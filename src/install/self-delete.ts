import { spawn, type SpawnOptions } from "node:child_process";

export interface SelfDeleteRequest {
  parentPid: number;
  installedExecutable: string;
  appDir: string;
  purge: boolean;
}

interface SelfDeleteSpawnOptions extends SpawnOptions {
  windowsHide: true;
  stdio: "ignore";
  shell: false;
  env: NodeJS.ProcessEnv;
}

export interface SelfDeleteInvocation {
  executable: "cmd.exe";
  args: [
    "/d",
    "/s",
    "/c",
    "start",
    "",
    "/b",
    "powershell.exe",
    "-NoProfile",
    "-NonInteractive",
    "-EncodedCommand",
    string,
  ];
  options: SelfDeleteSpawnOptions;
}

const CLEANUP_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
Wait-Process -Id ([int]$env:COPILOT_SESSION_RECOVERY_PARENT_PID)
if ($env:COPILOT_SESSION_RECOVERY_PURGE -eq '1') {
  Remove-Item -LiteralPath $env:COPILOT_SESSION_RECOVERY_APP_DIR -Recurse -Force
} else {
  Remove-Item -LiteralPath $env:COPILOT_SESSION_RECOVERY_INSTALLED_EXE -Force
}
`;

export function buildSelfDeleteInvocation(
  request: SelfDeleteRequest,
  baseEnv: NodeJS.ProcessEnv = process.env,
): SelfDeleteInvocation {
  const encodedScript = Buffer.from(CLEANUP_SCRIPT, "utf16le").toString("base64");

  return {
    executable: "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      "start",
      "",
      "/b",
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      encodedScript,
    ],
    options: {
      windowsHide: true,
      stdio: "ignore",
      shell: false,
      env: {
        ...baseEnv,
        COPILOT_SESSION_RECOVERY_PARENT_PID: String(request.parentPid),
        COPILOT_SESSION_RECOVERY_INSTALLED_EXE: request.installedExecutable,
        COPILOT_SESSION_RECOVERY_APP_DIR: request.appDir,
        COPILOT_SESSION_RECOVERY_PURGE: request.purge ? "1" : "0",
      },
    },
  };
}

export function scheduleSelfDelete(request: SelfDeleteRequest): void {
  const invocation = buildSelfDeleteInvocation(request);
  spawn(
    invocation.executable,
    invocation.args,
    invocation.options,
  );
}
