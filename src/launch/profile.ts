import type { LauncherProfile } from "../config/config.ts";
import type { SessionRecord } from "../session/model.ts";
import type { ProcessSpec } from "./process-runner.ts";

const TOKEN_PATTERN = /\{(sessionId|cwd|sessionIdPrefix)\}/g;

export function expandProfile(
  profile: LauncherProfile,
  session: SessionRecord,
): ProcessSpec {
  const values = {
    sessionId: session.sessionId,
    cwd: session.cwd,
    sessionIdPrefix: session.sessionId.replaceAll("-", "").slice(0, 7),
  };

  return {
    executable: profile.executable,
    args: profile.args.map((argument) =>
      argument.replace(
        TOKEN_PATTERN,
        (_, key: keyof typeof values) => values[key],
      ),
    ),
  };
}
