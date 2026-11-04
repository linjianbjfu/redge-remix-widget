import {env, runDurableObjectAlarm, runInDurableObject} from 'cloudflare:test';
import {expect, it} from 'vitest';
import {initializeSchema} from '../fs/schema.ts';
import type {UserAgentDO} from './user-agent-do.ts';

const object = () => env.AGENT.get(env.AGENT.idFromName(crypto.randomUUID()));

it('initializes only web storage and preserves pre-purpose web sessions', async () => {
  const stub = object();
  await runInDurableObject(stub, async (instance: UserAgentDO, ctx) => {
    const sql = instance.sqlForTest;
    expect(sql.exec<{name: string}>("SELECT name FROM sqlite_master WHERE type='table'").toArray()
      .some(row => /widgee|analytics|gallery|admin/.test(row.name))).toBe(false);
    const columns = sql.exec<{name: string}>('PRAGMA table_info(sessions)').toArray().map(row => row.name);
    for (const column of ['sdk_revision', 'prompt_version', 'title_source']) expect(columns).not.toContain(column);
    expect(sql.exec<{name: string}>('PRAGMA table_info(turns)').toArray().map(row => row.name)).not.toContain('execution_id');

    await ctx.storage.deleteAll();
    sql.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, model TEXT, thinking_level TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    sql.exec("INSERT INTO sessions(id,title,created_at,updated_at) VALUES('legacy','old web page',1,1)");
    initializeSchema(sql);
    initializeSchema(sql);
    expect(instance.storeForTest.session('legacy')).toMatchObject({title: 'old web page', purpose: 'webclip'});
    expect(instance.storeForTest.createSession('new').purpose).toBe('webclip');
    expect(instance.storeForTest.listSessions().map(row => row.id).sort()).toEqual(['legacy', 'new']);
  });
});

it.each(['widgee', 'unknown-product'])('isolates stored %s sessions from web HTTP and deletion', async purpose => {
  const stub = object();
  await runInDurableObject(stub, async (instance: UserAgentDO) => {
    const sql = instance.sqlForTest;
    sql.exec('INSERT INTO sessions(id,purpose,created_at,updated_at) VALUES(?,?,1,1)', 'native', purpose);
    sql.exec("INSERT INTO events VALUES('native',1,'old','pi_entry','{\"private\":true}')");
    // Historical tables and extra columns may remain; opening web storage must not alter their content.
    sql.exec('CREATE TABLE widgee_revisions(session_id TEXT, payload TEXT)');
    sql.exec("INSERT INTO widgee_revisions VALUES('native','preserve')");
    sql.exec('ALTER TABLE sessions ADD COLUMN sdk_revision TEXT');
    initializeSchema(sql);
    instance.storeForTest.createSession('web');
    expect(instance.storeForTest.session('native')).toBeUndefined();
    instance.storeForTest.deleteSession('native');
  });
  const list = await (await stub.fetch('https://test/v1/sessions')).json<{sessions: {id: string}[]}>();
  expect(list.sessions.map(row => row.id)).toEqual(['web']);
  for (const [path, method] of [['', 'GET'], ['', 'DELETE'], ['/events', 'GET'], ['/prompt', 'POST'], ['/abort', 'POST']]) {
    const response = await stub.fetch(new Request('https://test/v1/sessions/native' + path, {method: method!}));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({error: 'not_found'});
  }
  await runInDurableObject(stub, async (instance: UserAgentDO) => {
    const sql = instance.sqlForTest;
    expect(sql.exec("SELECT id FROM sessions WHERE id='native'").toArray()).toHaveLength(1);
    expect(sql.exec("SELECT payload FROM events WHERE session_id='native'").one().payload).toBe('{"private":true}');
    expect(sql.exec('SELECT payload FROM widgee_revisions').one().payload).toBe('preserve');
    expect(sql.exec("SELECT * FROM turns WHERE session_id='native'").toArray()).toEqual([]);
  });
});

it('recovers and prunes web turns while leaving historical native turns dormant', async () => {
  const stub = object(), resumed: string[] = [];
  await runInDurableObject(stub, async (instance: UserAgentDO, ctx) => {
    const sql = instance.sqlForTest, store = instance.storeForTest;
    store.createSession('web');
    sql.exec("INSERT INTO sessions(id,purpose,created_at,updated_at) VALUES('native','widgee',1,1)");
    for (const id of ['web', 'native']) {
      sql.exec(`INSERT INTO turns(session_id,turn_id,status,started_at,last_progress_at,prompt)
        VALUES(?,'running','running',?,?,'do not mix products')`, id, Date.now() - 200_000, Date.now() - 200_000);
      sql.exec(`INSERT INTO turns(session_id,turn_id,status,started_at,last_progress_at,ended_at,prompt)
        VALUES(?,'old','completed',1,1,1,'history')`, id);
    }
    instance.turnRunner = async ({sessionId}) => {resumed.push(sessionId);};
    expect(store.staleTurns(95_000).map(row => row.session_id)).toEqual(['web']);
    expect(store.hasRunningTurn()).toBe(true);
    await ctx.storage.setAlarm(Date.now() + 1000);
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  await runInDurableObject(stub, async (instance: UserAgentDO) => {
    const store = instance.storeForTest;
    expect(resumed).toEqual(['web']);
    expect(store.turn('web', 'running')?.recoveries).toBe(1);
    expect(store.turn('native', 'running')?.recoveries).toBe(0);
    expect(store.turn('native', 'old')?.status).toBe('completed');
    expect(store.turn('web', 'old')).toBeUndefined();
    store.endTurn('web', 'running', 'completed');
    expect(store.hasRunningTurn()).toBe(false);
  });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  await runInDurableObject(stub, async (instance: UserAgentDO, ctx) => {
    expect(await ctx.storage.getAlarm()).toBeNull();
    expect(instance.storeForTest.turn('native', 'running')?.status).toBe('running');
  });
});

it('does not start the web runner for a historical native session', async () => {
  await runInDurableObject(object(), async (instance: UserAgentDO) => {
    instance.sqlForTest.exec("INSERT INTO sessions(id,purpose,created_at,updated_at) VALUES('native','widgee',1,1)");
    await instance.turnRunner({sessionId: 'native', turnId: 't', text: ''});
    expect(instance.storeForTest.turn('native', 't')).toBeUndefined();
  });
});
