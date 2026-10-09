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
  dev?: number;
  ino?: number;
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

function missingError(): NodeJS.ErrnoException {
  const error = new Error("missing") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function accessError(): NodeJS.ErrnoException {
  const error = new Error("denied") as NodeJS.ErrnoException;
  error.code = "EACCES";
  return error;
}

function defaultInode(filePath: string): number {
  if (filePath.endsWith("config.json")) {
    return 2;
  }

  if (filePath.endsWith("sessions.json")) {
    return 3;
  }

  return 1;
}

function statsForPath(filePath: string, entry: StatsShape) {
  return {
    uid: entry.uid,
    mode: entry.mode,
    dev: entry.dev ?? 10,
    ino: entry.ino ?? defaultInode(filePath),
    isDirectory: () => entry.directory === true,
  };
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
        throw missingError();
      }

      return {
        dev: entry.dev ?? 10,
        ino: entry.ino ?? defaultInode(filePath),
        isSymbolicLink: () => entry.symbolicLink === true,
      };
    },
    async stat(filePath) {
      const entry = values[filePath];
      if (!entry) {
        throw missingError();
      }

      return statsForPath(filePath, entry);
    },
    async chmod() {
      throw new Error("pathname chmod should not run when secure open succeeds");
    },
    async open(filePath) {
      const entry = values[filePath];
      if (!entry) {
        throw missingError();
      }

      return {
        async stat() {
          return statsForPath(filePath, values[filePath]!);
        },
        async chmod(mode) {
          chmodCalls.push([filePath, mode]);
          values[filePath] = {
            ...values[filePath]!,
            mode,
          };
        },
        async close() {},
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
        dev: 10,
        ino: defaultInode(filePath),
        isSymbolicLink: () => filePath === paths.configFile,
      };
    },
    async stat(filePath) {
      return {
        uid: 501,
        mode: filePath === paths.appDir ? 0o700 : 0o600,
        dev: 10,
        ino: defaultInode(filePath),
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod() {
      throw new Error("pathname chmod should not run for symlink rejection");
    },
    async open(filePath) {
      return {
        async stat() {
          return {
            uid: 501,
            mode: filePath === paths.appDir ? 0o700 : 0o600,
            dev: 10,
            ino: defaultInode(filePath),
            isDirectory: () => filePath === paths.appDir,
          };
        },
        async chmod(mode) {
          chmodCalls.push([filePath, mode]);
        },
        async close() {},
      };
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
    async lstat(filePath) {
      return {
        dev: 10,
        ino: defaultInode(filePath),
        isSymbolicLink: () => false,
      };
    },
    async stat(filePath) {
      return {
        uid: filePath === paths.registryFile ? 777 : 501,
        mode: filePath === paths.appDir ? 0o700 : 0o600,
        dev: 10,
        ino: defaultInode(filePath),
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod() {
      throw new Error("pathname chmod should not run when secure open succeeds");
    },
    async open(filePath) {
      return {
        async stat() {
          return {
            uid: filePath === paths.registryFile ? 777 : 501,
            mode: filePath === paths.appDir ? 0o700 : 0o600,
            dev: 10,
            ino: defaultInode(filePath),
            isDirectory: () => filePath === paths.appDir,
          };
        },
        async chmod() {},
        async close() {},
      };
    },
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
    async lstat(filePath) {
      return {
        dev: 10,
        ino: defaultInode(filePath),
        isSymbolicLink: () => false,
      };
    },
    async stat(filePath) {
      return {
        uid: 501,
        mode: filePath === paths.appDir ? 0o700 : 0o644,
        dev: 10,
        ino: defaultInode(filePath),
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod() {
      throw new Error("pathname chmod should not run when secure open succeeds");
    },
    async open(filePath) {
      return {
        async stat() {
          return {
            uid: 501,
            mode: filePath === paths.appDir ? 0o700 : 0o644,
            dev: 10,
            ino: defaultInode(filePath),
            isDirectory: () => filePath === paths.appDir,
          };
        },
        async chmod() {},
        async close() {},
      };
    },
  });

  assert.deepEqual(result, {
    protected: false,
    detail: `${paths.configFile} permissions remain 644 instead of 600.`,
  });
});

test("protectMacState rejects a path replaced between inspection and chmod verification", async () => {
  const paths = createPaths();
  const lstatCalls = new Map<string, number>();
  const chmodCalls: Array<[string, number]> = [];

  const result = await protectMacState(paths, {
    getuid: () => 501,
    async lstat(filePath) {
      const count = (lstatCalls.get(filePath) ?? 0) + 1;
      lstatCalls.set(filePath, count);

      if (filePath === paths.configFile) {
        const identity =
          count === 1 ? { dev: 10, ino: 100 } : { dev: 10, ino: 200 };
        return {
          ...identity,
          isSymbolicLink: () => false,
        };
      }

      return {
        dev: 10,
        ino: filePath === paths.appDir ? 1 : 3,
        isSymbolicLink: () => false,
      };
    },
    async stat() {
      throw new Error("pathname stat should not run when secure open succeeds");
    },
    async chmod() {
      throw new Error("pathname chmod should not run when secure open succeeds");
    },
    async open(filePath) {
      if (filePath !== paths.configFile) {
        return {
          async stat() {
            return {
              uid: 501,
              mode: filePath === paths.appDir ? 0o700 : 0o600,
              dev: 10,
              ino: filePath === paths.appDir ? 1 : 3,
              isDirectory: () => filePath === paths.appDir,
            };
          },
          async chmod(mode) {
            chmodCalls.push([filePath, mode]);
          },
          async close() {},
        };
      }

      return {
        async stat() {
          return {
            uid: 501,
            mode: 0o600,
            dev: 10,
            ino: 100,
            isDirectory: () => false,
          };
        },
        async chmod(mode) {
          chmodCalls.push([`${filePath}:handle`, mode]);
        },
        async close() {},
      };
    },
  });

  assert.deepEqual(result, {
    protected: false,
    detail: `${paths.configFile} changed while permissions were being applied.`,
  });
  assert.deepEqual(chmodCalls, [
    [paths.appDir, 0o700],
    [`${paths.configFile}:handle`, 0o600],
  ]);
});

test("protectMacState repairs owned unreadable state paths with pathname chmod fallback and secure verification", async () => {
  const paths = createPaths();
  const openAttempts = new Map<string, number>();
  const chmodCalls: Array<[string, number]> = [];
  const values = createStatsShape({
    [paths.appDir]: { directory: true, mode: 0o000, uid: 501 },
    [paths.configFile]: { mode: 0o000, uid: 501 },
    [paths.registryFile]: { mode: 0o000, uid: 501 },
  });

  const result = await protectMacState(paths, {
    getuid: () => 501,
    async lstat(filePath) {
      const entry = values[filePath];
      if (!entry) {
        throw missingError();
      }

      return {
        dev: entry.dev ?? 10,
        ino: entry.ino ?? defaultInode(filePath),
        isSymbolicLink: () => entry.symbolicLink === true,
      };
    },
    async stat(filePath) {
      const entry = values[filePath];
      if (!entry) {
        throw missingError();
      }

      return statsForPath(filePath, entry);
    },
    async chmod(filePath, mode) {
      chmodCalls.push([filePath, mode]);
      values[filePath] = {
        ...values[filePath]!,
        mode,
      };
    },
    async open(filePath) {
      const attempts = (openAttempts.get(filePath) ?? 0) + 1;
      openAttempts.set(filePath, attempts);

      if (attempts === 1) {
        throw accessError();
      }

      return {
        async stat() {
          return statsForPath(filePath, values[filePath]!);
        },
        async chmod() {
          throw new Error("handle chmod should not run after fallback chmod");
        },
        async close() {},
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

test("protectMacState rejects unreadable paths replaced during pathname chmod fallback", async () => {
  const paths = createPaths();
  const openAttempts = new Map<string, number>();
  const values = createStatsShape({
    [paths.appDir]: { directory: true, mode: 0o700, uid: 501 },
    [paths.configFile]: { mode: 0o000, uid: 501, dev: 10, ino: 2 },
    [paths.registryFile]: { mode: 0o600, uid: 501 },
  });

  const result = await protectMacState(paths, {
    getuid: () => 501,
    async lstat(filePath) {
      const entry = values[filePath];
      if (!entry) {
        throw missingError();
      }

      return {
        dev: entry.dev ?? 10,
        ino: entry.ino ?? defaultInode(filePath),
        isSymbolicLink: () => entry.symbolicLink === true,
      };
    },
    async stat(filePath) {
      const entry = values[filePath];
      if (!entry) {
        throw missingError();
      }

      return statsForPath(filePath, entry);
    },
    async chmod(filePath, mode) {
      if (filePath === paths.configFile) {
        values[filePath] = {
          ...values[filePath]!,
          mode,
          ino: 22,
        };
        return;
      }

      values[filePath] = {
        ...values[filePath]!,
        mode,
      };
    },
    async open(filePath) {
      const attempts = (openAttempts.get(filePath) ?? 0) + 1;
      openAttempts.set(filePath, attempts);

      if (filePath === paths.configFile && attempts === 1) {
        throw accessError();
      }

      return {
        async stat() {
          return statsForPath(filePath, values[filePath]!);
        },
        async chmod() {},
        async close() {},
      };
    },
  });

  assert.deepEqual(result, {
    protected: false,
    detail: `${paths.configFile} changed while permissions were being applied.`,
  });
});

test("checkMacStateProtection reports success for owned state paths with strict modes", async () => {
  const paths = createPaths();

  const result = await checkMacStateProtection(paths, {
    getuid: () => 501,
    async lstat(filePath) {
      return {
        dev: 10,
        ino: defaultInode(filePath),
        isSymbolicLink: () => false,
      };
    },
    async stat(filePath) {
      return {
        uid: 501,
        mode: filePath === paths.appDir ? 0o700 : 0o600,
        dev: 10,
        ino: defaultInode(filePath),
        isDirectory: () => filePath === paths.appDir,
      };
    },
    async chmod() {
      throw new Error("pathname chmod should not run during checks");
    },
    async open(filePath) {
      return {
        async stat() {
          return {
            uid: 501,
            mode: filePath === paths.appDir ? 0o700 : 0o600,
            dev: 10,
            ino: defaultInode(filePath),
            isDirectory: () => filePath === paths.appDir,
          };
        },
        async chmod() {
          throw new Error("chmod should not run during checks");
        },
        async close() {},
      };
    },
  });

  assert.deepEqual(result, {
    protected: true,
    detail: "State paths are protected for the current user.",
  });
});
