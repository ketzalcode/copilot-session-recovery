import assert from "node:assert/strict";
import test from "node:test";

import { expandProfile } from "../../src/launch/profile.ts";
import type { SessionRecord } from "../../src/session/model.ts";

const session = {
  sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
  cwd: "C:\\src\\folder with spaces",
  launcherProfile: "agency",
  source: "resume",
  startedAt: "2026-10-05T18:00:00.000Z",
  lastSeenAt: "2026-10-05T18:01:00.000Z",
} satisfies SessionRecord;

test("expands arguments without joining them into a shell string", () => {
  assert.deepEqual(
    expandProfile(
      {
        executable: "agency",
        args: ["copilot", "--resume={sessionId}", "--add-dir", "{cwd}"],
      },
      session,
    ),
    {
      executable: "agency",
      args: [
        "copilot",
        "--resume=502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
        "--add-dir",
        "C:\\src\\folder with spaces",
      ],
    },
  );
});
