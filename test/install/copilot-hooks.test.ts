import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCopilotHookConfig,
  writeCopilotHookConfig,
} from "../../src/install/copilot-hooks.ts";
import type { RuntimeInstallation } from "../../src/runtime/installation.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

function createPaths(root: string): AppPaths {
  return {
    appDir: root,
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(
      root,
      ".copilot",
      "hooks",
      "copilot-session-recovery.json",
    ),
    launchPlanFile: path.join(root, "launch-plan.json"),
    launchPlanLockFile: path.join(root, "launch-plan.lock"),
  };
}

function createInstallation(root: string): RuntimeInstallation {
  return {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry: path.join(
      root,
      "node_modules",
      "copilot-session-recovery",
      "dist",
      "copilot-session-recovery.mjs",
    ),
  };
}

test("builds an owned node-plus-cli hook configuration", () => {
  const installation: RuntimeInstallation = {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry:
      "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
  };

  assert.deepEqual(
    buildCopilotHookConfig(installation),
    {
      version: 1,
      hooks: {
        sessionStart: [
          {
            type: "command",
            exec: installation.nodeExecutable,
            args: [installation.cliEntry, "hook", "session-start"],
            timeoutSec: 5,
          },
        ],
        sessionEnd: [
          {
            type: "command",
            exec: installation.nodeExecutable,
            args: [installation.cliEntry, "hook", "session-end"],
            timeoutSec: 5,
          },
        ],
      },
    },
  );
});

test("writes only the owned Copilot hook file", async (t) => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "copilot-session-recovery-hooks-"),
  );
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const paths = createPaths(root);
  const installation = createInstallation(root);
  const siblingHook = path.join(root, ".copilot", "hooks", "other-tool.json");

  await mkdir(path.dirname(siblingHook), { recursive: true });
  await writeFile(siblingHook, JSON.stringify({ ownedBy: "someone-else" }));

  await writeCopilotHookConfig(paths, installation);

  assert.deepEqual(
    JSON.parse(await readFile(paths.copilotHookFile, "utf8")),
    buildCopilotHookConfig(installation),
  );
  assert.deepEqual(
    JSON.parse(await readFile(siblingHook, "utf8")),
    { ownedBy: "someone-else" },
  );
});
