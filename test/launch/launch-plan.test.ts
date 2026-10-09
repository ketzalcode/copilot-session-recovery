import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  claimNextLaunch,
  completeLaunch,
  createLaunchPlan,
  failLaunch,
  type LaunchPlan,
  type LaunchPlanEntry,
} from "../../src/launch/launch-plan.ts";
import type { RecoveryTab } from "../../src/launch/recovery-plan.ts";
import { atomicWriteJson } from "../../src/storage/atomic-json.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

const sessionId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const runtimeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "runtime",
  "launch-plan",
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

async function readLaunchPlanText(paths: AppPaths): Promise<string> {
  return readFile(paths.launchPlanFile, "utf8");
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

function launchPlanEntry(
  id: string,
  status: LaunchPlanEntry["status"],
  overrides: Partial<LaunchPlanEntry> = {},
): LaunchPlanEntry {
  const entry: LaunchPlanEntry = {
    id,
    cwd: "/Users/ruben/src/project",
    process: {
      executable: "copilot",
      args: [`--resume=${id}`],
    },
    status,
    ...overrides,
  };

  if (status === "launching") {
    entry.claimToken = overrides.claimToken ?? `${id}-claim-token`;
  }

  if (status === "failed") {
    entry.error = overrides.error ?? "launch failed";
  }

  return entry;
}

function launchPlan(...entries: LaunchPlanEntry[]): LaunchPlan {
  return {
    schemaVersion: 1,
    createdAt: "2026-10-08T18:00:00.000Z",
    entries,
  };
}

test("createLaunchPlan rejects replacement when the current plan still has active work", async (t) => {
  const paths = await createRuntimePaths(t);
  const activeStatuses = ["pending", "launching", "failed"] as const;

  for (const status of activeStatuses) {
    await atomicWriteJson(
      paths.launchPlanFile,
      launchPlan(launchPlanEntry(`existing-${status}`, status)),
    );
    const before = await readLaunchPlanText(paths);

    await assert.rejects(
      createLaunchPlan(paths, [recoveryTab()]),
      /active launch plan/i,
    );
    assert.equal(await readLaunchPlanText(paths), before);
  }
});

test("createLaunchPlan replaces a fully launched plan with sanitized launch entries", async (t) => {
  const paths = await createRuntimePaths(t);
  const prior = launchPlan(launchPlanEntry("already-launched", "launched"));
  await atomicWriteJson(paths.launchPlanFile, prior);

  await createLaunchPlan(paths, [
    recoveryTab({
      process: {
        executable: "copilot",
        args: [`--resume=${sessionId}`],
        cwd: "/Users/ruben/src/ignored",
        env: {
          TERM: "xterm-256color",
        },
      },
    }),
  ]);

  const plan = await readLaunchPlan(paths);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(new Date(plan.createdAt).toISOString(), plan.createdAt);
  assert.equal(plan.entries.length, 1);

  const entry = plan.entries[0]!;
  assert.deepEqual(Object.keys(entry).sort(), ["cwd", "id", "process", "status"]);
  assert.equal(entry.cwd, "/Users/ruben/src/project");
  assert.equal(typeof entry.id, "string");
  assert.notEqual(entry.id, "");
  assert.equal(entry.status, "pending");
  assert.deepEqual(Object.keys(entry.process).sort(), [
    "args",
    "env",
    "executable",
  ]);
  assert.deepEqual(entry.process, {
    executable: "copilot",
    args: [`--resume=${sessionId}`],
    env: {
      TERM: "xterm-256color",
    },
  });
});

test("concurrent claimNextLaunch calls claim different entries under the file lock", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [
    recoveryTab(),
    recoveryTab({
      sessionId: "de305d54-75b4-431b-adb2-eb6b9e546014",
      cwd: "/Users/ruben/src/second-project",
      process: {
        executable: "copilot",
        args: ["--resume=de305d54-75b4-431b-adb2-eb6b9e546014"],
      },
    }),
  ]);

  const [first, second] = await Promise.all([
    claimNextLaunch(paths),
    claimNextLaunch(paths),
  ]);

  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.entry.id, second.entry.id);
  assert.deepEqual(
    new Set([first.entry.cwd, second.entry.cwd]),
    new Set([
      "/Users/ruben/src/project",
      "/Users/ruben/src/second-project",
    ]),
  );

  const plan = await readLaunchPlan(paths);
  assert.deepEqual(
    plan.entries.map((entry) => entry.status),
    ["launching", "launching"],
  );
  assert.deepEqual(
    new Set(plan.entries.map((entry) => entry.claimToken)),
    new Set([first.token, second.token]),
  );
});

