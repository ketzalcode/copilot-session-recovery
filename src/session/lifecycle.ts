import {
  SESSION_REGISTRY_SCHEMA_VERSION,
  type SessionLifecycleEvent,
  type SessionRegistry,
} from "./model.ts";

const CLEAN_END_REASONS = new Set(["complete", "user_exit"]);

export function emptyRegistry(): SessionRegistry {
  return {
    schemaVersion: SESSION_REGISTRY_SCHEMA_VERSION,
    sessions: {},
  };
}

export function applyLifecycleEvent(
  registry: SessionRegistry,
  event: SessionLifecycleEvent,
  defaultProfile?: string,
): SessionRegistry {
  if (event.type === "end") {
    if (!CLEAN_END_REASONS.has(event.reason)) {
      return registry;
    }

    const sessions = { ...registry.sessions };
    delete sessions[event.sessionId];
    return { ...registry, sessions };
  }

  if (defaultProfile === undefined) {
    throw new Error("defaultProfile is required for start lifecycle events.");
  }

  const timestamp = new Date(event.timestamp).toISOString();
  const existing = registry.sessions[event.sessionId];
  const record = {
    sessionId: event.sessionId,
    cwd: event.cwd,
    launcherProfile: existing?.launcherProfile ?? defaultProfile,
    source: event.source,
    startedAt: existing?.startedAt ?? timestamp,
    lastSeenAt: timestamp,
  };

  return {
    ...registry,
    sessions: {
      ...registry.sessions,
      [event.sessionId]: record,
    },
  };
}
