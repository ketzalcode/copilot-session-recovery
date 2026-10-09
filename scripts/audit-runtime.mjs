import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const supportedOs = ["win32", "darwin"];
const forbiddenLifecycleScripts = [
  "preinstall",
  "install",
  "postinstall",
  "preuninstall",
  "uninstall",
  "postuninstall",
];
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

function assertPackageMetadata(packageJson) {
  if (packageJson.private === true) {
    throw new Error("package.json must remain publishable.");
  }

  if (
    packageJson.dependencies &&
    Object.keys(packageJson.dependencies).length > 0
  ) {
    throw new Error("Runtime dependencies are not allowed in V1.");
  }

  if (packageJson.engines?.node !== ">=24") {
    throw new Error('package.json engines.node must be ">=24".');
  }

  if (
    !Array.isArray(packageJson.os) ||
    packageJson.os.length !== supportedOs.length ||
    supportedOs.some((value, index) => packageJson.os[index] !== value)
  ) {
    throw new Error(
      `package.json os must be exactly ${JSON.stringify(supportedOs)}.`,
    );
  }

  for (const script of forbiddenLifecycleScripts) {
    if (typeof packageJson.scripts?.[script] === "string") {
      throw new Error(`npm lifecycle script "${script}" is not allowed.`);
    }
  }
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
assertPackageMetadata(packageJson);

for (const file of await sourceFiles("src")) {
  const text = await readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(text)) {
      throw new Error(`Forbidden network API ${pattern} found in ${file}.`);
    }
  }
}
