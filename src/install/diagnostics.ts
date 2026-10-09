import type { CliOutput } from "../cli/io.ts";
import {
  loadConfig,
  type AppConfig,
} from "../config/config.ts";
import { commandExists as defaultCommandExists } from "../launch/process-runner.ts";
import type { SessionRegistry } from "../session/model.ts";
import type { AppPaths } from "../storage/paths.ts";
import {
  readRegistry,
  RegistryCorruptError,
  resetCorruptRegistry,
} from "../storage/registry.ts";
import {
  checkStateDirectoryProtection,
  type AclResult,
} from "../platform/windows-permissions.ts";
import { resolveRuntimeInstallation } from "../runtime/installation.ts";
import { buildCopilotHookConfig } from "./copilot-hooks.ts";
import { readFile, stat } from "node:fs/promises";

export type DiagnosticStatus = "ok" | "warning" | "error";

export interface DiagnosticCheck {
  id:
    | "installed-executable"
    | "copilot-hook"
    | "configuration"
    | "registry"
    | "state-acl"
    | "windows-terminal"
    | "launcher";
  status: DiagnosticStatus;
  summary: string;
  detail?: string;
  fix?: string;
}

export interface DiagnosticReport {
  healthy: boolean;
  checks: DiagnosticCheck[];
}

export interface DoctorOptions {
  repairRegistry: boolean;
}

export interface DiagnosticDependencies {
  paths: AppPaths;
  output: CliOutput;
  fileExists(filePath: string): Promise<boolean>;
  readText(filePath: string): Promise<string>;
  loadConfig(filePath: string): Promise<AppConfig>;
  readRegistry(registryFile: string, corruptDir: string): Promise<SessionRegistry>;
  resetCorruptRegistry(paths: AppPaths): Promise<string>;
  commandExists(executable: string): Promise<boolean>;
  checkStateDirectoryProtection(appDir: string): Promise<AclResult>;
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

export function createDiagnosticDependencies(
  paths: AppPaths,
  output: CliOutput,
): DiagnosticDependencies {
  return {
    paths,
    output,
    fileExists: productionFileExists,
    readText: (filePath) => readFile(filePath, "utf8"),
    loadConfig,
    readRegistry,
    resetCorruptRegistry,
    commandExists: defaultCommandExists,
    checkStateDirectoryProtection,
  };
}

function installedExecutablePath(paths: AppPaths): string {
  return `${paths.appDir}\\bin\\copilot-session-recovery.exe`;
}

function ok(id: DiagnosticCheck["id"], summary: string, detail?: string): DiagnosticCheck {
  return detail === undefined
    ? { id, status: "ok", summary }
    : { id, status: "ok", summary, detail };
}

function warning(
  id: DiagnosticCheck["id"],
  summary: string,
  detail: string,
  fix?: string,
): DiagnosticCheck {
  return fix === undefined
    ? { id, status: "warning", summary, detail }
    : { id, status: "warning", summary, detail, fix };
}

function error(
  id: DiagnosticCheck["id"],
  summary: string,
  detail: string,
  fix?: string,
): DiagnosticCheck {
  return fix === undefined
    ? { id, status: "error", summary, detail }
    : { id, status: "error", summary, detail, fix };
}

async function installedExecutableCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  const installedExecutable = installedExecutablePath(deps.paths);
  if (await deps.fileExists(installedExecutable)) {
    return ok("installed-executable", "Installed executable exists.");
  }

  return error(
    "installed-executable",
    "Installed executable is missing.",
    installedExecutable,
    "Run install from the self-contained executable.",
  );
}

async function copilotHookCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  try {
    const text = await deps.readText(deps.paths.copilotHookFile);
    const parsed = JSON.parse(text) as unknown;
    const expected = buildCopilotHookConfig(
      resolveRuntimeInstallation({
        moduleUrl: new URL("../cli/main.ts", import.meta.url).href,
      }),
    );
    if (JSON.stringify(parsed) === JSON.stringify(expected)) {
      return ok("copilot-hook", "Owned Copilot hook is installed.");
    }

    return error(
      "copilot-hook",
      "Owned Copilot hook differs from expected configuration.",
      deps.paths.copilotHookFile,
      "Run install to rewrite only the owned hook file.",
    );
  } catch (caught) {
    return error(
      "copilot-hook",
      "Owned Copilot hook is unavailable.",
      errorMessage(caught),
      "Run install to write the owned hook file.",
    );
  }
}

async function configurationCheck(
  deps: DiagnosticDependencies,
): Promise<{ check: DiagnosticCheck; config?: AppConfig }> {
  try {
    const config = await deps.loadConfig(deps.paths.configFile);
    return {
      check: ok("configuration", "Configuration is valid."),
      config,
    };
  } catch (caught) {
    return {
      check: error(
        "configuration",
        "Configuration is invalid or missing.",
        errorMessage(caught),
        "Run install or fix the configuration file.",
      ),
    };
  }
}

