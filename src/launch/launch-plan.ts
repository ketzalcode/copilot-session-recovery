import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import type { RecoveryTab } from "./recovery-plan.ts";
import type { ProcessSpec } from "./process-runner.ts";
import { atomicWriteJson } from "../storage/atomic-json.ts";
import type { AppPaths } from "../storage/paths.ts";
import { withFileLock } from "../storage/file-lock.ts";

const LAUNCH_PLAN_SCHEMA_VERSION = 1 as const;
const LAUNCH_PLAN_KEYS = ["schemaVersion", "createdAt", "entries"] as const;
const LAUNCH_PLAN_ENTRY_KEYS = [
  "id",
  "cwd",
  "process",
  "status",
  "claimToken",
  "error",
] as const;
const LAUNCH_PROCESS_KEYS = ["executable", "args", "env"] as const;
const LAUNCH_STATUSES = new Set<LaunchPlanEntry["status"]>([
  "pending",
  "launching",
  "launched",
  "failed",
]);

export interface LaunchPlanEntry {
  id: string;
  cwd: string;
  process: ProcessSpec;
  status: "pending" | "launching" | "launched" | "failed";
  claimToken?: string;
  error?: string;
}

export interface LaunchPlan {
  schemaVersion: typeof LAUNCH_PLAN_SCHEMA_VERSION;
  createdAt: string;
  entries: LaunchPlanEntry[];
}

export interface LaunchPlanInspection {
  retryableCount: number;
  launchingCount: number;
  launchedCount: number;
}

function isErrnoException(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains an unexpected field "${key}".`);
    }
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function isoTimestamp(value: unknown, label: string): string {
  const text = nonEmptyString(value, label);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== text) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }

  return text;
}

function isAbsoluteWorkingDirectory(cwd: string): boolean {
  return path.posix.isAbsolute(cwd) || path.win32.isAbsolute(cwd);
}

function absoluteWorkingDirectory(value: unknown, label: string): string {
  const cwd = nonEmptyString(value, label);
  if (!isAbsoluteWorkingDirectory(cwd)) {
    throw new Error(`${label} must be an absolute working directory.`);
  }

  return cwd;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value.map((entry, index) =>
    nonEmptyString(entry, `${label} ${index}`),
  );
}

function parseEnvironment(
  value: unknown,
  label: string,
): NodeJS.ProcessEnv | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = objectValue(value, label);
  const env: NodeJS.ProcessEnv = {};

  for (const [key, entry] of Object.entries(raw)) {
    env[key] = nonEmptyString(entry, `${label} ${key}`);
  }

  return env;
}

function sanitizeEnvironment(
  env: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv | undefined {
  if (env === undefined) {
    return undefined;
  }

  const next: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      next[key] = value;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function sanitizeProcessSpec(
  value: ProcessSpec,
  label: string,
): ProcessSpec {
  const process: ProcessSpec = {
    executable: nonEmptyString(value.executable, `${label} executable`),
    args: stringArray(value.args, `${label} args`),
  };
  const env = sanitizeEnvironment(value.env);
  if (env !== undefined) {
    process.env = env;
  }

  return process;
}

function parseProcessSpec(value: unknown, label: string): ProcessSpec {
  const input = objectValue(value, label);
  assertOnlyKeys(input, LAUNCH_PROCESS_KEYS, label);

  const process: ProcessSpec = {
    executable: nonEmptyString(input.executable, `${label} executable`),
    args: stringArray(input.args, `${label} args`),
  };
  const env = parseEnvironment(input.env, `${label} env`);
  if (env !== undefined) {
    process.env = env;
  }

  return process;
}

function parseStatus(
  value: unknown,
  label: string,
): LaunchPlanEntry["status"] {
  const status = nonEmptyString(value, label);
  if (!LAUNCH_STATUSES.has(status as LaunchPlanEntry["status"])) {
    throw new Error(`${label} contains an invalid status.`);
  }

  return status as LaunchPlanEntry["status"];
}

function parseLaunchPlanEntry(
  value: unknown,
  label: string,
): LaunchPlanEntry {
  const input = objectValue(value, label);
  assertOnlyKeys(input, LAUNCH_PLAN_ENTRY_KEYS, label);

  const entry: LaunchPlanEntry = {
    id: nonEmptyString(input.id, `${label} id`),
    cwd: absoluteWorkingDirectory(input.cwd, `${label} cwd`),
    process: parseProcessSpec(input.process, `${label} process`),
    status: parseStatus(input.status, `${label} status`),
  };

  if (input.claimToken !== undefined) {
    entry.claimToken = nonEmptyString(input.claimToken, `${label} claimToken`);
  }

  if (input.error !== undefined) {
    entry.error = nonEmptyString(input.error, `${label} error`);
  }

  if (entry.status === "launching" && entry.claimToken === undefined) {
    throw new Error(`${label} launching entries must include a claim token.`);
  }

  if (entry.status !== "launching" && entry.claimToken !== undefined) {
    throw new Error(
      `${label} claim tokens are allowed only for launching entries.`,
    );
  }

  return entry;
}

function parseLaunchPlan(value: unknown): LaunchPlan {
  const input = objectValue(value, "Launch plan");
  assertOnlyKeys(input, LAUNCH_PLAN_KEYS, "Launch plan");

  if (input.schemaVersion !== LAUNCH_PLAN_SCHEMA_VERSION) {
    throw new Error(
      `Launch plan schemaVersion must be ${LAUNCH_PLAN_SCHEMA_VERSION}.`,
    );
  }

  if (!Array.isArray(input.entries)) {
    throw new Error("Launch plan entries must be an array.");
  }

  const entries = input.entries.map((entry, index) =>
    parseLaunchPlanEntry(entry, `Launch plan entry ${index}`),
  );
  const ids = new Set<string>();
  const activeClaimTokens = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new Error(`Launch plan entry id ${entry.id} must be unique.`);
    }
    ids.add(entry.id);

    if (entry.status === "launching") {
      const claimToken = entry.claimToken!;
      if (activeClaimTokens.has(claimToken)) {
        throw new Error(
          "Launch plan launching claim tokens must be unique.",
        );
      }
      activeClaimTokens.add(claimToken);
    }
  }

  return {
    schemaVersion: LAUNCH_PLAN_SCHEMA_VERSION,
    createdAt: isoTimestamp(input.createdAt, "Launch plan createdAt"),
    entries,
  };
}

async function readLaunchPlan(
  filePath: string,
  options: { allowMissing: true },
): Promise<LaunchPlan | undefined>;
async function readLaunchPlan(
  filePath: string,
  options?: { allowMissing?: false },
): Promise<LaunchPlan>;
async function readLaunchPlan(
  filePath: string,
  options: { allowMissing?: boolean } = {},
): Promise<LaunchPlan | undefined> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if (options.allowMissing && isErrnoException(error, "ENOENT")) {
      return undefined;
    }

    throw error;
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Launch plan ${filePath} contains invalid JSON.`, {
      cause: error,
    });
  }

  return parseLaunchPlan(value);
}

