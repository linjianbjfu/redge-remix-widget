/** Shared pi construction. Callers own all instructions and tool selection. */
import {
  buildSessionContext,
  createAgentSession,
  SessionManager,
  type CreateAgentSessionOptions,
  type SessionContext,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";

function relink(entries: readonly unknown[]): SessionContext | undefined {
  const seen = new Set<string>();
  const chain: SessionEntry[] = [];
  let previousId: string | null = null;
  for (const raw of entries) {
    const entry = raw as SessionEntry & { id: string; parentId: string | null };
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entry.parentId = previousId;
    previousId = entry.id;
    chain.push(entry);
  }
  // `buildSessionContext` truncates at the last compaction entry, so passing
  // the whole chain does not undo a compaction.
  return chain.length > 0 ? buildSessionContext(chain, previousId) : undefined;
}

export async function openCoreSession(
  options: Omit<CreateAgentSessionOptions, "sessionManager">,
  history: readonly unknown[],
) {
  const restored = relink(history);
  const manager = SessionManager.inMemory();
  const { session } = await createAgentSession({
    ...options,
    sessionManager: manager,
  });
  if (restored) {
    (
      session as unknown as { agent: { state: { messages: unknown[] } } }
    ).agent.state.messages = [...restored.messages];
  }
  return {
    session,
    manager,
    persistedEntries: history.length ? manager.getEntries().length : 0,
    briefed: history.length > 0,
  };
}
