import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";

const executable = path.resolve("dist/copilot-session-recovery-windows-x64.exe");
const sessionA = "502ed8ca-ce22-4e92-b6a7-34eaec25c59d";
const sessionB = "95d2d9b1-0e6a-48c1-afd6-8a7598128f43";

function pathEntries(value) {
  return (value ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function fileExists(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function directoryExists(directory) {
  try {
    const details = await stat(directory);
    return details.isDirectory();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function filteredPath(fakeCommandDir) {
  const entries = pathEntries(process.env.Path ?? process.env.PATH);
  const kept = [];

  for (const entry of entries) {
    const normalized = entry.toLowerCase();
    if (normalized.includes("\\nodejs") || normalized.includes("\\nvm")) {
      continue;
    }

    if (await fileExists(path.join(entry, "node.exe"))) {
      continue;
    }

    kept.push(entry);
  }

  return [fakeCommandDir, ...kept].join(path.delimiter);
}

function run(command, args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
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

    if (input === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(input, "utf8");
    }
  });
}

async function waitFor(predicate, description) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250);
    });
  }

  throw new Error(`Timed out waiting for ${description}.`);
}

function sessionStartPayload(sessionId, cwd, timestamp) {
  return JSON.stringify({
    sessionId,
    timestamp,
    cwd,
    source: "resume",
  });
}

function appPaths(localAppData, userProfile, copilotHome) {
  const appDir = path.win32.join(localAppData, "copilot-session-recovery");

  return {
    appDir,
    configFile: path.win32.join(appDir, "config.json"),
    registryFile: path.win32.join(appDir, "sessions.json"),
    copilotHookFile: path.win32.join(
      copilotHome,
      "hooks",
      "copilot-session-recovery.json",
    ),
  };
}

async function assertExists(filePath) {
  await access(filePath, constants.F_OK);
}

async function assertAbsent(filePath) {
  assert.equal(await fileExists(filePath), false, `${filePath} should be absent`);
}

await assertExists(executable);

const root = await mkdtemp(
  path.join(os.tmpdir(), "copilot-session-recovery-sea-"),
);
const fakeCommandDir = path.join(root, "fake-bin");
const localAppData = path.join(root, "AppData", "Local");
const userProfile = path.join(root, "UserProfile");
const copilotHome = path.join(root, "CopilotHome");
const sessionRoot = path.join(root, "sessions");
const paths = appPaths(localAppData, userProfile, copilotHome);

try {
  await mkdir(fakeCommandDir, { recursive: true });
  await mkdir(userProfile, { recursive: true });
  await mkdir(copilotHome, { recursive: true });
  await mkdir(sessionRoot, { recursive: true });
  await writeFile(path.join(fakeCommandDir, "wt.exe"), "", "utf8");
  await writeFile(path.join(fakeCommandDir, "agency.exe"), "", "utf8");

  const childEnv = {
    ComSpec: process.env.ComSpec,
    PATHEXT: process.env.PATHEXT,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    WINDIR: process.env.WINDIR,
    LOCALAPPDATA: localAppData,
    USERPROFILE: userProfile,
    COPILOT_HOME: copilotHome,
    Path: await filteredPath(fakeCommandDir),
  };

  const nodeLookup = await run("where.exe", ["node"], childEnv);
  assert.notEqual(nodeLookup.code, 0, "node must be absent from child PATH");

  let result = await run(executable, ["--version"], childEnv);
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "0.1.0\n");
  assert.equal(result.stderr, "");

  result = await run(executable, ["install", "--profile", "agency"], childEnv);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Configured copilot-session-recovery/);

  await assertExists(paths.configFile);
  await assertExists(paths.registryFile);
  await assertExists(paths.copilotHookFile);

  const config = JSON.parse(await readFile(paths.configFile, "utf8"));
  assert.equal(config.defaultProfile, "agency");
  const registry = JSON.parse(await readFile(paths.registryFile, "utf8"));
  assert.deepEqual(registry.sessions, {});
  const hook = JSON.parse(await readFile(paths.copilotHookFile, "utf8"));
  assert.equal(hook.hooks.sessionStart[0].exec, executable);
  assert.deepEqual(hook.hooks.sessionStart[0].args, [
    executable,
    "hook",
    "session-start",
  ]);

  const cwdA = path.join(sessionRoot, "alpha");
  const cwdB = path.join(sessionRoot, "beta");
  await mkdir(cwdA, { recursive: true });
  await mkdir(cwdB, { recursive: true });

  result = await run(
    executable,
    ["hook", "session-start"],
    childEnv,
    sessionStartPayload(sessionA, cwdA, 1_812_379_200_000),
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "{}\n");

  result = await run(
    executable,
    ["hook", "session-start"],
    childEnv,
    sessionStartPayload(sessionB, cwdB, 1_812_379_201_000),
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "{}\n");

  result = await run(
    executable,
    ["recover-sessions", "--dry-run", "--profile", "agency"],
    childEnv,
  );
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(`agency copilot --resume=${sessionA}`));
  assert.match(result.stdout, new RegExp(`agency copilot --resume=${sessionB}`));

  result = await run(executable, ["uninstall"], childEnv);
  assert.equal(result.code, 0, result.stderr);
  await assertExists(paths.configFile);
  await assertExists(paths.registryFile);
  await assertAbsent(paths.copilotHookFile);

  result = await run(executable, ["install", "--profile", "agency"], childEnv);
  assert.equal(result.code, 0, result.stderr);
  result = await run(executable, ["uninstall", "--purge"], childEnv);
  assert.equal(result.code, 0, result.stderr);
  await waitFor(
    async () => !(await directoryExists(paths.appDir)),
    "application directory purge",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
