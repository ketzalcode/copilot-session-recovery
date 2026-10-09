import path from "node:path";

import type { PlatformAdapter } from "./platform.ts";
import type { AppPaths } from "../storage/paths.ts";

function resolveCopilotHome(env: NodeJS.ProcessEnv): string {
  if (typeof env.COPILOT_HOME === "string" && env.COPILOT_HOME.length > 0) {
    return env.COPILOT_HOME;
  }

  const userProfile = env.USERPROFILE;
  if (typeof userProfile !== "string" || userProfile.length === 0) {
    throw new Error("LOCALAPPDATA and USERPROFILE are required on Windows.");
  }

  return path.win32.join(userProfile, ".copilot");
}

export function resolveWindowsPaths(env: NodeJS.ProcessEnv): AppPaths {
  const localAppData = env.LOCALAPPDATA;
  const userProfile = env.USERPROFILE;

  if (
    typeof localAppData !== "string" ||
    localAppData.length === 0 ||
    typeof userProfile !== "string" ||
    userProfile.length === 0
  ) {
    throw new Error("LOCALAPPDATA and USERPROFILE are required on Windows.");
  }

  const appDir = path.win32.join(localAppData, "copilot-session-recovery");
  const copilotHome = resolveCopilotHome(env);

  return {
    appDir,
    configFile: path.win32.join(appDir, "config.json"),
    registryFile: path.win32.join(appDir, "sessions.json"),
    lockFile: path.win32.join(appDir, "sessions.lock"),
    diagnosticsDir: path.win32.join(appDir, "diagnostics"),
    corruptDir: path.win32.join(appDir, "corrupt"),
    copilotHookFile: path.win32.join(
      copilotHome,
      "hooks",
      "copilot-session-recovery.json",
    ),
    launchPlanFile: path.win32.join(appDir, "launch-plan.json"),
    launchPlanLockFile: path.win32.join(appDir, "launch-plan.lock"),
  };
}

export function createWindowsPlatformAdapter(): PlatformAdapter {
  return {
    id: "windows",
    terminalName: "Windows Terminal",
    resolvePaths: resolveWindowsPaths,
  };
}
