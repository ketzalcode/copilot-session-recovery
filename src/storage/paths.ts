import path from "node:path";

export interface AppPaths {
  appDir: string;
  binDir: string;
  installedExecutable: string;
  configFile: string;
  registryFile: string;
  lockFile: string;
  diagnosticsDir: string;
  corruptDir: string;
  copilotHookFile: string;
}

interface ResolvePathOptions {
  env?: NodeJS.ProcessEnv;
}

export function resolveAppPaths(
  options: ResolvePathOptions = {},
): AppPaths {
  const env = options.env ?? process.env;
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

  const copilotHome =
    typeof env.COPILOT_HOME === "string" && env.COPILOT_HOME.length > 0
      ? env.COPILOT_HOME
      : path.win32.join(userProfile, ".copilot");

  const appDir = path.win32.join(localAppData, "copilot-auto-save");
  const binDir = path.win32.join(appDir, "bin");

  return {
    appDir,
    binDir,
    installedExecutable: path.win32.join(binDir, "copilot-auto-save.exe"),
    configFile: path.win32.join(appDir, "config.json"),
    registryFile: path.win32.join(appDir, "sessions.json"),
    lockFile: path.win32.join(appDir, "sessions.lock"),
    diagnosticsDir: path.win32.join(appDir, "diagnostics"),
    corruptDir: path.win32.join(appDir, "corrupt"),
    copilotHookFile: path.win32.join(
      copilotHome,
      "hooks",
      "copilot-auto-save.json",
    ),
  };
}
