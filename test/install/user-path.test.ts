import assert from "node:assert/strict";
import test from "node:test";

import type { ProcessResult, ProcessSpec } from "../../src/launch/process-runner.ts";
import {
  ensureUserPathEntry,
  removeUserPathEntry,
} from "../../src/install/user-path.ts";

function createRunner(result: ProcessResult = { exitCode: 0, stdout: "", stderr: "" }) {
  const calls: ProcessSpec[] = [];

  return {
    calls,
    async runner(spec: ProcessSpec): Promise<ProcessResult> {
      calls.push(spec);
      return result;
    },
  };
}

test("ensureUserPathEntry uses a fixed PowerShell script and passes the owned bin path through env", async () => {
  const { calls, runner } = createRunner();
  const binDir = "C:\\Users\\ruben\\AppData\\Local\\copilot-auto-save\\bin";

  await ensureUserPathEntry(binDir, runner);

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.executable, "powershell.exe");
  assert.deepEqual(call.args.slice(0, 3), [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
  ]);
  assert.equal(call.env?.COPILOT_AUTO_SAVE_BIN_DIR, binDir);
  assert.doesNotMatch(call.args[3]!, /ruben|copilot-auto-save\\bin/i);
  assert.match(call.args[3]!, /GetEnvironmentVariable\('Path', 'User'\)/);
  assert.match(call.args[3]!, /SetEnvironmentVariable\('Path', \$next, 'User'\)/);
});

test("removeUserPathEntry removes only the normalized owned bin path", async () => {
  const { calls, runner } = createRunner();
  const binDir = "C:\\Users\\ruben\\AppData\\Local\\copilot-auto-save\\bin";

  await removeUserPathEntry(binDir, runner);

  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.equal(call.executable, "powershell.exe");
  assert.equal(call.env?.COPILOT_AUTO_SAVE_BIN_DIR, binDir);
  assert.doesNotMatch(call.args[3]!, /ruben|copilot-auto-save\\bin/i);
  assert.match(call.args[3]!, /TrimEnd\('\\'\)/);
  assert.match(call.args[3]!, /-not \$comparison\.Equals/);
});

test("PATH helpers surface PowerShell failures", async () => {
  const { runner } = createRunner({
    exitCode: 1,
    stdout: "",
    stderr: "access denied",
  });

  await assert.rejects(
    () => ensureUserPathEntry("C:\\owned\\bin", runner),
    /access denied/,
  );
});
