import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseCliArguments } from "../../src/cli/arguments.ts";
import { isMainModule, main } from "../../src/cli/main.ts";
import type { InstallerDependencies } from "../../src/install/installer.ts";
import { createLaunchPlan, type LaunchPlan } from "../../src/launch/launch-plan.ts";
import type { PlatformAdapter } from "../../src/platform/platform.ts";
import type { RuntimeInstallation } from "../../src/runtime/installation.ts";
import type { RecoveryTab } from "../../src/launch/recovery-plan.ts";
import type { AppPaths } from "../../src/storage/paths.ts";
import { atomicWriteJson } from "../../src/storage/atomic-json.ts";
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
  "  recover-sessions --discard-plan",
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
const runtimeRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "runtime",
  "main",
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

test("entrypoint detection resolves npm bin symlinks", () => {
  const canonicalEntry = path.resolve(
    "package",
    "dist",
    "copilot-session-recovery.mjs",
  );
  const npmBinEntry = path.resolve(
    "prefix",
    "bin",
    "copilot-session-recovery",
  );
  assert.equal(
    isMainModule(
      pathToFileURL(canonicalEntry).href,
      npmBinEntry,
      (filePath) =>
        filePath === npmBinEntry ? canonicalEntry : filePath,
    ),
    true,
  );
});

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
    async pathExists() {
      return false;
    },
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

function runtimePath(name: string): string {
  return path.join(runtimeRoot, `${process.pid}-${name}`);
}

function createPaths(root: string): AppPaths {
  return {
    appDir: root,
    configFile: path.join(root, "config.json"),
    registryFile: path.join(root, "sessions.json"),
    lockFile: path.join(root, "sessions.lock"),
    diagnosticsDir: path.join(root, "diagnostics"),
    corruptDir: path.join(root, "corrupt"),
    copilotHookFile: path.join(root, "copilot-session-recovery.json"),
    launchPlanFile: path.join(root, "launch-plan.json"),
    launchPlanLockFile: path.join(root, "launch-plan.lock"),
  };
}

async function createRuntimePaths(t: test.TestContext): Promise<AppPaths> {
  const root = runtimePath("state");
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return createPaths(root);
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
  assert.doesNotMatch(output.stdout, /launch-next/);
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

test("parseCliArguments parses launch-next and rejects extra arguments", () => {
  assert.deepEqual(parseCliArguments(["launch-next"]), {
    name: "launch-next",
  });
  assert.throws(
    () => parseCliArguments(["launch-next", "--wat"]),
    /does not accept arguments/i,
  );
});

test("main accepts installer dependencies with npm runtime installation data", async () => {
  const dependencies = createInstallerDependencies();

  assert.equal(await main(["install"], { installerDependencies: dependencies }), 0);
});

test("main routes launch-next and prints recorded spawn failures to stderr", async (t) => {
  const paths = await createRuntimePaths(t);
  const cwd = path.join(paths.appDir, "cwd");
  await mkdir(cwd, { recursive: true });

  const tabs: RecoveryTab[] = [
    {
      sessionId: "502ed8ca-ce22-4e92-b6a7-34eaec25c59d",
      cwd,
      title: "ms-pal - 502ed8c",
      launcherProfile: "copilot",
      process: {
        executable: path.join(paths.appDir, "missing-copilot.cmd"),
        args: ["--resume=502ed8ca-ce22-4e92-b6a7-34eaec25c59d"],
      },
      lastSeenAt: "2026-10-08T18:00:00.000Z",
    },
  ];
  await createLaunchPlan(paths, tabs);

  const output = await captureProcessOutput(() =>
    main(["launch-next"], { paths }),
  );

  assert.equal(output.result, 1);
  assert.equal(output.stdout, "");
  assert.match(output.stderr, /(EINVAL|ENOENT)/);

  const plan = JSON.parse(
    await readFile(paths.launchPlanFile, "utf8"),
  ) as LaunchPlan;
  assert.equal(plan.entries[0]?.status, "failed");
});

test("main does not print stale failed-launch errors when a claimed child exits nonzero after spawning", async (t) => {
  const paths = await createRuntimePaths(t);
  const cwd = path.join(paths.appDir, "cwd");
  await mkdir(cwd, { recursive: true });

  const pendingTabs: RecoveryTab[] = [
    {
      sessionId: "de305d54-75b4-431b-adb2-eb6b9e546014",
      cwd,
      title: "ms-pal - de305d5",
      launcherProfile: "copilot",
      process: {
        executable: process.execPath,
        args: ["-e", "process.exit(1)"],
      },
      lastSeenAt: "2026-10-08T18:00:00.000Z",
    },
  ];
  await createLaunchPlan(paths, pendingTabs);

  const initialPlan = JSON.parse(
    await readFile(paths.launchPlanFile, "utf8"),
  ) as LaunchPlan;
  await atomicWriteJson(paths.launchPlanFile, {
    ...initialPlan,
    entries: [
      {
        id: "failed-entry",
        cwd,
        process: {
          executable: "copilot",
          args: ["--resume=failed-entry"],
        },
        status: "failed",
        error: "stale spawn failure",
      },
      ...initialPlan.entries,
    ],
  });

  const output = await captureProcessOutput(() =>
    main(["launch-next"], { paths }),
  );

  assert.equal(output.result, 1);
  assert.equal(output.stdout, "");
  assert.equal(output.stderr, "");

  const plan = JSON.parse(
    await readFile(paths.launchPlanFile, "utf8"),
  ) as LaunchPlan;
  assert.deepEqual(
    plan.entries.map((entry) => entry.status),
    ["failed", "launched"],
  );
});
