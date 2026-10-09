import { resolveMacosPaths } from "../platform/macos.ts";
import { resolveWindowsPaths } from "../platform/windows.ts";

export interface AppPaths {
  appDir: string;
  configFile: string;
  registryFile: string;
  lockFile: string;
  diagnosticsDir: string;
  corruptDir: string;
  copilotHookFile: string;
  launchPlanFile: string;
  launchPlanLockFile: string;
}

type ResolvePathOptions =
  | {
      platform: "win32";
      env?: NodeJS.ProcessEnv;
    }
  | {
      platform: "darwin";
      env?: NodeJS.ProcessEnv;
    };

export function resolveAppPaths(options: ResolvePathOptions): AppPaths {
  if (options.platform === "win32") {
    return resolveWindowsPaths(options.env ?? process.env);
  }

  return resolveMacosPaths(options.env ?? process.env);
}