test("claimNextLaunch retries failed entries only after pending entries", async (t) => {
  const paths = await createRuntimePaths(t);
  await atomicWriteJson(
    paths.launchPlanFile,
    launchPlan(
      launchPlanEntry("failed-entry", "failed"),
      launchPlanEntry("pending-entry", "pending", {
        cwd: "/Users/ruben/src/pending-project",
      }),
    ),
  );

  const first = await claimNextLaunch(paths);
  const second = await claimNextLaunch(paths);

  assert.equal(first?.entry.id, "pending-entry");
  assert.equal(first?.entry.cwd, "/Users/ruben/src/pending-project");
  assert.equal(second?.entry.id, "failed-entry");
});

test("completeLaunch rejects stale or unknown claim tokens", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [recoveryTab()]);

  const claim = await claimNextLaunch(paths);
  assert.ok(claim);

  await assert.rejects(
    completeLaunch(paths, "missing-token"),
    /stale or unknown/i,
  );

  await completeLaunch(paths, claim.token);

  await assert.rejects(
    completeLaunch(paths, claim.token),
    /stale or unknown/i,
  );
});

test("completeLaunch keeps claim tokens single-use after one successful completion", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [
    recoveryTab(),
    recoveryTab({
      sessionId: "de305d54-75b4-431b-adb2-eb6b9e546014",
      cwd: "/Users/ruben/src/second-project",
      process: {
        executable: "copilot",
        args: ["--resume=de305d54-75b4-431b-adb2-eb6b9e546014"],
      },
    }),
  ]);

  const first = await claimNextLaunch(paths);
  const second = await claimNextLaunch(paths);
  assert.ok(first);
  assert.ok(second);

  await completeLaunch(paths, first.token);

  const plan = await readLaunchPlan(paths);
  assert.deepEqual(
    plan.entries.map((entry) => entry.status),
    ["launched", "launching"],
  );
  assert.equal(plan.entries[1]?.claimToken, second.token);

  await assert.rejects(
    completeLaunch(paths, first.token),
    /stale or unknown/i,
  );

  const afterRejectedRetry = await readLaunchPlan(paths);
  assert.deepEqual(
    afterRejectedRetry.entries.map((entry) => entry.status),
    ["launched", "launching"],
  );
  assert.equal(afterRejectedRetry.entries[1]?.claimToken, second.token);
});

test("failLaunch clears the claim token, records the error, and leaves the entry retryable", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [recoveryTab()]);

  const claim = await claimNextLaunch(paths);
  assert.ok(claim);

  await failLaunch(paths, claim.token, "copilot spawn failed");

  const plan = await readLaunchPlan(paths);
  const entry = plan.entries[0]!;
  assert.equal(entry.status, "failed");
  assert.equal(entry.error, "copilot spawn failed");
  assert.equal("claimToken" in entry, false);

  const retry = await claimNextLaunch(paths);
  assert.equal(retry?.entry.id, claim.entry.id);
});

test("completeLaunch removes the plan after the final launch entry succeeds", async (t) => {
  const paths = await createRuntimePaths(t);
  await createLaunchPlan(paths, [recoveryTab()]);

  const claim = await claimNextLaunch(paths);
  assert.ok(claim);

  await completeLaunch(paths, claim.token);

  assert.equal(await pathExists(paths.launchPlanFile), false);
});

test("claimNextLaunch rejects invalid stored plans without replacing them", async (t) => {
  const paths = await createRuntimePaths(t);
  const invalidPlans: Array<{ label: string; value: unknown; pattern: RegExp }> = [
    {
      label: "invalid-schema",
      value: {
        schemaVersion: 2,
        createdAt: "2026-10-08T18:00:00.000Z",
        entries: [],
      },
      pattern: /schemaVersion must be 1/i,
    },
    {
      label: "relative-working-directory",
      value: launchPlan(
        launchPlanEntry("relative-entry", "pending", {
          cwd: "relative/project",
        }),
      ),
      pattern: /absolute working directory/i,
    },
    {
      label: "duplicate-active-claim-token",
      value: launchPlan(
        launchPlanEntry("launching-entry-one", "launching", {
          claimToken: "shared-claim-token",
        }),
        launchPlanEntry("launching-entry-two", "launching", {
          claimToken: "shared-claim-token",
          cwd: "/Users/ruben/src/second-project",
        }),
      ),
      pattern: /claim tokens must be unique/i,
    },
  ];

  for (const invalid of invalidPlans) {
    await atomicWriteJson(paths.launchPlanFile, invalid.value);
    const before = await readLaunchPlanText(paths);

    await assert.rejects(claimNextLaunch(paths), invalid.pattern);
    assert.equal(await readLaunchPlanText(paths), before, invalid.label);
  }
});
