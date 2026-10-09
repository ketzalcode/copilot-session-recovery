import path from "node:path";

import type { PlatformAdapter } from "./platform.ts";
import {
  checkMacStateProtection,
  protectMacState,
  type ProtectionResult,
} from "./macos-permissions.ts";
import {
  commandExists,
  runProcess,
  type ProcessRunner,
} from "../launch/process-runner.ts";
import type { AppPaths } from "../storage/paths.ts";

function resolveCopilotHome(env: NodeJS.ProcessEnv): string {
  if (typeof env.COPILOT_HOME === "string" && env.COPILOT_HOME.length > 0) {
    return env.COPILOT_HOME;
  }

  const home = env.HOME;
  if (typeof home !== "string" || home.length === 0) {
    throw new Error("HOME is required on macOS.");
  }

  return path.posix.join(home, ".copilot");
}

export function resolveMacosPaths(env: NodeJS.ProcessEnv): AppPaths {
  const home = env.HOME;
  if (typeof home !== "string" || home.length === 0) {
    throw new Error("HOME is required on macOS.");
  }

  const appDir = path.posix.join(
    home,
    "Library",
    "Application Support",
    "copilot-session-recovery",
  );
  const copilotHome = resolveCopilotHome(env);

  return {
    appDir,
    configFile: path.posix.join(appDir, "config.json"),
    registryFile: path.posix.join(appDir, "sessions.json"),
    lockFile: path.posix.join(appDir, "sessions.lock"),
    diagnosticsDir: path.posix.join(appDir, "diagnostics"),
    corruptDir: path.posix.join(appDir, "corrupt"),
    copilotHookFile: path.posix.join(
      copilotHome,
      "hooks",
      "copilot-session-recovery.json",
    ),
    launchPlanFile: path.posix.join(appDir, "launch-plan.json"),
    launchPlanLockFile: path.posix.join(appDir, "launch-plan.lock"),
  };
}

interface MacosPlatformDependencies {
  commandExists?: (
    executable: string,
    platform: "win32" | "darwin",
  ) => Promise<boolean>;
  runProcess?: ProcessRunner;
  protectState?: (paths: AppPaths) => Promise<ProtectionResult>;
  checkStateProtection?: (paths: AppPaths) => Promise<ProtectionResult>;
}

export function createMacosPlatformAdapter(
  dependencies: MacosPlatformDependencies = {},
): PlatformAdapter {
  const lookupCommand = dependencies.commandExists ?? commandExists;
  const processRunner = dependencies.runProcess ?? runProcess;
  const protectState = dependencies.protectState ?? protectMacState;
  const checkStateProtection =
    dependencies.checkStateProtection ?? checkMacStateProtection;

  return {
    id: "macos",
    terminalName: "Apple Terminal",
    resolvePaths: resolveMacosPaths,
    protectState,
    checkStateProtection,
    async terminalAvailable() {
      if (!(await lookupCommand("/usr/bin/osascript", "darwin"))) {
        return false;
      }

      const result = await processRunner({
        executable: "/usr/bin/open",
        args: ["-Ra", "Terminal"],
      }).catch(() => undefined);

      return result?.exitCode === 0;
    },
  };
}
