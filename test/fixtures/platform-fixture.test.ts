import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createNativeCommandShim,
  createPlatformFixtureEnvironment,
  prependFixturePath,
} from "./platform-fixture.ts";

const runtimeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "runtime",
  "platform-fixture",
);

test("createPlatformFixtureEnvironment uses HOME and POSIX application paths on macOS", () => {
  const root = "/fixture/root";
  const fixture = createPlatformFixtureEnvironment(root, {
    platform: "darwin",
    baseEnv: {
      PATH: "/usr/bin",
    },
  });

  assert.equal(fixture.env.HOME, "/fixture/root/Home");
  assert.equal(fixture.env.LOCALAPPDATA, undefined);
  assert.equal(fixture.env.USERPROFILE, undefined);
  assert.equal(
    fixture.paths.appDir,
    "/fixture/root/Home/Library/Application Support/copilot-session-recovery",
  );
  assert.equal(
    fixture.paths.copilotHookFile,
    "/fixture/root/CopilotHome/hooks/copilot-session-recovery.json",
  );
});

test("prependFixturePath uses the supplied platform delimiter", () => {
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/bin:/bin",
  };

  prependFixturePath(env, "/fixture/fake-bin", ":");

  assert.equal(env.PATH, "/fixture/fake-bin:/usr/bin:/bin");
});

test("createNativeCommandShim creates a POSIX executable without a Windows extension", async () => {
  const root = path.join(runtimeRoot, `${process.pid}`);
  const fakeCommandPath = path.join(root, "fake-command.ts");

  await rm(root, { recursive: true, force: true });

  try {
    const shimPath = await createNativeCommandShim(
      root,
      "copilot",
      fakeCommandPath,
      "darwin",
    );

    assert.equal(shimPath, path.join(root, "copilot"));
    assert.match(await readFile(shimPath, "utf8"), /^#!\/bin\/sh\n/u);
    await access(shimPath, constants.X_OK);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
