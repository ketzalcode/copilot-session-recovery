import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  handleSessionEndHook,
  handleSessionStartHook,
  type HookDependencies,
} from "../../src/hooks/handler.ts";
import { defaultConfig, saveConfig } from "../../src/config/config.ts";
import { emptyRegistry } from "../../src/session/lifecycle.ts";
import type { AppPaths } from "../../src/storage/paths.ts";
import { readRegistry } from "../../src/storage/registry.ts";

const sessionId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const startTimestamp = 1_759_689_000_000;
const startTimestampIso = new Date(startTimestamp).toISOString();

interface CapturedOutput<T> {
  result: T;
  stdout: string;
  stderr: string;
}

function createTestPaths(root: string): AppPaths {
  return {
    appDir: root,
    binDir: path.join(root, "bin"),
    installedExecutable: path.join(root, "bin", "copilot-auto-save.exe"),
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(root, "hooks", "copilot-auto-save.json"),
  };
}

async function createHookTestDependencies(
  root: string,
  overrides: {
    config?: ReturnType<typeof defaultConfig>;
    writeDiagnostic?: HookDependencies["writeDiagnostic"];
    prepareRoot?: boolean;
    skipConfig?: boolean;
  } = {},
): Promise<HookDependencies> {
  const paths = createTestPaths(root);

  if (overrides.prepareRoot ?? true) {
    await mkdir(root, { recursive: true });
  }

  if (!overrides.skipConfig) {
    const config = overrides.config ?? defaultConfig();
    await saveConfig(paths.configFile, config);
  }

  return {
    paths,
    writeDiagnostic: overrides.writeDiagnostic ?? (async () => undefined),
  };
}

function startPayload(): string {
  return JSON.stringify({
    sessionId,
    timestamp: startTimestamp,
    cwd: "C:\\src\\ms-pal",
    source: "new",
  });
}

function endPayload(reason: "complete" | "error" = "complete"): string {
  return JSON.stringify({
    sessionId,
    timestamp: 1_759_689_010_000,
    cwd: "C:\\src\\ms-pal",
    reason,
  });
}

async function captureProcessOutput<T>(
  action: () => Promise<T>,
): Promise<CapturedOutput<T>> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  const captureWrite =
    (chunks: string[]) =>
    ((chunk, encoding) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString(
              typeof encoding === "string" ? encoding : undefined,
            );
      chunks.push(text);

      return true;
    }) as typeof process.stdout.write;

  process.stdout.write = captureWrite(stdoutChunks);
  process.stderr.write = captureWrite(stderrChunks);

  try {
    const result = await action();
    return {
      result,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

test("start hook persists the configured launcher profile and clean end hook removes the session", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cas-hook-"));

  try {
    const config = defaultConfig();
    config.defaultProfile = "agency";
    const deps = await createHookTestDependencies(root, { config });

    const started = await captureProcessOutput(() =>
      handleSessionStartHook(startPayload(), deps),
    );
    assert.equal(started.result, 0);
    assert.equal(started.stdout, "{}\n");
    assert.equal(started.stderr, "");

    const startedRegistry = await readRegistry(
      deps.paths.registryFile,
      deps.paths.corruptDir,
    );
    assert.deepEqual(startedRegistry.sessions[sessionId], {
      sessionId,
      cwd: "C:\\src\\ms-pal",
      launcherProfile: "agency",
      source: "new",
      startedAt: startTimestampIso,
      lastSeenAt: startTimestampIso,
    });

    const ended = await captureProcessOutput(() =>
      handleSessionEndHook(endPayload("complete"), deps),
    );
    assert.equal(ended.result, 0);
    assert.equal(ended.stdout, "{}\n");
    assert.equal(ended.stderr, "");
    assert.deepEqual(
      await readRegistry(deps.paths.registryFile, deps.paths.corruptDir),
      emptyRegistry(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hook failures return zero and report diagnostics for invalid payloads", async () => {
  const errors: string[] = [];
  const deps = await createHookTestDependencies("Z:\\unwritable", {
    prepareRoot: false,
    skipConfig: true,
    writeDiagnostic: async (message) => {
      errors.push(message);
    },
  });

  const failure = await captureProcessOutput(() =>
    handleSessionStartHook("not-json", deps),
  );

  assert.equal(failure.result, 0);
  assert.equal(failure.stdout, "{}\n");
  assert.match(failure.stderr, /^copilot-auto-save hook warning: /);
  assert.equal(errors.length, 1);
});

test("config and corrupt-registry failures return zero and report diagnostics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cas-hook-"));

  try {
    const configErrors: string[] = [];
    const missingConfigDeps = await createHookTestDependencies(root, {
      skipConfig: true,
      writeDiagnostic: async (message) => {
        configErrors.push(message);
      },
    });

    const missingConfig = await captureProcessOutput(() =>
      handleSessionStartHook(startPayload(), missingConfigDeps),
    );
    assert.equal(missingConfig.result, 0);
    assert.equal(missingConfig.stdout, "{}\n");
    assert.match(missingConfig.stderr, /^copilot-auto-save hook warning: /);
    assert.equal(configErrors.length, 1);

    const corruptErrors: string[] = [];
    const corruptRegistryDeps = await createHookTestDependencies(root, {
      writeDiagnostic: async (message) => {
        corruptErrors.push(message);
      },
    });
    await writeFile(corruptRegistryDeps.paths.registryFile, "{broken", "utf8");

    const corruptRegistry = await captureProcessOutput(() =>
      handleSessionEndHook(endPayload("error"), corruptRegistryDeps),
    );
    assert.equal(corruptRegistry.result, 0);
    assert.equal(corruptRegistry.stdout, "{}\n");
    assert.match(corruptRegistry.stderr, /^copilot-auto-save hook warning: /);
    assert.equal(corruptErrors.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clean end removes the session when the config file is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cas-hook-"));

  try {
    const diagnostics: string[] = [];
    const deps = await createHookTestDependencies(root, {
      writeDiagnostic: async (message) => {
        diagnostics.push(message);
      },
    });

    const started = await captureProcessOutput(() =>
      handleSessionStartHook(startPayload(), deps),
    );
    assert.equal(started.result, 0);

    await rm(deps.paths.configFile, { force: true });

    const ended = await captureProcessOutput(() =>
      handleSessionEndHook(endPayload("complete"), deps),
    );
    assert.equal(ended.result, 0);
    assert.equal(ended.stdout, "{}\n");
    assert.equal(ended.stderr, "");
    assert.equal(diagnostics.length, 0);
    assert.deepEqual(
      await readRegistry(deps.paths.registryFile, deps.paths.corruptDir),
      emptyRegistry(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clean end removes the session when the config file is corrupt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cas-hook-"));

  try {
    const diagnostics: string[] = [];
    const deps = await createHookTestDependencies(root, {
      writeDiagnostic: async (message) => {
        diagnostics.push(message);
      },
    });

    const started = await captureProcessOutput(() =>
      handleSessionStartHook(startPayload(), deps),
    );
    assert.equal(started.result, 0);

    await writeFile(deps.paths.configFile, "{broken", "utf8");

    const ended = await captureProcessOutput(() =>
      handleSessionEndHook(endPayload("complete"), deps),
    );
    assert.equal(ended.result, 0);
    assert.equal(ended.stdout, "{}\n");
    assert.equal(ended.stderr, "");
    assert.equal(diagnostics.length, 0);
    assert.deepEqual(
      await readRegistry(deps.paths.registryFile, deps.paths.corruptDir),
      emptyRegistry(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
