import type { AddSessionOptions, RecoverOptions } from "./commands.ts";
import { isSessionId } from "../session/ids.ts";

export interface ConfigAddProfileAction {
  name: "add-profile";
  profileName: string;
  executable: string;
  args: string[];
  replace: boolean;
}

export interface ConfigSetDefaultProfileAction {
  name: "set-default-profile";
  profileName: string;
}

export interface ConfigShowAction {
  name: "show";
}

export type ConfigAction =
  | ConfigAddProfileAction
  | ConfigSetDefaultProfileAction
  | ConfigShowAction;

export type ParsedCommand =
  | { name: "hook"; event: "session-start" | "session-end" }
  | { name: "launch-next" }
  | { name: "install"; options: { profile?: string } }
  | { name: "status" }
  | { name: "doctor"; options: { repairRegistry: boolean } }
  | { name: "uninstall"; options: { purge: boolean } }
  | { name: "recover-sessions"; options: RecoverOptions }
  | { name: "add"; options: Omit<AddSessionOptions, "cwd"> & { cwd?: string } }
  | { name: "list" }
  | { name: "remove"; prefix: string }
  | { name: "prune"; options: { missingCwd: true } }
  | { name: "config"; action: ConfigAction }
  | { name: "version" }
  | { name: "help" };

function parseLaunchNext(argv: readonly string[]): ParsedCommand {
  if (argv.length !== 1) {
    throw new Error("Command launch-next does not accept arguments.");
  }

  return {
    name: "launch-next",
  };
}

function parseInstall(argv: readonly string[]): ParsedCommand {
  const options: { profile?: string } = {};
  const seen = new Set<string>();

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--profile") {
      if (seen.has(argument)) {
        throw new Error(`Duplicate option: ${argument}`);
      }

      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("Option --profile requires a value.");
      }

      options.profile = value;
      seen.add(argument);
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  return {
    name: "install",
    options,
  };
}

function parseDoctor(argv: readonly string[]): ParsedCommand {
  if (argv.length === 1) {
    return {
      name: "doctor",
      options: {
        repairRegistry: false,
      },
    };
  }

  if (argv[1] === "--repair-registry" && argv.length === 2) {
    return {
      name: "doctor",
      options: {
        repairRegistry: true,
      },
    };
  }

  throw new Error(`Unknown option: ${argv[1]}`);
}

function parseUninstall(argv: readonly string[]): ParsedCommand {
  if (argv.length === 1) {
    return {
      name: "uninstall",
      options: {
        purge: false,
      },
    };
  }

  if (argv[1] === "--purge" && argv.length === 2) {
    return {
      name: "uninstall",
      options: {
        purge: true,
      },
    };
  }

  throw new Error(`Unknown option: ${argv[1]}`);
}

function parseRecoverSessions(argv: readonly string[]): ParsedCommand {
  const options: RecoverOptions = {
    dryRun: false,
    yes: false,
  };
  const seen = new Set<string>();

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--yes") {
      if (seen.has(argument)) {
        throw new Error(`Duplicate option: ${argument}`);
      }
      seen.add(argument);
      options.yes = true;
      continue;
    }

    if (argument === "--dry-run") {
      if (seen.has(argument)) {
        throw new Error(`Duplicate option: ${argument}`);
      }
      seen.add(argument);
      options.dryRun = true;
      continue;
    }

    if (argument === "--discard-plan") {
      if (seen.has(argument)) {
        throw new Error(`Duplicate option: ${argument}`);
      }
      seen.add(argument);
      options.discardPlan = true;
      continue;
    }

    if (argument === "--profile") {
      if (seen.has(argument)) {
        throw new Error(`Duplicate option: ${argument}`);
      }

      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("Option --profile requires a value.");
      }

      seen.add(argument);
      options.profile = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  if (
    options.discardPlan === true &&
    (options.dryRun || options.yes || options.profile !== undefined)
  ) {
    throw new Error(
      "Option --discard-plan cannot be combined with --dry-run, --yes, or --profile.",
    );
  }

  return {
    name: "recover-sessions",
    options,
  };
}

function requireValue(
  argv: readonly string[],
  index: number,
  message: string,
): string {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(message);
  }

  return value;
}

function parseRemove(argv: readonly string[]): ParsedCommand {
  if (argv.length !== 2) {
    throw new Error("Command remove requires an ID prefix.");
  }

  return {
    name: "remove",
    prefix: argv[1]!,
  };
}

