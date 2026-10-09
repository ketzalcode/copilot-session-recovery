import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface RuntimeInstallation {
  nodeExecutable: string;
  cliEntry: string;
}

function isAbsoluteRuntimePath(filePath: string): boolean {
  return path.win32.isAbsolute(filePath) || path.posix.isAbsolute(filePath);
}

function assertAbsoluteRuntimePath(name: string, filePath: string): void {
  if (!isAbsoluteRuntimePath(filePath)) {
    throw new Error(`${name} must be an absolute path.`);
  }
}

function assertAbsoluteInstallation(
  installation: RuntimeInstallation,
): void {
  assertAbsoluteRuntimePath("nodeExecutable", installation.nodeExecutable);
  assertAbsoluteRuntimePath("cliEntry", installation.cliEntry);
}

export function resolveRuntimeInstallation(options: {
  execPath?: string;
  moduleUrl?: string;
} = {}): RuntimeInstallation {
  const fallbackEntry = process.argv[1] ?? options.execPath ?? process.execPath;
  const installation = {
    nodeExecutable: options.execPath ?? process.execPath,
    cliEntry: fileURLToPath(
      options.moduleUrl ?? pathToFileURL(fallbackEntry).href,
    ),
  };

  assertAbsoluteInstallation(installation);
  return installation;
}

export function assertPersistentInstallation(
  installation: RuntimeInstallation,
): void {
  assertAbsoluteInstallation(installation);

  const segments = path.normalize(installation.cliEntry).split(/[\\/]+/u);
  if (segments.some((segment) => segment.toLowerCase() === "_npx")) {
    throw new Error(
      "Persistent setup cannot run from npx. Run npm install --global copilot-session-recovery, then copilot-session-recovery install.",
    );
  }
}
