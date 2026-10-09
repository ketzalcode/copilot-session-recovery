import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAppPaths, type AppPaths } from "../../src/storage/paths.ts";

export type FixturePlatform = "win32" | "darwin";

interface PlatformFixtureOptions {
  platform?: FixturePlatform;
  baseEnv?: NodeJS.ProcessEnv;
}

interface PlatformFixtureEnvironment {
  platform: FixturePlatform;
  env: NodeJS.ProcessEnv;
  paths: AppPaths;
  requiredDirectories: string[];
}

const PLATFORM_ENV_KEYS = [
  ["ComSpec"],
  ["Path", "PATH"],
  ["PATHEXT"],
  ["SystemRoot", "SYSTEMROOT"],
  ["TEMP"],
  ["TMP"],
  ["WINDIR"],
] as const;

function currentFixturePlatform(): FixturePlatform {
  if (process.platform === "win32" || process.platform === "darwin") {
    return process.platform;
  }

  throw new Error(`Unsupported fixture platform: ${process.platform}.`);
}

function copyPlatformEnvironment(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};

  for (const aliases of PLATFORM_ENV_KEYS) {
    for (const name of aliases) {
      const value = baseEnv[name];
      if (typeof value === "string" && value.length > 0) {
        env[name] = value;
        break;
      }
    }
  }

  return env;
}

export function createPlatformFixtureEnvironment(
  root: string,
  options: PlatformFixtureOptions = {},
): PlatformFixtureEnvironment {
  const platform = options.platform ?? currentFixturePlatform();
  const env = copyPlatformEnvironment(options.baseEnv ?? process.env);
  const platformPath = platform === "win32" ? path.win32 : path.posix;
  const copilotHome = platformPath.join(root, "CopilotHome");
  const requiredDirectories = [copilotHome];

  env.COPILOT_HOME = copilotHome;

  if (platform === "win32") {
    const localAppData = platformPath.join(root, "AppData", "Local");
    const userProfile = platformPath.join(root, "UserProfile");
    env.LOCALAPPDATA = localAppData;
    env.USERPROFILE = userProfile;
    requiredDirectories.push(localAppData, userProfile);
  } else {
    const home = platformPath.join(root, "Home");
    env.HOME = home;
    requiredDirectories.push(home);
  }

  return {
    platform,
    env,
    paths: resolveAppPaths({ platform, env }),
    requiredDirectories,
  };
}

export function prependFixturePath(
  env: NodeJS.ProcessEnv,
  directory: string,
  delimiter = path.delimiter,
): void {
  const currentPath = env.PATH ?? env.Path ?? "";
  env.PATH = [directory, currentPath]
    .filter((entry) => entry.length > 0)
    .join(delimiter);
  delete env.Path;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export async function createNativeCommandShim(
  binDirectory: string,
  name: string,
  fakeCommandPath: string,
  platform: FixturePlatform = currentFixturePlatform(),
): Promise<string> {
  await mkdir(binDirectory, { recursive: true });

  if (platform === "win32") {
    const shimPath = path.join(binDirectory, `${name}.cmd`);
    await writeFile(
      shimPath,
      [
        "@echo off",
        `set COPILOT_SESSION_RECOVERY_FAKE_NAME=${name}`,
        `"${process.execPath}" "${fakeCommandPath}" %*`,
        "",
      ].join("\r\n"),
      "utf8",
    );
    return shimPath;
  }

  const shimPath = path.join(binDirectory, name);
  await writeFile(
    shimPath,
    [
      "#!/bin/sh",
      `export COPILOT_SESSION_RECOVERY_FAKE_NAME=${shellSingleQuote(name)}`,
      `exec ${shellSingleQuote(process.execPath)} ${shellSingleQuote(fakeCommandPath)} "$@"`,
      "",
    ].join("\n"),
    "utf8",
  );
  await chmod(shimPath, 0o755);
  return shimPath;
}
