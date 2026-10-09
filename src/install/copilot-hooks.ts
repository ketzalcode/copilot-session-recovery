import { mkdir } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson } from "../storage/atomic-json.ts";
import type { AppPaths } from "../storage/paths.ts";

export interface CopilotHookCommand {
  type: "command";
  exec: string;
  args: ["hook", "session-start" | "session-end"];
  timeoutSec: 5;
}

export interface CopilotHookConfig {
  version: 1;
  hooks: {
    sessionStart: [CopilotHookCommand];
    sessionEnd: [CopilotHookCommand];
  };
}

export function buildCopilotHookConfig(
  installedExecutable: string,
): CopilotHookConfig {
  const entry = (
    event: "session-start" | "session-end",
  ): CopilotHookCommand => ({
    type: "command",
    exec: installedExecutable,
    args: ["hook", event],
    timeoutSec: 5,
  });

  return {
    version: 1,
    hooks: {
      sessionStart: [entry("session-start")],
      sessionEnd: [entry("session-end")],
    },
  };
}

function defaultInstalledExecutable(paths: AppPaths): string {
  return path.win32.join(paths.appDir, "bin", "copilot-session-recovery.exe");
}

export async function writeCopilotHookConfig(
  paths: AppPaths,
  installedExecutable = defaultInstalledExecutable(paths),
): Promise<void> {
  await mkdir(path.dirname(paths.copilotHookFile), { recursive: true });
  await atomicWriteJson(
    paths.copilotHookFile,
    buildCopilotHookConfig(installedExecutable),
  );
}
