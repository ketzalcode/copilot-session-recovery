import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface SpawnOptions {
  env?: NodeJS.ProcessEnv;
}

function runNode(
  argv: readonly string[],
  options: SpawnOptions = {},
): Promise<CommandResult> {
  return runCommand(process.execPath, argv, options);
}

async function runNpm(
  argv: readonly string[],
  options: SpawnOptions = {},
): Promise<CommandResult> {
  const command = await resolveNpmCommand();
  return runCommand(command.executable, [...command.args, ...argv], options);
}

function runCommand(
  command: string,
  argv: readonly string[],
  options: SpawnOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...argv], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      ...options,
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
  });
}

async function resolveNpmCommand(): Promise<{
  executable: string;
  args: string[];
}> {
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

  throw new Error("Could not resolve npm-cli.js for packaging tests.");
}

test("package metadata defines the public npm distribution contract", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.equal(packageJson.name, "copilot-session-recovery");
  assert.equal(packageJson.version, "0.1.0");
  assert.equal(packageJson.private, undefined);
  assert.equal(
    packageJson.description,
    "Recover GitHub Copilot CLI sessions after an unexpected restart.",
  );
  assert.equal(packageJson.license, "MIT");
  assert.deepEqual(packageJson.repository, {
    type: "git",
    url: "git+https://github.com/ketzalcode/copilot-session-recovery.git",
  });
  assert.deepEqual(packageJson.bugs, {
    url: "https://github.com/ketzalcode/copilot-session-recovery/issues",
  });
  assert.equal(
    packageJson.homepage,
    "https://github.com/ketzalcode/copilot-session-recovery#readme",
  );
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.engines.node, ">=24");
  assert.deepEqual(packageJson.os, ["win32", "darwin"]);
  assert.deepEqual(packageJson.bin, {
    "copilot-session-recovery": "dist/copilot-session-recovery.mjs",
  });
  assert.deepEqual(packageJson.files, [
    "dist/copilot-session-recovery.mjs",
    "dist/copilot-session-recovery.mjs.map",
    "README.md",
    "LICENSE",
  ]);
  assert.deepEqual(packageJson.publishConfig, {
    access: "public",
    provenance: true,
  });
  assert.deepEqual(packageJson.scripts, {
    test: "node scripts/test.mjs",
    "test:coverage": "node scripts/test.mjs --coverage",
    typecheck: "tsc --noEmit",
    "audit:runtime": "node scripts/audit-runtime.mjs",
    build: "node scripts/build.mjs",
    "smoke:package": "node scripts/smoke-package.mjs",
    prepack: "npm run build",
    verify:
      "npm run typecheck && npm test && npm run audit:runtime && npm run build && npm run smoke:package",
  });
});

test("runtime audit passes the current source tree", async () => {
  const result = await runNode(["scripts/audit-runtime.mjs"]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("build script produces the bundled npm CLI entry and source map", async () => {
  let result = await runNode(["scripts/build.mjs"]);
  assert.equal(result.code, 0, result.stderr);

  const distFiles = (await readdir("dist")).sort();
  assert.deepEqual(distFiles, [
    "copilot-session-recovery.mjs",
    "copilot-session-recovery.mjs.map",
  ]);

  const bundle = await readFile("dist/copilot-session-recovery.mjs", "utf8");
  assert.match(bundle, /^#!\/usr\/bin\/env node\r?\n/u);

  result = await runNode(["dist/copilot-session-recovery.mjs", "--version"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "0.1.0\n");
  assert.equal(result.stderr, "");
});

test("npm pack dry-run includes only the publish whitelist and npm metadata", async () => {
  const result = await runNpm(["pack", "--json", "--dry-run"]);
  assert.equal(result.code, 0, result.stderr);

  const [summary] = JSON.parse(result.stdout) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;

  assert.equal(summary?.filename, "copilot-session-recovery-0.1.0.tgz");

  const packedFiles = summary?.files.map((entry) => entry.path).sort();
  assert.deepEqual(packedFiles, [
    "LICENSE",
    "README.md",
    "dist/copilot-session-recovery.mjs",
    "dist/copilot-session-recovery.mjs.map",
    "package.json",
  ]);
});

test("smoke package ignores hostile ambient npm pack config", async () => {
  const distPath = path.resolve("dist");
  const distBackupPath = path.resolve(".dist-smoke-package-backup");
  const packDestination = await mkdtemp(
    path.join(process.cwd(), ".pack-destination-"),
  );

  await rm(distBackupPath, { recursive: true, force: true });
  await rename(distPath, distBackupPath);

  try {
    const result = await runNode(["scripts/smoke-package.mjs"], {
      env: {
        ...process.env,
        npm_config_ignore_scripts: "true",
        npm_config_pack_destination: packDestination,
      },
    });

    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stderr, "");

    const packFiles = await readdir(packDestination);
    assert.deepEqual(packFiles, []);
  } finally {
    await rm(distPath, { recursive: true, force: true });
    await rename(distBackupPath, distPath);
    await rm(packDestination, { recursive: true, force: true });
  }
});
