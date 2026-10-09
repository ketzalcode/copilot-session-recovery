import { formatDryRunCommand } from "../cli/format.ts";
import type { AppPaths } from "../storage/paths.ts";
import type { TerminalLauncher } from "./terminal.ts";
import type { RecoveryTab } from "./recovery-plan.ts";
import {
  commandExists,
  runProcess,
  type ProcessResult,
  type ProcessRunner,
} from "./process-runner.ts";

interface WindowsTerminalDependencies {
  commandExists?: (
    executable: string,
    platform: "win32" | "darwin",
  ) => Promise<boolean>;
  runProcess?: ProcessRunner;
}

export function buildWindowsTerminalArgs(
  tabs: readonly RecoveryTab[],
): string[] {
  if (tabs.length === 0) {
    throw new Error("Cannot launch Windows Terminal with an empty plan.");
  }

  const args = ["-w", "new"];

  for (const [index, tab] of tabs.entries()) {
    if (index > 0) {
      args.push(";");
    }

    args.push(
      "new-tab",
      "--title",
      tab.title,
      "--startingDirectory",
      tab.cwd,
      tab.process.executable,
      ...tab.process.args,
    );
  }

  return args;
}

export function launchWindowsTerminal(
  tabs: readonly RecoveryTab[],
  runner: ProcessRunner = runProcess,
): Promise<ProcessResult> {
  return runner({
    executable: "wt.exe",
    args: buildWindowsTerminalArgs(tabs),
  });
}

export function createWindowsTerminalLauncher(
  dependencies: WindowsTerminalDependencies = {},
): TerminalLauncher {
  const lookupCommand = dependencies.commandExists ?? commandExists;
  const processRunner = dependencies.runProcess ?? runProcess;

  return {
    name: "Windows Terminal",
    command: "wt.exe",
    available: () => lookupCommand("wt.exe", "win32"),
    preview: (tabs: readonly RecoveryTab[], _paths: AppPaths) =>
      formatDryRunCommand("wt.exe", buildWindowsTerminalArgs(tabs)),
    launch: (tabs: readonly RecoveryTab[], _paths: AppPaths) =>
      launchWindowsTerminal(tabs, processRunner),
  };
}
