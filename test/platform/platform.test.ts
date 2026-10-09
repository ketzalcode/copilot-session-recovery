import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSupportedPlatform,
  createPlatformAdapter,
} from "../../src/platform/platform.ts";

test("accepts only the supported platform and architecture matrix", () => {
  assert.deepEqual(assertSupportedPlatform("win32", "x64"), {
    platform: "win32",
    arch: "x64",
  });
  assert.deepEqual(assertSupportedPlatform("darwin", "arm64"), {
    platform: "darwin",
    arch: "arm64",
  });
  assert.throws(
    () => assertSupportedPlatform("win32", "arm64"),
    /Unsupported platform: win32 arm64/,
  );
  assert.throws(
    () => assertSupportedPlatform("linux", "x64"),
    /Unsupported platform: linux x64/,
  );
});

test("creates a Windows adapter with the expected contract", () => {
  const adapter = createPlatformAdapter("win32", "x64");

  assert.equal(adapter.id, "windows");
  assert.equal(adapter.terminalName, "Windows Terminal");
  assert.equal(
    adapter.resolvePaths({
      LOCALAPPDATA: "C:\\Users\\ruben\\AppData\\Local",
      USERPROFILE: "C:\\Users\\ruben",
    }).launchPlanFile,
    "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\launch-plan.json",
  );
});

test("creates a macOS adapter with the expected contract", () => {
  const adapter = createPlatformAdapter("darwin", "x64");

  assert.equal(adapter.id, "macos");
  assert.equal(adapter.terminalName, "Apple Terminal");
  assert.equal(
    adapter.resolvePaths({
      HOME: "/Users/ruben",
    }).launchPlanFile,
    "/Users/ruben/Library/Application Support/copilot-session-recovery/launch-plan.json",
  );
});
