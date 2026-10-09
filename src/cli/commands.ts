import { loadConfig, parseConfig, saveConfig } from "../config/config.ts";
import {
  commandExists as defaultCommandExists,
  type ProcessSpec,
} from "../launch/process-runner.ts";
import type { TerminalLauncher } from "../launch/terminal.ts";
import { buildRecoveryPlan } from "../launch/recovery-plan.ts";
import { applyLifecycleEvent } from "../session/lifecycle.ts";
import { isSessionId } from "../session/ids.ts";
import type { SessionRegistry } from "../session/model.ts";
import type { AppPaths } from "../storage/paths.ts";
import {
  pruneMissingWorkingDirectories,
  readRegistry,
  removeSessionByPrefix,
  updateRegistry,
} from "../storage/registry.ts";
import type { CliOutput } from "./io.ts";
import { formatSessionTable } from "./format.ts";
export {
  doctorCommand,
  repairRegistryCommand,
  statusCommand,
} from "../install/diagnostics.ts";
export {
  installCommand,
  uninstallCommand,
} from "../install/installer.ts";

export interface RecoverOptions {
  dryRun: boolean;
  yes: boolean;
  profile?: string;
}

export interface AddSessionOptions {
  sessionId: string;
  cwd: string;
  profile?: string;
}

export interface RecoverDependencies {
  paths: AppPaths;
  output: CliOutput;
  terminal: TerminalLauncher;
  directoryExists(cwd: string): Promise<boolean>;
  commandExists(executable: string): Promise<boolean>;
}

export interface ManagementDependencies {
  paths: AppPaths;
  output: CliOutput;
  directoryExists(cwd: string): Promise<boolean>;
  now?: () => number;
}

