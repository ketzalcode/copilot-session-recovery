import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { parseCliArguments } from "../../src/cli/arguments.ts";
import type { CliOutput } from "../../src/cli/io.ts";
import {
  defaultConfig,
  parseConfig,
  type AppConfig,
} from "../../src/config/config.ts";
import { buildCopilotHookConfig } from "../../src/install/copilot-hooks.ts";
import {
  installCommand,
  type InstallerDependencies,
  uninstallCommand,
} from "../../src/install/installer.ts";
import type { SelfDeleteRequest } from "../../src/install/self-delete.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

interface OutputCapture {
  output: CliOutput;
  text(): string;
  errorText(): string;
}

interface InstallerDependencyOverrides {
  aclProtected?: boolean;
  currentExecutable?: string;
  existingConfig?: AppConfig;
  installed?: boolean;
  isSea?: boolean;
}

type TestInstallerDependencies = InstallerDependencies & {
  cleanupRequests: SelfDeleteRequest[];
  configWrites: number;
  copiedFiles: [string, string][];
  currentExecutable: string;
  currentPid: number;
  protectedDirectories: string[];
  remainingFiles: string[];
  removedPathEntries: string[];
  savedConfig: AppConfig | undefined;
  userPathEntries: string[];
  writtenHookConfig: unknown;
  outputCapture: OutputCapture;
};

const customConfig = parseConfig({
  schemaVersion: 1,
  defaultProfile: "corp",
  profiles: {
    corp: {
      executable: "corp",
      args: ["--resume={sessionId}"],
    },
  },
});

function createOutputCapture(): OutputCapture {
  const lines: string[] = [];
  const errors: string[] = [];

  return {
    output: {
      out(message) {
        lines.push(message);
      },
      error(message) {
        errors.push(message);
      },
      async confirm() {
        return true;
      },
    },
    text() {
      return lines.join("\n");
    },
    errorText() {
      return errors.join("\n");
    },
  };
}

function createPaths(): AppPaths {
  const appDir = "C:\\Users\\ruben\\AppData\\Local\\copilot-auto-save";
  return {
    appDir,
    binDir: path.win32.join(appDir, "bin"),
    installedExecutable: path.win32.join(appDir, "bin", "copilot-auto-save.exe"),
    configFile: path.win32.join(appDir, "config.json"),
    registryFile: path.win32.join(appDir, "sessions.json"),
    lockFile: path.win32.join(appDir, "sessions.lock"),
    diagnosticsDir: path.win32.join(appDir, "diagnostics"),
    corruptDir: path.win32.join(appDir, "corrupt"),
    copilotHookFile: "C:\\Users\\ruben\\.copilot\\hooks\\copilot-auto-save.json",
  };
}

function removeOne(values: string[], value: string): void {
  const index = values.indexOf(value);
  if (index >= 0) {
    values.splice(index, 1);
  }
}

function createInstallerDependencies(
  overrides: InstallerDependencyOverrides = {},
): TestInstallerDependencies {
  const paths = createPaths();
  const outputCapture = createOutputCapture();
  const currentExecutable =
    overrides.currentExecutable ?? "C:\\Downloads\\copilot-auto-save.exe";
  const remainingFiles = overrides.installed
    ? [
        paths.installedExecutable,
        paths.configFile,
        paths.registryFile,
        paths.copilotHookFile,
      ]
    : [];
  let savedConfig = overrides.existingConfig;
  if (savedConfig !== undefined && !remainingFiles.includes(paths.configFile)) {
    remainingFiles.push(paths.configFile);
  }

  const deps: TestInstallerDependencies = {
    paths,
    output: outputCapture.output,
    outputCapture,
    currentExecutable,
    currentPid: 9876,
    platform: "win32",
    copiedFiles: [],
    userPathEntries: [],
    removedPathEntries: [],
    protectedDirectories: [],
    cleanupRequests: [],
    remainingFiles,
    savedConfig,
    configWrites: 0,
    writtenHookConfig: undefined,
    isSea() {
      return overrides.isSea ?? true;
    },
    async ensureDirectory() {},
    async fileExists(filePath) {
      return remainingFiles.includes(filePath);
    },
    async copyFileAtomic(source, destination) {
      deps.copiedFiles.push([source, destination]);
      if (!remainingFiles.includes(destination)) {
        remainingFiles.push(destination);
      }
    },
    async loadConfig() {
      if (savedConfig === undefined) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return savedConfig;
    },
    async saveConfig(_filePath, config) {
      savedConfig = config;
      deps.savedConfig = config;
      deps.configWrites += 1;
      if (!remainingFiles.includes(paths.configFile)) {
        remainingFiles.push(paths.configFile);
      }
    },
    async writeJson(filePath) {
      if (!remainingFiles.includes(filePath)) {
        remainingFiles.push(filePath);
      }
    },
    async writeCopilotHookConfig() {
      deps.writtenHookConfig = buildCopilotHookConfig(paths.installedExecutable);
      if (!remainingFiles.includes(paths.copilotHookFile)) {
        remainingFiles.push(paths.copilotHookFile);
      }
    },
    async ensureUserPathEntry(binDir) {
      deps.userPathEntries.push(binDir);
    },
    async removeUserPathEntry(binDir) {
      deps.removedPathEntries.push(binDir);
    },
    async protectStateDirectory(appDir) {
      deps.protectedDirectories.push(appDir);
      return overrides.aclProtected === false
        ? { protected: false, detail: "icacls failed" }
        : {
            protected: true,
            detail: "State directory is protected for the current user.",
          };
    },
    async removeFile(filePath) {
      removeOne(remainingFiles, filePath);
    },
    scheduleSelfDelete(request) {
      deps.cleanupRequests.push(request);
    },
  };

  return deps;
}

