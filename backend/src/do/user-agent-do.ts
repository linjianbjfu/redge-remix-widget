/**
 * Session storage for a user, or one of the twenty direct-generation pool objects.
 *
 * The router chooses user identity for sessions and a time bucket for direct
 * generation. Direct requests isolate and clean their temporary workspaces.
 * Nothing in memory is durable: the object is evicted routinely
 * and rebuilt from SQLite.
 */

import { DurableObject } from "cloudflare:workers";

import { handle, type HandlerDeps, type StartTurn } from "./handlers.ts";
import { Hub } from "./hub.ts";
import { streamEndFrame } from "./sse.ts";
import { Store } from "./store.ts";
import { decideAlarm, KEEPALIVE_MS, STALE_MS, TURN_RETENTION_MS } from "./turns.ts";
import { initializeSchema } from "../fs/schema.ts";
import { WorkspaceFs } from "../fs/workspace-fs.ts";
import {GENERATION_PATH, NO_CACHE_HEADERS, type GenerationRequest, type GenerationResult} from "../generation.ts";

export type Env = Cloudflare.Env;

export class UserAgentDO extends DurableObject<Env> {
  readonly #sql: SqlStorage;
  readonly #store: Store;
  readonly #hub = new Hub();
  #alarmSchedule: Promise<void> = Promise.resolve();
  readonly #workspaces = new Map<string, WorkspaceFs>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#sql = ctx.storage.sql;
    initializeSchema(this.#sql);
    this.#store = new Store(this.#sql, body => ctx.storage.transactionSync(body));
  }

  /** Test seam: the schema handle is private but tests build their own façades. */
  get sqlForTest(): SqlStorage {
    return this.#sql;
  }

  /** Test seam: lets a test set up turn state without going through HTTP. */
  get storeForTest(): Store {
    return this.#store;
  }

  workspace(sessionId: string): WorkspaceFs {
    let fs = this.#workspaces.get(sessionId);
    if (!fs) {
      fs = new WorkspaceFs(this.#sql, sessionId);
      this.#workspaces.set(sessionId, fs);
    }
    return fs;
  }

  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === GENERATION_PATH) return this.#generate(request);
    return handle(request, this.#deps());
  }

  generationRunner = async (input: GenerationRequest, fs: WorkspaceFs, sessionId: string): Promise<GenerationResult> => {
    const {generateWidget} = await import("../agent/generate.ts");
    return generateWidget(this.env, fs, sessionId, input);
  };

  async #generate(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({status: "Error", error: "method_not_allowed"},
      {status: 405, headers: {...NO_CACHE_HEADERS, allow: "POST"}});
    let input: GenerationRequest;
    try { input = await request.json<GenerationRequest>(); }
    catch { return Response.json({status: "Error", error: "invalid_json"}, {status: 400, headers: NO_CACHE_HEADERS}); }
    const sessionId = crypto.randomUUID();
    this.#store.createSession(sessionId);
    try {
      const result = await this.generationRunner(input, this.workspace(sessionId), sessionId);
      return Response.json(result, {headers: NO_CACHE_HEADERS});
    } catch {
      return Response.json({status: "Error", error: "generation_failed"}, {status: 500, headers: NO_CACHE_HEADERS});
    } finally {
      this.#store.deleteSession(sessionId);
      this.#workspaces.delete(sessionId);
    }
  }

  #deps(): HandlerDeps {
    return {
      store: this.#store,
      hub: this.#hub,
      workspace: id => this.workspace(id),
      startTurn: input => this.turnRunner(input),
      newSessionId: () => crypto.randomUUID(),
      scheduleKeepalive: () => void this.#scheduleKeepalive(),
    };
  }

  /**
   * How a turn is executed.
   *
   * Replaceable because the real runner imports pi's package root, which the
   * Workers test pool resolves to an extension loader needing `node:process`
   * and then cannot run. Everything around the runner — the alarm's keepalive
   * and recovery branches, the event log, the subscriber hub — is testable
   * only if the runner itself can be swapped out. The import stays dynamic so
   * pi is never pulled in merely by constructing the object.
   */
  turnRunner: StartTurn = async ({ sessionId, turnId }) => {
    if (!this.#store.session(sessionId)) return;
    const { runTurn } = await import("../agent/run-turn.ts");
    await runTurn({
      env: this.env,
      store: this.#store,
      hub: this.#hub,
      fs: this.workspace(sessionId),
      sessionId,
      turnId,
    });
  };

  /**
   * Re-arm while any turn is running.
   *
   * The firing itself is the point: an alarm is an inbound event, and inbound
   * events are what reset the object's inactivity timer. A detached turn with
   * neither an inbound request nor an alarm is killed at 70 seconds.
   */
  async #scheduleKeepalive(): Promise<void> {
    await this.#scheduleAlarm(Date.now() + KEEPALIVE_MS);
  }

  #scheduleAlarm(deadline: number): Promise<void> {
    const scheduled = this.#alarmSchedule.then(async () => {
      const current = await this.ctx.storage.getAlarm();
      if (current === null || current > deadline) await this.ctx.storage.setAlarm(deadline);
    });
    this.#alarmSchedule = scheduled.catch(() => { console.error('alarm_schedule_failed'); });
    return this.#alarmSchedule;
  }

  override async alarm(): Promise<void> {
    const stale = this.#store.staleTurns(STALE_MS);
    const decision = decideAlarm(stale, this.#store.hasRunningTurn(), Date.now());

    for (const { sessionId, turnId, reason } of decision.abandon) {
      this.#store.endTurn(sessionId, turnId, "failed");
      const rows = this.#store.append(sessionId, [
        {
          turnId,
          kind: "error",
          payload: { turnId, code: reason, message: `turn ${reason}`, retryable: true },
        },
        { turnId, kind: "turn_end", payload: { turnId, reason: "failed", out: [] } },
      ]);
      for (const row of rows) {
        this.#hub.broadcast(sessionId, {
          event: row.kind === "pi_entry" ? "entry" : row.kind,
          data: JSON.parse(row.payload) as unknown,
          seq: row.seq,
        });
      }
      this.#hub.closeAll(sessionId, streamEndFrame(false));
    }

    for (const { sessionId, turnId } of decision.resume) {
      this.#store.countRecovery(sessionId, turnId);
      void this.turnRunner({ sessionId, turnId, text: "" });
    }

    this.#store.pruneTurns(TURN_RETENTION_MS);
    if (decision.rearm) await this.#scheduleAlarm(Date.now() + KEEPALIVE_MS);
  }
}
