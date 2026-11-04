/** Imported only by the temporary maintenance entry, never by src/index.ts. */
import {DurableObject} from 'cloudflare:workers';
import {UserAgentDO as ApplicationDO, type Env} from '../do/user-agent-do.ts';
import {checkAuth} from '../auth.ts';

export const CLEANUP_PATH = '/__maintenance/cleanup-do';
export interface CleanupPolicy {token: string; expiresAt: number; ids: string[]; forceId: string | null; apply: boolean}
export interface CleanupResult {status: 'candidate' | 'preserved' | 'busy' | 'deleted' | 'failed'; sessions?: number | null; error?: string}
const objectID = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
const tables = (storage: DurableObjectStorage) => storage.sql.exec<{name: string}>(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'").toArray().map(row => row.name);

/** No migrations: missing or unreadable schemas are never evidence of an empty historical object. */
export async function inspectStorage(storage: DurableObjectStorage): Promise<number> {
  const names = tables(storage);
  if (!names.includes('sessions')) {
    if (names.length || (await storage.list({limit: 1})).size) throw new Error('unknown_schema');
    return 0;
  }
  return storage.sql.exec<{count: number}>('SELECT COUNT(*) AS count FROM sessions').one().count;
}

/** The gate covers the final check and atomic deleteAll, including concurrent inbound business requests. */
export async function cleanupStorage(ctx: DurableObjectState, force: boolean, apply: boolean,
  active: () => boolean): Promise<CleanupResult> {
  return ctx.blockConcurrencyWhile(async () => {
    if (active()) return {status: 'busy'};
    try {
      let sessions: number | null = null;
      if (!force) {
        sessions = await inspectStorage(ctx.storage);
        if (sessions > 0) return {status: 'preserved', sessions};
        if (tables(ctx.storage).includes('turns') && ctx.storage.sql.exec(
          "SELECT 1 FROM turns WHERE status='running' LIMIT 1").toArray().length) return {status: 'busy'};
      } else if (!apply) {
        try {sessions = await inspectStorage(ctx.storage);} catch { /* Explicit ID preview can describe an unreadable target. */ }
      }
      if (!apply) return {status: 'candidate', sessions};
      // For SQLite and this compatibility date deleteAll is atomic and also removes the alarm.
      await ctx.storage.deleteAll();
      if (tables(ctx.storage).length || (await ctx.storage.list({limit: 1})).size || await ctx.storage.getAlarm() !== null)
        return {status: 'failed', error: 'delete_verification_failed'};
      return {status: 'deleted', sessions};
    } catch {return {status: 'failed', error: apply ? 'check_or_delete_failed' : 'storage_read_failed'};}
  });
}

/** Lazy delegation avoids creating schema or recovering turns solely to inspect/delete an object. */
export class MaintenanceUserAgentDO extends DurableObject<Env> {
  private application: ApplicationDO | undefined;
  private deleted = false;
  private accessed = false;
  private policy: CleanupPolicy;
  constructor(ctx: DurableObjectState, env: Env, policy: CleanupPolicy) {super(ctx, env); this.policy = policy;}
  private app() {
    this.accessed = true; this.deleted = false;
    return this.application ??= new ApplicationDO(this.ctx, this.env);
  }
  override fetch(request: Request) {return this.app().fetch(request);}
  override async alarm() {if (!this.deleted) await this.app().alarm();}
  async cleanup(token: string): Promise<CleanupResult> {
    if (!checkAuth(new Request('https://maintenance.invalid', {headers: {Authorization: `Bearer ${token}`}}), this.policy.token).ok
      || Date.now() >= this.policy.expiresAt || !this.policy.ids.includes(this.ctx.id.toString()))
      return {status: 'failed', error: 'maintenance_not_authorized'};
    // Any delegated request may leave asynchronous model or alarm work behind; never delete under it.
    const result = await cleanupStorage(this.ctx, this.policy.forceId === this.ctx.id.toString(), this.policy.apply,
      () => this.accessed);
    if (result.status === 'deleted') this.deleted = true;
    return result;
  }
}

export async function handleCleanup(request: Request, env: Env, policy: CleanupPolicy): Promise<Response> {
  const reply = (data: unknown, status = 200) => Response.json(data, {status, headers: {'Cache-Control': 'no-store'}});
  if (!checkAuth(request, policy.token).ok) return reply({error: 'unauthorized'}, 401);
  if (request.method !== 'POST') return reply({error: 'method_not_allowed'}, 405);
  if (Date.now() >= policy.expiresAt) return reply({error: 'maintenance_expired'}, 410);
  try {
    const text = await request.text();
    if (text.length > 1024) return reply({error: 'invalid_input'}, 400);
    const input = JSON.parse(text) as {id?: unknown};
    if (!objectID(input?.id) || !policy.ids.includes(input.id)) return reply({error: 'invalid_object_id'}, 400);
    const stub = env.AGENT.get(env.AGENT.idFromString(input.id)) as unknown as DurableObjectStub<MaintenanceUserAgentDO>;
    return reply(await stub.cleanup(policy.token));
  } catch {return reply({error: 'maintenance_request_failed'}, 502);}
}
