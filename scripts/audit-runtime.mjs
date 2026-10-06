import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const forbidden = [
  /\bfrom\s+["']node:(?:http|https|net|tls|dgram|dns)["']/,
  /\bimport\s*\(\s*["']node:(?:http|https|net|tls|dgram|dns)["']\s*\)/,
  /\bfetch\s*\(/,
  /\bnew\s+WebSocket\s*\(/,
];

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (
  packageJson.dependencies &&
  Object.keys(packageJson.dependencies).length > 0
) {
  throw new Error("Runtime dependencies are not allowed in V1.");
}

for (const file of await sourceFiles("src")) {
  const text = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      throw new Error(`Forbidden network API ${pattern} found in ${file}.`);
    }
  }
}
