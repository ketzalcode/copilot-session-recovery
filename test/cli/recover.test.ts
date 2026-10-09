import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCliArguments } from "../../src/cli/arguments.ts";
import { formatDryRunCommand, formatSessionTable } from "../../src/cli/format.ts";
import { recoverSessionsCommand } from "../../src/cli/commands.ts";
import { main } from "../../src/cli/main.ts";
import { defaultConfig, saveConfig } from "../../src/config/config.ts";
import { buildWindowsTerminalArgs } from "../../src/launch/windows-terminal.ts";
import type { ProcessResult, ProcessRunner, ProcessSpec } from "../../src/launch/process-runner.ts";
import type { RecoveryTab, SkippedSession } from "../../src/launch/recovery-plan.ts";
import type { SessionRegistry } from "../../src/session/model.ts";
import { atomicWriteJson } from "../../src/storage/atomic-json.ts";
import type { AppPaths } from "../../src/storage/paths.ts";

interface OutputCapture {
  output: {
    out(message: string): void;
    error(message: string): void;
    confirm(message: string): Promise<boolean>;
  };
  text(): string;
  errorText(): string;
  prompts: string[];
}

interface RecoverTestDependencies {
  paths: AppPaths;
  output: OutputCapture["output"];
  directoryExists(cwd: string): Promise<boolean>;
  commandExists(executable: string): Promise<boolean>;
  runProcess: ProcessRunner;
  processCalls: ProcessSpec[];
  registryWrites: string[];
  outputCapture: OutputCapture;
  readRegistry(): Promise<SessionRegistry>;
}

interface RecoverDependencyOverrides {
  confirm?: (message: string) => Promise<boolean>;
  commandExists?: (executable: string) => Promise<boolean>;
  runProcess?: ProcessRunner;
  registry?: SessionRegistry;
}

const primarySessionId = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const skippedSessionId = "95d2d9b1-0e6a-48c1-afd6-8a7598128f43";

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

function createSessionRegistry(
  sessions: SessionRegistry["sessions"],
): SessionRegistry {
  return {
    schemaVersion: 1,
    sessions,
  };
}

function createRecoveryFixtures(): {
  tabs: RecoveryTab[];
  skipped: SkippedSession[];
} {
  return {
    tabs: [
      {
        sessionId: primarySessionId,
        cwd: "C:\\src\\ms-pal",
        title: "ms-pal - 502ed8c",
        launcherProfile: "agency",
        process: {
          executable: "agency",
          args: ["copilot", `--resume=${primarySessionId}`],
        },
        lastSeenAt: "2026-10-05T18:00:00.000Z",
      },
    ],
    skipped: [
      {
        sessionId: skippedSessionId,
        cwd: "C:\\missing",
        reason: "working-directory-missing",
      },
    ],
  };
}

