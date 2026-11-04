/**
 * Worker-side routing.
 *
 * Session requests resolve the caller's identity and forward to that user's
 * Durable Object. Session routing is by `idFromName(userId)`, so
 * every request for one user lands on one instance and can share the
 * subscriber hub and the live pi sessions held in its memory.
 *
 * Clients send a stable identifier as x-webclip-user.
 * The declared id selects a Durable Object; it is not authenticated.
 */

import type { Env } from "./do/user-agent-do.ts";

const USER_HEADER = "x-webclip-user";

export interface RouteError {
  error: string;
  [key: string]: unknown;
}

export function jsonError(status: number, body: RouteError): Response {
  return Response.json(body, { status });
}

function resolveUserId(request: Request): string | undefined {
  const raw = request.headers.get(USER_HEADER)?.trim();
  return raw && raw.length > 0 && raw.length <= 200 ? raw : undefined;
}

export async function route(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/v1/sessions' && !url.pathname.startsWith('/v1/sessions/')) {
    return jsonError(404, { error: 'not_found' });
  }
  const userId = resolveUserId(request);
  if (!userId) return jsonError(400, { error: "missing_user", header: USER_HEADER });

  const stub = env.AGENT.get(env.AGENT.idFromName(userId));
  return stub.fetch(request);
}
