import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { parseCliArguments } from "./arguments.ts";
import {
  addSessionCommand,
  addProfileCommand,
  createRecoverDependencies,
  doctorCommand,
  installCommand,
  listSessionsCommand,
  pruneSessionsCommand,
  recoverSessionsCommand,
  removeSessionCommand,
  setDefaultProfileCommand,
  showConfigCommand,
  statusCommand,
  uninstallCommand,
} from "./commands.ts";
import { createCliOutput, readStdinText, type CliOutput } from "./io.ts";
import { APP_VERSION } from "../version.ts";
import {
  createDiagnosticDependencies,
  type DiagnosticDependencies,
} from "../install/diagnostics.ts";
import {
  createInstallerDependencies,
  type InstallerDependencies,
} from "../install/installer.ts";
import {
  commandExists,
  runProcess,
  type ProcessRunner,
} from "../launch/process-runner.ts";
import {
  handleSessionEndHook,
  handleSessionStartHook,
  writeDiagnostic as writeHookDiagnostic,
  type HookDependencies,
} from "../hooks/handler.ts";
import {
  assertSupportedPlatform,
  createPlatformAdapter,
} from "../platform/platform.ts";
import { resolveRuntimeInstallation } from "../runtime/installation.ts";
import { resolveAppPaths, type AppPaths } from "../storage/paths.ts";

const HELP_TEXT = [
  "Usage: copilot-session-recovery <command>",
  "",
  "Commands:",
  "  hook session-start",
  "  hook session-end",
  "  install [--profile <name>]",
  "  status",
  "  doctor [--repair-registry]",
  "  uninstall [--purge]",
  "  add <session-id> [--cwd <path>] [--profile <name>]",
  "  list",
  "  remove <id-prefix>",
  "  prune --missing-cwd",
  "  recover-sessions [--yes] [--dry-run] [--profile <name>]",
  "  config show",
  "  config set default-profile <name>",
  "  config profile add <name> --executable <path> --arg <value> [--arg <value>...] [--replace]",
  "  --version",
  "  --help",
].join("\n");

interface MainOverrides {
  env?: NodeJS.ProcessEnv;
  input?: NodeJS.ReadableStream & AsyncIterable<Buffer | string>;
  paths?: AppPaths;
  output?: CliOutput;
  runProcess?: ProcessRunner;
  commandExists?: typeof commandExists;
  directoryExists?: (cwd: string) => Promise<boolean>;
  writeDiagnostic?: HookDependencies["writeDiagnostic"];
  installerDependencies?: InstallerDependencies;
  diagnosticDependencies?: DiagnosticDependencies;
  currentDirectory?: () => string;
}

function hookDependencies(overrides: MainOverrides): HookDependencies {
  const { platform } = assertSupportedPlatform(process.platform, process.arch);
  const paths =
    overrides.paths ??
    resolveAppPaths({
      platform,
      ...(overrides.env === undefined ? {} : { env: overrides.env }),
    });

  return {
    paths,
    writeDiagnostic:
      overrides.writeDiagnostic ??
      ((message) => writeHookDiagnostic(paths, message)),
  };
}

function isErrnoException(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function defaultDirectoryExists(cwd: string): Promise<boolean> {
  try {
    const details = await stat(cwd);
    return details.isDirectory();
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
}

export async function main(
  argv: readonly string[],
  overrides: MainOverrides = {},
): Promise<number> {
  const command = parseCliArguments(argv);

  if (command.name === "help") {
    process.stdout.write(`${HELP_TEXT}\n`);
    return 0;
  }

  if (command.name === "version") {
    process.stdout.write(`${APP_VERSION}\n`);
    return 0;
  }

  const { platform } = assertSupportedPlatform(process.platform, process.arch);
  const adapter = createPlatformAdapter(
    process.platform,
    process.arch,
    overrides.env,
  );
  const paths = overrides.paths ?? adapter.resolvePaths(overrides.env ?? process.env);
  const output = overrides.output ?? createCliOutput();

  if (command.name === "install") {
    return installCommand(
      command.options,
      overrides.installerDependencies ??
        createInstallerDependencies(
          paths,
          output,
          resolveRuntimeInstallation({ moduleUrl: import.meta.url }),
          adapter,
        ),
    );
  }

  if (command.name === "status") {
    return statusCommand(
      overrides.diagnosticDependencies ??
        createDiagnosticDependencies(paths, output),
    );
  }

  if (command.name === "doctor") {
    return doctorCommand(
      command.options,
      overrides.diagnosticDependencies ??
        createDiagnosticDependencies(paths, output),
    );
  }

  if (command.name === "uninstall") {
    return uninstallCommand(
      command.options,
      overrides.installerDependencies ??
        createInstallerDependencies(
          paths,
          output,
          resolveRuntimeInstallation({ moduleUrl: import.meta.url }),
          adapter,
        ),
    );
  }

  if (command.name === "recover-sessions") {
    const deps = createRecoverDependencies(
      paths,
      output,
      overrides.directoryExists ?? defaultDirectoryExists,
      overrides.runProcess ?? runProcess,
    );

    if (overrides.commandExists) {
      deps.commandExists = overrides.commandExists;
    }

    return recoverSessionsCommand(command.options, deps);
  }

  if (command.name === "list") {
    return listSessionsCommand({
      paths,
      output,
      directoryExists: overrides.directoryExists ?? defaultDirectoryExists,
    });
  }

  if (command.name === "add") {
    return addSessionCommand(
      {
        ...command.options,
        cwd:
          command.options.cwd ??
          (overrides.currentDirectory ?? process.cwd)(),
      },
      {
        paths,
        output,
        directoryExists: overrides.directoryExists ?? defaultDirectoryExists,
      },
    );
  }

  if (command.name === "remove") {
    return removeSessionCommand(command.prefix, {
      paths,
      output,
      directoryExists: overrides.directoryExists ?? defaultDirectoryExists,
    });
  }

  if (command.name === "prune") {
    return pruneSessionsCommand({
      paths,
      output,
      directoryExists: overrides.directoryExists ?? defaultDirectoryExists,
    });
  }

  if (command.name === "config") {
    if (command.action.name === "show") {
      return showConfigCommand({ paths, output });
    }

    if (command.action.name === "set-default-profile") {
      return setDefaultProfileCommand(command.action.profileName, {
        paths,
        output,
      });
    }

    return addProfileCommand(
      command.action.profileName,
      command.action.executable,
      command.action.args,
      command.action.replace,
      { paths, output },
    );
  }

  const inputText = await readStdinText(overrides.input);
  const deps = hookDependencies(overrides);

  return command.event === "session-start"
    ? handleSessionStartHook(inputText, deps)
    : handleSessionEndHook(inputText, deps);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
