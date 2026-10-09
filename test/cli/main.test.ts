import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { main } from "../../src/cli/main.ts";
import type { InstallerDependencies } from "../../src/install/installer.ts";
import type { PlatformAdapter } from "../../src/platform/platform.ts";
import type { RuntimeInstallation } from "../../src/runtime/installation.ts";
import { APP_VERSION } from "../../src/version.ts";

const HELP_TEXT = [
  "Usage: copilot-session-recovery <command>",
  "",
  "Commands:",
  "  hook session-start",
  "  hook session-end",
  "  install [--profile <name>]",
  "  status",
  "  doctor [--repair-registry]",
  "  uninstall [--purge]",
  "  add <session-id> [--cwd <path>] [--profile <name>]",
  "  list",
  "  remove <id-prefix>",
  "  prune --missing-cwd",
  "  recover-sessions [--yes] [--dry-run] [--profile <name>]",
  "  config show",
  "  config set default-profile <name>",
  "  config profile add <name> --executable <path> --arg <value> [--arg <value>...] [--replace]",
  "  --version",
  "  --help",
  "",
].join("\n");

const workerPath = fileURLToPath(
  new URL("../fixtures/hook-worker.ts", import.meta.url),
);
const PLATFORM_ENV_KEYS = [
  ["ComSpec"],
  ["Path", "PATH"],
  ["PATHEXT"],
  ["SystemRoot", "SYSTEMROOT"],
  ["TEMP"],
  ["TMP"],
  ["WINDIR"],
] as const;

interface CapturedOutput<T> {
  result: T;
  stdout: string;
  stderr: string;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function createInstallerDependencies(): InstallerDependencies {
  const installation: RuntimeInstallation = {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry:
      "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
  };
  const paths = {
    appDir: "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery",
    configFile:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\config.json",
    registryFile:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\sessions.json",
    lockFile:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\sessions.lock",
    diagnosticsDir:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\diagnostics",
    corruptDir:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\corrupt",
    copilotHookFile:
      "C:\\Users\\ruben\\.copilot\\hooks\\copilot-session-recovery.json",
    launchPlanFile:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\launch-plan.json",
    launchPlanLockFile:
      "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\launch-plan.lock",
  };
  const platform: PlatformAdapter = {
    id: "windows",
    terminalName: "Windows Terminal",
    resolvePaths() {
      return paths;
    },
    async protectState() {
      return {
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
    async terminalAvailable() {
      return true;
    },
  };

  return {
    paths,
    output: {
      out() {},
      error() {},
      async confirm() {
        return true;
      },
    },
    installation,
    platform,
    async ensureDirectory() {},
    async fileExists() {
      return false;
    },
    async loadConfig() {
      throw new Error("missing");
    },
    async saveConfig() {},
    async writeJson() {},
    async writeCopilotHookConfig() {},
    async removeFile() {},
    async removeDirectory() {},
  };
}

async function captureProcessOutput<T>(
  action: () => Promise<T>,
): Promise<CapturedOutput<T>> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  const captureWrite =
    (chunks: string[]) =>
    ((chunk, encoding) => {
      const text =
        typeof chunk === "string"
          ? chunk
          : Buffer.from(chunk).toString(
              typeof encoding === "string" ? encoding : undefined,
            );
      chunks.push(text);

      return true;
    }) as typeof process.stdout.write;

  process.stdout.write = captureWrite(stdoutChunks);
  process.stderr.write = captureWrite(stderrChunks);

  try {
    const result = await action();
    return {
      result,
      stdout: stdoutChunks.join(""),
      stderr: stderrChunks.join(""),
    };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const aliases of PLATFORM_ENV_KEYS) {
    for (const name of aliases) {
      const value = process.env[name];
      if (typeof value === "string" && value.length > 0) {
        env[name] = value;
        break;
      }
    }
  }

  return env;
}

function runCli(argv: readonly string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ...argv], {
      env: buildChildEnv(),
      shell: false,
    });
    let stdout = "";
    let stderr = "";

    child.once("error", reject);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test("main writes help text for --help", async () => {
  const output = await captureProcessOutput(() => main(["--help"]));

  assert.equal(output.result, 0);
  assert.equal(output.stdout, HELP_TEXT);
  assert.equal(output.stderr, "");
});

test("main writes the version for --version", async () => {
  const output = await captureProcessOutput(() => main(["--version"]));

  assert.equal(output.result, 0);
  assert.equal(output.stdout, `${APP_VERSION}\n`);
  assert.equal(output.stderr, "");
});

test("unknown commands exit with code 1 and print the parse error", async () => {
  const result = await runCli(["unknown-command"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command: unknown-command/);
});

test("main accepts installer dependencies with npm runtime installation data", async () => {
  const dependencies = createInstallerDependencies();

  assert.equal(await main(["install"], { installerDependencies: dependencies }), 0);
});
