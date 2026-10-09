import assert from "node:assert/strict";
import test from "node:test";

import { LAUNCH_NEXT_COMMAND } from "../../src/launch/macos-terminal.ts";
import { createMacosPlatformAdapter } from "../../src/platform/macos.ts";
import {
  assertSupportedPlatform,
  createPlatformAdapter,
} from "../../src/platform/platform.ts";
import { createWindowsPlatformAdapter } from "../../src/platform/windows.ts";

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
  assert.equal(adapter.terminal.name, "Windows Terminal");
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
  assert.equal(adapter.terminal.name, "Apple Terminal");
  assert.equal(
    adapter.resolvePaths({
      HOME: "/Users/ruben",
    }).launchPlanFile,
    "/Users/ruben/Library/Application Support/copilot-session-recovery/launch-plan.json",
  );
});

test("Windows adapter exposes state protection and terminal checks", async () => {
  const paths = createPlatformAdapter("win32", "x64").resolvePaths({
    LOCALAPPDATA: "C:\\Users\\ruben\\AppData\\Local",
    USERPROFILE: "C:\\Users\\ruben",
  });
  const commandChecks: Array<{ executable: string; platform: "win32" | "darwin" }> = [];
  const adapter = createWindowsPlatformAdapter({
    commandExists: async (executable, platform) => {
      commandChecks.push({ executable, platform });
      return true;
    },
    protectState: async (receivedPaths) => {
      assert.equal(receivedPaths, paths);
      return { protected: true, detail: "protected" };
    },
    checkStateProtection: async (receivedPaths) => {
      assert.equal(receivedPaths, paths);
      return { protected: true, detail: "checked" };
    },
  });

  assert.deepEqual(await adapter.protectState(paths), {
    protected: true,
    detail: "protected",
  });
  assert.deepEqual(await adapter.checkStateProtection(paths), {
    protected: true,
    detail: "checked",
  });
  assert.equal(await adapter.terminal.available(), true);
  assert.deepEqual(commandChecks, [
    {
      executable: "wt.exe",
      platform: "win32",
    },
  ]);
});

test("macOS adapter delegates availability checks and preview to the Apple Terminal launcher", async () => {
  const paths = createPlatformAdapter("darwin", "x64").resolvePaths({
    HOME: "/Users/ruben",
  });
  const commandChecks: Array<{ executable: string; platform: "win32" | "darwin" }> = [];
  const processCalls: Array<{ executable: string; args: string[] }> = [];
  const adapter = createMacosPlatformAdapter({
    commandExists: async (executable, platform) => {
      commandChecks.push({ executable, platform });
      return true;
    },
    runProcess: async (spec) => {
      processCalls.push({
        executable: spec.executable,
        args: spec.args,
      });
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
    protectState: async (receivedPaths) => {
      assert.equal(receivedPaths, paths);
      return { protected: true, detail: "protected" };
    },
    checkStateProtection: async (receivedPaths) => {
      assert.equal(receivedPaths, paths);
      return { protected: true, detail: "checked" };
    },
  });

  assert.deepEqual(await adapter.protectState(paths), {
    protected: true,
    detail: "protected",
  });
  assert.deepEqual(await adapter.checkStateProtection(paths), {
    protected: true,
    detail: "checked",
  });
  assert.equal(await adapter.terminal.available(), true);
  assert.equal(
    adapter.terminal.preview(
      [
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
      ],
      paths,
    ),
    `Apple Terminal tab count: 1\n${LAUNCH_NEXT_COMMAND}`,
  );
  assert.match(
    processCalls[0]?.executable ?? "",
    /\/usr\/bin\/open/,
  );
  assert.deepEqual(processCalls[0], {
    executable: "/usr/bin/open",
    args: ["-Ra", "Terminal"],
  });
  assert.deepEqual(commandChecks, [
    {
      executable: "/usr/bin/osascript",
      platform: "darwin",
    },
  ]);
  assert.doesNotMatch(
    adapter.terminal.preview([], paths),
    /sessionId|cwd|launcherProfile|--resume=/,
  );
});