function parseAdd(argv: readonly string[]): ParsedCommand {
  const sessionId = argv[1];
  if (sessionId === undefined || sessionId.startsWith("--")) {
    throw new Error("Command add requires a full session ID.");
  }
  if (!isSessionId(sessionId)) {
    throw new Error("Command add requires a full session UUID.");
  }

  const options: Omit<AddSessionOptions, "cwd"> & { cwd?: string } = {
    sessionId,
  };
  const seen = new Set<string>();

  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument !== "--cwd" && argument !== "--profile") {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (seen.has(argument)) {
      throw new Error(`Duplicate option: ${argument}`);
    }

    const value = requireValue(
      argv,
      index + 1,
      `Option ${argument} requires a value.`,
    );
    if (argument === "--cwd") {
      options.cwd = value;
    } else {
      options.profile = value;
    }
    seen.add(argument);
    index += 1;
  }

  return { name: "add", options };
}

function parsePrune(argv: readonly string[]): ParsedCommand {
  if (argv.length === 1) {
    throw new Error("Command prune requires --missing-cwd.");
  }

  if (argv[1] !== "--missing-cwd") {
    throw new Error(`Unknown option: ${argv[1]}`);
  }

  if (argv.length > 2) {
    throw new Error(`Unknown option: ${argv[2]}`);
  }

  return {
    name: "prune",
    options: {
      missingCwd: true,
    },
  };
}

function parseConfig(argv: readonly string[]): ParsedCommand {
  if (argv[1] === "show") {
    if (argv.length > 2) {
      throw new Error(`Unknown command: ${argv.join(" ")}`);
    }

    return {
      name: "config",
      action: { name: "show" },
    };
  }

  if (argv[1] === "set" && argv[2] === "default-profile") {
    if (argv.length < 4) {
      throw new Error("config set default-profile requires a profile name.");
    }

    if (argv.length > 4) {
      throw new Error(`Unknown command: ${argv.join(" ")}`);
    }

    return {
      name: "config",
      action: {
        name: "set-default-profile",
        profileName: argv[3]!,
      },
    };
  }

  if (argv[1] === "profile" && argv[2] === "add") {
    const profileName = requireValue(
      argv,
      3,
      "config profile add requires a profile name.",
    );
    let executable: string | undefined;
    const args: string[] = [];
    let replace = false;
    const seen = new Set<string>();

    for (let index = 4; index < argv.length; index += 1) {
      const argument = argv[index];

      if (argument === "--replace") {
        if (seen.has(argument)) {
          throw new Error(`Duplicate option: ${argument}`);
        }

        seen.add(argument);
        replace = true;
        continue;
      }

      if (argument === "--executable") {
        if (seen.has(argument)) {
          throw new Error(`Duplicate option: ${argument}`);
        }

        executable = requireValue(
          argv,
          index + 1,
          "Option --executable requires a value.",
        );
        seen.add(argument);
        index += 1;
        continue;
      }

      if (argument === "--arg") {
        const value = argv[index + 1];
        if (value === undefined) {
          throw new Error("Option --arg requires a value.");
        }

        args.push(value);
        index += 1;
        continue;
      }

      throw new Error(`Unknown option: ${argument}`);
    }

    if (executable === undefined) {
      throw new Error("config profile add requires --executable <path>.");
    }

    if (args.length === 0) {
      throw new Error("config profile add requires at least one --arg <value>.");
    }

    return {
      name: "config",
      action: {
        name: "add-profile",
        profileName,
        executable,
        args,
        replace,
      },
    };
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}

export function parseCliArguments(argv: readonly string[]): ParsedCommand {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    return { name: "help" };
  }

  if (argv[0] === "--version" || argv[0] === "-v") {
    return { name: "version" };
  }

  if (
    argv[0] === "hook" &&
    (argv[1] === "session-start" || argv[1] === "session-end") &&
    argv.length === 2
  ) {
    return { name: "hook", event: argv[1] };
  }

  if (argv[0] === "launch-next") {
    return parseLaunchNext(argv);
  }

  if (argv[0] === "install") {
    return parseInstall(argv);
  }

  if (argv[0] === "status" && argv.length === 1) {
    return { name: "status" };
  }

  if (argv[0] === "doctor") {
    return parseDoctor(argv);
  }

  if (argv[0] === "uninstall") {
    return parseUninstall(argv);
  }

  if (argv[0] === "recover-sessions") {
    return parseRecoverSessions(argv);
  }

  if (argv[0] === "list" && argv.length === 1) {
    return { name: "list" };
  }

  if (argv[0] === "add") {
    return parseAdd(argv);
  }

  if (argv[0] === "remove") {
    return parseRemove(argv);
  }

  if (argv[0] === "prune") {
    return parsePrune(argv);
  }

  if (argv[0] === "config") {
    return parseConfig(argv);
  }

  throw new Error(`Unknown command: ${argv.join(" ")}`);
}
