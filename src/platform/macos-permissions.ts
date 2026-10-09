import {
  constants,
  lstat as defaultLstat,
  open as defaultOpen,
} from "node:fs/promises";

import type { AppPaths } from "../storage/paths.ts";

export interface ProtectionResult {
  protected: boolean;
  detail: string;
}

interface LinkStats {
  dev: number;
  ino: number;
  isSymbolicLink(): boolean;
}

interface FileStats {
  dev: number;
  ino: number;
  uid: number;
  mode: number;
}

interface MacFileHandle {
  stat(): Promise<FileStats>;
  chmod(mode: number): Promise<void>;
  close(): Promise<void>;
}

export interface MacPermissionDependencies {
  getuid(): number;
  lstat(filePath: string): Promise<LinkStats>;
  open(filePath: string, flags: number): Promise<MacFileHandle>;
}

interface ProtectedPath {
  filePath: string;
  mode: number;
}

function defaultDependencies(): MacPermissionDependencies {
  return {
    getuid() {
      const uid = process.getuid?.();
      if (typeof uid !== "number") {
        throw new Error("process.getuid() is unavailable.");
      }

      return uid;
    },
    lstat: defaultLstat,
    open: defaultOpen,
  };
}

function failure(detail: string): ProtectionResult {
  return {
    protected: false,
    detail,
  };
}

function isErrnoException(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function protectedPaths(paths: AppPaths): ProtectedPath[] {
  return [
    { filePath: paths.appDir, mode: 0o700 },
    { filePath: paths.configFile, mode: 0o600 },
    { filePath: paths.registryFile, mode: 0o600 },
  ];
}

function formatMode(mode: number): string {
  return (mode & 0o777).toString(8);
}

function sameIdentity(left: Pick<LinkStats, "dev" | "ino">, right: Pick<LinkStats, "dev" | "ino">): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function pathChanged(filePath: string): ProtectionResult {
  return failure(`${filePath} changed while permissions were being applied.`);
}

function noFollowReadOnlyFlags(): number {
  return constants.O_RDONLY | constants.O_NOFOLLOW;
}

interface OpenedPath {
  handle: MacFileHandle;
  details: FileStats;
}

async function inspectPath(
  filePath: string,
  deps: MacPermissionDependencies,
): Promise<OpenedPath | ProtectionResult | undefined> {
  try {
    const linkDetails = await deps.lstat(filePath);
    if (linkDetails.isSymbolicLink()) {
      return failure(`${filePath} is a symbolic link.`);
    }

    let handle: MacFileHandle;
    try {
      handle = await deps.open(filePath, noFollowReadOnlyFlags());
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) {
        return pathChanged(filePath);
      }

      if (isErrnoException(error, "ELOOP")) {
        return failure(`${filePath} is a symbolic link.`);
      }

      return failure(
        `${filePath} could not be opened securely: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    try {
      const details = await handle.stat();
      if (!sameIdentity(linkDetails, details)) {
        await handle.close();
        return pathChanged(filePath);
      }

      return {
        handle,
        details,
      };
    } catch (error) {
      await handle.close();
      return failure(
        `${filePath} could not be inspected: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return undefined;
    }

    return failure(
      `${filePath} could not be inspected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function ensurePathUnchanged(
  filePath: string,
  expected: Pick<LinkStats, "dev" | "ino">,
  deps: MacPermissionDependencies,
): Promise<ProtectionResult | undefined> {
  try {
    const linkDetails = await deps.lstat(filePath);
    if (linkDetails.isSymbolicLink()) {
      return failure(`${filePath} is a symbolic link.`);
    }

    if (!sameIdentity(linkDetails, expected)) {
      return pathChanged(filePath);
    }

    return undefined;
  } catch (error) {
    if (isErrnoException(error, "ENOENT")) {
      return pathChanged(filePath);
    }

    return failure(
      `${filePath} could not be inspected: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function verifyOwnershipAndMode(
  filePath: string,
  expectedMode: number,
  deps: MacPermissionDependencies,
  action: "protect" | "check",
): Promise<ProtectionResult | undefined> {
  const opened = await inspectPath(filePath, deps);
  if (opened === undefined) {
    return undefined;
  }

  if ("protected" in opened) {
    return opened;
  }

  const { handle } = opened;

  try {
    if (opened.details.uid !== deps.getuid()) {
      return failure(
        `${filePath} is not owned by the current user.`,
      );
    }

    if (action === "protect") {
      await handle.chmod(expectedMode);
      const refreshed = await handle.stat();
      if ((refreshed.mode & 0o777) !== expectedMode) {
        return failure(
          `${filePath} permissions remain ${formatMode(refreshed.mode)} instead of ${formatMode(expectedMode)}.`,
        );
      }

      return await ensurePathUnchanged(filePath, refreshed, deps);
    }

    if ((opened.details.mode & 0o777) !== expectedMode) {
      return failure(
        `${filePath} permissions are ${formatMode(opened.details.mode)} instead of ${formatMode(expectedMode)}.`,
      );
    }

    return await ensurePathUnchanged(filePath, opened.details, deps);
  } finally {
    await handle.close();
  }
}

async function protectOrCheckMacState(
  paths: AppPaths,
  action: "protect" | "check",
  dependencies?: MacPermissionDependencies,
): Promise<ProtectionResult> {
  const deps = dependencies ?? defaultDependencies();

  try {
    for (const entry of protectedPaths(paths)) {
      const result = await verifyOwnershipAndMode(
        entry.filePath,
        entry.mode,
        deps,
        action,
      );
      if (result !== undefined) {
        return result;
      }
    }

    return {
      protected: true,
      detail: "State paths are protected for the current user.",
    };
  } catch (error) {
    return failure(
      `Protecting macOS state failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function protectMacState(
  paths: AppPaths,
  deps?: MacPermissionDependencies,
): Promise<ProtectionResult> {
  return protectOrCheckMacState(paths, "protect", deps);
}

export function checkMacStateProtection(
  paths: AppPaths,
  deps?: MacPermissionDependencies,
): Promise<ProtectionResult> {
  return protectOrCheckMacState(paths, "check", deps);
}