async function createRecoverTestDependencies(
  t: test.TestContext,
  overrides: RecoverDependencyOverrides = {},
): Promise<RecoverTestDependencies> {
  const root = await mkdtemp(path.join(os.tmpdir(), "copilot-session-recovery-"));
  t.after(async () => {
    await import("node:fs/promises").then(({ rm }) =>
      rm(root, { recursive: true, force: true }),
    );
  });

  const paths: AppPaths = {
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

  await mkdir(path.join(root, "bin"), { recursive: true });
  await mkdir(paths.diagnosticsDir, { recursive: true });
  await mkdir(paths.corruptDir, { recursive: true });
  await saveConfig(paths.configFile, defaultConfig());

  const registry =
    overrides.registry ??
    createSessionRegistry({
      [primarySessionId]: {
        sessionId: primarySessionId,
        cwd: "C:\\src\\ms-pal",
        launcherProfile: "copilot",
        source: "resume",
        startedAt: "2026-10-05T17:59:00.000Z",
        lastSeenAt: "2026-10-05T18:00:00.000Z",
      },
      [skippedSessionId]: {
        sessionId: skippedSessionId,
        cwd: "C:\\missing",
        launcherProfile: "copilot",
        source: "resume",
        startedAt: "2026-10-05T17:58:00.000Z",
        lastSeenAt: "2026-10-05T18:01:00.000Z",
      },
    });

  await atomicWriteJson(paths.registryFile, registry);

  let lastRegistryState = await readFile(paths.registryFile, "utf8");
  const processCalls: ProcessSpec[] = [];
  const registryWrites: string[] = [];
  const confirm = overrides.confirm ?? (async () => true);
  const outputCapture = createOutputCapture(confirm);
  const baseProcessRunner =
    overrides.runProcess ??
    (async () => ({ exitCode: 0, stdout: "", stderr: "" } satisfies ProcessResult));

  const runProcess: ProcessRunner = async (spec) => {
    processCalls.push(spec);
    const currentRegistryState = await readFile(paths.registryFile, "utf8");
    if (currentRegistryState !== lastRegistryState) {
      registryWrites.push(currentRegistryState);
      lastRegistryState = currentRegistryState;
    }
    return baseProcessRunner(spec);
  };

  return {
    paths,
    output: outputCapture.output,
    directoryExists: async (cwd) => cwd !== "C:\\missing",
    commandExists: overrides.commandExists ?? (async () => true),
    runProcess,
    processCalls,
    registryWrites,
    outputCapture,
    async readRegistry() {
      return JSON.parse(await readFile(paths.registryFile, "utf8")) as SessionRegistry;
    },
  };
}

async function expectRegistryUnchanged(
  registryFile: string,
  action: () => Promise<number>,
): Promise<number> {
  const before = await readFile(registryFile);
  const result = await action();
  const after = await readFile(registryFile);

  assert.equal(Buffer.compare(after, before), 0);
  return result;
}

test("formatSessionTable prints valid and skipped sessions with stable columns", () => {
  const fixtures = createRecoveryFixtures();
  const text = formatSessionTable(
    fixtures.tabs,
    fixtures.skipped,
    Date.parse("2026-10-05T18:03:00.000Z"),
  );

  assert.match(text, /Recoverable sessions:/);
  assert.match(text, /ID\s+Directory\s+Working directory\s+Launcher\s+Last seen/);
  assert.match(text, /502ed8c\s+ms-pal\s+C:\\src\\ms-pal\s+agency\s+3m ago/);
  assert.match(text, /Skipped sessions:/);
  assert.match(
    text,
    /95d2d9b\s+missing\s+C:\\missing\s+skipped: working-directory-missing\s+-/,
  );
});

test("formatDryRunCommand quotes Windows Terminal preview text", () => {
  const command = formatDryRunCommand(
    "wt.exe",
    buildWindowsTerminalArgs(createRecoveryFixtures().tabs),
  );

  assert.equal(
    command,
    `wt.exe -w new new-tab --title "ms-pal - 502ed8c" --startingDirectory C:\\src\\ms-pal agency copilot --resume=${primarySessionId}`,
  );
});

test("parseCliArguments parses recover-sessions flags and rejects invalid forms", () => {
  assert.deepEqual(parseCliArguments(["recover-sessions"]), {
    name: "recover-sessions",
    options: {
      dryRun: false,
      yes: false,
    },
  });

  assert.deepEqual(
    parseCliArguments(["recover-sessions", "--profile", "agency", "--dry-run", "--yes"]),
    {
      name: "recover-sessions",
      options: {
        dryRun: true,
        yes: true,
        profile: "agency",
      },
    },
  );

  assert.throws(
    () => parseCliArguments(["recover-sessions", "--yes", "--yes"]),
    /Duplicate option: --yes/,
  );
  assert.throws(
    () => parseCliArguments(["recover-sessions", "--profile"]),
    /Option --profile requires a value/,
  );
  assert.throws(
    () => parseCliArguments(["recover-sessions", "--wat"]),
    /Unknown option: --wat/,
  );
});

test("dry run prints the plan and never starts wt.exe", async (t) => {
  const deps = await createRecoverTestDependencies(t);

  const result = await expectRegistryUnchanged(
    deps.paths.registryFile,
    () =>
      recoverSessionsCommand(
        { dryRun: true, yes: false },
        deps,
      ),
  );

  assert.equal(result, 0);
  assert.equal(deps.processCalls.length, 0);
  assert.match(deps.outputCapture.text(), /Recoverable sessions:/);
  assert.match(deps.outputCapture.text(), /Skipped sessions:/);
  assert.match(deps.outputCapture.text(), /ms-pal/);
  assert.match(
    deps.outputCapture.text(),
    /wt\.exe -w new new-tab --title "ms-pal - 502ed8c"/,
  );
});

test("an empty registry prints no recoverable sessions and exits zero", async (t) => {
  const deps = await createRecoverTestDependencies(t, {
    registry: createSessionRegistry({}),
  });

  assert.equal(
    await expectRegistryUnchanged(deps.paths.registryFile, () =>
      recoverSessionsCommand({ dryRun: false, yes: false }, deps),
    ),
    0,
  );
  assert.equal(deps.processCalls.length, 0);
  assert.equal(deps.outputCapture.prompts.length, 0);
  assert.match(deps.outputCapture.text(), /No recoverable sessions\./);
});

test("a declined confirmation does not mutate profiles or launch", async (t) => {
  const deps = await createRecoverTestDependencies(t, {
    confirm: async () => false,
  });

  assert.equal(
    await expectRegistryUnchanged(deps.paths.registryFile, () =>
      recoverSessionsCommand({ dryRun: false, yes: false }, deps),
    ),
    0,
  );
  assert.equal(deps.processCalls.length, 0);
  assert.equal(deps.outputCapture.prompts.length, 1);
  assert.match(deps.outputCapture.text(), /Recovery cancelled\./);
});

test("missing wt.exe leaves the registry unchanged and returns one", async (t) => {
  const deps = await createRecoverTestDependencies(t, {
    commandExists: async (executable) => executable !== "wt.exe",
  });

  assert.equal(
    await expectRegistryUnchanged(deps.paths.registryFile, () =>
      recoverSessionsCommand({ dryRun: false, yes: true }, deps),
    ),
    1,
  );
  assert.equal(deps.processCalls.length, 0);
  assert.equal(deps.outputCapture.text(), "");
  assert.match(deps.outputCapture.errorText(), /wt\.exe/);
});

test("confirmation persists profile overrides before launching once", async (t) => {
  const deps = await createRecoverTestDependencies(t, {
    confirm: async () => true,
  });

  assert.equal(
    await recoverSessionsCommand(
      { dryRun: false, yes: false, profile: "agency" },
      deps,
    ),
    0,
  );
  assert.equal(deps.registryWrites.length, 1);
  assert.equal(deps.processCalls.length, 1);
  assert.equal(deps.processCalls[0]?.executable, "wt.exe");
  assert.deepEqual(deps.processCalls[0]?.args, [
    "-w",
    "new",
    "new-tab",
    "--title",
    "ms-pal - 502ed8c",
    "--startingDirectory",
    "C:\\src\\ms-pal",
    "agency",
    "copilot",
    `--resume=${primarySessionId}`,
  ]);

  const persisted = await deps.readRegistry();
  assert.equal(
    persisted.sessions[primarySessionId]?.launcherProfile,
    "agency",
  );
  assert.equal(
    persisted.sessions[skippedSessionId]?.launcherProfile,
    "copilot",
  );
});

test("nonzero Windows Terminal exits return one and print stderr", async (t) => {
  const deps = await createRecoverTestDependencies(t, {
    runProcess: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "launch failed\r\n",
    }),
  });

  assert.equal(
    await recoverSessionsCommand({ dryRun: false, yes: true }, deps),
    1,
  );
  assert.equal(deps.processCalls.length, 1);
  assert.match(deps.outputCapture.errorText(), /^launch failed$/m);
});

test("main wires recover-sessions through the recovery command", async (t) => {
  const deps = await createRecoverTestDependencies(t);

  assert.equal(
    await main(["recover-sessions", "--dry-run"], {
      paths: deps.paths,
      output: deps.output,
      directoryExists: deps.directoryExists,
      commandExists: deps.commandExists,
      runProcess: deps.runProcess,
    }),
    0,
  );
  assert.equal(deps.processCalls.length, 0);
  assert.match(deps.outputCapture.text(), /Recoverable sessions:/);
});
