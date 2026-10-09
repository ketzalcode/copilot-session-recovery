import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { defaultConfig, parseConfig, saveConfig } from "../../src/config/config.ts";
import { resolveAppPaths, type AppPaths } from "../../src/storage/paths.ts";
import type { SessionRegistry } from "../../src/session/model.ts";
import {
  createNativeCommandShim,
  createPlatformFixtureEnvironment,
  prependFixturePath,
  type FixturePlatform,
} from "../fixtures/platform-fixture.ts";

const workerPath = fileURLToPath(
  new URL("../fixtures/hook-worker.ts", import.meta.url),
);
const fakeCommandPath = fileURLToPath(
  new URL("../fixtures/fake-command.ts", import.meta.url),
);
const sessionA = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const sessionB = "95d2d9b1-0e6a-48c1-afd6-8a7598128f43";
const sessionC = "7a2ed8ce-7934-4bf7-913d-73dbf8c128f8";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function sessionPrefix(sessionId: string): string {
  return sessionId.replaceAll("-", "").slice(0, 7);
}

function requireCwd(
  cwdBySession: Record<string, string>,
  sessionId: string,
): string {
  const cwd = cwdBySession[sessionId];
  if (cwd === undefined) {
    throw new Error(`Missing working directory fixture for ${sessionId}.`);
  }

  return cwd;
}

function runCli(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, ...argv], {
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.once("error", reject);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code) => {
      resolve({ code, stdout, stderr });
    });

    if (input !== undefined) {
      child.stdin.end(input, "utf8");
    } else {
      child.stdin.end();
    }
  });
}

