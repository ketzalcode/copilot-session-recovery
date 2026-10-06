export const SESSION_REGISTRY_SCHEMA_VERSION = 1 as const;

export type SessionStartSource = "startup" | "resume" | "new";
export type SessionEndReason =
  | "complete"
  | "error"
  | "abort"
  | "timeout"
  | "user_exit";

export interface SessionRecord {
  sessionId: string;
  cwd: string;
  launcherProfile: string;
  source: SessionStartSource;
  startedAt: string;
  lastSeenAt: string;
}

export interface SessionRegistry {
  schemaVersion: typeof SESSION_REGISTRY_SCHEMA_VERSION;
  sessions: Record<string, SessionRecord>;
}

export interface SessionStartEvent {
  type: "start";
  sessionId: string;
  cwd: string;
  source: SessionStartSource;
  timestamp: number;
}

export interface SessionEndEvent {
  type: "end";
  sessionId: string;
  cwd: string;
  reason: SessionEndReason;
  timestamp: number;
}

export type SessionLifecycleEvent = SessionStartEvent | SessionEndEvent;