async function writeLaunchPlan(filePath: string, plan: LaunchPlan): Promise<void> {
  await atomicWriteJson(filePath, parseLaunchPlan(plan));
}

function hasActiveEntries(plan: LaunchPlan): boolean {
  return plan.entries.some(
    (entry) =>
      entry.status === "pending" ||
      entry.status === "launching" ||
      entry.status === "failed",
  );
}

function inspectPlan(plan: LaunchPlan): LaunchPlanInspection {
  let retryableCount = 0;
  let launchingCount = 0;
  let launchedCount = 0;

  for (const entry of plan.entries) {
    if (entry.status === "pending" || entry.status === "failed") {
      retryableCount += 1;
    } else if (entry.status === "launching") {
      launchingCount += 1;
    } else {
      launchedCount += 1;
    }
  }

  return {
    retryableCount,
    launchingCount,
    launchedCount,
  };
}

function findClaimedEntryIndex(plan: LaunchPlan, token: string): number {
  return plan.entries.findIndex(
    (entry) => entry.status === "launching" && entry.claimToken === token,
  );
}

function cloneEntry(entry: LaunchPlanEntry): LaunchPlanEntry {
  const next: LaunchPlanEntry = {
    id: entry.id,
    cwd: entry.cwd,
    process: {
      executable: entry.process.executable,
      args: [...entry.process.args],
    },
    status: entry.status,
  };

  if (entry.process.env !== undefined) {
    next.process.env = { ...entry.process.env };
  }

  if (entry.claimToken !== undefined) {
    next.claimToken = entry.claimToken;
  }

  if (entry.error !== undefined) {
    next.error = entry.error;
  }

  return next;
}

function createPendingEntry(tab: RecoveryTab): LaunchPlanEntry {
  return {
    id: randomUUID(),
    cwd: absoluteWorkingDirectory(tab.cwd, "Launch tab cwd"),
    process: sanitizeProcessSpec(tab.process, "Launch tab process"),
    status: "pending",
  };
}

