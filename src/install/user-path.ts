import {
  runProcess,
  type ProcessRunner,
  type ProcessSpec,
} from "../launch/process-runner.ts";

const ADD_USER_PATH_SCRIPT = String.raw`
$target = $env:COPILOT_SESSION_RECOVERY_BIN_DIR
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $current) { $current = '' }
$parts = @($current -split ';' | Where-Object { $_ })
$comparison = [StringComparer]::OrdinalIgnoreCase
if (-not ($parts | Where-Object { $comparison.Equals($_.TrimEnd('\'), $target.TrimEnd('\')) })) {
  $next = (($parts + $target) -join ';')
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
}
`;

const REMOVE_USER_PATH_SCRIPT = String.raw`
$target = $env:COPILOT_SESSION_RECOVERY_BIN_DIR
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
if ($null -eq $current) { $current = '' }
$parts = @($current -split ';' | Where-Object { $_ })
$comparison = [StringComparer]::OrdinalIgnoreCase
$targetNormalized = $target.TrimEnd('\')
$nextParts = @($parts | Where-Object { -not $comparison.Equals($_.TrimEnd('\'), $targetNormalized) })
$next = ($nextParts -join ';')
[Environment]::SetEnvironmentVariable('Path', $next, 'User')
`;

function buildPowerShellSpec(binDir: string, script: string): ProcessSpec {
  return {
    executable: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    env: {
      ...process.env,
      COPILOT_SESSION_RECOVERY_BIN_DIR: binDir,
    },
  };
}

function processFailureMessage(
  action: string,
  exitCode: number,
  stderr: string,
  stdout: string,
): string {
  const detail = stderr.trim() || stdout.trim() || `exit code ${exitCode}`;
  return `${action} failed: ${detail}`;
}

async function runUserPathScript(
  action: string,
  binDir: string,
  script: string,
  runner: ProcessRunner,
): Promise<void> {
  const result = await runner(buildPowerShellSpec(binDir, script));
  if (result.exitCode !== 0) {
    throw new Error(
      processFailureMessage(action, result.exitCode, result.stderr, result.stdout),
    );
  }
}

export async function ensureUserPathEntry(
  binDir: string,
  runner: ProcessRunner = runProcess,
): Promise<void> {
  await runUserPathScript(
    "Adding current-user PATH entry",
    binDir,
    ADD_USER_PATH_SCRIPT,
    runner,
  );
}

export async function removeUserPathEntry(
  binDir: string,
  runner: ProcessRunner = runProcess,
): Promise<void> {
  await runUserPathScript(
    "Removing current-user PATH entry",
    binDir,
    REMOVE_USER_PATH_SCRIPT,
    runner,
  );
}
