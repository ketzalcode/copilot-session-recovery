import type { AppPaths } from "../storage/paths.ts";
import type { ProcessResult } from "./process-runner.ts";
import type { RecoveryTab } from "./recovery-plan.ts";

export interface TerminalLauncher {
  readonly name: string;
  readonly command: string;
  readonly unavailableMessage?: string;
  readonly unavailableFix?: string;
  available(): Promise<boolean>;
  preview(tabs: readonly RecoveryTab[], paths: AppPaths): string;
  launch(
    tabs: readonly RecoveryTab[],
    paths: AppPaths,
  ): Promise<ProcessResult>;
}