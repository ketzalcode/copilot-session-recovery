import {
  commandExists as defaultCommandExists,
  runProcess,
  type ProcessResult,
  type ProcessRunner,
} from "./process-runner.ts";
import type { RecoveryTab } from "./recovery-plan.ts";
import type { TerminalLauncher } from "./terminal.ts";
import { createLaunchPlan } from "./launch-plan.ts";
import type { AppPaths } from "../storage/paths.ts";

export const LAUNCH_NEXT_COMMAND = "copilot-session-recovery launch-next";

const APPLE_TERMINAL_COMMAND = "/usr/bin/osascript";
const APPLE_TERMINAL_AUTOMATION_MESSAGE =
  "Apple Terminal automation was denied. Approve the prompt or allow your terminal app in System Settings > Privacy & Security > Automation, then rerun recover-sessions.";

interface MacTerminalDependencies {
  commandExists?: (
    executable: string,
    platform: "win32" | "darwin",
  ) => Promise<boolean>;
  runProcess?: ProcessRunner;
}

function tabCountPreview(tabCount: number): string {
  return `Apple Terminal tab count: ${tabCount}\n${LAUNCH_NEXT_COMMAND}`;
}

function isAutomationDenied(stderr: string): boolean {
  return /not authorized to send Apple events/i.test(stderr) ||
    /not permitted to send Apple events/i.test(stderr) ||
    /\(-1743\)/.test(stderr);
}

function mapAutomationDenied(result: ProcessResult): ProcessResult {
  if (result.exitCode === 0 || !isAutomationDenied(result.stderr)) {
    return result;
  }

  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: APPLE_TERMINAL_AUTOMATION_MESSAGE,
  };
}

export function buildAppleTerminalScript(): string {
  return [
    "on run argv",
    "  set tabCount to item 1 of argv as integer",
    "  if tabCount < 1 then",
    "    return",
    "  end if",
    "  tell application \"Terminal\"",
    "    activate",
    "    if (count of windows) is 0 then",
    `      do script "${LAUNCH_NEXT_COMMAND}"`,
    "      delay 0.2",
    "      set openedTabs to 1",
    "    else",
    "      set openedTabs to 0",
    "    end if",
    "    repeat while openedTabs < tabCount",
    "      tell application \"System Events\" to keystroke \"t\" using command down",
    "      delay 0.2",
    `      do script "${LAUNCH_NEXT_COMMAND}" in selected tab of front window`,
    "      set openedTabs to openedTabs + 1",
    "    end repeat",
    "  end tell",
    "end run",
  ].join("\n");
}

export function createMacTerminalLauncherWithDependencies(
  paths: AppPaths,
  dependencies: MacTerminalDependencies = {},
): TerminalLauncher {
  const lookupCommand = dependencies.commandExists ?? defaultCommandExists;
  const processRunner = dependencies.runProcess ?? runProcess;

  return {
    name: "Apple Terminal",
    command: APPLE_TERMINAL_COMMAND,
    async available() {
      if (!(await lookupCommand(APPLE_TERMINAL_COMMAND, "darwin"))) {
        return false;
      }

      const result = await processRunner({
        executable: "/usr/bin/open",
        args: ["-Ra", "Terminal"],
      }).catch(() => undefined);

      return result?.exitCode === 0;
    },
    preview(tabs: readonly RecoveryTab[]) {
      return tabCountPreview(tabs.length);
    },
    async launch(
      tabs: readonly RecoveryTab[],
      launchPaths: AppPaths = paths,
    ): Promise<ProcessResult> {
      if (tabs.length === 0) {
        throw new Error("Cannot launch Apple Terminal with an empty plan.");
      }

      await createLaunchPlan(launchPaths, tabs);
      const result = await processRunner({
        executable: APPLE_TERMINAL_COMMAND,
        args: ["-e", buildAppleTerminalScript(), String(tabs.length)],
      });

      return mapAutomationDenied(result);
    },
  };
}

export function createMacTerminalLauncher(
  paths: AppPaths,
  runner: ProcessRunner = runProcess,
): TerminalLauncher {
  return createMacTerminalLauncherWithDependencies(paths, {
    runProcess: runner,
  });
}
