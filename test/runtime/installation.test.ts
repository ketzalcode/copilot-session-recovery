import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPersistentInstallation,
  resolveRuntimeInstallation,
} from "../../src/runtime/installation.ts";

test("resolveRuntimeInstallation decodes the bundled CLI entry from a file URL", () => {
  assert.deepEqual(
    resolveRuntimeInstallation({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      moduleUrl:
        "file:///C:/npm/node_modules/copilot-session-recovery/dist/copilot-session-recovery.mjs",
    }),
    {
      nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
      cliEntry:
        "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
    },
  );
});

test("resolveRuntimeInstallation rejects non-absolute runtime paths", () => {
  assert.throws(
    () =>
      resolveRuntimeInstallation({
        execPath: "node.exe",
        moduleUrl: "file:///C:/npm/copilot-session-recovery.mjs",
      }),
    /absolute/i,
  );
});

test("resolveRuntimeInstallation falls back to argv[1] when moduleUrl is unavailable", () => {
  const originalArgv1 = process.argv[1];
  process.argv[1] =
    "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs";

  try {
    assert.deepEqual(
      resolveRuntimeInstallation({
        execPath: "C:\\Program Files\\nodejs\\node.exe",
      }),
      {
        nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
        cliEntry:
          "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
      },
    );
  } finally {
    if (originalArgv1 === undefined) {
      process.argv.splice(1, 1);
    } else {
      process.argv[1] = originalArgv1;
    }
  }
});

test("assertPersistentInstallation rejects transient npx installations on Windows and POSIX", () => {
  for (const cliEntry of [
    "C:\\Users\\ruben\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
    "/Users/ruben/.npm/_npx/abc/node_modules/copilot-session-recovery/dist/copilot-session-recovery.mjs",
  ]) {
    assert.throws(
      () =>
        assertPersistentInstallation({
          nodeExecutable:
            cliEntry[1] === ":"
              ? "C:\\Program Files\\nodejs\\node.exe"
              : "/opt/homebrew/bin/node",
          cliEntry,
        }),
      /npm install --global copilot-session-recovery/,
    );
  }
});
