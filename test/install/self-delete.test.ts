import assert from "node:assert/strict";
import test from "node:test";

import { buildSelfDeleteInvocation } from "../../src/install/self-delete.ts";

test("buildSelfDeleteInvocation hands cleanup to cmd start and passes targets through env", () => {
  const request = {
    parentPid: 4242,
    installedExecutable:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-auto-save\\bin\\copilot-auto-save.exe",
    appDir: "C:\\Users\\ruben\\AppData\\Local\\copilot-auto-save",
    purge: true,
  };

  const invocation = buildSelfDeleteInvocation(request, { Path: "C:\\Windows" });
  const encodedScript = invocation.args.at(-1)!;
  const script = Buffer.from(encodedScript, "base64").toString("utf16le");

  assert.equal(invocation.executable, "cmd.exe");
  assert.deepEqual(invocation.args.slice(0, 6), [
    "/d",
    "/s",
    "/c",
    "start",
    "",
    "/b",
  ]);
  assert.deepEqual(invocation.args.slice(6, 9), [
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
  ]);
  assert.equal(invocation.args[9], "-EncodedCommand");
  assert.match(script, /Wait-Process -Id \(\[int\]\$env:COPILOT_AUTO_SAVE_PARENT_PID\)/);
  assert.match(script, /Remove-Item -LiteralPath \$env:COPILOT_AUTO_SAVE_APP_DIR -Recurse -Force/);
  assert.doesNotMatch(script, /Users\\ruben|copilot-auto-save\.exe/);
  assert.equal(invocation.options.stdio, "ignore");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.env.COPILOT_AUTO_SAVE_PARENT_PID, "4242");
  assert.equal(
    invocation.options.env.COPILOT_AUTO_SAVE_INSTALLED_EXE,
    request.installedExecutable,
  );
  assert.equal(invocation.options.env.COPILOT_AUTO_SAVE_APP_DIR, request.appDir);
  assert.equal(invocation.options.env.COPILOT_AUTO_SAVE_PURGE, "1");
});
