import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  assertPersistentInstallation,
  resolveRuntimeInstallation,
} from "../../src/runtime/installation.ts";

test("resolveRuntimeInstallation decodes the bundled CLI entry from a file URL", () => {
  const nodeExecutable =
    process.platform === "win32"
      ? "C:\\Program Files\\nodejs\\node.exe"
      : "/opt/homebrew/bin/node";
  const cliEntry =
    process.platform === "win32"
      ? "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs"
      : "/usr/local/lib/node_modules/copilot-session-recovery/dist/copilot-session-recovery.mjs";

  assert.deepEqual(
    resolveRuntimeInstallation({
      execPath: nodeExecutable,
      moduleUrl: pathToFileURL(cliEntry).href,
    }),
    {
      nodeExecutable,
      cliEntry,
    },
  );
});

test("resolveRuntimeInstallation rejects non-absolute runtime paths", () => {
  const absoluteEntry = path.resolve("copilot-session-recovery.mjs");

  assert.throws(
    () =>
      resolveRuntimeInstallation({
        execPath: "node.exe",
        moduleUrl: pathToFileURL(absoluteEntry).href,
      }),
    /absolute/i,
  );
});

test("resolveRuntimeInstallation falls back to argv[1] when moduleUrl is unavailable", () => {
  const originalArgv1 = process.argv[1];
  const cliEntry = path.resolve(
    "node_modules",
    "copilot-session-recovery",
    "dist",
    "copilot-session-recovery.mjs",
  );
  process.argv[1] = cliEntry;

  try {
    assert.deepEqual(
      resolveRuntimeInstallation({
        execPath: process.execPath,
      }),
      {
        nodeExecutable: process.execPath,
        cliEntry,
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
