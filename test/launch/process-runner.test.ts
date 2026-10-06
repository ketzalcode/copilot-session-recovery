import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { commandExists } from "../../src/launch/process-runner.ts";

test("commandExists rejects directories for path-like executables", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-process-runner-test-"),
  );

  try {
    assert.equal(await commandExists(directory), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("commandExists accepts an existing path-like executable file", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-session-recovery-process-runner-test-"),
  );
  const executable = path.join(directory, "copilot.cmd");

  try {
    await writeFile(executable, "@echo off\r\necho ok\r\n", "utf8");

    assert.equal(await commandExists(executable), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
