import assert from "node:assert/strict";
import test from "node:test";

import type { RecoveryTab } from "../../src/launch/recovery-plan.ts";
import {
  buildWindowsTerminalArgs,
  createWindowsTerminalLauncher,
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

test("launcher delegates availability preview and launch to wt.exe", async () => {
  const terminal = createWindowsTerminalLauncher({
    commandExists: async (executable, platform) =>
      executable === "wt.exe" && platform === "win32",
    runProcess: async (spec) => {
      assert.equal(spec.executable, "wt.exe");
      assert.deepEqual(spec.args, [
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
      ]);
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
  });

  const tabs: RecoveryTab[] = [
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
  ];

  assert.equal(terminal.name, "Windows Terminal");
  assert.equal(terminal.command, "wt.exe");
  assert.equal(await terminal.available(), true);
  assert.equal(
    terminal.preview(tabs, {
      appDir: "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery",
      configFile:
        "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\config.json",
      registryFile:
        "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\sessions.json",
      lockFile:
        "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\sessions.lock",
      diagnosticsDir:
        "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\diagnostics",
      corruptDir:
        "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\corrupt",
      copilotHookFile:
        "C:\\Users\\ruben\\.copilot\\hooks\\copilot-session-recovery.json",
      launchPlanFile:
        "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\launch-plan.json",
      launchPlanLockFile:
        "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\launch-plan.lock",
    }),
    'wt.exe -w new new-tab --title "ms-pal - 502ed8c" --startingDirectory C:\\src\\ms-pal agency copilot --resume=502ed8ca-ce22-4e92-b6a7-34eaec25c59d',
  );
  assert.deepEqual(
    await terminal.launch(tabs, {
      appDir: "",
      configFile: "",
      registryFile: "",
      lockFile: "",
      diagnosticsDir: "",
      corruptDir: "",
      copilotHookFile: "",
      launchPlanFile: "",
      launchPlanLockFile: "",
    }),
    {
      exitCode: 0,
      stdout: "",
      stderr: "",
    },
  );
});
