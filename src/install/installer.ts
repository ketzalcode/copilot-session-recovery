import { isSea } from "node:sea";
import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
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
import type { AppPaths } from "../storage/paths.ts";
import { protectStateDirectory, type AclResult } from "./acl.ts";
import { writeCopilotHookConfig } from "./copilot-hooks.ts";
import { scheduleSelfDelete, type SelfDeleteRequest } from "./self-delete.ts";
import { ensureUserPathEntry, removeUserPathEntry } from "./user-path.ts";

export interface InstallOptions {
  profile?: string;
}

export interface UninstallOptions {
  purge: boolean;
}

export interface InstallerDependencies {
  paths: AppPaths;
  output: CliOutput;
  currentExecutable: string;
  currentPid: number;
  platform: NodeJS.Platform;
  isSea(): boolean;
  ensureDirectory(directory: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
  copyFileAtomic(source: string, destination: string): Promise<void>;
  loadConfig(filePath: string): Promise<AppConfig>;
  saveConfig(filePath: string, config: AppConfig): Promise<void>;
  writeJson(filePath: string, value: unknown): Promise<void>;
  writeCopilotHookConfig(paths: AppPaths): Promise<void>;
  ensureUserPathEntry(binDir: string): Promise<void>;
  removeUserPathEntry(binDir: string): Promise<void>;
  protectStateDirectory(appDir: string): Promise<AclResult>;
  removeFile(filePath: string): Promise<void>;
  scheduleSelfDelete(request: SelfDeleteRequest): void;
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

function normalizedWindowsPath(filePath: string): string {
  return path.win32.normalize(filePath).replace(/[\\]+$/u, "").toLowerCase();
}

function binDir(paths: AppPaths): string {
  return path.win32.join(paths.appDir, "bin");
}

function installedExecutable(paths: AppPaths): string {
  return path.win32.join(binDir(paths), "copilot-session-recovery.exe");
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

async function copyFileAtomically(
  source: string,
  destination: string,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await copyFile(source, temporaryPath);
    await rename(temporaryPath, destination);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function createInstallerDependencies(
  paths: AppPaths,
  output: CliOutput,
): InstallerDependencies {
  return {
    paths,
    output,
    currentExecutable: process.execPath,
    currentPid: process.pid,
    platform: process.platform,
    isSea,
    ensureDirectory(directory) {
      return mkdir(directory, { recursive: true }).then(() => undefined);
    },
    fileExists: productionFileExists,
    copyFileAtomic: copyFileAtomically,
    loadConfig,
    saveConfig,
    writeJson: atomicWriteJson,
    writeCopilotHookConfig,
    ensureUserPathEntry,
    removeUserPathEntry,
    protectStateDirectory,
    removeFile(filePath) {
      return rm(filePath, { force: true });
    },
    scheduleSelfDelete,
  };
}

function assertWindows(deps: InstallerDependencies): void {
  if (deps.platform !== "win32") {
    throw new Error("Install and uninstall are supported only on Windows.");
  }
}

async function ensureInstallDirectories(deps: InstallerDependencies): Promise<void> {
  await deps.ensureDirectory(deps.paths.appDir);
  await deps.ensureDirectory(binDir(deps.paths));
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
  assertWindows(deps);

  if (!deps.isSea()) {
    throw new Error(
      "Install must be run from the self-contained executable, not from Node.js source.",
    );
  }

  await ensureInstallDirectories(deps);

  const targetExecutable = installedExecutable(deps.paths);

  if (
    normalizedWindowsPath(deps.currentExecutable) !==
    normalizedWindowsPath(targetExecutable)
  ) {
    await deps.copyFileAtomic(deps.currentExecutable, targetExecutable);
  }

  await installConfiguration(options, deps);
  await installRegistry(deps);
  await deps.writeCopilotHookConfig(deps.paths);
  await deps.ensureUserPathEntry(binDir(deps.paths));

  const acl = await deps.protectStateDirectory(deps.paths.appDir);
  if (!acl.protected) {
    deps.output.error(`Warning: ${acl.detail}`);
  }

  deps.output.out(
    `Installed copilot-session-recovery to ${targetExecutable}.`,
  );
  deps.output.out("Restart already-open terminals to observe the updated PATH.");
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
  assertWindows(deps);
  await deps.removeFile(deps.paths.copilotHookFile);
  await deps.removeUserPathEntry(binDir(deps.paths));
  deps.scheduleSelfDelete({
    parentPid: deps.currentPid,
    installedExecutable: installedExecutable(deps.paths),
    appDir: deps.paths.appDir,
    purge: options.purge,
  });
  deps.output.out(
    options.purge
      ? `Scheduled removal of ${deps.paths.appDir} after this command exits.`
      : `Scheduled removal of ${installedExecutable(deps.paths)} after this command exits.`,
  );
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