export async function createLaunchPlan(
  paths: AppPaths,
  tabs: readonly RecoveryTab[],
): Promise<void> {
  await withFileLock(paths.launchPlanLockFile, async () => {
    const existing = await readLaunchPlan(paths.launchPlanFile, {
      allowMissing: true,
    });
    if (existing !== undefined && hasActiveEntries(existing)) {
      throw new Error("An active launch plan already exists.");
    }

    const plan: LaunchPlan = {
      schemaVersion: LAUNCH_PLAN_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      entries: tabs.map((tab) => createPendingEntry(tab)),
    };

    await writeLaunchPlan(paths.launchPlanFile, plan);
  });
}

export async function inspectLaunchPlan(
  paths: AppPaths,
): Promise<LaunchPlanInspection | undefined> {
  return withFileLock(paths.launchPlanLockFile, async () => {
    const plan = await readLaunchPlan(paths.launchPlanFile, {
      allowMissing: true,
    });
    return plan === undefined ? undefined : inspectPlan(plan);
  });
}

export async function discardLaunchPlan(paths: AppPaths): Promise<boolean> {
  return withFileLock(paths.launchPlanLockFile, async () => {
    const plan = await readLaunchPlan(paths.launchPlanFile, {
      allowMissing: true,
    });
    if (plan === undefined) {
      return false;
    }

    const inspection = inspectPlan(plan);
    if (inspection.launchingCount > 0) {
      throw new Error(
        "Cannot discard the launch plan while entries are launching.",
      );
    }

    await rm(paths.launchPlanFile, { force: true });
    return true;
  });
}

export async function claimNextLaunch(
  paths: AppPaths,
): Promise<{ token: string; entry: LaunchPlanEntry } | undefined> {
  return withFileLock(paths.launchPlanLockFile, async () => {
    const plan = await readLaunchPlan(paths.launchPlanFile, {
      allowMissing: true,
    });
    if (plan === undefined) {
      return undefined;
    }

    const nextIndex = plan.entries.findIndex((entry) => entry.status === "pending");
    const retryIndex =
      nextIndex >= 0
        ? nextIndex
        : plan.entries.findIndex((entry) => entry.status === "failed");
    if (retryIndex < 0) {
      return undefined;
    }

    const current = plan.entries[retryIndex]!;
    const token = randomUUID();
    const entry: LaunchPlanEntry = {
      id: current.id,
      cwd: current.cwd,
      process: cloneEntry(current).process,
      status: "launching",
      claimToken: token,
    };

    plan.entries[retryIndex] = entry;
    await writeLaunchPlan(paths.launchPlanFile, plan);

    return {
      token,
      entry: cloneEntry(entry),
    };
  });
}

export async function completeLaunch(
  paths: AppPaths,
  token: string,
): Promise<void> {
  await withFileLock(paths.launchPlanLockFile, async () => {
    const plan = await readLaunchPlan(paths.launchPlanFile, {
      allowMissing: true,
    });
    if (plan === undefined) {
      throw new Error("Launch claim token is stale or unknown.");
    }

    const index = findClaimedEntryIndex(plan, token);
    if (index < 0) {
      throw new Error("Launch claim token is stale or unknown.");
    }

    const current = plan.entries[index]!;
    plan.entries[index] = {
      id: current.id,
      cwd: current.cwd,
      process: cloneEntry(current).process,
      status: "launched",
    };

    if (plan.entries.every((entry) => entry.status === "launched")) {
      await rm(paths.launchPlanFile, { force: true });
      return;
    }

    await writeLaunchPlan(paths.launchPlanFile, plan);
  });
}

export async function failLaunch(
  paths: AppPaths,
  token: string,
  message: string,
): Promise<void> {
  await withFileLock(paths.launchPlanLockFile, async () => {
    const plan = await readLaunchPlan(paths.launchPlanFile, {
      allowMissing: true,
    });
    if (plan === undefined) {
      throw new Error("Launch claim token is stale or unknown.");
    }

    const index = findClaimedEntryIndex(plan, token);
    if (index < 0) {
      throw new Error("Launch claim token is stale or unknown.");
    }

    const current = plan.entries[index]!;
    plan.entries[index] = {
      id: current.id,
      cwd: current.cwd,
      process: cloneEntry(current).process,
      status: "failed",
      error: nonEmptyString(message, "Launch failure message"),
    };

    await writeLaunchPlan(paths.launchPlanFile, plan);
  });
}
