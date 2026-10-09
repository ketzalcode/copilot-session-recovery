import assert from "node:assert/strict";
import test from "node:test";

import {
  checkMacStateProtection,
  protectMacState,
} from "../../src/platform/macos-permissions.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

type StatsShape = {
  directory?: boolean;
  symbolicLink?: boolean;
  mode: number;
  uid: number;
};

function createPaths(): AppPaths {
  return {
    appDir: "/Users/ruben/Library/Application Support/copilot-session-recovery",
    configFile:
      "/Users/ruben/Library/Application Support/copilot-session-recovery/config.json",
    registryFile:
      "/Users/ruben/Library/Application Support/copilot-session-recovery/sessions.json",
    lockFile:
      "/Users/ruben/Library/Application Support/copilot-session-recovery/sessions.lock",
    diagnosticsDir:
      "/Users/ruben/Library/Application Support/copilot-session-recovery/diagnostics",
    corruptDir:
      "/Users/ruben/Library/Application Support/copilot-session-recovery/corrupt",
    copilotHookFile:
      "/Users/ruben/.copilot/hooks/copilot-session-recovery.json",
    launchPlanFile:
      "/Users/ruben/Library/Application Support/copilot-session-recovery/launch-plan.json",
    launchPlanLockFile:
      "/Users/ruben/Library/Application Support/copilot-session-recovery/launch-plan.lock",
  };
}

function createStatsShape(values: Record<string, StatsShape>) {
  return values;
}

test("protectMacState chmods owned state paths and verifies the final modes", async () => {
  const paths = createPaths();
  const chmodCalls: Array<[string, number]> = [];
  const values = createStatsShape({
    [paths.appDir]: { directory: true, mode: 0o755, uid: 501 },
    [paths.configFile]: { mode: 0o644, uid: 501 },
    [paths.registryFile]: { mode: 0o644, uid: 501 },
  });

  const result = await protectMacState(paths, {
    getuid: () => 501,
    async lstat(filePath) {
      const entry = values[filePath];
      if (!entry) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }

      return {
        isSymbolicLink: () => entry.symbolicLink === true,
      };
    },
    async stat(filePath) {
      const entry = values[filePath];
      if (!entry) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }

      return {
        uid: entry.uid,
        mode: entry.mode,
        isDirectory: () => entry.directory === true,
      };
    },
    async chmod(filePath, mode) {
      chmodCalls.push([filePath, mode]);
      values[filePath] = {
        ...values[filePath]!,
        mode,
      };
    },
  });

  assert.deepEqual(chmodCalls, [
    [paths.appDir, 0o700],
    [paths.configFile, 0o600],
    [paths.registryFile, 0o600],
  ]);
  assert.deepEqual(result, {
    protected: true,
    detail: "State paths are protected for the current user.",
  });
});

test("protectMacState rejects symlinked state paths", async () => {
  const paths = createPaths();
  const chmodCalls: Array<[string, number]> = [];

  const result = await protectMacState(paths, {
    getuid: () => 501,
    async lstat(filePath) {
      return {
        isSymbolicLink: () => filePath === paths.configFile,
      };
    },
    async stat(filePath) {
      return {
        uid: 501,
        mode: filePath === paths.appDir ? 0o700 : 0o600,
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod(filePath, mode) {
      chmodCalls.push([filePath, mode]);
    },
  });

  assert.deepEqual(result, {
    protected: false,
    detail: `${paths.configFile} is a symbolic link.`,
  });
  assert.deepEqual(chmodCalls, [[paths.appDir, 0o700]]);
});

test("protectMacState rejects state paths owned by another user", async () => {
  const paths = createPaths();

  const result = await protectMacState(paths, {
    getuid: () => 501,
    async lstat() {
      return {
        isSymbolicLink: () => false,
      };
    },
    async stat(filePath) {
      return {
        uid: filePath === paths.registryFile ? 777 : 501,
        mode: filePath === paths.appDir ? 0o700 : 0o600,
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod() {},
  });

  assert.deepEqual(result, {
    protected: false,
    detail: `${paths.registryFile} is not owned by the current user.`,
  });
});

test("protectMacState rejects mismatched modes after chmod", async () => {
  const paths = createPaths();

  const result = await protectMacState(paths, {
    getuid: () => 501,
    async lstat() {
      return {
        isSymbolicLink: () => false,
      };
    },
    async stat(filePath) {
      return {
        uid: 501,
        mode: filePath === paths.appDir ? 0o700 : 0o644,
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod() {},
  });

  assert.deepEqual(result, {
    protected: false,
    detail: `${paths.configFile} permissions remain 644 instead of 600.`,
  });
});

test("checkMacStateProtection reports success for owned state paths with strict modes", async () => {
  const paths = createPaths();

  const result = await checkMacStateProtection(paths, {
    getuid: () => 501,
    async lstat() {
      return {
        isSymbolicLink: () => false,
      };
    },
    async stat(filePath) {
      return {
        uid: 501,
        mode: filePath === paths.appDir ? 0o700 : 0o600,
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod() {
      throw new Error("chmod should not run during checks");
    },
  });

  assert.deepEqual(result, {
    protected: true,
    detail: "State paths are protected for the current user.",
  });
});
