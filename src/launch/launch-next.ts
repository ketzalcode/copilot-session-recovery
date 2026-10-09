import { spawn } from "node:child_process";

import {
  claimNextLaunch,
  completeLaunch,
  failLaunch,
} from "./launch-plan.ts";
import type { ProcessSpec } from "./process-runner.ts";
import type { AppPaths } from "../storage/paths.ts";

export interface AttachedSpawnHandle {
  spawned: Promise<void>;
  exitCode: Promise<number>;
}

export type AttachedSpawnerResult = number | void | AttachedSpawnHandle;

export type AttachedSpawner = (
  spec: ProcessSpec & { cwd: string },
) => AttachedSpawnerResult | Promise<AttachedSpawnerResult>;

export interface LaunchNextOptions {
  onSpawnFailure?: (message: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneProcessSpec(
  spec: ProcessSpec & { cwd: string },
): ProcessSpec & { cwd: string } {
  const next: ProcessSpec & { cwd: string } = {
    executable: spec.executable,
    args: [...spec.args],
    cwd: spec.cwd,
  };

  if (spec.env !== undefined) {
    next.env = { ...spec.env };
  }

  return next;
}

function spawnAttachedProcess(
  spec: ProcessSpec & { cwd: string },
): AttachedSpawnHandle {
  const child = spawn(spec.executable, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    shell: false,
    stdio: "inherit",
  });

  const spawned = new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  const exitCode = new Promise<number>((resolve) => {
    child.once("close", (code) => {
      resolve(code ?? 1);
    });
    child.once("error", () => {
      resolve(1);
    });
  });

  return {
    spawned,
    exitCode,
  };
}

function isAttachedSpawnHandle(
  value: AttachedSpawnerResult,
): value is AttachedSpawnHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "spawned" in value &&
    "exitCode" in value
  );
}

function normalizeAttachedSpawnResult(
  value: AttachedSpawnerResult,
): AttachedSpawnHandle {
  if (isAttachedSpawnHandle(value)) {
    return value;
  }

  return {
    spawned: Promise.resolve(),
    exitCode: Promise.resolve(value ?? 0),
  };
}

async function recordLaunchFailure(
  paths: AppPaths,
  token: string,
  error: unknown,
): Promise<void> {
  try {
    await failLaunch(paths, token, errorMessage(error));
  } catch (recordError) {
    throw new AggregateError(
      [error, recordError],
      "Launch failed and could not be recorded.",
    );
  }
}

export async function launchNext(
  paths: AppPaths,
  spawnAttached: AttachedSpawner = spawnAttachedProcess,
  options: LaunchNextOptions = {},
): Promise<number> {
  const claim = await claimNextLaunch(paths);
  if (claim === undefined) {
    return 0;
  }

  const spec = cloneProcessSpec({
    executable: claim.entry.process.executable,
    args: claim.entry.process.args,
    cwd: claim.entry.cwd,
    ...(claim.entry.process.env === undefined
      ? {}
      : { env: claim.entry.process.env }),
  });
  let claimCompleted = false;

  try {
    const handle = normalizeAttachedSpawnResult(await spawnAttached(spec));
    await handle.spawned;
    await completeLaunch(paths, claim.token);
    claimCompleted = true;
    return await handle.exitCode;
  } catch (error) {
    if (!claimCompleted) {
      const failureMessage = errorMessage(error);
      await recordLaunchFailure(paths, claim.token, failureMessage);
      options.onSpawnFailure?.(failureMessage);
    }

    return 1;
  }
}
