import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import type { CliOutput } from "../cli/io.ts";
import {
  defaultConfig,
  loadConfig,
  parseConfig,
  saveConfig,
  type AppConfig,
} from "../config/config.ts";
import { emptyRegistry } from "../session/lifecycle.ts";
import { atomicWriteJson } from "../storage/atomic-json.ts";
import type { PlatformAdapter } from "../platform/platform.ts";
import { writeCopilotHookConfig } from "./copilot-hooks.ts";
import {
  assertPersistentInstallation,
  type RuntimeInstallation,
} from "../runtime/installation.ts";
import type { AppPaths } from "../storage/paths.ts";

export interface InstallOptions {
  profile?: string;
}

export interface UninstallOptions {
  purge: boolean;
}

export interface InstallerDependencies {
  paths: AppPaths;
  output: CliOutput;
  installation: RuntimeInstallation;
  platform: PlatformAdapter;
  ensureDirectory(directory: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
  loadConfig(filePath: string): Promise<AppConfig>;
  saveConfig(filePath: string, config: AppConfig): Promise<void>;
  writeJson(filePath: string, value: unknown): Promise<void>;
  writeCopilotHookConfig(
    paths: AppPaths,
    installation: RuntimeInstallation,
  ): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  removeDirectory(directory: string): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isErrnoException(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function productionFileExists(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

export function createInstallerDependencies(
  paths: AppPaths,
  output: CliOutput,
  installation: RuntimeInstallation,
  platform: PlatformAdapter,
): InstallerDependencies {
  return {
    paths,
    output,
    installation,
    platform,
    ensureDirectory(directory) {
      return mkdir(directory, { recursive: true }).then(() => undefined);
    },
    fileExists: productionFileExists,
    loadConfig,
    saveConfig,
    writeJson: atomicWriteJson,
    writeCopilotHookConfig,
    removeFile(filePath) {
      return rm(filePath, { force: true });
    },
    removeDirectory(directory) {
      return rm(directory, { recursive: true, force: true });
    },
  };
}

async function ensureInstallDirectories(deps: InstallerDependencies): Promise<void> {
  await deps.ensureDirectory(deps.paths.appDir);
  await deps.ensureDirectory(deps.paths.diagnosticsDir);
  await deps.ensureDirectory(deps.paths.corruptDir);
  await deps.ensureDirectory(path.dirname(deps.paths.copilotHookFile));
}

async function installConfiguration(
  options: InstallOptions,
  deps: InstallerDependencies,
): Promise<void> {
  const configExists = await deps.fileExists(deps.paths.configFile);
  let config = configExists
    ? await deps.loadConfig(deps.paths.configFile)
    : defaultConfig();
  let shouldSave = !configExists;

  if (options.profile !== undefined) {
    config = parseConfig({
      ...config,
      defaultProfile: options.profile,
    });
    shouldSave = true;
  }

  if (shouldSave) {
    await deps.saveConfig(deps.paths.configFile, config);
  }
}

async function installRegistry(deps: InstallerDependencies): Promise<void> {
  if (!(await deps.fileExists(deps.paths.registryFile))) {
    await deps.writeJson(deps.paths.registryFile, emptyRegistry());
  }
}

async function performInstall(
  options: InstallOptions,
  deps: InstallerDependencies,
): Promise<void> {
  assertPersistentInstallation(deps.installation);

  await ensureInstallDirectories(deps);
  await installConfiguration(options, deps);
  await installRegistry(deps);
  await deps.writeCopilotHookConfig(deps.paths, deps.installation);

  const acl = await deps.platform.protectState(deps.paths);
  if (!acl.protected) {
    deps.output.error(`Warning: ${acl.detail}`);
  }

  deps.output.out(
    "Configured copilot-session-recovery for the current npm installation.",
  );
}

export async function installCommand(
  options: InstallOptions,
  deps: InstallerDependencies,
): Promise<number> {
  try {
    await performInstall(options, deps);
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

async function performUninstall(
  options: UninstallOptions,
  deps: InstallerDependencies,
): Promise<void> {
  await deps.removeFile(deps.paths.copilotHookFile);

  if (!options.purge) {
    deps.output.out("Removed the owned Copilot hook configuration.");
    return;
  }

  const expectedAppDir = deps.platform.resolvePaths(process.env).appDir;
  if (expectedAppDir !== deps.paths.appDir) {
    throw new Error(
      `Refusing to purge unexpected application directory: ${deps.paths.appDir}.`,
    );
  }

  await deps.removeDirectory(deps.paths.appDir);
  deps.output.out(`Removed ${deps.paths.appDir}.`);
}

export async function uninstallCommand(
  options: UninstallOptions,
  deps: InstallerDependencies,
): Promise<number> {
  try {
    await performUninstall(options, deps);
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}