test("parseCliArguments parses install diagnostics and uninstall commands", () => {
  assert.deepEqual(parseCliArguments(["install", "--profile", "agency"]), {
    name: "install",
    options: { profile: "agency" },
  });
  assert.deepEqual(parseCliArguments(["status"]), { name: "status" });
  assert.deepEqual(parseCliArguments(["doctor"]), {
    name: "doctor",
    options: { repairRegistry: false },
  });
  assert.deepEqual(parseCliArguments(["doctor", "--repair-registry"]), {
    name: "doctor",
    options: { repairRegistry: true },
  });
  assert.deepEqual(parseCliArguments(["uninstall", "--purge"]), {
    name: "uninstall",
    options: { purge: true },
  });
});

test("install copies the SEA, creates config once, writes hooks, and adds PATH", async () => {
  const deps = createInstallerDependencies();

  assert.equal(await installCommand({ profile: "agency" }, deps), 0);
  assert.deepEqual(deps.copiedFiles, [
    [deps.currentExecutable, deps.paths.installedExecutable],
  ]);
  assert.equal(deps.configWrites, 1);
  assert.equal(deps.savedConfig?.defaultProfile, "agency");
  assert.deepEqual(
    deps.writtenHookConfig,
    buildCopilotHookConfig(deps.paths.installedExecutable),
  );
  assert.equal(deps.userPathEntries.at(-1), deps.paths.binDir);
  assert.equal(deps.protectedDirectories.at(-1), deps.paths.appDir);
  assert.match(deps.outputCapture.text(), /restart already-open terminals/i);
});

test("repair install preserves an existing valid custom configuration", async () => {
  const deps = createInstallerDependencies({ existingConfig: customConfig });

  assert.equal(await installCommand({}, deps), 0);
  assert.equal(deps.configWrites, 0);
  assert.deepEqual(deps.savedConfig, customConfig);
});

test("uninstall preserves state unless purge is explicit", async () => {
  const deps = createInstallerDependencies({ installed: true });

  assert.equal(await uninstallCommand({ purge: false }, deps), 0);
  assert.ok(deps.remainingFiles.includes(deps.paths.registryFile));
  assert.ok(deps.remainingFiles.includes(deps.paths.configFile));
  assert.ok(!deps.remainingFiles.includes(deps.paths.copilotHookFile));
  assert.equal(deps.removedPathEntries.at(-1), deps.paths.binDir);
  assert.deepEqual(deps.cleanupRequests, [
    {
      parentPid: deps.currentPid,
      installedExecutable: deps.paths.installedExecutable,
      appDir: deps.paths.appDir,
      purge: false,
    },
  ]);
});

test("repair install does not copy the executable over itself", async () => {
  const deps = createInstallerDependencies({
    currentExecutable: "C:\\Local\\copilot-auto-save\\bin\\copilot-auto-save.exe",
  });
  deps.paths.installedExecutable = deps.currentExecutable;

  assert.equal(await installCommand({}, deps), 0);
  assert.equal(deps.copiedFiles.length, 0);
});

test("uninstall --purge schedules exact app directory cleanup after exit", async () => {
  const deps = createInstallerDependencies({ installed: true });

  assert.equal(await uninstallCommand({ purge: true }, deps), 0);
  assert.ok(deps.remainingFiles.includes(deps.paths.registryFile));
  assert.deepEqual(deps.cleanupRequests, [
    {
      parentPid: deps.currentPid,
      installedExecutable: deps.paths.installedExecutable,
      appDir: deps.paths.appDir,
      purge: true,
    },
  ]);
});

test("install warns but succeeds when current-user ACL protection fails", async () => {
  const deps = createInstallerDependencies({ aclProtected: false });

  assert.equal(await installCommand({}, deps), 0);
  assert.match(deps.outputCapture.errorText(), /icacls failed/);
});

test("install refuses non-SEA executions", async () => {
  const deps = createInstallerDependencies({ isSea: false });

  assert.equal(await installCommand({}, deps), 1);
  assert.match(deps.outputCapture.errorText(), /self-contained executable/i);
});
