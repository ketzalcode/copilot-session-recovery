import assert from "node:assert/strict";
import test from "node:test";

import type { CliOutput } from "../../src/cli/io.ts";
import { defaultConfig, type AppConfig } from "../../src/config/config.ts";
import { buildCopilotHookConfig } from "../../src/install/copilot-hooks.ts";
import {
  collectDiagnostics,
  repairRegistryCommand,
  type DiagnosticDependencies,
} from "../../src/install/diagnostics.ts";
import { emptyRegistry } from "../../src/session/lifecycle.ts";
import { RegistryCorruptError } from "../../src/storage/registry.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

interface OutputCapture {
  output: CliOutput;
  text(): string;
  errorText(): string;
  prompts: string[];
}

type TestDiagnosticDependencies = DiagnosticDependencies & {
  output: CliOutput;
  outputCapture: OutputCapture;
  registryResets: string[];
};

interface DiagnosticOverrides {
  confirm?: (message: string) => Promise<boolean>;
  corruptRegistry?: boolean;
  config?: AppConfig;
}

function createOutputCapture(
  confirm: (message: string) => Promise<boolean>,
): OutputCapture {
  const lines: string[] = [];
  const errors: string[] = [];
  const prompts: string[] = [];

  return {
    output: {
      out(message) {
        lines.push(message);
      },
      error(message) {
        errors.push(message);
      },
      async confirm(message) {
        prompts.push(message);
        return confirm(message);
      },
    },
    text() {
      return lines.join("\n");
    },
    errorText() {
      return errors.join("\n");
    },
    prompts,
  };
}

function createPaths(): AppPaths {
  const appDir = "C:\\Users\\ruben\\AppData\\Local\\copilot-auto-save";
  return {
    appDir,
    binDir: `${appDir}\\bin`,
    installedExecutable: `${appDir}\\bin\\copilot-auto-save.exe`,
    configFile: `${appDir}\\config.json`,
    registryFile: `${appDir}\\sessions.json`,
    lockFile: `${appDir}\\sessions.lock`,
    diagnosticsDir: `${appDir}\\diagnostics`,
    corruptDir: `${appDir}\\corrupt`,
    copilotHookFile: "C:\\Users\\ruben\\.copilot\\hooks\\copilot-auto-save.json",
  };
}

function createDiagnosticDependencies(
  overrides: DiagnosticOverrides = {},
): TestDiagnosticDependencies {
  const paths = createPaths();
  const outputCapture = createOutputCapture(
    overrides.confirm ?? (async () => true),
  );
  const registryResets: string[] = [];
  const evidencePath = `${paths.corruptDir}\\sessions.20261005000000.abc.json`;
  const config = overrides.config ?? defaultConfig();

  return {
    paths,
    output: outputCapture.output,
    outputCapture,
    registryResets,
    async fileExists(filePath) {
      return filePath === paths.installedExecutable;
    },
    async readText(filePath) {
      if (filePath !== paths.copilotHookFile) {
        throw new Error(`Unexpected read: ${filePath}`);
      }

      return JSON.stringify(buildCopilotHookConfig(paths.installedExecutable));
    },
    async loadConfig() {
      return config;
    },
    async readRegistry() {
      if (overrides.corruptRegistry) {
        throw new RegistryCorruptError(
          `Registry is corrupt. Preserved evidence at ${evidencePath}.`,
          evidencePath,
        );
      }

      return emptyRegistry();
    },
    async resetCorruptRegistry() {
      registryResets.push(evidencePath);
      return evidencePath;
    },
    async commandExists(executable) {
      return executable === "wt.exe" || executable === config.profiles[config.defaultProfile]!.executable;
    },
    async checkStateDirectoryProtection() {
      return {
        protected: true,
        detail: "State directory is protected for the current user.",
      };
    },
  };
}

test("status reports every required health check", async () => {
  const report = await collectDiagnostics(createDiagnosticDependencies());

  assert.deepEqual(
    report.checks.map((check) => check.id),
    [
      "installed-executable",
      "copilot-hook",
      "configuration",
      "registry",
      "state-acl",
      "windows-terminal",
      "launcher",
    ],
  );
  assert.equal(report.healthy, true);
});

test("doctor includes the corrupt registry evidence path", async () => {
  const report = await collectDiagnostics(
    createDiagnosticDependencies({ corruptRegistry: true }),
  );

  assert.equal(report.healthy, false);
  assert.match(JSON.stringify(report), /corrupt\\\\sessions/);
});

test("registry repair preserves evidence and requires confirmation", async () => {
  const declined = createDiagnosticDependencies({
    corruptRegistry: true,
    confirm: async () => false,
  });
  assert.equal(await repairRegistryCommand(declined), 0);
  assert.equal(declined.registryResets.length, 0);

  const approved = createDiagnosticDependencies({
    corruptRegistry: true,
    confirm: async () => true,
  });
  assert.equal(await repairRegistryCommand(approved), 0);
  assert.equal(approved.registryResets.length, 1);
  assert.match(approved.outputCapture.text(), /preserved evidence/i);
});
