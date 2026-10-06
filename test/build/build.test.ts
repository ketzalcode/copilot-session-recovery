import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runNode(argv: readonly string[]): Promise<CommandResult> {
  return runCommand(process.execPath, argv);
}

function runCommand(
  command: string,
  argv: readonly string[],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...argv], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
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
  });
}

test("source CLI entry point runs the exported main function", async () => {
  const result = await runNode(["src/cli/main.ts", "--version"]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "0.1.0-dev\n");
  assert.equal(result.stderr, "");
});

test("SEA configuration points at the bundled ESM entry", async () => {
  const config = JSON.parse(await readFile("sea-config.json", "utf8"));
  assert.deepEqual(config, {
    main: "dist/copilot-auto-save.mjs",
    mainFormat: "module",
    output: "dist/copilot-auto-save-windows-x64.exe",
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    useVfs: false,
  });
});

test("package scripts run the full release verification pipeline", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));

  assert.deepEqual(packageJson.scripts, {
    test: "node scripts/test.mjs",
    "test:coverage": "node scripts/test.mjs --coverage",
    typecheck: "tsc --noEmit",
    "audit:runtime": "node scripts/audit-runtime.mjs",
    build: "node scripts/build.mjs",
    checksum: "node scripts/checksum.mjs",
    "smoke:sea": "node scripts/smoke-sea.mjs",
    verify:
      "npm run typecheck && npm test && npm run audit:runtime && npm run build && npm run checksum && npm run smoke:sea",
  });
});

test("runtime audit passes the current source tree", async () => {
  const result = await runNode(["scripts/audit-runtime.mjs"]);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("build script produces an executable that runs the bundled CLI", async () => {
  let result = await runNode(["scripts/build.mjs"]);
  assert.equal(result.code, 0, result.stderr);

  result = await runCommand("dist/copilot-auto-save-windows-x64.exe", [
    "--version",
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, "0.1.0\n");
  assert.equal(result.stderr, "");
});
