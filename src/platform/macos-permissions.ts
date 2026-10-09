import {
  chmod as defaultChmod,
  lstat as defaultLstat,
  stat as defaultStat,
} from "node:fs/promises";

import type { AppPaths } from "../storage/paths.ts";

export interface ProtectionResult {
  protected: boolean;
  detail: string;
}

interface LinkStats {
  isSymbolicLink(): boolean;
}

interface FileStats {
  uid: number;
  mode: number;
}

export interface MacPermissionDependencies {
  getuid(): number;
  lstat(filePath: string): Promise<LinkStats>;
  stat(filePath: string): Promise<FileStats>;
  chmod(filePath: string, mode: number): Promise<void>;
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
    stat: defaultStat,
    chmod: defaultChmod,
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

async function inspectPath(
  filePath: string,
  deps: MacPermissionDependencies,
): Promise<FileStats | ProtectionResult | undefined> {
  try {
    const linkDetails = await deps.lstat(filePath);
    if (linkDetails.isSymbolicLink()) {
      return failure(`${filePath} is a symbolic link.`);
    }

    return await deps.stat(filePath);
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

async function verifyOwnershipAndMode(
  filePath: string,
  expectedMode: number,
  deps: MacPermissionDependencies,
  action: "protect" | "check",
): Promise<ProtectionResult | undefined> {
  const details = await inspectPath(filePath, deps);
  if (details === undefined) {
    return undefined;
  }

  if ("protected" in details) {
    return details;
  }

  if (details.uid !== deps.getuid()) {
    return failure(`${filePath} is not owned by the current user.`);
  }

  if (action === "protect") {
    await deps.chmod(filePath, expectedMode);
    const refreshed = await deps.stat(filePath);
    if ((refreshed.mode & 0o777) !== expectedMode) {
      return failure(
        `${filePath} permissions remain ${formatMode(refreshed.mode)} instead of ${formatMode(expectedMode)}.`,
      );
    }

    return undefined;
  }

  if ((details.mode & 0o777) !== expectedMode) {
    return failure(
      `${filePath} permissions are ${formatMode(details.mode)} instead of ${formatMode(expectedMode)}.`,
    );
  }

  return undefined;
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
