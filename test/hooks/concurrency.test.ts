import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultConfig, saveConfig } from "../../src/config/config.ts";
import { resolveAppPaths } from "../../src/storage/paths.ts";
import { readRegistry } from "../../src/storage/registry.ts";

const workerCount = 24;
const workerPath = fileURLToPath(
  new URL("../fixtures/hook-worker.ts", import.meta.url),
);
const PLATFORM_ENV_KEYS = [
  ["ComSpec"],
  ["Path", "PATH"],
  ["PATHEXT"],
  ["SystemRoot", "SYSTEMROOT"],
  ["TEMP"],
  ["TMP"],
  ["WINDIR"],
] as const;

interface WorkerResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

function sessionIdFor(index: number): string {
  const suffix = index.toString(16).padStart(12, "0");
  const prefix = index.toString(16).padStart(8, "0");
  return `${prefix}-1111-4222-8aaa-${suffix}`;
}

function startPayload(index: number): string {
  return JSON.stringify({
    sessionId: sessionIdFor(index),
    timestamp: 1_759_689_000_000 + index,
    cwd: `C:\\src\\project-${index}`,
    source: "new",
  });
}

function buildWorkerEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const aliases of PLATFORM_ENV_KEYS) {
    for (const name of aliases) {
      const value = process.env[name];
      if (typeof value === "string" && value.length > 0) {
        env[name] = value;
        break;
      }
    }
  }

  return {
    ...env,
    ...overrides,
  };
}

function runHookWorker(
  workerPath: string,
  env: NodeJS.ProcessEnv,
  payload: string,
): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [workerPath, "hook", "session-start"],
      {
        env,
        shell: false,
      },
    );
    let stdout = "";
    let stderr = "";

    child.once("error", reject);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code) => {
      resolve({ code, stderr, stdout });
    });
    child.stdin?.end(payload);
  });
}

test("concurrent hook workers preserve every session update", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cas-hook-concurrency-"));

  try {
    const localAppData = path.join(root, "LocalAppData");
    const userProfile = path.join(root, "UserProfile");
    const copilotHome = path.join(root, "CopilotHome");
    const env = buildWorkerEnv({
      LOCALAPPDATA: localAppData,
      USERPROFILE: userProfile,
      COPILOT_HOME: copilotHome,
    });
    const paths = resolveAppPaths({ platform: "win32", env });

    await Promise.all([
      mkdir(localAppData, { recursive: true }),
      mkdir(userProfile, { recursive: true }),
      mkdir(copilotHome, { recursive: true }),
      mkdir(paths.appDir, { recursive: true }),
    ]);
    await saveConfig(paths.configFile, defaultConfig());

    const results = await Promise.all(
      Array.from({ length: workerCount }, (_, index) =>
        runHookWorker(workerPath, env, startPayload(index + 1)),
      ),
    );

    for (const result of results) {
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.equal(result.stdout, "{}\n");
      assert.equal(result.stderr, "");
    }

    const registry = await readRegistry(paths.registryFile, paths.corruptDir);
    assert.deepEqual(
      Object.keys(registry.sessions).sort(),
      Array.from({ length: workerCount }, (_, index) =>
        sessionIdFor(index + 1),
      ).sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
