import { readFile } from "node:fs/promises";

import { atomicWriteJson } from "../storage/atomic-json.ts";

export const CONFIG_SCHEMA_VERSION = 1 as const;

const ALLOWED_PLACEHOLDERS = new Set([
  "sessionId",
  "cwd",
  "sessionIdPrefix",
]);

const CONFIG_KEYS = ["schemaVersion", "defaultProfile", "profiles"] as const;
const PROFILE_KEYS = ["executable", "args"] as const;

export interface LauncherProfile {
  executable: string;
  args: string[];
}

export interface AppConfig {
  schemaVersion: typeof CONFIG_SCHEMA_VERSION;
  defaultProfile: string;
  profiles: Record<string, LauncherProfile>;
}

function objectValue(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function assertOnlyKeys(
  input: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string,
): void {
  for (const key of Object.keys(input)) {
    if (!allowedKeys.includes(key)) {
      throw new Error(`${label} contains an unexpected field "${key}".`);
    }
  }
}

function validateArgument(argument: unknown, label: string): string {
  const value = nonEmptyString(argument, label);
  const tokens = [...value.matchAll(/\{([^{}]+)\}/g)];

  for (const token of tokens) {
    if (!ALLOWED_PLACEHOLDERS.has(token[1]!)) {
      throw new Error(`${label} contains unknown placeholder {${token[1]}}.`);
    }
  }

  const withoutTokens = value.replace(/\{([^{}]+)\}/g, "");
  if (withoutTokens.includes("{") || withoutTokens.includes("}")) {
    throw new Error(`${label} contains malformed placeholder syntax.`);
  }

  return value;
}

function parseProfile(name: string, value: unknown): LauncherProfile {
  const profile = objectValue(value, `Profile ${name}`);
  assertOnlyKeys(profile, PROFILE_KEYS, `Profile ${name}`);

  const executable = nonEmptyString(
    profile.executable,
    `Profile ${name} executable`,
  );

  if (!Array.isArray(profile.args) || profile.args.length === 0) {
    throw new Error(`Profile ${name} args must be a non-empty array.`);
  }

  return {
    executable,
    args: profile.args.map((argument, index) =>
      validateArgument(argument, `Profile ${name} argument ${index}`),
    ),
  };
}

export function defaultConfig(): AppConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaultProfile: "copilot",
    profiles: {
      copilot: {
        executable: "copilot",
        args: ["--resume={sessionId}"],
      },
      agency: {
        executable: "agency",
        args: ["copilot", "--resume={sessionId}"],
      },
    },
  };
}

export function parseConfig(value: unknown): AppConfig {
  const input = objectValue(value, "Configuration");
  assertOnlyKeys(input, CONFIG_KEYS, "Configuration");

  if (input.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(
      `Configuration schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`,
    );
  }

  const defaultProfile = nonEmptyString(
    input.defaultProfile,
    "defaultProfile",
  );
  const rawProfiles = objectValue(input.profiles, "profiles");
  const profiles: Record<string, LauncherProfile> = {};

  for (const [name, profileValue] of Object.entries(rawProfiles)) {
    profiles[nonEmptyString(name, "Profile name")] = parseProfile(
      name,
      profileValue,
    );
  }

  if (!profiles[defaultProfile]) {
    throw new Error(`Default profile ${defaultProfile} does not exist.`);
  }

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    defaultProfile,
    profiles,
  };
}

export async function loadConfig(filePath: string): Promise<AppConfig> {
  const text = await readFile(filePath, "utf8");
  return parseConfig(JSON.parse(text));
}

export async function saveConfig(
  filePath: string,
  config: AppConfig,
): Promise<void> {
  await atomicWriteJson(filePath, parseConfig(config));
}
