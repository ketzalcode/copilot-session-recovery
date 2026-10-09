import assert from "node:assert/strict";
import test from "node:test";

import type { CliOutput } from "../../src/cli/io.ts";
import { defaultConfig, type AppConfig } from "../../src/config/config.ts";
import { buildCopilotHookConfig } from "../../src/install/copilot-hooks.ts";
import {
  collectDiagnostics,
  repairRegistryCommand,
  type DiagnosticCheck,
  type DiagnosticDependencies,
} from "../../src/install/diagnostics.ts";
import { createMacosPlatformAdapter } from "../../src/platform/macos.ts";
import type { PlatformAdapter } from "../../src/platform/platform.ts";
import { createWindowsPlatformAdapter } from "../../src/platform/windows.ts";
import type { RuntimeInstallation } from "../../src/runtime/installation.ts";
import { emptyRegistry } from "../../src/session/lifecycle.ts";
import { RegistryCorruptError } from "../../src/storage/registry.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

interface OutputCapture {
  output: CliOutput;
  text(): string;
  errorText(): string;
  prompts: string[];
}

interface ProcessCall {
  executable: string;
  args: string[];
}

interface CommandCheck {
  executable: string;
  platform: "win32" | "darwin";
}

interface DiagnosticOverrides {
  config?: AppConfig;
  confirm?: (message: string) => Promise<boolean>;
  corruptRegistry?: boolean;
  hookInstallation?: RuntimeInstallation;
  installation?: RuntimeInstallation;
  platformId?: "win32" | "darwin";
  protected?: boolean;
  protectionDetail?: string;
}

type TestDiagnosticDependencies = DiagnosticDependencies & {
  output: CliOutput;
  outputCapture: OutputCapture;
  commandChecks: CommandCheck[];
  processCalls: ProcessCall[];
  registryResets: string[];
};

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

function createWindowsInstallation(
  overrides: Partial<RuntimeInstallation> = {},
): RuntimeInstallation {
  return {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry:
      "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
    ...overrides,
  };
}

function createMacosInstallation(
  overrides: Partial<RuntimeInstallation> = {},
): RuntimeInstallation {
  return {
    nodeExecutable: "/opt/homebrew/bin/node",
    cliEntry:
      "/usr/local/lib/node_modules/copilot-session-recovery/dist/copilot-session-recovery.mjs",
    ...overrides,
  };
}

function createPlatformAdapter(
  platformId: "win32" | "darwin",
  commandChecks: CommandCheck[],
  processCalls: ProcessCall[],
  protection: { protected: boolean; detail: string },
  launcherExecutable: string,
): { paths: AppPaths; platform: PlatformAdapter } {
  if (platformId === "win32") {
    const platform = createWindowsPlatformAdapter({
      commandExists: async (executable, platformName) => {
        commandChecks.push({ executable, platform: platformName });
        return executable === "wt.exe" || executable === launcherExecutable;
      },
      checkStateProtection: async () => protection,
    });

    return {
      platform,
      paths: platform.resolvePaths({
        LOCALAPPDATA: "C:\\Users\\ruben\\AppData\\Local",
        USERPROFILE: "C:\\Users\\ruben",
      }),
    };
  }

  const platform = createMacosPlatformAdapter({
    commandExists: async (executable, platformName) => {
      commandChecks.push({ executable, platform: platformName });
      return (
        executable === "/usr/bin/osascript" ||
        executable === launcherExecutable
      );
    },
    runProcess: async (spec) => {
      processCalls.push({
        executable: spec.executable,
        args: spec.args,
      });
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
      };
    },
    checkStateProtection: async () => protection,
  });

  return {
    platform,
    paths: platform.resolvePaths({
      HOME: "/Users/ruben",
    }),
  };
}

