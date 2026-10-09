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
import type { PlatformAdapter } from "../../src/platform/platform.ts";
import type { RuntimeInstallation } from "../../src/runtime/installation.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

interface OutputCapture {
  output: CliOutput;
  text(): string;
  errorText(): string;
}

type TestPaths = AppPaths & {
  hookDirectory: string;
};

interface InstallerDependencyOverrides {
  aclProtected?: boolean;
  existingConfig?: AppConfig;
  existingRegistry?: boolean;
  installation?: RuntimeInstallation;
  resolvedPaths?: AppPaths;
}

type TestInstallerDependencies = Omit<InstallerDependencies, "paths"> & {
  paths: TestPaths;
  configWrites: number;
  ensuredDirectories: string[];
  jsonWrites: string[];
  protectedDirectories: string[];
  remainingFiles: string[];
  removedDirectories: string[];
  removedFiles: string[];
  savedConfig: AppConfig | undefined;
  installation: RuntimeInstallation;
  writtenHookConfig: unknown;
  writeHookInstallations: RuntimeInstallation[];
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

function createPaths(): TestPaths {
  const appDir = "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery";
  return {
    appDir,
    configFile: path.win32.join(appDir, "config.json"),
    registryFile: path.win32.join(appDir, "sessions.json"),
    lockFile: path.win32.join(appDir, "sessions.lock"),
    diagnosticsDir: path.win32.join(appDir, "diagnostics"),
    corruptDir: path.win32.join(appDir, "corrupt"),
    copilotHookFile:
      "C:\\Users\\ruben\\.copilot\\hooks\\copilot-session-recovery.json",
    hookDirectory: "C:\\Users\\ruben\\.copilot\\hooks",
    launchPlanFile: path.win32.join(appDir, "launch-plan.json"),
    launchPlanLockFile: path.win32.join(appDir, "launch-plan.lock"),
  };
}

function createInstallation(): RuntimeInstallation {
  return {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry:
      "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
  };
}

function createPlatformAdapter(
  paths: AppPaths,
  protectedDirectories: string[],
  overrides: InstallerDependencyOverrides = {},
): PlatformAdapter {
  return {
    id: "windows",
    terminal: {
      name: "Windows Terminal",
      command: "wt.exe",
      available: async () => true,
      preview: () => "wt.exe",
      async launch() {
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
        };
      },
    },
    resolvePaths() {
      return overrides.resolvedPaths ?? paths;
    },
    async protectState(appPaths) {
      protectedDirectories.push(appPaths.appDir);
      return overrides.aclProtected === false
        ? { protected: false, detail: "icacls failed" }
        : {
            protected: true,
            detail: "State directory is protected for the current user.",
          };
    },
    async checkStateProtection() {
      return {
        protected: true,
        detail: "State directory is protected for the current user.",
      };
    },
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
  const installation = overrides.installation ?? createInstallation();
  const remainingFiles: string[] = [];
  if (overrides.existingRegistry) {
    remainingFiles.push(paths.registryFile);
  }
  let savedConfig = overrides.existingConfig;
  if (savedConfig !== undefined && !remainingFiles.includes(paths.configFile)) {
    remainingFiles.push(paths.configFile);
  }
  const protectedDirectories: string[] = [];

  const deps: TestInstallerDependencies = {
    paths,
    output: outputCapture.output,
    outputCapture,
    installation,
    protectedDirectories,
    platform: createPlatformAdapter(paths, protectedDirectories, overrides),
    ensuredDirectories: [],
    jsonWrites: [],
    remainingFiles,
    removedDirectories: [],
    removedFiles: [],
    savedConfig,
    configWrites: 0,
    writtenHookConfig: undefined,
    writeHookInstallations: [],
    async ensureDirectory(directory) {
      deps.ensuredDirectories.push(directory);
    },
    async fileExists(filePath) {
      return remainingFiles.includes(filePath);
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
      deps.jsonWrites.push(filePath);
      if (!remainingFiles.includes(filePath)) {
        remainingFiles.push(filePath);
      }
    },
    async writeCopilotHookConfig(_paths, runtimeInstallation) {
      deps.writeHookInstallations.push(runtimeInstallation);
      deps.writtenHookConfig = buildCopilotHookConfig(runtimeInstallation);
      if (!remainingFiles.includes(paths.copilotHookFile)) {
        remainingFiles.push(paths.copilotHookFile);
      }
    },
    async removeFile(filePath) {
      deps.removedFiles.push(filePath);
      removeOne(remainingFiles, filePath);
    },
    async removeDirectory(directory) {
      deps.removedDirectories.push(directory);
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

test("install creates state directories and writes hooks for the persistent npm runtime", async () => {
  const deps = createInstallerDependencies();

  assert.equal(await installCommand({ profile: "agency" }, deps), 0);
  assert.deepEqual(deps.ensuredDirectories, [
    deps.paths.appDir,
    deps.paths.diagnosticsDir,
    deps.paths.corruptDir,
    deps.paths.hookDirectory,
  ]);
  assert.equal(deps.configWrites, 1);
  assert.equal(deps.savedConfig?.defaultProfile, "agency");
  assert.deepEqual(deps.jsonWrites, [deps.paths.registryFile]);
  assert.deepEqual(deps.writeHookInstallations, [deps.installation]);
  assert.deepEqual(
    deps.writtenHookConfig,
    buildCopilotHookConfig(deps.installation),
  );
  assert.equal(deps.protectedDirectories.at(-1), deps.paths.appDir);
  assert.match(deps.outputCapture.text(), /configured copilot-session-recovery/i);
});

test("repair install preserves an existing valid config and registry", async () => {
  const deps = createInstallerDependencies({
    existingConfig: customConfig,
    existingRegistry: true,
  });

  assert.equal(await installCommand({}, deps), 0);
  assert.equal(deps.configWrites, 0);
  assert.equal(deps.jsonWrites.length, 0);
  assert.deepEqual(deps.savedConfig, customConfig);
});

test("install rejects npx before mutating the filesystem", async () => {
  const deps = createInstallerDependencies({
    installation: {
      nodeExecutable: "/opt/homebrew/bin/node",
      cliEntry:
        "/Users/ruben/.npm/_npx/abc/node_modules/copilot-session-recovery/dist/copilot-session-recovery.mjs",
    },
  });

  assert.equal(await installCommand({}, deps), 1);
  assert.equal(deps.ensuredDirectories.length, 0);
  assert.equal(deps.configWrites, 0);
  assert.equal(deps.jsonWrites.length, 0);
  assert.equal(deps.writeHookInstallations.length, 0);
  assert.equal(deps.protectedDirectories.length, 0);
  assert.match(
    deps.outputCapture.errorText(),
    /npm install --global copilot-session-recovery/i,
  );
});

test("uninstall removes only the owned hook without purge", async () => {
  const deps = createInstallerDependencies({
    existingConfig: customConfig,
    existingRegistry: true,
  });
  deps.remainingFiles.push(deps.paths.copilotHookFile);

  assert.equal(await uninstallCommand({ purge: false }, deps), 0);
  assert.deepEqual(deps.removedFiles, [deps.paths.copilotHookFile]);
  assert.deepEqual(deps.removedDirectories, []);
  assert.ok(deps.remainingFiles.includes(deps.paths.registryFile));
  assert.ok(deps.remainingFiles.includes(deps.paths.configFile));
  assert.ok(!deps.remainingFiles.includes(deps.paths.copilotHookFile));
});

test("uninstall --purge removes the application directory after the owned hook", async () => {
  const deps = createInstallerDependencies({
    existingConfig: customConfig,
    existingRegistry: true,
  });
  deps.remainingFiles.push(deps.paths.copilotHookFile);

  assert.equal(await uninstallCommand({ purge: true }, deps), 0);
  assert.ok(deps.remainingFiles.includes(deps.paths.registryFile));
  assert.deepEqual(deps.removedFiles, [deps.paths.copilotHookFile]);
  assert.deepEqual(deps.removedDirectories, [deps.paths.appDir]);
});

test("install warns but succeeds when current-user ACL protection fails", async () => {
  const deps = createInstallerDependencies({ aclProtected: false });

  assert.equal(await installCommand({}, deps), 0);
  assert.match(deps.outputCapture.errorText(), /icacls failed/);
});
