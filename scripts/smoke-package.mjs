import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const packageName = packageJson.name;
const expectedPackFiles = [
  "LICENSE",
  "README.md",
  "dist/copilot-session-recovery.mjs",
  "dist/copilot-session-recovery.mjs.map",
  "package.json",
];

function pathEnvKey(env = process.env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ??
    (process.platform === "win32" ? "Path" : "PATH");
}

function applyEnvOverrides(baseEnv, overrides) {
  const managedKeys = new Set(
    Object.keys(overrides).map((key) => key.toLowerCase()),
  );
  const sanitized = Object.fromEntries(
    Object.entries(baseEnv).filter(
      ([key]) => !managedKeys.has(key.toLowerCase()),
    ),
  );

  return {
    ...sanitized,
    ...overrides,
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...options,
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
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

async function resolveNpmCommand() {
  if (
    typeof process.env.npm_execpath === "string" &&
    process.env.npm_execpath.length > 0
  ) {
    return {
      executable: process.execPath,
      args: [process.env.npm_execpath],
    };
  }

  const execDirectory = path.dirname(process.execPath);
  const candidates = [
    path.join(execDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(execDirectory, "..", "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(
      execDirectory,
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.F_OK);
      return {
        executable: process.execPath,
        args: [candidate],
      };
    } catch {
      continue;
    }
  }

  throw new Error("Could not resolve npm-cli.js for smoke packaging.");
}

async function runNpm(args, options = {}) {
  const command = await resolveNpmCommand();
  return runCommand(command.executable, [...command.args, ...args], options);
}

function normalizePath(filePath) {
  return path.normalize(filePath);
}

function expectedCliEntry(prefix) {
  return process.platform === "win32"
    ? path.join(
        prefix,
        "node_modules",
        packageName,
        "dist",
        "copilot-session-recovery.mjs",
      )
    : path.join(
        prefix,
        "lib",
        "node_modules",
        packageName,
        "dist",
        "copilot-session-recovery.mjs",
      );
}

function createNpmEnv(prefix) {
  const pathKey = pathEnvKey();
  const originalPath =
    process.env[pathKey] ??
    process.env.PATH ??
    process.env.Path ??
    "";

  return applyEnvOverrides(process.env, {
    [pathKey]: [
      path.dirname(process.execPath),
      originalPath,
    ].filter((value) => value.length > 0).join(path.delimiter),
    npm_config_audit: "false",
    npm_config_cache: path.join(prefix, "npm-cache"),
    npm_config_fund: "false",
    npm_config_prefix: prefix,
    npm_config_update_notifier: "false",
  });
}

async function createInstallEnv(prefix) {
  const env = createNpmEnv(prefix);

  if (process.platform === "win32") {
    const localAppData = path.join(prefix, "LocalAppData");
    const userProfile = path.join(prefix, "UserProfile");
    const copilotHome = path.join(prefix, "CopilotHome");

    await mkdir(localAppData, { recursive: true });
    await mkdir(userProfile, { recursive: true });
    await mkdir(copilotHome, { recursive: true });

    return {
      env: {
        ...env,
        LOCALAPPDATA: localAppData,
        USERPROFILE: userProfile,
        COPILOT_HOME: copilotHome,
      },
      paths: {
        appDir: path.join(localAppData, "copilot-session-recovery"),
        configFile: path.join(localAppData, "copilot-session-recovery", "config.json"),
        registryFile: path.join(localAppData, "copilot-session-recovery", "sessions.json"),
        copilotHookFile: path.join(
          copilotHome,
          "hooks",
          "copilot-session-recovery.json",
        ),
      },
    };
  }

  const home = path.join(prefix, "Home");
  const copilotHome = path.join(prefix, "CopilotHome");

  await mkdir(home, { recursive: true });
  await mkdir(copilotHome, { recursive: true });

  return {
    env: {
      ...env,
      HOME: home,
      COPILOT_HOME: copilotHome,
    },
    paths: {
      appDir: path.join(
        home,
        "Library",
        "Application Support",
        "copilot-session-recovery",
      ),
      configFile: path.join(
        home,
        "Library",
        "Application Support",
        "copilot-session-recovery",
        "config.json",
      ),
      registryFile: path.join(
        home,
        "Library",
        "Application Support",
        "copilot-session-recovery",
        "sessions.json",
      ),
      copilotHookFile: path.join(
        copilotHome,
        "hooks",
        "copilot-session-recovery.json",
      ),
    },
  };
}

function installedShim(prefix) {
  if (process.platform === "win32") {
    return {
      executable: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(prefix, `${packageName}.ps1`),
      ],
      filePath: path.join(prefix, `${packageName}.ps1`),
    };
  }

  return {
    executable: path.join(prefix, "bin", packageName),
    args: [],
    filePath: path.join(prefix, "bin", packageName),
  };
}

async function runInstalledCli(prefix, args, env) {
  const shim = installedShim(prefix);
  return runCommand(shim.executable, [...shim.args, ...args], { env });
}

async function assertFileExists(filePath) {
  await access(filePath, constants.F_OK);
}

async function assertPathMissing(filePath) {
  try {
    await stat(filePath);
    throw new Error(`${filePath} should be absent.`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

function assertHookCommand(command, expectedNodePath, expectedEntry, event) {
  assert.equal(command.type, "command");
  assert.equal(normalizePath(command.exec), normalizePath(expectedNodePath));
  assert.deepEqual(command.args, [expectedEntry, "hook", event]);
  assert.equal(command.timeoutSec, 5);
  assert.equal(path.isAbsolute(command.exec), true);
  assert.equal(path.isAbsolute(command.args[0]), true);
}

let tarballPath;
const prefix = await mkdtemp(path.join(process.cwd(), ".smoke-package-prefix-"));

try {
  const packResult = await runNpm(["pack", "--json"]);
  assert.equal(packResult.code, 0, packResult.stderr);

  const [packSummary] = JSON.parse(packResult.stdout);
  assert.equal(packSummary?.filename, `${packageName}-${packageJson.version}.tgz`);

  const packedFiles = packSummary?.files.map((entry) => entry.path).sort();
  assert.deepEqual(packedFiles, expectedPackFiles);

  tarballPath = path.resolve(packSummary.filename);

  const installEnv = await createInstallEnv(prefix);
  const npmEnv = createNpmEnv(prefix);
  const prefixCheck = await runNpm(["prefix", "--global"], { env: npmEnv });
  assert.equal(prefixCheck.code, 0, prefixCheck.stderr);
  assert.equal(normalizePath(prefixCheck.stdout.trim()), normalizePath(prefix));

  const installed = await runNpm(
    ["install", "--global", tarballPath],
    { env: npmEnv },
  );
  assert.equal(installed.code, 0, installed.stderr);

  await assertFileExists(installedShim(prefix).filePath);
  await assertFileExists(expectedCliEntry(prefix));

  let result = await runInstalledCli(prefix, ["--version"], installEnv.env);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageJson.version);
  assert.equal(result.stderr, "");

  result = await runInstalledCli(prefix, ["--help"], installEnv.env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Usage: copilot-session-recovery/u);
  assert.equal(result.stderr, "");

  result = await runInstalledCli(prefix, ["install"], installEnv.env);
  assert.equal(result.code, 0, result.stderr);
  assert.match(
    result.stdout,
    /Configured copilot-session-recovery for the current npm installation\./u,
  );

  await assertFileExists(installEnv.paths.configFile);
  await assertFileExists(installEnv.paths.registryFile);
  await assertFileExists(installEnv.paths.copilotHookFile);

  const hookConfig = JSON.parse(
    await readFile(installEnv.paths.copilotHookFile, "utf8"),
  );
  const installedEntry = normalizePath(expectedCliEntry(prefix));

  assertHookCommand(
    hookConfig.hooks.sessionStart[0],
    process.execPath,
    installedEntry,
    "session-start",
  );
  assertHookCommand(
    hookConfig.hooks.sessionEnd[0],
    process.execPath,
    installedEntry,
    "session-end",
  );

  result = await runInstalledCli(prefix, ["uninstall", "--purge"], installEnv.env);
  assert.equal(result.code, 0, result.stderr);
  await assertPathMissing(installEnv.paths.copilotHookFile);
  await assertPathMissing(installEnv.paths.appDir);
} finally {
  await rm(prefix, { recursive: true, force: true });
  if (tarballPath !== undefined) {
    await rm(tarballPath, { force: true });
  }
}
