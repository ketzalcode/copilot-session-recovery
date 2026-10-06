import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWindowsTerminalArgs,
} from "../../src/launch/windows-terminal.ts";

test("creates one new window with one new-tab command per session", () => {
  const args = buildWindowsTerminalArgs([
    {
      sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      cwd: "C:\\src\\ms-pal",
      title: "ms-pal - 502ed8c",
      launcherProfile: "agency",
      process: {
        executable: "agency",
        args: ["copilot", "--resume=502ed8ca-ce22-4e92-b6a7-34eaec25c59d"],
      },
      lastSeenAt: "2026-10-05T18:00:00.000Z",
    },
    {
      sessionId: "95d2d9b1-0e6a-48c1-afd6-8a7598128f43",
      cwd: "C:\\src\\approvals",
      title: "approvals - 95d2d9b",
      launcherProfile: "copilot",
      process: {
        executable: "copilot",
        args: ["--resume=95d2d9b1-0e6a-48c1-afd6-8a7598128f43"],
      },
      lastSeenAt: "2026-10-05T18:01:00.000Z",
    },
  ]);

  assert.deepEqual(args, [
    "-w",
    "new",
    "new-tab",
    "--title",
    "ms-pal - 502ed8c",
    "--startingDirectory",
    "C:\\src\\ms-pal",
    "agency",
    "copilot",
    "--resume=502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
    ";",
    "new-tab",
    "--title",
    "approvals - 95d2d9b",
    "--startingDirectory",
    "C:\\src\\approvals",
    "copilot",
    "--resume=95d2d9b1-0e6a-48c1-afd6-8a7598128f43",
  ]);
});
