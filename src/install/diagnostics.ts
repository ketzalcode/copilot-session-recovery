import type { CliOutput } from "../cli/io.ts";
import {
  loadConfig,
  type AppConfig,
} from "../config/config.ts";
import { commandExists as defaultCommandExists } from "../launch/process-runner.ts";
import type { PlatformAdapter } from "../platform/platform.ts";
import type { SessionRegistry } from "../session/model.ts";
import type { AppPaths } from "../storage/paths.ts";
import {
  readRegistry,
  RegistryCorruptError,
  resetCorruptRegistry,
} from "../storage/registry.ts";
import type { RuntimeInstallation } from "../runtime/installation.ts";
import { buildCopilotHookConfig } from "./copilot-hooks.ts";
import { readFile, stat } from "node:fs/promises";

export type DiagnosticStatus = "ok" | "warning" | "error";

export interface DiagnosticCheck {
  id:
    | "runtime"
    | "copilot-hook"
    | "configuration"
    | "registry"
    | "state-protection"
    | "terminal"
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
  installation: RuntimeInstallation;
  platform: PlatformAdapter;
  fileExists(filePath: string): Promise<boolean>;
  readText(filePath: string): Promise<string>;
  loadConfig(filePath: string): Promise<AppConfig>;
  readRegistry(registryFile: string, corruptDir: string): Promise<SessionRegistry>;
  resetCorruptRegistry(paths: AppPaths): Promise<string>;
  commandExists(
    executable: string,
    platform: "win32" | "darwin",
  ): Promise<boolean>;
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
  installation: RuntimeInstallation,
  platform: PlatformAdapter,
): DiagnosticDependencies {
  return {
    paths,
    output,
    installation,
    platform,
    fileExists: productionFileExists,
    readText: (filePath) => readFile(filePath, "utf8"),
    loadConfig,
    readRegistry,
    resetCorruptRegistry,
    commandExists: defaultCommandExists,
  };
}

function currentPlatform(
  platform: PlatformAdapter,
): "win32" | "darwin" {
  return platform.id === "windows" ? "win32" : "darwin";
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

async function runtimeCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  const { nodeExecutable, cliEntry } = deps.installation;

  if (nodeExecutable.length === 0) {
    return error(
      "runtime",
      "Installed npm runtime is unavailable.",
      "nodeExecutable is missing from the runtime installation.",
      "Run install from the persistent npm installation.",
    );
  }

  if (cliEntry.length === 0) {
    return error(
      "runtime",
      "Installed npm runtime is unavailable.",
      "cliEntry is missing from the runtime installation.",
      "Run install from the persistent npm installation.",
    );
  }

  if (!(await deps.fileExists(nodeExecutable))) {
    return error(
      "runtime",
      "Installed npm runtime is unavailable.",
      nodeExecutable,
      "Repair or reinstall Node.js, then rerun install.",
    );
  }

  if (!(await deps.fileExists(cliEntry))) {
    return error(
      "runtime",
      "Installed npm runtime is unavailable.",
      cliEntry,
      "Reinstall copilot-session-recovery with npm, then rerun install.",
    );
  }

  return ok("runtime", "Installed npm runtime is available.");
}

async function copilotHookCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  try {
    const text = await deps.readText(deps.paths.copilotHookFile);
    const parsed = JSON.parse(text) as unknown;
    const expected = buildCopilotHookConfig(deps.installation);
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

async function stateProtectionCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  const result = await deps.platform.checkStateProtection(deps.paths);
  if (result.protected) {
    return ok(
      "state-protection",
      "State directory is current-user protected.",
      result.detail,
    );
  }

  return warning(
    "state-protection",
    "State directory protection could not be verified.",
    result.detail,
    "Run install again or inspect the state directory permissions.",
  );
}

async function terminalCheck(
  deps: DiagnosticDependencies,
): Promise<DiagnosticCheck> {
  if (await deps.platform.terminalAvailable()) {
    return ok("terminal", `${deps.platform.terminalName} is available.`);
  }

  return error(
    "terminal",
    `${deps.platform.terminalName} is unavailable.`,
    `${deps.platform.terminalName} could not be confirmed on this installation.`,
    "Repair the terminal integration for this platform.",
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

  if (
    await deps.commandExists(
      profile.executable,
      currentPlatform(deps.platform),
    )
  ) {
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
    await runtimeCheck(deps),
    await copilotHookCheck(deps),
    configuration.check,
    await registryCheck(deps),
    await stateProtectionCheck(deps),
    await terminalCheck(deps),
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