function createDiagnosticDependencies(
  overrides: DiagnosticOverrides = {},
): TestDiagnosticDependencies {
  const platformId = overrides.platformId ?? "win32";
  const installation =
    overrides.installation ??
    (platformId === "win32"
      ? createWindowsInstallation()
      : createMacosInstallation());
  const outputCapture = createOutputCapture(
    overrides.confirm ?? (async () => true),
  );
  const registryResets: string[] = [];
  const commandChecks: CommandCheck[] = [];
  const processCalls: ProcessCall[] = [];
  const config = overrides.config ?? defaultConfig();
  const protection = {
    protected: overrides.protected ?? true,
    detail:
      overrides.protectionDetail ??
      "State directory is protected for the current user.",
  };
  const { paths, platform } = createPlatformAdapter(
    platformId,
    commandChecks,
    processCalls,
    protection,
    config.profiles[config.defaultProfile]!.executable,
  );
  const evidencePath = `${paths.corruptDir}${platformId === "win32" ? "\\" : "/"}sessions.20261005000000.abc.json`;

  return {
    paths,
    output: outputCapture.output,
    outputCapture,
    commandChecks,
    processCalls,
    registryResets,
    installation,
    platform,
    async fileExists() {
      return true;
    },
    async readText(filePath) {
      if (filePath !== paths.copilotHookFile) {
        throw new Error(`Unexpected read: ${filePath}`);
      }

      return JSON.stringify(
        buildCopilotHookConfig(overrides.hookInstallation ?? installation),
      );
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
    async commandExists(executable, platformName) {
      commandChecks.push({ executable, platform: platformName });
      return executable === config.profiles[config.defaultProfile]!.executable;
    },
  };
}

function findCheck(
  report: Awaited<ReturnType<typeof collectDiagnostics>>,
  id: DiagnosticCheck["id"],
): DiagnosticCheck {
  const check = report.checks.find((entry) => entry.id === id);
  if (check === undefined) {
    throw new Error(`Missing diagnostic check: ${id}`);
  }
  return check;
}

test("healthy Windows diagnostics use the runtime installation and adapter checks", async () => {
  const report = await collectDiagnostics(createDiagnosticDependencies());

  assert.deepEqual(
    report.checks.map((check) => check.id),
    [
      "runtime",
      "copilot-hook",
      "configuration",
      "registry",
      "state-protection",
      "terminal",
      "launcher",
    ],
  );
  assert.equal(report.healthy, true);
  assert.equal(
    findCheck(report, "runtime").summary,
    "Installed npm runtime is available.",
  );
  assert.equal(
    findCheck(report, "state-protection").summary,
    "State directory is current-user protected.",
  );
  assert.equal(
    findCheck(report, "terminal").summary,
    "Windows Terminal is available.",
  );
});

test("macOS diagnostics report Apple Terminal availability through the adapter", async () => {
  const deps = createDiagnosticDependencies({ platformId: "darwin" });
  const report = await collectDiagnostics(deps);

  assert.deepEqual(
    report.checks.map((check) => check.id),
    [
      "runtime",
      "copilot-hook",
      "configuration",
      "registry",
      "state-protection",
      "terminal",
      "launcher",
    ],
  );
  assert.equal(report.healthy, true);
  assert.equal(
    findCheck(report, "runtime").summary,
    "Installed npm runtime is available.",
  );
  assert.equal(
    findCheck(report, "state-protection").summary,
    "State directory is current-user protected.",
  );
  assert.equal(
    findCheck(report, "terminal").summary,
    "Apple Terminal is available.",
  );
  assert.deepEqual(deps.processCalls, [
    {
      executable: "/usr/bin/open",
      args: ["-Ra", "Terminal"],
    },
  ]);
});

test("missing nodeExecutable reports a runtime error", async () => {
  const report = await collectDiagnostics(
    createDiagnosticDependencies({
      installation: createWindowsInstallation({ nodeExecutable: "" }),
    }),
  );

  const runtime = findCheck(report, "runtime");
  assert.equal(runtime.status, "error");
  assert.match(runtime.detail ?? "", /nodeExecutable/i);
});

test("missing cliEntry reports a runtime error", async () => {
  const report = await collectDiagnostics(
    createDiagnosticDependencies({
      installation: createWindowsInstallation({ cliEntry: "" }),
    }),
  );

  const runtime = findCheck(report, "runtime");
  assert.equal(runtime.status, "error");
  assert.match(runtime.detail ?? "", /cliEntry/i);
});

test("moved runtime hook paths tell the operator to rerun install", async () => {
  const report = await collectDiagnostics(
    createDiagnosticDependencies({
      hookInstallation: createWindowsInstallation({
        nodeExecutable: "C:\\Moved\\node.exe",
        cliEntry: "C:\\Moved\\copilot-session-recovery.mjs",
      }),
    }),
  );

  const hook = findCheck(report, "copilot-hook");
  assert.equal(hook.status, "error");
  assert.match(hook.fix ?? "", /Run install/i);
});

test("state protection failures are warnings with platform-neutral copy", async () => {
  const report = await collectDiagnostics(
    createDiagnosticDependencies({
      protected: false,
      protectionDetail: "Permission audit was unavailable.",
    }),
  );

  const protection = findCheck(report, "state-protection");
  assert.equal(protection.status, "warning");
  assert.equal(
    protection.summary,
    "State directory protection could not be verified.",
  );
  assert.doesNotMatch(protection.summary, /ACL/i);
  assert.doesNotMatch(protection.fix ?? "", /ACL/i);
});

test("launcher lookup receives the current Windows platform", async () => {
  const deps = createDiagnosticDependencies();
  const config = defaultConfig();

  await collectDiagnostics(deps);

  assert.deepEqual(deps.commandChecks, [
    {
      executable: "wt.exe",
      platform: "win32",
    },
    {
      executable: config.profiles[config.defaultProfile]!.executable,
      platform: "win32",
    },
  ]);
});

test("launcher lookup receives the current macOS platform", async () => {
  const deps = createDiagnosticDependencies({ platformId: "darwin" });
  const config = defaultConfig();

  await collectDiagnostics(deps);

  assert.deepEqual(deps.commandChecks, [
    {
      executable: "/usr/bin/osascript",
      platform: "darwin",
    },
    {
      executable: config.profiles[config.defaultProfile]!.executable,
      platform: "darwin",
    },
  ]);
});

test("doctor includes the corrupt registry evidence path", async () => {
  const report = await collectDiagnostics(
    createDiagnosticDependencies({ corruptRegistry: true }),
  );

  assert.equal(report.healthy, false);
  assert.match(
    findCheck(report, "registry").detail ?? "",
    /corrupt[\\/]sessions/,
  );
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
