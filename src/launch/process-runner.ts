import { spawn } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import path from "node:path";

export interface ProcessSpec {
  executable: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ProcessRunner = (spec: ProcessSpec) => Promise<ProcessResult>;

export const runProcess: ProcessRunner = async (spec) =>
  new Promise((resolve, reject) => {
    const child = spawn(spec.executable, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      shell: false,
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });

function defaultCommandPlatform(): "win32" | "darwin" {
  return process.platform === "darwin" ? "darwin" : "win32";
}

function isPathLikeExecutable(
  executable: string,
  platform: "win32" | "darwin",
): boolean {
  if (platform === "win32") {
    return path.win32.isAbsolute(executable) || /[\\/]/.test(executable);
  }

  return path.posix.isAbsolute(executable) || /[\\/]/.test(executable);
}

export function commandExists(
  executable: string,
  platform: "win32" | "darwin",
  runner?: ProcessRunner,
): Promise<boolean>;
export async function commandExists(
  executable: string,
  runner?: ProcessRunner,
): Promise<boolean>;
export async function commandExists(
  executable: string,
  platformOrRunner: "win32" | "darwin" | ProcessRunner = defaultCommandPlatform(),
  runner: ProcessRunner = runProcess,
): Promise<boolean> {
  const platform =
    typeof platformOrRunner === "function"
      ? defaultCommandPlatform()
      : platformOrRunner;
  const processRunner =
    typeof platformOrRunner === "function" ? platformOrRunner : runner;

  if (isPathLikeExecutable(executable, platform)) {
    try {
      const details = await stat(executable);
      if (!details.isFile()) {
        return false;
      }

      await access(executable, constants.X_OK);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" ||
          error.code === "EACCES" ||
          error.code === "EPERM")
      ) {
        return false;
      }

      throw error;
    }
  }

  const lookup =
    platform === "win32"
      ? { executable: "where.exe", args: [executable] }
      : { executable: "/usr/bin/which", args: [executable] };

  const result = await processRunner(lookup).catch(() => undefined);

  return result?.exitCode === 0;
}
