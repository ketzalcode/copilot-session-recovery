import assert from "node:assert/strict";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { commandExists } from "../../src/launch/process-runner.ts";

const runtimeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "runtime",
  "process-runner",
);

function runtimePath(name: string): string {
  return path.join(runtimeRoot, `${process.pid}-${name}`);
}

test("commandExists uses where.exe for Windows bare commands", async () => {
  const calls: Array<{ executable: string; args: string[] }> = [];

  const exists = await commandExists("copilot", "win32", async (spec) => {
    calls.push({
      executable: spec.executable,
      args: spec.args,
    });
    return {
      exitCode: 0,
      stdout: "C:\\tools\\copilot.exe\r\n",
      stderr: "",
    };
  });

  assert.equal(exists, true);
  assert.deepEqual(calls[0], {
    executable: "where.exe",
    args: ["copilot"],
  });
});

test("commandExists uses /usr/bin/which for macOS bare commands", async () => {
  const calls: Array<{ executable: string; args: string[] }> = [];

  const exists = await commandExists("copilot", "darwin", async (spec) => {
    calls.push({
      executable: spec.executable,
      args: spec.args,
    });
    return {
      exitCode: 0,
      stdout: "/usr/local/bin/copilot\n",
      stderr: "",
    };
  });

  assert.equal(exists, true);
  assert.deepEqual(calls[0], {
    executable: "/usr/bin/which",
    args: ["copilot"],
  });
});

test("commandExists rejects directories for absolute executables", async () => {
  const directory = runtimePath("directory");

  try {
    await mkdir(directory, { recursive: true });
    assert.equal(await commandExists(directory, "win32"), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("commandExists accepts an existing absolute executable file without lookup", async () => {
  const directory = runtimePath("file");
  const platform = process.platform === "darwin" ? "darwin" : "win32";
  const executable = path.join(
    directory,
    platform === "win32" ? "copilot.cmd" : "copilot",
  );

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      executable,
      platform === "win32"
        ? "@echo off\r\necho ok\r\n"
        : "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    if (platform === "darwin") {
      await chmod(executable, 0o755);
    }

    assert.equal(
      await commandExists(executable, platform, async () => {
        throw new Error("lookup should not run for absolute executables");
      }),
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
