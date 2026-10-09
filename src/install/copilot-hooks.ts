import { mkdir } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson } from "../storage/atomic-json.ts";
import type { RuntimeInstallation } from "../runtime/installation.ts";
import type { AppPaths } from "../storage/paths.ts";

export interface CopilotHookCommand {
  type: "command";
  exec: string;
  args: [string, "hook", "session-start" | "session-end"];
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
  installation: RuntimeInstallation,
): CopilotHookConfig {
  const entry = (
    event: "session-start" | "session-end",
  ): CopilotHookCommand => ({
    type: "command",
    exec: installation.nodeExecutable,
    args: [installation.cliEntry, "hook", event],
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

export async function writeCopilotHookConfig(
  paths: AppPaths,
  installation: RuntimeInstallation,
): Promise<void> {
  await mkdir(path.dirname(paths.copilotHookFile), { recursive: true });
  await atomicWriteJson(
    paths.copilotHookFile,
    buildCopilotHookConfig(installation),
  );
}
