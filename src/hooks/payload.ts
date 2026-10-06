import type {
  SessionEndEvent,
  SessionEndReason,
  SessionStartEvent,
  SessionStartSource,
} from "../session/model.ts";
import { isSessionId } from "../session/ids.ts";

const START_KEYS = ["cwd", "sessionId", "source", "timestamp"] as const;
const END_KEYS = ["cwd", "reason", "sessionId", "timestamp"] as const;

const START_SOURCES = new Set<SessionStartSource>(["startup", "resume", "new"]);
const END_REASONS = new Set<SessionEndReason>([
  "complete",
  "error",
  "abort",
  "timeout",
  "user_exit",
]);

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Hook input must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function assertOnlyOfficialKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  hookName: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(
        `${hookName} hook input contains an unexpected field "${key}".`,
      );
    }
  }
}

function readCommonFields(value: unknown, hookName: string) {
  const input = readObject(value);
  assertOnlyOfficialKeys(input, hookName === "sessionStart" ? START_KEYS : END_KEYS, hookName);

  const sessionId = input.sessionId;
  if (typeof sessionId !== "string" || !isSessionId(sessionId)) {
    throw new Error(`${hookName} hook input contains an invalid sessionId.`);
  }

  const timestamp = input.timestamp;
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`${hookName} hook input contains an invalid timestamp.`);
  }

  const cwd = input.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) {
    throw new Error(`${hookName} hook input contains an invalid cwd.`);
  }

  return {
    sessionId: sessionId.toLowerCase(),
    timestamp,
    cwd,
  };
}

export function parseSessionStartPayload(value: unknown): SessionStartEvent {
  const { sessionId, timestamp, cwd } = readCommonFields(value, "sessionStart");
  const input = readObject(value);
  const source = input.source;

  if (typeof source !== "string" || !START_SOURCES.has(source as SessionStartSource)) {
    throw new Error("sessionStart hook input contains an invalid source.");
  }

  return {
    type: "start",
    sessionId,
    timestamp,
    cwd,
    source: source as SessionStartSource,
  };
}

export function parseSessionEndPayload(value: unknown): SessionEndEvent {
  const { sessionId, timestamp, cwd } = readCommonFields(value, "sessionEnd");
  const input = readObject(value);
  const reason = input.reason;

  if (typeof reason !== "string" || !END_REASONS.has(reason as SessionEndReason)) {
    throw new Error("sessionEnd hook input contains an invalid reason.");
  }

  return {
    type: "end",
    sessionId,
    timestamp,
    cwd,
    reason: reason as SessionEndReason,
  };
}
