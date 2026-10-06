import type { RecoveryTab } from "./recovery-plan.ts";
import {
  runProcess,
  type ProcessResult,
  type ProcessRunner,
} from "./process-runner.ts";

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
