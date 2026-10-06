import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { atomicWriteJson } from "../../src/storage/atomic-json.ts";

test("atomicWriteJson writes JSON content", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-auto-save-atomic-json-test-"),
  );

  try {
    const filePath = path.join(directory, "config.json");

    await atomicWriteJson(filePath, {
      schemaVersion: 1,
      defaultProfile: "copilot",
    });

    assert.equal(
      await readFile(filePath, "utf8"),
      '{\n  "schemaVersion": 1,\n  "defaultProfile": "copilot"\n}\n',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("atomicWriteJson removes its temp file when serialization fails", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "copilot-auto-save-atomic-json-test-"),
  );

  try {
    const filePath = path.join(directory, "config.json");

    await assert.rejects(
      atomicWriteJson(filePath, { invalid: 1n }),
      /serialize|BigInt|JSON/i,
    );

    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
