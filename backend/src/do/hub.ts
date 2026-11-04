/**
 * Fan-out of live frames to every open stream for a session.
 *
 * A stream is not owned by the turn that produced it. `POST /prompt` returns
 * one subscriber and `GET /events` returns another; both are ordinary HTTP
 * responses fed from the same broadcast. Requests for one session land on one
 * Durable Object, so the hub can live in its memory.
 *
 * Writes are never awaited. A subscriber that falls behind its backlog cap is
 * closed and dropped rather than throttled: reconnection is lossless — the
 * client returns with `since` and the log fills the gap — whereas making the
 * agent loop wait on a client that may have been backgrounded costs far more.
 * The common cause of a stalled subscriber is not a slow reader but a TCP
 * connection the server cannot yet tell is dead.
 */

import { encodeFrame, type Frame } from "./sse.ts";

const MAX_PENDING_WRITES = 64;
const HEARTBEAT = new TextEncoder().encode(": keepalive\n\n");

/** Synchronous, non-throwing output projection; must not mutate shared frames. */
export type MapFrame = (frame: Frame) => Frame;
const identity: MapFrame = frame => frame;

/** The returned function must stop future ticks for this subscription. */
type ScheduleHeartbeat = (tick: () => void, milliseconds: number) => () => void;
const scheduleHeartbeat: ScheduleHeartbeat = (tick, milliseconds) => {
  const timer = setInterval(tick, milliseconds);
  return () => clearInterval(timer);
};

class Subscriber {
  #pending = 0;
  #dead = false;
  #stopHeartbeat?: () => void;
  readonly #writer: WritableStreamDefaultWriter<Uint8Array>;
  readonly #onClose: () => void;

  constructor(writer: WritableStreamDefaultWriter<Uint8Array>, onClose = () => {},
    private readonly mapFrame: MapFrame = identity) {
    this.#writer = writer;
    this.#onClose = onClose;
    // Reader cancellation rejects closed even when no write is in flight.
    void writer.closed.then(() => this.#dispose(), () => this.#dispose());
  }

  startHeartbeat(schedule: ScheduleHeartbeat): void {
    if (!this.#dead) this.#stopHeartbeat = schedule(() => this.#offer(HEARTBEAT), 15_000);
  }

  #dispose(): void {
    if (this.#dead) return;
    this.#dead = true;
    this.#stopHeartbeat?.();
    this.#onClose();
  }

  offer(frame: Frame): boolean {
    return this.#offer(encodeFrame(this.mapFrame(frame)));
  }

  #offer(bytes: Uint8Array): boolean {
    if (this.#dead) return false;
    if (this.#pending >= MAX_PENDING_WRITES) {
      this.#dispose();
      // Abort releases queued writes even if the consumer never reads again.
      void this.#writer.abort(new Error("SSE subscriber backlog exceeded")).catch(() => {});
      return false;
    }
    this.#pending += 1;
    void this.#writer.write(bytes).then(
      () => { this.#pending -= 1; },
      () => this.#dispose(),
    );
    return true;
  }

  /** Stop scheduling immediately; never await a stalled consumer's drain. */
  close(): void {
    if (this.#dead) return;
    this.#dispose();
    void this.#writer.close().catch(() => {
      // A peer may cancel while its final queued frames are draining.
    });
  }
}

export class Hub {
  readonly #bySession = new Map<string, Set<Subscriber>>();

  constructor(private readonly schedule: ScheduleHeartbeat = scheduleHeartbeat) {}

  /**
   * Register a stream and hand back its readable end.
   *
   * `backlog` is written before any live frame reaches the subscriber, which
   * is what closes the gap between reading the log and joining the broadcast.
   * Caller must compute the backlog and call this in one synchronous block:
   * `sql.exec()` returns synchronously, so no broadcast can interleave.
   */
  subscribe(sessionId: string, backlog: readonly Frame[], mapFrame: MapFrame = identity): ReadableStream<Uint8Array> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    let set = this.#bySession.get(sessionId);
    if (!set) {
      set = new Set();
      this.#bySession.set(sessionId, set);
    }
    const subscribers = set;
    const subscriber = new Subscriber(writable.getWriter(), () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0 && this.#bySession.get(sessionId) === subscribers) {
        this.#bySession.delete(sessionId);
      }
    }, mapFrame);
    set.add(subscriber);
    for (const frame of backlog) subscriber.offer(frame);
    subscriber.startHeartbeat(this.schedule);
    return readable;
  }

  /**
   * A stream that carries only the backlog and the terminator.
   *
   * Used when no turn is running: the caller gets every record after its
   * cursor and the stream closes, so it never becomes a subscriber and never
   * holds the Durable Object in memory.
   */
  finite(backlog: readonly Frame[], tail: Frame, mapFrame: MapFrame = identity): ReadableStream<Uint8Array> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const subscriber = new Subscriber(writable.getWriter(), undefined, mapFrame);
    for (const frame of backlog) subscriber.offer(frame);
    subscriber.offer(tail);
    subscriber.close();
    return readable;
  }

  broadcast(sessionId: string, frame: Frame): void {
    const set = this.#bySession.get(sessionId);
    if (!set) return;
    for (const subscriber of [...set]) {
      if (!subscriber.offer(frame)) {
        subscriber.close();
        set.delete(subscriber);
      }
    }
    if (set.size === 0) this.#bySession.delete(sessionId);
  }

  /**
   * Send the terminator to every subscriber and close them.
   *
   * Synchronous by design: a turn must be able to finish without waiting on
   * any client to consume its last frames.
   */
  closeAll(sessionId: string, tail: Frame): void {
    const set = this.#bySession.get(sessionId);
    if (!set) return;
    this.#bySession.delete(sessionId);
    for (const subscriber of set) {
      subscriber.offer(tail);
      subscriber.close();
    }
  }

  count(sessionId: string): number {
    return this.#bySession.get(sessionId)?.size ?? 0;
  }
}
