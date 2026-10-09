import { createMacosPlatformAdapter } from "./macos.ts";
import { createWindowsPlatformAdapter } from "./windows.ts";

import type { AppPaths } from "../storage/paths.ts";

export type SupportedPlatform =
  | { platform: "win32"; arch: "x64" }
  | { platform: "darwin"; arch: "x64" | "arm64" };

export interface PlatformAdapter {
  readonly id: "windows" | "macos";
  readonly terminalName: "Windows Terminal" | "Apple Terminal";
  resolvePaths(env: NodeJS.ProcessEnv): AppPaths;
  protectState(paths: AppPaths): Promise<ProtectionResult>;
  checkStateProtection(paths: AppPaths): Promise<ProtectionResult>;
  terminalAvailable(): Promise<boolean>;
}

export interface ProtectionResult {
  protected: boolean;
  detail: string;
}

export function assertSupportedPlatform(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): SupportedPlatform {
  if (platform === "win32" && arch === "x64") {
    return { platform, arch };
  }

  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) {
    return { platform, arch };
  }

  throw new Error(`Unsupported platform: ${platform} ${arch}.`);
}

export function createPlatformAdapter(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  env?: NodeJS.ProcessEnv,
): PlatformAdapter {
  const supported = assertSupportedPlatform(platform, arch);
  const adapter =
    supported.platform === "win32"
      ? createWindowsPlatformAdapter()
      : createMacosPlatformAdapter();

  if (env !== undefined) {
    adapter.resolvePaths(env);
  }

  return adapter;
}
