import assert from "node:assert/strict";
import test from "node:test";

import type {
  ProcessResult,
  ProcessSpec,
} from "../../src/launch/process-runner.ts";
import { protectStateDirectory } from "../../src/platform/windows-permissions.ts";

test("protectStateDirectory grants only the current user SID recursively", async () => {
  const calls: ProcessSpec[] = [];
  const results: ProcessResult[] = [
    {
      exitCode: 0,
      stdout: '"CONTOSO\\ruben","S-1-5-21-1000-1000-1000-1001"\r\n',
      stderr: "",
    },
    {
      exitCode: 0,
      stdout: "processed file",
      stderr: "",
    },
  ];

  const result = await protectStateDirectory(
    "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery",
    async (spec) => {
      calls.push(spec);
      return results.shift()!;
    },
  );

  assert.deepEqual(calls[0], {
    executable: "whoami.exe",
    args: ["/user", "/fo", "csv", "/nh"],
  });
  assert.deepEqual(calls[1], {
    executable: "icacls.exe",
    args: [
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery",
      "/inheritance:r",
      "/grant:r",
      "*S-1-5-21-1000-1000-1000-1001:F",
      "*S-1-5-21-1000-1000-1000-1001:(OI)(CI)F",
      "/T",
      "/C",
    ],
  });
  assert.deepEqual(result, {
    protected: true,
    detail: "State directory is protected for the current user.",
  });
});

test("protectStateDirectory returns a warning result instead of throwing on ACL failures", async () => {
  const result = await protectStateDirectory("C:\\state", async () => ({
    exitCode: 1,
    stdout: "",
    stderr: "whoami failed",
  }));

  assert.equal(result.protected, false);
  assert.match(result.detail, /whoami failed/);
});
