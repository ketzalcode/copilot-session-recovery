import { access, constants } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { main } from "../../src/cli/main.ts";
import { createMacTerminalLauncherWithDependencies } from "../../src/launch/macos-terminal.ts";
import { resolveAppPaths } from "../../src/storage/paths.ts";

function pathEntries(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function candidateExecutables(executable: string, env: NodeJS.ProcessEnv): string[] {
  const extension = path.extname(executable);
  const base = extension.length > 0
    ? executable.slice(0, -extension.length)
    : executable;
  const pathExt = pathEntries(env.PATHEXT);
  const candidates = new Set<string>([executable]);

  if (!path.win32.isAbsolute(executable) && !/[\\/]/.test(executable)) {
    candidates.add(base);
    for (const value of pathExt) {
      candidates.add(`${base}${value}`);
    }
  }

  return [...candidates];
}

async function fakeCommandExists(
  executable: string,
  env: NodeJS.ProcessEnv,
): Promise<boolean> {
  if (path.isAbsolute(executable)) {
    try {
      await access(
        executable,
        process.platform === "win32"
          ? constants.F_OK
          : constants.F_OK | constants.X_OK,
      );
      return true;
    } catch {
      return false;
    }
  }

  for (const directory of pathEntries(env.PATH ?? env.Path)) {
    for (const candidate of candidateExecutables(executable, env)) {
      try {
        await access(
          path.join(directory, candidate),
          process.platform === "win32"
            ? constants.F_OK
            : constants.F_OK | constants.X_OK,
        );
        return true;
      } catch {
        // Keep searching the fake PATH.
      }
    }
  }

  return false;
}

async function fakeRunProcess(
  fakeCommandPath: string,
  spec: {
    executable: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fakeCommandPath, ...spec.args], {
      cwd: spec.cwd,
      env: {
        ...process.env,
        ...spec.env,
        COPILOT_SESSION_RECOVERY_FAKE_NAME: spec.executable,
      },
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";

    child.once("error", reject);
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

const fakeCommandPath = process.env.COPILOT_SESSION_RECOVERY_FAKE_COMMAND_PATH;
const fakeCommandOverrides =
  fakeCommandPath === undefined
    ? {}
    : {
        commandExists(executable: string) {
          return fakeCommandExists(executable, process.env);
        },
        runProcess(spec: {
          executable: string;
          args: string[];
          cwd?: string;
          env?: NodeJS.ProcessEnv;
        }) {
          return fakeRunProcess(fakeCommandPath, spec);
        },
      };

const terminal =
  fakeCommandPath !== undefined && process.platform === "darwin"
    ? createMacTerminalLauncherWithDependencies(
        resolveAppPaths({
          platform: "darwin",
          env: process.env,
        }),
        fakeCommandOverrides,
      )
    : undefined;

process.exitCode = await main(
  process.argv.slice(2),
  {
    ...fakeCommandOverrides,
    ...(terminal === undefined ? {} : { terminal }),
  },
);
