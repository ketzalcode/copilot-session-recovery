import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export function assertReleaseVersion(tag, version) {
  if (tag !== `v${version}`) {
    throw new Error(
      `Release tag ${tag} does not match package version v${version}.`,
    );
  }
}

async function readPackageVersion() {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  if (
    typeof packageJson.version !== "string" ||
    packageJson.version.length === 0
  ) {
    throw new Error("package.json version must be a non-empty string.");
  }

  return packageJson.version;
}

export async function main(argv = process.argv.slice(2)) {
  const [tag] = argv;

  if (typeof tag !== "string" || tag.length === 0) {
    throw new Error("Expected the pushed release tag as the only argument.");
  }

  assertReleaseVersion(tag, await readPackageVersion());
}

const scriptPath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

if (scriptPath === invokedPath) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
