import {env} from 'cloudflare:test';
import {describe, expect, it, vi} from 'vitest';
import {route} from './router.ts';

const context = {} as ExecutionContext;
function request(path: string, user?: string, body?: unknown) {
  return new Request('https://worker.example' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {'content-type': 'application/json', ...(user ? {'x-webclip-user': user} : {})},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  });
}

describe('web session routing', () => {
  it('reuses one user DO and isolates another client', async () => {
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    const response = await route(request('/v1/sessions', a, {title: 'web page'}), env, context);
    expect(response.status).toBe(201);
    const {sessionId} = await response.json<{sessionId: string}>();
    const list = async (user: string) => (await route(request('/v1/sessions', user), env, context)).json<{sessions: {id: string}[]}>();
    expect((await list(a)).sessions.map(s => s.id)).toContain(sessionId);
    expect((await list(b)).sessions).toEqual([]);
    expect((await route(request(`/v1/sessions/${sessionId}/events`, b), env, context)).status).toBe(404);
    expect((await route(request(`/v1/sessions/${sessionId}/events`, a), env, context)).status).toBe(200);
  });

  it.each([undefined, ' ', 'x'.repeat(201)])('rejects missing or invalid identity: %s', async user => {
    const response = await route(request('/v1/sessions', user), env, context);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({error: 'missing_user'});
  });

  it('accepts a trimmed identity at the length limit', async () => {
    expect((await route(request('/v1/sessions', ' ' + 'x'.repeat(200) + ' '), env, context)).status).toBe(200);
  });

  it.each(['/v1/widgee/sessions', '/v1/widgee/shared-widgets', '/v1/admin/shared-widgets',
    '/v1/admin/users', '/v1/admin/auth', '/v1/analytics/events', '/public-assets/widget.js',
    '/admin', '/admin/index.html', '/v1/sessions-extra', '/v1/unknown', '/'])
  ('returns 404 for removed or unknown routes without waking a DO: %s', async path => {
    const get = vi.fn(() => {throw new Error('Unsupported routes must not reach a DO');});
    const fake = {...env, AGENT: new Proxy(env.AGENT, {get(target, key) {
      return key === 'get' ? get : Reflect.get(target, key);
    }})};
    for (const user of [undefined, crypto.randomUUID()]) {
      const response = await route(request(path, user), fake, context);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({error: 'not_found'});
    }
    expect(get).not.toHaveBeenCalled();
  });
});