export interface ConfigCommandDependencies {
  paths: AppPaths;
  output: CliOutput;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyProcess(): ProcessSpec {
  return {
    executable: "",
    args: [],
  };
}

function sortedSessions(registry: SessionRegistry) {
  return Object.values(registry.sessions).sort((a, b) =>
    a.lastSeenAt.localeCompare(b.lastSeenAt) ||
    a.sessionId.localeCompare(b.sessionId),
  );
}

function formatRegistrySessions(registry: SessionRegistry): string {
  return formatSessionTable(
    sortedSessions(registry).map((session) => ({
      sessionId: session.sessionId,
      cwd: session.cwd,
      title: "",
      launcherProfile: session.launcherProfile,
      process: emptyProcess(),
      lastSeenAt: session.lastSeenAt,
    })),
    [],
  );
}

async function persistProfileUpdates(
  paths: AppPaths,
  profileUpdates: Readonly<Record<string, string>>,
): Promise<void> {
  await updateRegistry(paths, (registry) => {
    const sessions = { ...registry.sessions };

    for (const [sessionId, launcherProfile] of Object.entries(profileUpdates)) {
      const current = sessions[sessionId];
      if (!current) {
        continue;
      }

      sessions[sessionId] = {
        ...current,
        launcherProfile,
      };
    }

    return {
      ...registry,
      sessions,
    };
  });
}

export async function recoverSessionsCommand(
  options: RecoverOptions,
  deps: RecoverDependencies,
): Promise<number> {
  try {
    const config = await loadConfig(deps.paths.configFile);
    const registry = await readRegistry(
      deps.paths.registryFile,
      deps.paths.corruptDir,
    );

    if (!(await deps.terminal.available())) {
      deps.output.error(
        deps.terminal.unavailableMessage ??
          `${deps.terminal.name} is unavailable.`,
      );
      return 1;
    }

    const plan = await buildRecoveryPlan(registry, config, {
      profileOverride: options.profile,
      directoryExists: deps.directoryExists,
      commandExists: deps.commandExists,
    });

    if (plan.tabs.length === 0) {
      const preview = formatSessionTable(plan.tabs, plan.skipped);
      if (preview.length > 0) {
        deps.output.out(preview);
      }
      deps.output.out("No recoverable sessions.");
      return 0;
    }

    deps.output.out(formatSessionTable(plan.tabs, plan.skipped));

    if (options.dryRun) {
      deps.output.out(`Dry run command:\n${deps.terminal.preview(plan.tabs, deps.paths)}`);
      return 0;
    }

    if (
      !options.yes &&
      !(await deps.output.confirm(
        `Launch recoverable sessions in ${deps.terminal.name}?`,
      ))
    ) {
      deps.output.out("Recovery cancelled.");
      return 0;
    }

    await persistProfileUpdates(deps.paths, plan.profileUpdates);
    const result = await deps.terminal.launch(plan.tabs, deps.paths);

    if (result.exitCode !== 0) {
      deps.output.error(
        result.stderr.trim().length > 0
          ? result.stderr.trimEnd()
          : `${deps.terminal.name} exited with code ${result.exitCode}.`,
      );
      return 1;
    }

    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

export function createRecoverDependencies(
  paths: AppPaths,
  output: CliOutput,
  terminal: TerminalLauncher,
  directoryExists: RecoverDependencies["directoryExists"],
): RecoverDependencies {
  return {
    paths,
    output,
    terminal,
    directoryExists,
    commandExists: defaultCommandExists,
  };
}

export async function listSessionsCommand(
  deps: ManagementDependencies,
): Promise<number> {
  try {
    const registry = await readRegistry(
      deps.paths.registryFile,
      deps.paths.corruptDir,
    );

    if (Object.keys(registry.sessions).length === 0) {
      deps.output.out("No recoverable sessions.");
      return 0;
    }

    deps.output.out(formatRegistrySessions(registry));
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

export async function addSessionCommand(
  options: AddSessionOptions,
  deps: ManagementDependencies,
): Promise<number> {
  try {
    if (!isSessionId(options.sessionId)) {
      throw new Error("Command add requires a full session UUID.");
    }

    const config = await loadConfig(deps.paths.configFile);
    const profile = options.profile ?? config.defaultProfile;
    if (config.profiles[profile] === undefined) {
      throw new Error(`Launcher profile ${profile} does not exist.`);
    }
    if (!(await deps.directoryExists(options.cwd))) {
      throw new Error(`Working directory does not exist: ${options.cwd}`);
    }

    const registry = await updateRegistry(deps.paths, (current) =>
      applyLifecycleEvent(
        current,
        {
          type: "start",
          sessionId: options.sessionId,
          timestamp: deps.now?.() ?? Date.now(),
          cwd: options.cwd,
          source: "resume",
        },
        profile,
      ),
    );
    const saved = registry.sessions[options.sessionId]!;
    deps.output.out(
      `Added session ${saved.sessionId} from ${saved.cwd} using ${saved.launcherProfile}.`,
    );
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

export async function removeSessionCommand(
  prefix: string,
  deps: ManagementDependencies,
): Promise<number> {
  try {
    const removed = await removeSessionByPrefix(deps.paths, prefix);
    deps.output.out(`Removed session ${removed}.`);
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

export async function pruneSessionsCommand(
  deps: ManagementDependencies,
): Promise<number> {
  try {
    const registry = await readRegistry(
      deps.paths.registryFile,
      deps.paths.corruptDir,
    );
    const missing = [];

    for (const session of sortedSessions(registry)) {
      if (await deps.directoryExists(session.cwd)) {
        continue;
      }

      missing.push({
        sessionId: session.sessionId,
        cwd: session.cwd,
        reason: "working-directory-missing" as const,
      });
    }

    if (missing.length === 0) {
      deps.output.out("No missing working directories.");
      return 0;
    }

    deps.output.out(formatSessionTable([], missing));

    if (!(await deps.output.confirm("Remove the listed sessions?"))) {
      deps.output.out("Prune cancelled.");
      return 0;
    }

    const removed = await pruneMissingWorkingDirectories(
      deps.paths,
      new Set(missing.map((session) => session.sessionId)),
    );
    deps.output.out(
      `Pruned ${removed.length} session${removed.length === 1 ? "" : "s"}.`,
    );
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

export async function showConfigCommand(
  deps: ConfigCommandDependencies,
): Promise<number> {
  try {
    const config = await loadConfig(deps.paths.configFile);
    deps.output.out(JSON.stringify(config, null, 2));
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

export async function setDefaultProfileCommand(
  name: string,
  deps: ConfigCommandDependencies,
): Promise<number> {
  try {
    const config = await loadConfig(deps.paths.configFile);
    const next = parseConfig({
      ...config,
      defaultProfile: name,
    });

    await saveConfig(deps.paths.configFile, next);
    deps.output.out(`Default profile set to ${name}.`);
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}

export async function addProfileCommand(
  name: string,
  executable: string,
  args: readonly string[],
  replace: boolean,
  deps: ConfigCommandDependencies,
): Promise<number> {
  try {
    const config = await loadConfig(deps.paths.configFile);

    if (!replace && config.profiles[name] !== undefined) {
      throw new Error(
        `Launcher profile ${name} already exists. Pass --replace to overwrite it.`,
      );
    }

    const next = parseConfig({
      ...config,
      profiles: {
        ...config.profiles,
        [name]: {
          executable,
          args: [...args],
        },
      },
    });

    await saveConfig(deps.paths.configFile, next);
    deps.output.out(`Saved launcher profile ${name}.`);
    return 0;
  } catch (error) {
    deps.output.error(errorMessage(error));
    return 1;
  }
}