async function registryCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  try {
    await deps.readRegistry(deps.paths.registryFile, deps.paths.corruptDir);
    return ok("registry", "Registry is valid.");
  } catch (caught) {
    if (caught instanceof RegistryCorruptError) {
      return error(
        "registry",
        "Registry is corrupt.",
        caught.evidencePath,
        "Run doctor --repair-registry after reviewing the evidence.",
      );
    }

    return error(
      "registry",
      "Registry could not be read.",
      errorMessage(caught),
    );
  }
}

async function stateAclCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  const result = await deps.checkStateDirectoryProtection(deps.paths.appDir);
  if (result.protected) {
    return ok("state-acl", "State directory ACL is current-user protected.", result.detail);
  }

  return warning(
    "state-acl",
    "State directory ACL protection could not be verified.",
    result.detail,
    "Run install again or inspect the directory ACL.",
  );
}

async function windowsTerminalCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  if (await deps.commandExists("wt.exe")) {
    return ok("windows-terminal", "Windows Terminal is available.");
  }

  return error(
    "windows-terminal",
    "Windows Terminal was not found.",
    "wt.exe is not available on PATH.",
    "Install Windows Terminal or repair PATH.",
  );
}

async function launcherCheck(
  deps: DiagnosticDependencies,
  config: AppConfig | undefined,
): Promise<DiagnosticCheck> {
  if (config === undefined) {
    return error(
      "launcher",
      "Launcher could not be checked.",
      "Configuration is invalid or missing.",
    );
  }

  const profile = config.profiles[config.defaultProfile];
  if (profile === undefined) {
    return error(
      "launcher",
      "Default launcher profile is missing.",
      config.defaultProfile,
    );
  }

  if (await deps.commandExists(profile.executable)) {
    return ok("launcher", `Launcher ${config.defaultProfile} is available.`);
  }

  return error(
    "launcher",
    `Launcher ${config.defaultProfile} was not found.`,
    profile.executable,
    "Install the launcher or adjust the default profile.",
  );
}

export async function collectDiagnostics(
  deps: DiagnosticDependencies,
): Promise<DiagnosticReport> {
  const configuration = await configurationCheck(deps);
  const checks = [
    await installedExecutableCheck(deps),
    await copilotHookCheck(deps),
    configuration.check,
    await registryCheck(deps),
    await stateAclCheck(deps),
    await windowsTerminalCheck(deps),
    await launcherCheck(deps, configuration.config),
  ];

  return {
    healthy: checks.every((check) => check.status === "ok"),
    checks,
  };
}

function formatCompact(check: DiagnosticCheck): string {
  return `${check.status.toUpperCase()} ${check.id}: ${check.summary}`;
}

function formatDetailed(check: DiagnosticCheck): string {
  const lines = [formatCompact(check)];
  if (check.detail !== undefined) {
    lines.push(`  detail: ${check.detail}`);
  }
  if (check.fix !== undefined) {
    lines.push(`  fix: ${check.fix}`);
  }
  return lines.join("\n");
}

export async function statusCommand(
  deps: DiagnosticDependencies,
): Promise<number> {
  const report = await collectDiagnostics(deps);
  for (const check of report.checks) {
    deps.output.out(formatCompact(check));
  }
  return report.healthy ? 0 : 1;
}

export async function repairRegistryCommand(
  deps: DiagnosticDependencies,
): Promise<number> {
  let evidencePath: string;
  try {
    await deps.readRegistry(deps.paths.registryFile, deps.paths.corruptDir);
    deps.output.out("Registry is healthy; no repair was needed.");
    return 0;
  } catch (caught) {
    if (!(caught instanceof RegistryCorruptError)) {
      deps.output.error(errorMessage(caught));
      return 1;
    }

    evidencePath = caught.evidencePath;
  }

  deps.output.out(`Registry corruption evidence: ${evidencePath}`);
  if (!(await deps.output.confirm("Reset registry and preserve corrupt evidence?"))) {
    deps.output.out("Registry repair cancelled.");
    return 0;
  }

  const preservedEvidencePath = await deps.resetCorruptRegistry(deps.paths);
  deps.output.out(
    `Registry repaired with an empty registry; preserved evidence at ${preservedEvidencePath}.`,
  );
  return 0;
}

export async function doctorCommand(
  options: DoctorOptions,
  deps: DiagnosticDependencies,
): Promise<number> {
  if (options.repairRegistry) {
    return repairRegistryCommand(deps);
  }

  const report = await collectDiagnostics(deps);
  for (const check of report.checks) {
    deps.output.out(formatDetailed(check));
  }
  return report.healthy ? 0 : 1;
}
