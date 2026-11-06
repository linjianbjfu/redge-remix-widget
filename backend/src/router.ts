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
 * Direct generation uses twenty time buckets and does not require user identity.
 */

import type { Env } from "./do/user-agent-do.ts";
import {GENERATION_PATH, NO_CACHE_HEADERS, generationObjectName} from "./generation.ts";

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

export async function route(request: Request, env: Env, _ctx: ExecutionContext, tick = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === GENERATION_PATH) {
    if (request.method !== "POST") return Response.json({status: "Error", error: "method_not_allowed"},
      {status: 405, headers: {...NO_CACHE_HEADERS, allow: "POST"}});
    const headers = new Headers({"content-type": "application/json"});
    for (const name of ["Sec-MS-GEC", "Sec-MS-GEC-Version"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const stub = env.AGENT.get(env.AGENT.idFromName(generationObjectName(tick)));
    return stub.fetch(new Request(request, {headers, cache: "no-store"}));
  }
  if (url.pathname !== '/v1/sessions' && !url.pathname.startsWith('/v1/sessions/')) {
    return jsonError(404, { error: 'not_found' });
  }
  const userId = resolveUserId(request);
  if (!userId) return jsonError(400, { error: "missing_user", header: USER_HEADER });

  const stub = env.AGENT.get(env.AGENT.idFromName(userId));
  return stub.fetch(request);
}
