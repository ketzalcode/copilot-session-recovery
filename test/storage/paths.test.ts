import assert from "node:assert/strict";
import test from "node:test";

import { resolveAppPaths } from "../../src/storage/paths.ts";

test("resolves Windows app paths from LOCALAPPDATA and USERPROFILE", () => {
  const paths = resolveAppPaths({
    platform: "win32",
    env: {
      LOCALAPPDATA: "C:\\Users\\ruben\\AppData\\Local",
      USERPROFILE: "C:\\Users\\ruben",
    },
  });

  assert.equal(
    paths.appDir,
    "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery",
  );
  assert.equal(
    paths.registryFile,
    "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\sessions.json",
  );
  assert.equal(
    paths.copilotHookFile,
    "C:\\Users\\ruben\\.copilot\\hooks\\copilot-session-recovery.json",
  );
  assert.equal(
    paths.launchPlanFile,
    "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\launch-plan.json",
  );
  assert.equal(
    paths.launchPlanLockFile,
    "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\launch-plan.lock",
  );
});

test("resolves macOS app paths from HOME", () => {
  const paths = resolveAppPaths({
    platform: "darwin",
    env: { HOME: "/Users/ruben" },
  });

  assert.equal(
    paths.appDir,
    "/Users/ruben/Library/Application Support/copilot-session-recovery",
  );
  assert.equal(
    paths.registryFile,
    "/Users/ruben/Library/Application Support/copilot-session-recovery/sessions.json",
  );
  assert.equal(
    paths.copilotHookFile,
    "/Users/ruben/.copilot/hooks/copilot-session-recovery.json",
  );
  assert.equal(
    paths.launchPlanFile,
    "/Users/ruben/Library/Application Support/copilot-session-recovery/launch-plan.json",
  );
  assert.equal(
    paths.launchPlanLockFile,
    "/Users/ruben/Library/Application Support/copilot-session-recovery/launch-plan.lock",
  );
});

test("honors COPILOT_HOME on Windows", () => {
  const paths = resolveAppPaths({
    platform: "win32",
    env: {
      LOCALAPPDATA: "D:\\Local",
      USERPROFILE: "C:\\Users\\ruben",
      COPILOT_HOME: "D:\\Copilot",
    },
  });

  assert.equal(
    paths.copilotHookFile,
    "D:\\Copilot\\hooks\\copilot-session-recovery.json",
  );
});

test("honors COPILOT_HOME on macOS", () => {
  const paths = resolveAppPaths({
    platform: "darwin",
    env: {
      HOME: "/Users/ruben",
      COPILOT_HOME: "/tmp/copilot",
    },
  });

  assert.equal(
    paths.copilotHookFile,
    "/tmp/copilot/hooks/copilot-session-recovery.json",
  );
});

test("requires LOCALAPPDATA and USERPROFILE on Windows", () => {
  assert.throws(
    () =>
      resolveAppPaths({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\ruben\\AppData\\Local" },
      }),
    /LOCALAPPDATA and USERPROFILE are required on Windows\./,
  );
});

test("requires HOME on macOS", () => {
  assert.throws(
    () =>
      resolveAppPaths({
        platform: "darwin",
        env: {},
      }),
    /HOME is required on macOS\./,
  );
});
