import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  defaultConfig,
  loadConfig,
  parseConfig,
  saveConfig,
} from "../../src/config/config.ts";

test("default configuration provides copilot and agency profiles", () => {
  assert.deepEqual(defaultConfig(), {
    schemaVersion: 1,
    defaultProfile: "copilot",
    profiles: {
      copilot: {
        executable: "copilot",
        args: ["--resume={sessionId}"],
      },
      agency: {
        executable: "agency",
        args: ["copilot", "--resume={sessionId}"],
      },
    },
  });
});

test("rejects unknown placeholders", () => {
  assert.throws(() =>
    parseConfig({
      schemaVersion: 1,
      defaultProfile: "copilot",
      profiles: {
        copilot: {
          executable: "copilot",
          args: ["--resume={unknown}"],
        },
      },
    }),
  );
});

test("rejects whitespace-only default profile values", () => {
  assert.throws(
    () =>
      parseConfig({
        schemaVersion: 1,
        defaultProfile: "   ",
        profiles: {
          copilot: {
            executable: "copilot",
            args: ["--resume={sessionId}"],
          },
        },
      }),
    /defaultProfile must be a non-empty string\./,
  );
});

test("rejects whitespace-only executable values", () => {
  assert.throws(
    () =>
      parseConfig({
        schemaVersion: 1,
        defaultProfile: "copilot",
        profiles: {
          copilot: {
            executable: "   ",
            args: ["--resume={sessionId}"],
          },
        },
      }),
    /Profile copilot executable must be a non-empty string\./,
  );
});

test("rejects whitespace-only argument values", () => {
  assert.throws(
    () =>
      parseConfig({
        schemaVersion: 1,
        defaultProfile: "copilot",
        profiles: {
          copilot: {
            executable: "copilot",
            args: ["   "],
          },
        },
      }),
    /Profile copilot argument 0 must be a non-empty string\./,
  );
});

test("rejects missing default profile references", () => {
  assert.throws(
    () =>
      parseConfig({
        schemaVersion: 1,
        defaultProfile: "missing",
        profiles: {
          copilot: {
            executable: "copilot",
            args: ["--resume={sessionId}"],
          },
        },
      }),
    /Default profile missing does not exist\./,
  );
});

test("saveConfig and loadConfig round-trip valid configuration", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-auto-save-config-test-"),
  );

  try {
    const configPath = path.join(directory, "config.json");
    const config = defaultConfig();

    await saveConfig(configPath, config);

    assert.deepEqual(await loadConfig(configPath), config);
    assert.match(
      await readFile(configPath, "utf8"),
      /\n$/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
