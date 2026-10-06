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

export async function commandExists(
  executable: string,
  runner: ProcessRunner = runProcess,
): Promise<boolean> {
  if (path.win32.isAbsolute(executable) || /[\\/]/.test(executable)) {
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

  const result = await runner({
    executable: "where.exe",
    args: [executable],
  }).catch(() => undefined);

  return result?.exitCode === 0;
}
