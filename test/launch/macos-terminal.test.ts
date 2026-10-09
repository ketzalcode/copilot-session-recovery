import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildAppleTerminalScript,
  createMacTerminalLauncher,
  LAUNCH_NEXT_COMMAND,
} from "../../src/launch/macos-terminal.ts";
import type { RecoveryTab } from "../../src/launch/recovery-plan.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

const runtimeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "runtime",
  "macos-terminal",
);

function runtimePath(name: string): string {
  return path.join(runtimeRoot, `${process.pid}-${randomUUID()}-${name}`);
}

function recoveryTabs(): RecoveryTab[] {
  return [
    {
      sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      cwd: "/Users/ruben/src/ms-pal",
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
      cwd: "/Users/ruben/src/approvals",
      title: "approvals - 95d2d9b",
      launcherProfile: "copilot",
      process: {
        executable: "copilot",
        args: ["--resume=95d2d9b1-0e6a-48c1-afd6-8a7598128f43"],
      },
      lastSeenAt: "2026-10-05T18:01:00.000Z",
    },
  ];
}

function createPaths(root: string): AppPaths {
  return {
    appDir: root,
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(root, "copilot-session-recovery.json"),
    launchPlanFile: path.join(root, "launch-plan.json"),
    launchPlanLockFile: path.join(root, "launch-plan.lock"),
  };
}

async function createRuntimePaths(t: test.TestContext): Promise<AppPaths> {
  const root = runtimePath("state");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return createPaths(root);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

test("buildAppleTerminalScript stays static and uses bounded polling before sending the broker command to new tabs", () => {
  const script = buildAppleTerminalScript();

  assert.match(script, /copilot-session-recovery launch-next/);
  assert.doesNotMatch(script, /sessionId|cwd|launcherProfile|--resume=/);
  assert.match(script, /keystroke "t" using command down/);
  assert.match(script, /set tabCount to item 1 of argv as integer/);
  assert.match(script, /frontmost of process "Terminal"/);
  assert.match(script, /set previousTabCount to count of tabs of front window/);
  assert.match(script, /set previousSelectedTabIndex to index of selected tab of front window/);
  assert.match(script, /if currentTabCount > previousTabCount then/);
  assert.match(script, /set currentSelectedTabIndex to index of selected tab of front window/);
  assert.match(script, /if currentSelectedTabIndex is not previousSelectedTabIndex then/);
  assert.match(
    script,
    /Timed out waiting for Apple Terminal to become frontmost\./,
  );
  assert.match(
    script,
    /Timed out waiting for Apple Terminal to open a new selected tab\./,
  );
  assert.doesNotMatch(script, /delay 0\.2/);
  assert.equal(
    script.match(/copilot-session-recovery launch-next/g)?.length,
    2,
  );
});

test("createMacTerminalLauncher previews the broker command without touching the launch plan", async (t) => {
  const paths = await createRuntimePaths(t);
  const launcher = createMacTerminalLauncher(paths);

  assert.equal(
    launcher.preview(recoveryTabs().slice(0, 1), paths),
    `Apple Terminal tab count: 1\n${LAUNCH_NEXT_COMMAND}`,
  );
  assert.equal(await pathExists(paths.launchPlanFile), false);
});

test("createMacTerminalLauncher writes the launch plan before running osascript with only the static script and tab count", async (t) => {
  const paths = await createRuntimePaths(t);
  const calls: Array<{ executable: string; args: string[] }> = [];
  const launcher = createMacTerminalLauncher(paths, async (spec) => {
    assert.equal(await pathExists(paths.launchPlanFile), true);
    calls.push({
      executable: spec.executable,
      args: spec.args,
    });
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  });

  assert.deepEqual(
    await launcher.launch(recoveryTabs(), paths),
    {
      exitCode: 0,
      stdout: "",
      stderr: "",
    },
  );
  assert.deepEqual(calls[0], {
    executable: "/usr/bin/osascript",
    args: ["-e", buildAppleTerminalScript(), "2"],
  });
});

test("createMacTerminalLauncher rewrites known automation denials with an actionable message and preserves the plan", async (t) => {
  const paths = await createRuntimePaths(t);
  const launcher = createMacTerminalLauncher(paths, async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "execution error: Not authorized to send Apple events to Terminal. (-1743)\n",
  }));

  const result = await launcher.launch(recoveryTabs().slice(0, 1), paths);

  assert.equal(result.exitCode, 1);
  assert.match(
    result.stderr,
    /System Settings > Privacy & Security > Automation/,
  );
  assert.match(result.stderr, /launch plan was preserved/i);
  assert.equal(await pathExists(paths.launchPlanFile), true);
  const planText = await readFile(paths.launchPlanFile, "utf8");
  assert.match(planText, /"status": "pending"/);
});

test("createMacTerminalLauncher rewrites System Events accessibility denials with focused guidance and preserves the plan", async (t) => {
  const paths = await createRuntimePaths(t);
  const launcher = createMacTerminalLauncher(paths, async () => ({
    exitCode: 1,
    stdout: "",
    stderr:
      "execution error: System Events got an error: osascript is not allowed to send keystrokes. (-25211)\n",
  }));

  const result = await launcher.launch(recoveryTabs().slice(0, 1), paths);

  assert.equal(result.exitCode, 1);
  assert.match(
    result.stderr,
    /System Settings > Privacy & Security > Accessibility/,
  );
  assert.doesNotMatch(result.stderr, /Privacy & Security > Automation/);
  assert.match(result.stderr, /launch plan was preserved/i);
  assert.equal(await pathExists(paths.launchPlanFile), true);
  const planText = await readFile(paths.launchPlanFile, "utf8");
  assert.match(planText, /"status": "pending"/);
});
