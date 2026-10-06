import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCopilotHookConfig,
  writeCopilotHookConfig,
} from "../../src/install/copilot-hooks.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

function createPaths(root: string): AppPaths {
  return {
    appDir: root,
    binDir: path.join(root, "bin"),
    installedExecutable: path.join(
      root,
      "bin",
      "copilot-session-recovery.exe",
    ),
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
  };
}

test("builds an owned direct-exec hook configuration", () => {
  assert.deepEqual(
    buildCopilotHookConfig(
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\bin\\copilot-session-recovery.exe",
    ),
    {
      version: 1,
      hooks: {
        sessionStart: [
          {
            type: "command",
            exec: "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\bin\\copilot-session-recovery.exe",
            args: ["hook", "session-start"],
            timeoutSec: 5,
          },
        ],
        sessionEnd: [
          {
            type: "command",
            exec: "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\bin\\copilot-session-recovery.exe",
            args: ["hook", "session-end"],
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
  const siblingHook = path.join(root, ".copilot", "hooks", "other-tool.json");

  await mkdir(path.dirname(siblingHook), { recursive: true });
  await writeFile(siblingHook, JSON.stringify({ ownedBy: "someone-else" }));

  await writeCopilotHookConfig(paths);

  assert.deepEqual(
    JSON.parse(await readFile(paths.copilotHookFile, "utf8")),
    buildCopilotHookConfig(paths.installedExecutable),
  );
  assert.deepEqual(
    JSON.parse(await readFile(siblingHook, "utf8")),
    { ownedBy: "someone-else" },
  );
});