async function fakeLogExists(logFile: string): Promise<boolean> {
  try {
    await access(logFile, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readFakeLog(logFile: string): Promise<
  Array<{ executable?: string; argv: string[]; cwd: string }>
> {
  const text = await readFile(logFile, "utf8");
  return text
    .trim()
    .split(/\r?\n/u)
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { executable?: string; argv: string[]; cwd: string });
}

function splitWindowsTerminalTabs(argv: readonly string[]): string[][] {
  assert.equal(argv.at(0), "-w");
  assert.equal(argv.at(1), "new");

  const segments: string[][] = [];
  let current: string[] = [];

  for (const argument of argv.slice(2)) {
    if (argument === ";") {
      segments.push(current);
      current = [];
      continue;
    }

    current.push(argument);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

function expectedRecoveryTab(
  cwdBySession: Record<string, string>,
  sessionId: string,
): string[] {
  const cwd = cwdBySession[sessionId];
  if (cwd === undefined) {
    throw new Error(`Missing working directory for ${sessionId}.`);
  }

  return [
    "new-tab",
    "--title",
    `${path.basename(cwd)} - ${sessionPrefix(sessionId)}`,
    "--startingDirectory",
    cwd,
    "agency",
    "copilot",
    `--resume=${sessionId}`,
  ];
}

async function createEndToEndFixture(
  t: test.TestContext,
): Promise<{
  env: NodeJS.ProcessEnv;
  platform: FixturePlatform;
  paths: AppPaths;
  fakeLogFile: string;
  cwdBySession: Record<string, string>;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "copilot-session-recovery-e2e-"));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fakeBin = path.join(root, "fake-bin");
  const fakeLogFile = path.join(root, "fake-commands.log");
  const sessionRoot = path.join(root, "sessions");
  const platformFixture = createPlatformFixtureEnvironment(root);
  const { env, paths, platform } = platformFixture;
  env.COPILOT_SESSION_RECOVERY_FAKE_LOG = fakeLogFile;
  env.COPILOT_SESSION_RECOVERY_FAKE_COMMAND_PATH = fakeCommandPath;
  prependFixturePath(env, fakeBin);

  assert.deepEqual(paths, resolveAppPaths({ platform, env }));
  await Promise.all(
    platformFixture.requiredDirectories.map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );
  await mkdir(paths.appDir, { recursive: true });
  await mkdir(path.dirname(paths.copilotHookFile), { recursive: true });
  await mkdir(sessionRoot, { recursive: true });
  await Promise.all(
    [
      ...(platform === "win32" ? ["wt"] : []),
      "copilot",
      "agency",
    ].map((name) =>
      createNativeCommandShim(fakeBin, name, fakeCommandPath, platform),
    ),
  );

  await saveConfig(
    paths.configFile,
    parseConfig({
      ...defaultConfig(),
      defaultProfile: "agency",
    }),
  );

  const cwdBySession = {
    [sessionA]: path.join(sessionRoot, "alpha"),
    [sessionB]: path.join(sessionRoot, "beta"),
    [sessionC]: path.join(sessionRoot, "gamma"),
  };
  await Promise.all(
    Object.values(cwdBySession).map((cwd) => mkdir(cwd, { recursive: true })),
  );

  return {
    env,
    platform,
    paths,
    fakeLogFile,
    cwdBySession,
  };
}

function sessionStartPayload(
  sessionId: string,
  cwd: string,
  timestamp: number,
): string {
  return JSON.stringify({
    sessionId,
    timestamp,
    cwd,
    source: "resume",
  });
}

function sessionEndPayload(
  sessionId: string,
  cwd: string,
  timestamp: number,
  reason: "user_exit" | "error" | "complete",
): string {
  return JSON.stringify({
    sessionId,
    timestamp,
    cwd,
    reason,
  });
}

test("source CLI preserves only recoverable sessions and launches Agency recovery safely", async (t) => {
  const fixture = await createEndToEndFixture(t);
  const startTime = Date.parse("2026-10-05T18:00:00.000Z");

  for (const [offset, sessionId] of [sessionA, sessionB, sessionC].entries()) {
    const result = await runCli(
      ["hook", "session-start"],
      fixture.env,
      sessionStartPayload(
        sessionId,
        requireCwd(fixture.cwdBySession, sessionId),
        startTime + offset * 1_000,
      ),
    );

    assert.equal(result.code, 0);
    assert.equal(result.stdout, "{}\n");
    assert.equal(result.stderr, "");
  }

  let result = await runCli(
    ["hook", "session-end"],
    fixture.env,
    sessionEndPayload(
      sessionA,
      requireCwd(fixture.cwdBySession, sessionA),
      startTime + 10_000,
      "user_exit",
    ),
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");

  result = await runCli(
    ["hook", "session-end"],
    fixture.env,
    sessionEndPayload(
      sessionB,
      requireCwd(fixture.cwdBySession, sessionB),
      startTime + 11_000,
      "error",
    ),
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");

  result = await runCli(["list"], fixture.env);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Recoverable sessions:/);
  assert.match(result.stdout, new RegExp(sessionPrefix(sessionB)));
  assert.match(result.stdout, new RegExp(sessionPrefix(sessionC)));
  assert.doesNotMatch(result.stdout, new RegExp(sessionPrefix(sessionA)));
  assert.equal(result.stderr, "");

  result = await runCli(
    ["recover-sessions", "--dry-run", "--profile", "agency"],
    fixture.env,
  );
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Dry run command:/);
  assert.match(result.stdout, new RegExp(`agency copilot --resume=${sessionB}`));
  assert.match(result.stdout, new RegExp(`agency copilot --resume=${sessionC}`));
  if (fixture.platform === "win32") {
    assert.equal(await fakeLogExists(fixture.fakeLogFile), false);
  } else {
    const dryRunInvocations = await readFakeLog(fixture.fakeLogFile);
    assert.deepEqual(dryRunInvocations.map((entry) => entry.executable), [
      "/usr/bin/open",
    ]);
    await rm(fixture.fakeLogFile, { force: true });
  }
  assert.equal(result.stderr, "");

  result = await runCli(
    ["recover-sessions", "--yes", "--profile", "agency"],
    fixture.env,
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout.includes("Dry run command:"), false);
  assert.equal(result.stderr, "");

  const registryBeforeRecovery = JSON.parse(
    await readFile(fixture.paths.registryFile, "utf8"),
  ) as SessionRegistry;

  result = await runCli(["list"], fixture.env);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Recoverable sessions:/);
  assert.match(result.stdout, new RegExp(sessionPrefix(sessionB)));
  assert.match(result.stdout, new RegExp(sessionPrefix(sessionC)));
  assert.doesNotMatch(result.stdout, new RegExp(sessionPrefix(sessionA)));
  assert.equal(result.stderr, "");

  const registryAfterRecovery = JSON.parse(
    await readFile(fixture.paths.registryFile, "utf8"),
  ) as SessionRegistry;
  assert.deepEqual(registryAfterRecovery, registryBeforeRecovery);

  const invocations = await readFakeLog(fixture.fakeLogFile);
  if (fixture.platform === "win32") {
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0]?.executable, "wt.exe");
    const recoveryTabs = splitWindowsTerminalTabs(invocations[0]?.argv ?? []);
    assert.deepEqual(recoveryTabs, [
      expectedRecoveryTab(fixture.cwdBySession, sessionB),
      expectedRecoveryTab(fixture.cwdBySession, sessionC),
    ]);
  } else {
    assert.deepEqual(invocations.map((entry) => entry.executable), [
      "/usr/bin/open",
      "/usr/bin/osascript",
    ]);
    assert.equal(invocations[1]?.argv.at(-1), "2");
    assert.doesNotMatch(
      invocations[1]?.argv[1] ?? "",
      new RegExp(`${sessionB}|${sessionC}|${requireCwd(fixture.cwdBySession, sessionB)}`),
    );

    const launchPlan = JSON.parse(
      await readFile(fixture.paths.launchPlanFile, "utf8"),
    ) as {
      entries: Array<{
        cwd: string;
        process: { executable: string; args: string[] };
        status: string;
      }>;
    };
    assert.deepEqual(
      launchPlan.entries.map((entry) => ({
        cwd: entry.cwd,
        process: entry.process,
        status: entry.status,
      })),
      [sessionB, sessionC].map((sessionId) => ({
        cwd: requireCwd(fixture.cwdBySession, sessionId),
        process: {
          executable: "agency",
          args: ["copilot", `--resume=${sessionId}`],
        },
        status: "pending",
      })),
    );
  }

  result = await runCli(
    ["hook", "session-end"],
    fixture.env,
    sessionEndPayload(
      sessionB,
      requireCwd(fixture.cwdBySession, sessionB),
      startTime + 12_000,
      "complete",
    ),
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");

  result = await runCli(
    ["hook", "session-end"],
    fixture.env,
    sessionEndPayload(
      sessionC,
      requireCwd(fixture.cwdBySession, sessionC),
      startTime + 13_000,
      "complete",
    ),
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "{}\n");
  assert.equal(result.stderr, "");

  result = await runCli(["list"], fixture.env);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "No recoverable sessions.\n");
  assert.equal(result.stderr, "");
});
