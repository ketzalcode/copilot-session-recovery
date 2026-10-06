const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_ID_PREFIX_PATTERN = /^[0-9a-f]{7,32}$/i;

function normalizeSessionId(value: string): string {
  return value.replaceAll("-", "").toLowerCase();
}

function isHexPrefix(value: string): boolean {
  return SESSION_ID_PREFIX_PATTERN.test(value.replaceAll("-", ""));
}

export function isSessionId(value: string): boolean {
  return SESSION_ID_PATTERN.test(value);
}

export function resolveSessionIdPrefix(
  sessionIds: readonly string[],
  prefix: string,
): string {
  const compactPrefix = prefix.replaceAll("-", "").toLowerCase();

  if (!isSessionId(prefix) && !isHexPrefix(prefix)) {
    throw new Error(
      "Session ID prefixes must contain at least seven hexadecimal characters.",
    );
  }

  const matches = sessionIds.filter(
    (sessionId) => normalizeSessionId(sessionId).startsWith(compactPrefix),
  );

  if (matches.length === 0) {
    throw new Error(`No session matches prefix "${prefix}".`);
  }
  if (matches.length > 1) {
    throw new Error(`Session prefix "${prefix}" is ambiguous.`);
  }

  return matches[0]!;
}
