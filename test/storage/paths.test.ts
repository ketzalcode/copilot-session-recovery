import assert from "node:assert/strict";
import test from "node:test";

import { resolveAppPaths } from "../../src/storage/paths.ts";

test("uses LOCALAPPDATA and the default Copilot home", () => {
  const paths = resolveAppPaths({
    env: {
      LOCALAPPDATA: "C:\\Users\\ruben\\AppData\\Local",
      USERPROFILE: "C:\\Users\\ruben",
    },
  });

  assert.equal(
    paths.registryFile,
    "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\sessions.json",
  );
  assert.equal(
    paths.copilotHookFile,
    "C:\\Users\\ruben\\.copilot\\hooks\\copilot-session-recovery.json",
  );
});

test("honors COPILOT_HOME", () => {
  const paths = resolveAppPaths({
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
