import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

async function findTests(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findTests(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }
  return files;
}

const tests = (await findTests("test")).sort();
const coverage = process.argv.includes("--coverage")
  ? ["--experimental-test-coverage"]
  : [];

const child = spawn(process.execPath, [
  ...coverage,
  "--test",
  "--test-concurrency=1",
  "--test-isolation=none",
  ...tests,
], {
  stdio: "inherit",
  shell: false,
});
child.once("error", (error) => {
  throw error;
});
child.once("close", (code) => {
  process.exitCode = code ?? 1;
});
