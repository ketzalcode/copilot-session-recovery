import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../config/config.ts";
import { applyLifecycleEvent } from "../session/lifecycle.ts";
import type { AppPaths } from "../storage/paths.ts";
import { updateRegistry } from "../storage/registry.ts";
import {
  parseSessionEndPayload,
  parseSessionStartPayload,
} from "./payload.ts";

export interface HookDependencies {
  paths: AppPaths;
  writeDiagnostic: (message: string) => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function diagnosticTimestamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export async function writeDiagnostic(
  paths: AppPaths,
  message: string,
): Promise<void> {
  await mkdir(paths.diagnosticsDir, { recursive: true });

  const filePath = path.join(
    paths.diagnosticsDir,
    `hook-${diagnosticTimestamp(new Date())}-${process.pid}-${randomUUID()}.log`,
  );
  await writeFile(filePath, `${message}\n`, "utf8");
}

async function handleHook(
  run: () => Promise<void>,
  deps: HookDependencies,
): Promise<number> {
  try {
    await run();
  } catch (error) {
    const message = errorMessage(error);
    await deps.writeDiagnostic(message).catch(() => undefined);
    process.stderr.write(`copilot-auto-save hook warning: ${message}\n`);
  }

  process.stdout.write("{}\n");
  return 0;
}

export function handleSessionStartHook(
  inputText: string,
  deps: HookDependencies,
): Promise<number> {
  return handleHook(async () => {
    const event = parseSessionStartPayload(JSON.parse(inputText));
    const config = await loadConfig(deps.paths.configFile);

    await updateRegistry(deps.paths, (registry) =>
      applyLifecycleEvent(registry, event, config.defaultProfile),
    );
  }, deps);
}

export function handleSessionEndHook(
  inputText: string,
  deps: HookDependencies,
): Promise<number> {
  return handleHook(async () => {
    const event = parseSessionEndPayload(JSON.parse(inputText));

    await updateRegistry(deps.paths, (registry) =>
      applyLifecycleEvent(registry, event),
    );
  }, deps);
}
