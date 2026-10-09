import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  claimNextLaunch,
  createLaunchPlan,
  type LaunchPlan,
} from "../../src/launch/launch-plan.ts";
import { launchNext } from "../../src/launch/launch-next.ts";
import type { RecoveryTab } from "../../src/launch/recovery-plan.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

const sessionId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const runtimeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "runtime",
  "launch-next",
);

function runtimePath(name: string): string {
  return path.join(runtimeRoot, `${process.pid}-${randomUUID()}-${name}`);
}

function recoveryTab(overrides: Partial<RecoveryTab> = {}): RecoveryTab {
  return {
    sessionId,
    cwd: "/Users/ruben/src/project",
    title: "project - 502ed8c",
    launcherProfile: "copilot",
    process: {
      executable: "copilot",
      args: [`--resume=${sessionId}`],
      env: {
        TERM: "xterm-256color",
      },
    },
    lastSeenAt: "2026-10-08T18:00:00.000Z",
    ...overrides,
  };
}

function createPaths(root: string): AppPaths {
  return {
    appDir: root,
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(root, "copilot-session-recovery.json"),
    launchPlanFile: path.join(root, "launch-plan.json"),
    launchPlanLockFile: path.join(root, "launch-plan.lock"),
  };
}

async function createRuntimePaths(t: test.TestContext): Promise<AppPaths> {
  const root = runtimePath("state");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return createPaths(root);
}

async function readLaunchPlan(paths: AppPaths): Promise<LaunchPlan> {
  return JSON.parse(await readFile(paths.launchPlanFile, "utf8")) as LaunchPlan;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function waitFor(
  description: string,
  predicate: () => Promise<boolean> | boolean,
): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 1);
    });
  }

  assert.fail(`Timed out waiting for ${description}.`);
}

test("launchNext accepts an injected attached spawner and completes the claim on success", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [recoveryTab()]);

  const exitCode = await launchNext(paths, async ({ executable, args, cwd }) => {
    assert.equal(executable, "copilot");
    assert.deepEqual(args, [`--resume=${sessionId}`]);
    assert.equal(cwd, "/Users/ruben/src/project");
    return 0;
  });

  assert.equal(exitCode, 0);
  assert.equal(await pathExists(paths.launchPlanFile), false);
});

test("launchNext marks the claim complete after spawn and then returns the attached child exit code", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [recoveryTab()]);

  let signalSpawned!: () => void;
  let signalExited!: (exitCode: number) => void;
  const spawned = new Promise<void>((resolve) => {
    signalSpawned = resolve;
  });
  const exitCode = new Promise<number>((resolve) => {
    signalExited = resolve;
  });

  const launch = launchNext(paths, async ({ executable, args, cwd, env }) => {
    assert.equal(executable, "copilot");
    assert.deepEqual(args, [`--resume=${sessionId}`]);
    assert.equal(cwd, "/Users/ruben/src/project");
    assert.deepEqual(env, {
      TERM: "xterm-256color",
    });
    return {
      spawned,
      exitCode,
    };
  });

  await Promise.resolve();
  assert.equal(await pathExists(paths.launchPlanFile), true);

  signalSpawned();

  await waitFor("launch plan completion before child exit", async () => {
    return !(await pathExists(paths.launchPlanFile));
  });

  signalExited(23);
  assert.equal(await launch, 23);
});

test("launchNext records spawn failures as retryable failed entries and returns 1", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [recoveryTab()]);

  const exitCode = await launchNext(paths, async () => ({
    spawned: Promise.reject(new Error("spawn failed")),
    exitCode: Promise.resolve(1),
  }));

  assert.equal(exitCode, 1);

  const plan = await readLaunchPlan(paths);
  const entry = plan.entries[0]!;
  assert.equal(entry.status, "failed");
  assert.equal(entry.error, "spawn failed");
  assert.equal("claimToken" in entry, false);

  const retry = await claimNextLaunch(paths);
  assert.equal(retry?.entry.id, entry.id);
});

test("launchNext returns 0 when no launch plan is available", async (t) => {
  const paths = await createRuntimePaths(t);

  const exitCode = await launchNext(paths, async () => {
    assert.fail("launchNext should not spawn when there is no pending launch");
  });

  assert.equal(exitCode, 0);
});
