import {
  commandExists as defaultCommandExists,
  runProcess,
  type ProcessResult,
  type ProcessRunner,
} from "./process-runner.ts";
import type { RecoveryTab } from "./recovery-plan.ts";
import type { TerminalLauncher } from "./terminal.ts";
import {
  createLaunchPlan,
  discardLaunchPlan,
  inspectLaunchPlan,
} from "./launch-plan.ts";
import type { AppPaths } from "../storage/paths.ts";

export const LAUNCH_NEXT_COMMAND = "copilot-session-recovery launch-next";

const APPLE_TERMINAL_COMMAND = "/usr/bin/osascript";
const APPLE_TERMINAL_AUTOMATION_MESSAGE =
  "Apple Terminal automation was denied. The launch plan was preserved. Approve the prompt or allow your terminal app in System Settings > Privacy & Security > Automation, then retry the recovery launch.";
const APPLE_TERMINAL_ACCESSIBILITY_MESSAGE =
  "Apple Terminal tab automation was denied by System Events. The launch plan was preserved. Allow your terminal app or osascript in System Settings > Privacy & Security > Accessibility, then retry the recovery launch.";

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

function isAccessibilityDenied(stderr: string): boolean {
  return /not allowed to send keystrokes/i.test(stderr) ||
    /not allowed assistive access/i.test(stderr) ||
    /access for assistive devices is disabled/i.test(stderr) ||
    (/assistive access/i.test(stderr) && /\(-1728\)/.test(stderr)) ||
    /\(-25211\)/.test(stderr);
}

function mapAppleTerminalFailure(result: ProcessResult): ProcessResult {
  if (result.exitCode === 0) {
    return result;
  }

  if (isAccessibilityDenied(result.stderr)) {
    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: APPLE_TERMINAL_ACCESSIBILITY_MESSAGE,
    };
  }

  if (!isAutomationDenied(result.stderr)) {
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
    "  my activateTerminal()",
    "  tell application \"Terminal\"",
    "    if (count of windows) is 0 then",
    `      do script "${LAUNCH_NEXT_COMMAND}"`,
    "      set openedTabs to 1",
    "    else",
    "      set openedTabs to 0",
    "    end if",
    "  end tell",
    "  if openedTabs > 0 and tabCount > openedTabs then",
    "    my waitForFrontWindowTabCount(1)",
    "  end if",
    "  repeat while openedTabs < tabCount",
    "    my activateTerminal()",
    "    tell application \"Terminal\"",
    "      set previousFrontWindowId to id of front window",
    "      set previousTabCount to count of tabs of front window",
    "      set previousSelectedTabIndex to index of selected tab of front window",
    "    end tell",
    "    tell application \"System Events\" to keystroke \"t\" using command down",
    "    my waitForSelectedTab(previousFrontWindowId, previousTabCount, previousSelectedTabIndex)",
    "    tell application \"Terminal\"",
    `      do script "${LAUNCH_NEXT_COMMAND}" in selected tab of front window`,
    "    end tell",
    "    set openedTabs to openedTabs + 1",
    "  end repeat",
    "end run",
    "",
    "on activateTerminal()",
    "  tell application \"Terminal\" to activate",
    "  my waitForTerminalFrontmost()",
    "end activateTerminal",
    "",
    "on waitForTerminalFrontmost()",
    "  repeat with attempt from 1 to 100",
    "    tell application \"System Events\"",
    "      if exists process \"Terminal\" then",
    "        if frontmost of process \"Terminal\" then",
    "          return",
    "        end if",
    "      end if",
    "    end tell",
    "    delay 0.05",
    "  end repeat",
    "  error \"Timed out waiting for Apple Terminal to become frontmost.\"",
    "end waitForTerminalFrontmost",
    "",
    "on waitForFrontWindowTabCount(requiredTabCount)",
    "  repeat with attempt from 1 to 100",
    "    tell application \"Terminal\"",
    "      if (count of windows) > 0 then",
    "        if (count of tabs of front window) is greater than or equal to requiredTabCount then",
    "          return",
    "        end if",
    "      end if",
    "    end tell",
    "    delay 0.05",
    "  end repeat",
    "  error \"Timed out waiting for Apple Terminal to open the first tab.\"",
    "end waitForFrontWindowTabCount",
    "",
    "on waitForSelectedTab(previousFrontWindowId, previousTabCount, previousSelectedTabIndex)",
    "  repeat with attempt from 1 to 100",
    "    tell application \"Terminal\"",
    "      if (count of windows) > 0 then",
    "        set currentFrontWindowId to id of front window",
    "        if currentFrontWindowId is not previousFrontWindowId then",
    "          return",
    "        end if",
    "        set currentTabCount to count of tabs of front window",
    "        if currentTabCount > previousTabCount then",
    "          set currentSelectedTabIndex to index of selected tab of front window",
    "          if currentSelectedTabIndex is not previousSelectedTabIndex then",
    "            return",
    "          end if",
    "        end if",
    "      end if",
    "    end tell",
    "    delay 0.05",
    "  end repeat",
    "  error \"Timed out waiting for Apple Terminal to open a new selected tab.\"",
    "end waitForSelectedTab",
  ].join("\n");
}

export function createMacTerminalLauncherWithDependencies(
  paths: AppPaths,
  dependencies: MacTerminalDependencies = {},
): TerminalLauncher {
  const lookupCommand = dependencies.commandExists ?? defaultCommandExists;
  const processRunner = dependencies.runProcess ?? runProcess;
  const runAppleTerminal = async (tabCount: number): Promise<ProcessResult> => {
    const result = await processRunner({
      executable: APPLE_TERMINAL_COMMAND,
      args: ["-e", buildAppleTerminalScript(), String(tabCount)],
    });

    return mapAppleTerminalFailure(result);
  };

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
    async loadPreservedLaunch(launchPaths: AppPaths = paths) {
      const inspection = await inspectLaunchPlan(launchPaths);
      if (inspection === undefined) {
        return undefined;
      }

      if (inspection.retryableCount === 0) {
        if (inspection.launchingCount > 0) {
          throw new Error(
            "The preserved Apple Terminal recovery plan still has launches in progress. Retry after they finish.",
          );
        }
        return undefined;
      }

      return {
        count: inspection.retryableCount,
        preview: tabCountPreview(inspection.retryableCount),
        async launch() {
          const current = await inspectLaunchPlan(launchPaths);
          if (current === undefined || current.retryableCount === 0) {
            throw new Error(
              "The preserved Apple Terminal recovery plan no longer has pending or failed entries.",
            );
          }

          return runAppleTerminal(current.retryableCount);
        },
      };
    },
    discardPreservedLaunch(launchPaths: AppPaths = paths) {
      return discardLaunchPlan(launchPaths);
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
      return runAppleTerminal(tabs.length);
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
