# npm-Only Cross-Platform Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Windows SEA release with a dependency-free npm CLI that installs official Copilot hooks and recovers sessions through Windows Terminal or Apple Terminal.

**Architecture:** Preserve the shared lifecycle, registry, locking, configuration, and recovery-plan core. Introduce an explicit platform adapter for paths, permissions, diagnostics, and terminal launch; use a locked launch-plan broker so AppleScript never contains session or profile data.

**Tech Stack:** TypeScript 7, Node.js 24+, esbuild, npm, Node test runner, PowerShell, AppleScript through `osascript`, GitHub Actions, npm trusted publishing

**Spec:** `docs/superpowers/specs/2026-10-08-npm-cross-platform-distribution-design.md`

## Global Constraints

- Distribution is the public, unscoped npm package `copilot-session-recovery`.
- Require Node.js 24 or newer.
- Support only Windows x64 and macOS x64/arm64.
- Keep runtime `dependencies` empty or absent.
- Keep runtime behavior offline, telemetry-free, and limited to official Copilot lifecycle-hook metadata.
- Never read, parse, store, infer, or depend on private Copilot state, prompts, responses, tool output, credentials, tokens, or source content.
- Use structured process arguments. Never interpolate session IDs, working directories, executables, or profile arguments into shell or AppleScript text.
- `npm install --global copilot-session-recovery` installs the runtime; `copilot-session-recovery install` explicitly configures local state and hooks.
- Reject `install` when the package entrypoint is under npm's transient `_npx` cache.
- Remove all SEA, EXE, self-copy, self-delete, checksum, executable PATH-management, and binary release behavior.
- Preserve the existing registry and configuration schemas.
- Use test-driven development for every source behavior change and observe the focused test fail before implementation.
- Keep the pinned GitHub Actions versions already used by the repository unless a design change separately approves updates.
- Do not publish, tag, push, create a GitHub Release, or perform the manual first npm publication during implementation.

---

## File Map

### Platform contract

- Create `src/platform/platform.ts`: supported platform/architecture validation and the shared `PlatformAdapter` interface.
- Create `src/platform/windows.ts`: Windows paths, ACL bridge, Windows Terminal availability and launch.
- Create `src/platform/macos.ts`: macOS paths, POSIX protection, Apple Terminal availability and launch.
- Modify `src/storage/paths.ts`: retain only shared `AppPaths` construction from an adapter-provided application and Copilot home.
- Modify `src/launch/process-runner.ts`: make command lookup platform-aware without a shell.
- Rename `src/install/acl.ts` to `src/platform/windows-permissions.ts`.
- Create `src/platform/macos-permissions.ts`.
- Delete `src/install/user-path.ts`.
- Test in `test/platform/*.test.ts`, `test/storage/paths.test.ts`, and `test/launch/process-runner.test.ts`.

### npm setup and diagnostics

- Create `src/runtime/installation.ts`: resolve and validate the installed Node executable and bundled CLI entrypoint.
- Modify `src/install/copilot-hooks.ts`: write hooks as absolute Node plus bundled-entry argument arrays.
- Rewrite `src/install/installer.ts`: configure state and hooks only; remove runtime copying and PATH mutation.
- Delete `src/install/self-delete.ts`.
- Modify `src/install/diagnostics.ts`: inspect runtime entrypoint, hook identity, platform protection, and terminal.
- Modify `src/cli/main.ts`: construct and inject the platform adapter and runtime identity.
- Test in `test/runtime/installation.test.ts`, `test/install/copilot-hooks.test.ts`, `test/install/installer.test.ts`, `test/install/diagnostics.test.ts`, and `test/cli/main.test.ts`.

### Cross-platform recovery

- Create `src/launch/terminal.ts`: platform-neutral terminal launcher contract.
- Keep `src/launch/windows-terminal.ts`: Windows implementation behind that contract.
- Create `src/launch/launch-plan.ts`: validated plan schema and locked claim/complete/fail transitions.
- Create `src/launch/macos-terminal.ts`: constant AppleScript and `osascript` invocation.
- Create `src/launch/launch-next.ts`: claim one launch entry and spawn it with inherited terminal I/O.
- Modify `src/cli/arguments.ts`: parse the internal `launch-next` command.
- Modify `src/cli/commands.ts`: call the injected terminal adapter and implement the broker command.
- Modify `src/cli/main.ts`: route `launch-next`.
- Extend `src/storage/paths.ts`: add launch plan and launch-plan lock paths.
- Test in `test/launch/launch-plan.test.ts`, `test/launch/macos-terminal.test.ts`, `test/launch/launch-next.test.ts`, `test/cli/recover.test.ts`, and `test/cli/main.test.ts`.

### npm package and release

- Rewrite `scripts/build.mjs`: emit only the bundled ESM CLI and source map.
- Create `scripts/smoke-package.mjs`: pack, inspect, temporary-prefix install, command smoke, setup, and teardown.
- Delete `scripts/checksum.mjs` and `scripts/smoke-sea.mjs`.
- Delete `sea-config.json`.
- Modify `scripts/audit-runtime.mjs`: retain no-dependency/network checks and include generated package contract checks where appropriate.
- Modify `package.json` and regenerate `package-lock.json`.
- Rewrite `test/build/build.test.ts`.
- Modify `.github/workflows/ci.yml` and `.github/workflows/release.yml`.

### Documentation

- Modify `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/architecture.md`, `docs/security.md`, `docs/troubleshooting.md`, and `.github/ISSUE_TEMPLATE/bug.yml`.
- Preserve older specs/plans as historical records; final legacy searches explicitly exclude `docs/superpowers`.

---

### Task 1: Establish the supported-platform and path contract

**Files:**
- Create: `src/platform/platform.ts`
- Create: `src/platform/windows.ts`
- Create: `src/platform/macos.ts`
- Modify: `src/storage/paths.ts`
- Modify: `test/storage/paths.test.ts`
- Create: `test/platform/platform.test.ts`

**Interfaces:**
- Produces:

```ts
export type SupportedPlatform =
  | { platform: "win32"; arch: "x64" }
  | { platform: "darwin"; arch: "x64" | "arm64" };

export interface PlatformAdapter {
  readonly id: "windows" | "macos";
  readonly terminalName: "Windows Terminal" | "Apple Terminal";
  resolvePaths(env: NodeJS.ProcessEnv): AppPaths;
}

export function assertSupportedPlatform(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): SupportedPlatform;

export function createPlatformAdapter(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
  env?: NodeJS.ProcessEnv,
): PlatformAdapter;
```

- Produces `AppPaths` without `binDir` or `installedExecutable`, and with:

```ts
launchPlanFile: string;
launchPlanLockFile: string;
```

- Consumes no later-task interfaces. Task 2 extends this interface with
  protection and terminal-availability behavior; Task 5 adds terminal launch.

- [ ] **Step 1: Write failing platform and path tests**

Add exact support-matrix assertions:

```ts
assert.deepEqual(assertSupportedPlatform("win32", "x64"), {
  platform: "win32",
  arch: "x64",
});
assert.deepEqual(assertSupportedPlatform("darwin", "arm64"), {
  platform: "darwin",
  arch: "arm64",
});
assert.throws(
  () => assertSupportedPlatform("win32", "arm64"),
  /Unsupported platform: win32 arm64/,
);
assert.throws(
  () => assertSupportedPlatform("linux", "x64"),
  /Unsupported platform: linux x64/,
);
```

Update path tests to call:

```ts
const windows = resolveAppPaths({
  platform: "win32",
  env: {
    LOCALAPPDATA: "C:\\Users\\ruben\\AppData\\Local",
    USERPROFILE: "C:\\Users\\ruben",
  },
});

const macos = resolveAppPaths({
  platform: "darwin",
  env: { HOME: "/Users/ruben" },
});
```

Assert these exact roots and plan files:

```ts
assert.equal(
  windows.appDir,
  "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery",
);
assert.equal(
  macos.appDir,
  "/Users/ruben/Library/Application Support/copilot-session-recovery",
);
assert.equal(
  macos.copilotHookFile,
  "/Users/ruben/.copilot/hooks/copilot-session-recovery.json",
);
assert.equal(
  macos.launchPlanFile,
  "/Users/ruben/Library/Application Support/copilot-session-recovery/launch-plan.json",
);
```

Cover `COPILOT_HOME` on both platforms and missing required environment values.

- [ ] **Step 2: Run the focused tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/platform/platform.test.ts `
  test/storage/paths.test.ts
```

Expected: FAIL because `src/platform/*` and the platform-aware path API do not
exist.

- [ ] **Step 3: Implement support validation and path resolution**

Implement the support matrix with no implicit fallback:

```ts
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
```

Make `resolveAppPaths` a discriminated platform operation. Use `path.win32`
only for Windows and `path.posix` only for macOS. Require `LOCALAPPDATA` and
`USERPROFILE` on Windows; require `HOME` on macOS. In both cases derive:

```ts
configFile
registryFile
lockFile
diagnosticsDir
corruptDir
copilotHookFile
launchPlanFile
launchPlanLockFile
```

Create adapter factories with the exact IDs, terminal names, and path resolver
in the interface. Do not add placeholder permission or launch methods; later
tasks extend the contract only when they provide real implementations.

- [ ] **Step 4: Run focused tests and type checking**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/platform/platform.test.ts `
  test/storage/paths.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the platform contract**

```powershell
git add src/platform src/storage/paths.ts test/platform test/storage/paths.test.ts
git diff --cached --check
git commit -m "refactor: add cross-platform runtime contract" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Add platform-aware command discovery and state protection

**Files:**
- Modify: `src/launch/process-runner.ts`
- Move: `src/install/acl.ts` to `src/platform/windows-permissions.ts`
- Create: `src/platform/macos-permissions.ts`
- Modify: `src/platform/windows.ts`
- Modify: `src/platform/macos.ts`
- Modify: `test/launch/process-runner.test.ts`
- Move: `test/install/acl.test.ts` to `test/platform/windows-permissions.test.ts`
- Create: `test/platform/macos-permissions.test.ts`

**Interfaces:**
- Consumes `PlatformAdapter`, `AppPaths`, `ProcessRunner`, and `ProcessSpec` from Task 1.
- Produces:

```ts
export interface ProtectionResult {
  protected: boolean;
  detail: string;
}

export interface PlatformAdapter {
  readonly id: "windows" | "macos";
  readonly terminalName: "Windows Terminal" | "Apple Terminal";
  resolvePaths(env: NodeJS.ProcessEnv): AppPaths;
  protectState(paths: AppPaths): Promise<ProtectionResult>;
  checkStateProtection(paths: AppPaths): Promise<ProtectionResult>;
  terminalAvailable(): Promise<boolean>;
}

export function commandExists(
  executable: string,
  platform: "win32" | "darwin",
  runner?: ProcessRunner,
): Promise<boolean>;

export function protectMacState(
  paths: AppPaths,
  deps?: MacPermissionDependencies,
): Promise<ProtectionResult>;
```

- [ ] **Step 1: Write failing command-discovery and permission tests**

Keep Windows `where.exe` expectations and add:

```ts
await commandExists("copilot", "darwin", runner);
assert.deepEqual(calls[0], {
  executable: "/usr/bin/which",
  args: ["copilot"],
});
```

Test absolute executables through `stat`/`access` without invoking `which` or
`where.exe`.

For macOS protection, inject filesystem operations and assert:

```ts
assert.deepEqual(chmodCalls, [
  [paths.appDir, 0o700],
  [paths.configFile, 0o600],
  [paths.registryFile, 0o600],
]);
```

Also assert that symlinks, non-owned paths, and post-`chmod` mode mismatches
return `{ protected: false, detail }` and do not claim success.

- [ ] **Step 2: Run focused tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/launch/process-runner.test.ts `
  test/platform/windows-permissions.test.ts `
  test/platform/macos-permissions.test.ts
```

Expected: FAIL on the missing platform argument and macOS protection module.

- [ ] **Step 3: Implement permission adapters and command lookup**

Preserve the structured Windows ACL calls from the moved module:

```ts
{ executable: "whoami.exe", args: ["/user", "/fo", "csv", "/nh"] }
{ executable: "icacls.exe", args: [appDir, "/inheritance:r", ...] }
```

For macOS, use `lstat`, `stat`, and `chmod` from `node:fs/promises`. Compare
`stat.uid` to `process.getuid()` before changing existing paths. Reject symbolic
links. Apply `0700` to directories and `0600` to files that exist, then read
metadata again and require `(mode & 0o777) === expectedMode`.

Make bare-command discovery select exactly:

```ts
const lookup = platform === "win32"
  ? { executable: "where.exe", args: [executable] }
  : { executable: "/usr/bin/which", args: [executable] };
```

Wire each adapter's protection methods to its platform implementation.
Implement `terminalAvailable` with structured probes: Windows calls
`commandExists("wt.exe", "win32")`; macOS requires executable
`/usr/bin/osascript` and runs `{ executable: "/usr/bin/open", args:
["-Ra", "Terminal"] }`, returning true only for exit code 0.

- [ ] **Step 4: Run focused tests and type checking**

Run the Step 2 test command, then:

```powershell
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit platform protection**

```powershell
git add src/launch/process-runner.ts src/platform test/launch/process-runner.test.ts test/platform
git diff --cached --check
git commit -m "feat: protect state across supported platforms" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Replace executable installation with explicit npm setup

**Files:**
- Create: `src/runtime/installation.ts`
- Modify: `src/install/copilot-hooks.ts`
- Rewrite: `src/install/installer.ts`
- Modify: `src/cli/main.ts`
- Delete: `src/install/self-delete.ts`
- Delete: `src/install/user-path.ts`
- Create: `test/runtime/installation.test.ts`
- Modify: `test/install/copilot-hooks.test.ts`
- Rewrite: `test/install/installer.test.ts`
- Delete: `test/install/self-delete.test.ts`
- Delete: `test/install/user-path.test.ts`
- Modify: `test/cli/main.test.ts`

**Interfaces:**
- Consumes `PlatformAdapter` and `AppPaths` from Tasks 1-2.
- Produces:

```ts
export interface RuntimeInstallation {
  nodeExecutable: string;
  cliEntry: string;
}

export function resolveRuntimeInstallation(options?: {
  execPath?: string;
  moduleUrl?: string;
}): RuntimeInstallation;

export function assertPersistentInstallation(
  installation: RuntimeInstallation,
): void;

export function buildCopilotHookConfig(
  installation: RuntimeInstallation,
): CopilotHookConfig;
```

- Changes `CopilotHookCommand.args` to:

```ts
[string, "hook", "session-start" | "session-end"]
```

where the first element is the absolute bundled CLI entry.

- [ ] **Step 1: Write failing runtime and installer contract tests**

Test URL decoding and absolute paths:

```ts
assert.deepEqual(
  resolveRuntimeInstallation({
    execPath: "C:\\Program Files\\nodejs\\node.exe",
    moduleUrl: "file:///C:/npm/node_modules/copilot-session-recovery/dist/copilot-session-recovery.mjs",
  }),
  {
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    cliEntry:
      "C:\\npm\\node_modules\\copilot-session-recovery\\dist\\copilot-session-recovery.mjs",
  },
);
```

Test both Windows and POSIX `_npx` path segments:

```ts
assert.throws(
  () => assertPersistentInstallation({
    nodeExecutable: "/opt/homebrew/bin/node",
    cliEntry: "/Users/ruben/.npm/_npx/abc/node_modules/copilot-session-recovery/dist/copilot-session-recovery.mjs",
  }),
  /npm install --global copilot-session-recovery/,
);
```

Update hook expectations to:

```ts
{
  type: "command",
  exec: installation.nodeExecutable,
  args: [installation.cliEntry, "hook", "session-start"],
  timeoutSec: 5,
}
```

Rewrite installer tests to prove setup:

- creates state directories;
- preserves valid config and registry;
- writes hooks using the runtime installation;
- calls the selected adapter's protection method;
- rejects `_npx` before any filesystem mutation;
- removes only the owned hook on ordinary uninstall;
- removes the application directory only for `uninstall --purge`;
- never copies a runtime or changes PATH.

- [ ] **Step 2: Run focused tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/runtime/installation.test.ts `
  test/install/copilot-hooks.test.ts `
  test/install/installer.test.ts `
  test/cli/main.test.ts
```

Expected: FAIL because hooks still target the copied SEA and installer
dependencies still expose copy/PATH/self-delete operations.

- [ ] **Step 3: Implement npm runtime identity and setup**

Resolve the entry from `import.meta.url` with `fileURLToPath`. Require both
`nodeExecutable` and `cliEntry` to be absolute. Detect transient npm execution
using normalized path segments rather than substring matching:

```ts
const segments = path.normalize(cliEntry).split(/[\\/]+/u);
if (segments.some((segment) => segment.toLowerCase() === "_npx")) {
  throw new Error(
    "Persistent setup cannot run from npx. Run npm install --global copilot-session-recovery, then copilot-session-recovery install.",
  );
}
```

Rewrite installer dependencies around:

```ts
interface InstallerDependencies {
  paths: AppPaths;
  output: CliOutput;
  installation: RuntimeInstallation;
  platform: PlatformAdapter;
  ensureDirectory(path: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
  // Existing config and JSON helpers remain.
}
```

Call `assertPersistentInstallation` before `ensureDirectory`. On uninstall,
remove the owned hook first; on `--purge`, remove `paths.appDir` only after
confirming it is the adapter-resolved application directory.

Delete SEA, copy, PATH, and delayed self-delete imports and modules.

- [ ] **Step 4: Run focused tests and type checking**

Run the Step 2 command, then:

```powershell
npm run typecheck
```

Expected: all commands exit 0 and no import references deleted modules.

- [ ] **Step 5: Commit npm setup**

```powershell
git add src test
git diff --cached --check
git commit -m "refactor: configure hooks from npm installation" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Make diagnostics platform- and npm-aware

**Files:**
- Modify: `src/install/diagnostics.ts`
- Modify: `src/cli/main.ts`
- Rewrite: `test/install/diagnostics.test.ts`

**Interfaces:**
- Consumes `RuntimeInstallation`, `PlatformAdapter`, and the new hook format.
- Replaces diagnostic IDs:

```ts
"runtime" | "copilot-hook" | "configuration" | "registry"
  | "state-protection" | "terminal" | "launcher"
```

- [ ] **Step 1: Write failing diagnostic tests**

Assert the healthy check order above on both a Windows and macOS fixture.
Assert:

- missing `nodeExecutable` reports `runtime` error;
- missing `cliEntry` reports `runtime` error;
- hook JSON targeting moved paths reports a fix to rerun `install`;
- Windows terminal checks `wt.exe`;
- macOS terminal checks `/usr/bin/osascript` and Apple Terminal availability
  through the injected adapter;
- adapter protection failure is a warning with platform-neutral copy;
- launcher lookup receives the current platform.

Use the exact successful summaries:

```text
Installed npm runtime is available.
State directory is current-user protected.
Windows Terminal is available.
Apple Terminal is available.
```

- [ ] **Step 2: Run diagnostics tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none test/install/diagnostics.test.ts
```

Expected: FAIL because diagnostics still require `installedExecutable`, ACL,
and Windows Terminal directly.

- [ ] **Step 3: Implement platform-neutral diagnostics**

Change `DiagnosticDependencies` to contain:

```ts
installation: RuntimeInstallation;
platform: PlatformAdapter;
fileExists(filePath: string): Promise<boolean>;
commandExists(executable: string, platform: "win32" | "darwin"): Promise<boolean>;
```

Compare parsed hook JSON against:

```ts
buildCopilotHookConfig(deps.installation)
```

Use `platform.checkStateProtection(paths)`,
`platform.terminalAvailable()`, and `platform.terminalName`; do not branch on OS
inside diagnostics. Keep registry-repair behavior unchanged.

- [ ] **Step 4: Run focused and adjacent tests**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/install/diagnostics.test.ts `
  test/install/installer.test.ts `
  test/install/copilot-hooks.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit diagnostics**

```powershell
git add src/install/diagnostics.ts src/cli/main.ts test/install/diagnostics.test.ts
git diff --cached --check
git commit -m "refactor: diagnose npm platform installations" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Decouple recovery from Windows Terminal

**Files:**
- Create: `src/launch/terminal.ts`
- Modify: `src/launch/windows-terminal.ts`
- Modify: `src/platform/windows.ts`
- Modify: `src/install/diagnostics.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/format.ts`
- Modify: `test/cli/recover.test.ts`
- Modify: `test/launch/windows-terminal.test.ts`
- Modify: `test/install/diagnostics.test.ts`

**Interfaces:**
- Produces:

```ts
export interface TerminalLauncher {
  readonly name: string;
  readonly command: string;
  available(): Promise<boolean>;
  preview(tabs: readonly RecoveryTab[], paths: AppPaths): string;
  launch(
    tabs: readonly RecoveryTab[],
    paths: AppPaths,
  ): Promise<ProcessResult>;
}
```

- Changes `RecoverDependencies` to consume one `terminal: TerminalLauncher`
  instead of importing Windows launch functions.
- Extends `PlatformAdapter` with `readonly terminal: TerminalLauncher` and
  removes the standalone `terminalAvailable` method by delegating diagnostics
  to `platform.terminal.available()`.

- [ ] **Step 1: Write failing platform-neutral recovery tests**

Replace direct `wt.exe` assumptions in command tests with an injected fake:

```ts
const terminal: TerminalLauncher = {
  name: "Test Terminal",
  command: "test-terminal",
  available: async () => true,
  preview: () => "test-terminal preview",
  launch: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
};
```

Assert:

```text
Test Terminal was not found.
Launch recoverable sessions in Test Terminal?
Dry run command:
test-terminal preview
```

Keep Windows argument-array tests unchanged and add an adapter test proving
Windows delegates to `wt.exe` with `shell: false` through `runProcess`.

- [ ] **Step 2: Run focused recovery tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/cli/recover.test.ts `
  test/launch/windows-terminal.test.ts
```

Expected: FAIL because recovery imports and names Windows Terminal directly.

- [ ] **Step 3: Implement terminal injection**

Move all terminal-specific availability, preview, prompt, launch, and failure
copy behind `TerminalLauncher`. Keep `buildRecoveryPlan` platform-neutral.
Update diagnostics from `platform.terminalAvailable()` to
`platform.terminal.available()` in the same change.
Implement the Windows launcher with:

```ts
{
  name: "Windows Terminal",
  command: "wt.exe",
  available: () => commandExists("wt.exe", "win32"),
  preview: (tabs) => formatDryRunCommand(
    "wt.exe",
    buildWindowsTerminalArgs(tabs),
  ),
  launch: (tabs) => launchWindowsTerminal(tabs),
}
```

Persist profile updates only after confirmation and immediately before calling
the injected launcher, preserving current behavior.

- [ ] **Step 4: Run focused tests and type checking**

Run the Step 2 command, then:

```powershell
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit terminal abstraction**

```powershell
git add src/launch src/platform/windows.ts src/install/diagnostics.ts src/cli test/cli/recover.test.ts test/launch/windows-terminal.test.ts test/install/diagnostics.test.ts
git diff --cached --check
git commit -m "refactor: abstract recovery terminal launch" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Build the locked macOS launch-plan broker

**Files:**
- Create: `src/launch/launch-plan.ts`
- Create: `src/launch/launch-next.ts`
- Create: `test/launch/launch-plan.test.ts`
- Create: `test/launch/launch-next.test.ts`

**Interfaces:**
- Consumes `withFileLock`, `atomicWriteJson`, `AppPaths`, and `ProcessSpec`.
- Produces:

```ts
export interface LaunchPlanEntry {
  id: string;
  cwd: string;
  process: ProcessSpec;
  status: "pending" | "launching" | "launched" | "failed";
  claimToken?: string;
  error?: string;
}

export interface LaunchPlan {
  schemaVersion: 1;
  createdAt: string;
  entries: LaunchPlanEntry[];
}

export function createLaunchPlan(
  paths: AppPaths,
  tabs: readonly RecoveryTab[],
): Promise<void>;

export function claimNextLaunch(
  paths: AppPaths,
): Promise<{ token: string; entry: LaunchPlanEntry } | undefined>;

export function completeLaunch(
  paths: AppPaths,
  token: string,
): Promise<void>;

export function failLaunch(
  paths: AppPaths,
  token: string,
  message: string,
): Promise<void>;

export function launchNext(
  paths: AppPaths,
  spawnAttached?: AttachedSpawner,
): Promise<number>;
```

- [ ] **Step 1: Write failing launch-plan state-machine tests**

Cover:

1. `createLaunchPlan` rejects creation when an existing plan contains
   `pending`, `launching`, or `failed` entries.
2. It writes only `cwd`, structured `ProcessSpec`, generated ID, and status.
3. Concurrent `claimNextLaunch` calls claim different entries under
   `launchPlanLockFile`.
4. `claimNextLaunch` retries `failed` entries after `pending` entries.
5. `completeLaunch` rejects a stale or unknown token.
6. `failLaunch` clears the claim token, records the error, and returns the
   entry to retryable `failed`.
7. Completing the final entry removes the plan.
8. Invalid schema or relative working directories fail without replacement.

For `launchNext`, inject:

```ts
async ({ executable, args, cwd }) => {
  assert.equal(executable, "copilot");
  assert.deepEqual(args, [`--resume=${sessionId}`]);
  assert.equal(cwd, "/Users/ruben/src/project");
}
```

Assert success completes the claim and thrown spawn errors call `failLaunch`
and return exit code 1.

- [ ] **Step 2: Run launch broker tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/launch/launch-plan.test.ts `
  test/launch/launch-next.test.ts
```

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement locked plan transitions**

Use `withFileLock(paths.launchPlanLockFile, async () => ...)` for every read,
claim, completion, failure, and deletion. Parse every disk read as `unknown`
and validate:

- `schemaVersion === 1`;
- ISO `createdAt`;
- unique non-empty entry IDs;
- absolute `cwd`;
- non-empty executable;
- string argument array;
- valid status;
- claim token present only for `launching`.

Never silently replace invalid data. Use `randomUUID()` for entry IDs and claim
tokens. Write transitions with `atomicWriteJson`.

Implement attached spawning directly with `spawn`:

```ts
const child = spawn(entry.process.executable, entry.process.args, {
  cwd: entry.cwd,
  env: entry.process.env,
  shell: false,
  stdio: "inherit",
});
child.once("spawn", () => {
  child.unref();
  resolve();
});
child.once("error", reject);
```

Resolve the spawn promise on the `"spawn"` event, not process exit, so the
broker can mark the claim complete and exit while Copilot retains the Terminal
tab's inherited I/O. Reject on `"error"`.

- [ ] **Step 4: Run broker tests and type checking**

Run the Step 2 command, then:

```powershell
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the launch broker**

```powershell
git add src/launch/launch-plan.ts src/launch/launch-next.ts test/launch/launch-plan.test.ts test/launch/launch-next.test.ts
git diff --cached --check
git commit -m "feat: add secure macOS launch broker" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Launch recovery tabs through Apple Terminal

**Files:**
- Create: `src/launch/macos-terminal.ts`
- Modify: `src/platform/macos.ts`
- Modify: `src/cli/arguments.ts`
- Modify: `src/cli/commands.ts`
- Modify: `src/cli/main.ts`
- Create: `test/launch/macos-terminal.test.ts`
- Modify: `test/cli/recover.test.ts`
- Modify: `test/cli/main.test.ts`

**Interfaces:**
- Consumes the Task 6 launch-plan API and Task 5 `TerminalLauncher`.
- Produces:

```ts
export const LAUNCH_NEXT_COMMAND = "copilot-session-recovery launch-next";

export function buildAppleTerminalScript(): string;

export function createMacTerminalLauncher(
  paths: AppPaths,
  runner?: ProcessRunner,
): TerminalLauncher;
```

- Adds internal parsed command:

```ts
{ name: "launch-next" }
```

- [ ] **Step 1: Write failing Apple Terminal and routing tests**

Assert the generated AppleScript is static and contains only the constant
broker command:

```ts
const script = buildAppleTerminalScript();
assert.match(script, /copilot-session-recovery launch-next/);
assert.doesNotMatch(script, /sessionId|cwd|launcherProfile|--resume=/);
```

Assert the process call has only the static script and tab count:

```ts
assert.deepEqual(calls[0], {
  executable: "/usr/bin/osascript",
  args: ["-e", buildAppleTerminalScript(), "2"],
});
```

Test `recover-sessions` on the macOS fake:

- writes the launch plan before `osascript`;
- uses `Apple Terminal` in confirmation;
- keeps the plan when `osascript` reports Automation denial;
- dry run prints a count and the constant broker command but creates no plan.

Test `parseCliArguments(["launch-next"])`, reject extra arguments, and prove
`main` routes it without exposing it in public help.

- [ ] **Step 2: Run focused macOS tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/launch/macos-terminal.test.ts `
  test/cli/recover.test.ts `
  test/cli/main.test.ts
```

Expected: FAIL because Apple Terminal and `launch-next` routing do not exist.

- [ ] **Step 3: Implement static AppleScript and CLI routing**

The script may use the tab count argument for iteration, but its command text
must remain exactly `copilot-session-recovery launch-next`. Use Apple Terminal's
`do script` command to create the first window when needed and one tab per
remaining entry. Do not concatenate any plan value.

The macOS launch sequence is:

```ts
await createLaunchPlan(paths, tabs);
return runner({
  executable: "/usr/bin/osascript",
  args: ["-e", buildAppleTerminalScript(), String(tabs.length)],
});
```

Map known `osascript` Automation-denial stderr to an actionable message naming
System Settings > Privacy & Security > Automation. Return nonzero and preserve
the plan.

Route `launch-next` before normal interactive command setup. It resolves paths
through the selected adapter, calls `launchNext`, writes spawn failures to
stderr, and returns the broker exit code.

- [ ] **Step 4: Run all launch and CLI tests**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/launch/windows-terminal.test.ts `
  test/launch/macos-terminal.test.ts `
  test/launch/launch-plan.test.ts `
  test/launch/launch-next.test.ts `
  test/cli/recover.test.ts `
  test/cli/main.test.ts
npm run typecheck
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit macOS recovery**

```powershell
git add src/launch/macos-terminal.ts src/platform/macos.ts src/cli test/launch/macos-terminal.test.ts test/cli
git diff --cached --check
git commit -m "feat: recover sessions in Apple Terminal" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Convert the build into a publishable npm package

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Rewrite: `scripts/build.mjs`
- Create: `scripts/smoke-package.mjs`
- Modify: `scripts/audit-runtime.mjs`
- Delete: `scripts/checksum.mjs`
- Delete: `scripts/smoke-sea.mjs`
- Delete: `sea-config.json`
- Rewrite: `test/build/build.test.ts`

**Interfaces:**
- Consumes the complete CLI from Tasks 1-7.
- Produces:

```text
dist/copilot-session-recovery.mjs
dist/copilot-session-recovery.mjs.map
copilot-session-recovery-0.1.0.tgz
```

- [ ] **Step 1: Write failing package contract tests**

Assert exact package metadata:

```ts
assert.equal(packageJson.private, undefined);
assert.equal(packageJson.engines.node, ">=24");
assert.deepEqual(packageJson.os, ["win32", "darwin"]);
assert.deepEqual(packageJson.bin, {
  "copilot-session-recovery": "dist/copilot-session-recovery.mjs",
});
assert.deepEqual(packageJson.files, [
  "dist/copilot-session-recovery.mjs",
  "dist/copilot-session-recovery.mjs.map",
  "README.md",
  "LICENSE",
]);
assert.deepEqual(packageJson.publishConfig, {
  access: "public",
  provenance: true,
});
assert.equal(packageJson.repository.url,
  "git+https://github.com/ketzalcode/copilot-session-recovery.git");
```

Assert scripts:

```ts
{
  test: "node scripts/test.mjs",
  "test:coverage": "node scripts/test.mjs --coverage",
  typecheck: "tsc --noEmit",
  "audit:runtime": "node scripts/audit-runtime.mjs",
  build: "node scripts/build.mjs",
  "smoke:package": "node scripts/smoke-package.mjs",
  prepack: "npm run build",
  verify:
    "npm run typecheck && npm test && npm run audit:runtime && npm run build && npm run smoke:package"
}
```

Build and assert the ESM entry starts with:

```text
#!/usr/bin/env node
```

Use `npm pack --json --dry-run` and assert the tarball file list equals the
whitelist plus npm-required package metadata. Assert there is no `.exe`,
`.blob`, SEA config, checksum, test fixture, source TypeScript, or workflow.

- [ ] **Step 2: Run the package tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none test/build/build.test.ts
```

Expected: FAIL on `private`, missing `bin`, SEA scripts/config, and executable
build behavior.

- [ ] **Step 3: Implement npm metadata and JavaScript-only build**

Set package metadata from Step 1. Add:

```json
"description": "Recover GitHub Copilot CLI sessions after an unexpected restart.",
"license": "MIT",
"repository": {
  "type": "git",
  "url": "git+https://github.com/ketzalcode/copilot-session-recovery.git"
},
"bugs": {
  "url": "https://github.com/ketzalcode/copilot-session-recovery/issues"
},
"homepage": "https://github.com/ketzalcode/copilot-session-recovery#readme"
```

Configure esbuild with `banner: { js: "#!/usr/bin/env node" }`, ESM output,
Node 24 target, external source map, and existing `__APP_VERSION__` injection.
Delete all SEA probing, fuse mutation, resource injection, and executable
copying.

Regenerate the lockfile only through:

```powershell
npm install --package-lock-only --ignore-scripts
```

Implement `smoke-package.mjs` using structured `spawn` calls. It must:

1. run `npm pack --json`;
2. inspect the returned tarball file list;
3. create a temporary npm prefix;
4. run `npm install --global` with the absolute path returned by
   `npm pack --json`;
5. invoke the installed platform shim with `--version` and `--help`;
6. run `install` with isolated platform environment directories;
7. inspect the hook JSON for absolute Node and CLI paths;
8. run `uninstall --purge`;
9. remove only the known temporary prefix and generated tarball in `finally`.

- [ ] **Step 4: Run package verification**

Run:

```powershell
npm run typecheck
npm test
npm run audit:runtime
npm run build
npm run smoke:package
```

Expected: all commands exit 0. `dist` contains only the bundled `.mjs` and map;
the generated `.tgz` is cleaned up.

- [ ] **Step 5: Commit npm packaging**

```powershell
git add package.json package-lock.json scripts test/build sea-config.json
git diff --cached --check
git commit -m "build: replace executable with npm package" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Add Windows/macOS CI and trusted npm release automation

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Create: `scripts/check-release-version.mjs`
- Create: `test/build/release-version.test.ts`

**Interfaces:**
- Consumes `npm run verify` and the npm package from Task 8.
- Produces a tag-gated release workflow that calls `npm publish` through npm
  trusted publishing.

- [ ] **Step 1: Write the failing release-version test**

Extract pure validation:

```ts
export function assertReleaseVersion(tag: string, version: string): void {
  if (tag !== `v${version}`) {
    throw new Error(
      `Release tag ${tag} does not match package version v${version}.`,
    );
  }
}
```

Test exact match, missing `v`, and mismatched versions. Add workflow text
assertions proving:

- CI matrix contains `windows-latest` and `macos-latest`;
- both run `npm run verify`;
- release triggers only on `v*`;
- release permissions are exactly `contents: read` and `id-token: write`;
- release uses `registry-url: https://registry.npmjs.org`;
- release runs the version check and `npm publish`;
- neither workflow mentions `.exe`, checksum, SBOM binary input, GitHub Release
  creation, or artifact upload.

- [ ] **Step 2: Run the release tests and verify the red state**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/build/release-version.test.ts `
  test/build/build.test.ts
```

Expected: FAIL because the validator is absent and workflows remain
Windows/EXE-specific.

- [ ] **Step 3: Implement CI and release workflows**

CI keeps the commit-metadata guard and changes verification to:

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [windows-latest, macos-latest]
runs-on: ${{ matrix.os }}
```

Run the metadata guard self-test and commit-range guard on one matrix member
only, then run `npm ci` and `npm run verify` on both.

Release uses the repository's pinned `actions/checkout` and
`actions/setup-node` versions, a GitHub-hosted runner, and:

```yaml
permissions:
  contents: read
  id-token: write
```

Configure npm registry URL, run `npm ci`, `npm run verify`,
`node scripts/check-release-version.mjs "$env:GITHUB_REF_NAME"` (PowerShell
syntax on Windows), then `npm publish`. Do not pass or read `NPM_TOKEN`;
trusted publishing supplies short-lived OIDC credentials and provenance.

- [ ] **Step 4: Run release tests and YAML-adjacent verification**

Run:

```powershell
node --test --test-concurrency=1 --test-isolation=none `
  test/build/release-version.test.ts `
  test/build/build.test.ts
npm run verify
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit automation**

```powershell
git add .github/workflows scripts/check-release-version.mjs test/build/release-version.test.ts
git diff --cached --check
git commit -m "ci: publish npm package from version tags" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Rewrite public documentation for npm and macOS

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`
- Modify: `AGENTS.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security.md`
- Modify: `docs/troubleshooting.md`
- Modify: `.github/ISSUE_TEMPLATE/bug.yml`

**Interfaces:**
- Documents the final user and contributor contract. Produces no runtime API.

- [ ] **Step 1: Update user installation and platform documentation**

Replace the quick start with:

```powershell
npm install --global copilot-session-recovery
copilot-session-recovery install
```

State Node.js 24+, Windows x64, macOS Intel/Apple Silicon, Windows Terminal,
Apple Terminal Automation permission, and the global-install requirement.
Explain that `npx` is suitable for help/version only and is rejected by
`install`.

Document teardown in this order:

```powershell
copilot-session-recovery uninstall
npm uninstall --global copilot-session-recovery
```

Include `--purge` as the state-removing variant.

- [ ] **Step 2: Update architecture, security, and troubleshooting**

Document:

- platform-specific state paths and permissions;
- absolute Node-plus-entry hook commands;
- static AppleScript and locked launch-plan broker;
- no runtime dependencies/network/telemetry;
- moved-global-install diagnostics and rerunning `install`;
- macOS Automation denial remediation;
- package provenance and trusted publishing;
- temporary-prefix package smoke testing;
- the manual Apple Terminal release check.

Remove SmartScreen, executable checksum, SEA, self-copy, PATH-management, and
binary release instructions.

Update `AGENTS.md` from Windows-only/SEA verification to the exact approved
cross-platform npm constraints and `npm run verify` command.

- [ ] **Step 3: Update issue intake**

Replace Windows Terminal-only fields with:

- operating system and architecture;
- Node and npm versions;
- terminal (`Windows Terminal` or `Apple Terminal`);
- output of `copilot-session-recovery doctor`.

Do not ask users for registry contents, hook payloads, source content, prompts,
responses, credentials, or tokens.

- [ ] **Step 4: Validate documentation**

Run:

```powershell
git --no-pager diff --check
rg -n "windows-x64\.exe|smoke:sea|sea-config|SmartScreen|checksum|self-contained executable" `
  README.md CONTRIBUTING.md AGENTS.md docs .github/ISSUE_TEMPLATE
```

Expected: `diff --check` exits 0. The search returns matches only from
historical files under `docs/superpowers`, not current product documentation.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md CONTRIBUTING.md AGENTS.md docs/architecture.md docs/security.md docs/troubleshooting.md .github/ISSUE_TEMPLATE/bug.yml
git diff --cached --check
git commit -m "docs: document npm cross-platform distribution" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Run final cross-platform and release-readiness verification

**Files:**
- Modify only files required to fix failures caused by Tasks 1-10.
- Do not modify historical files under `docs/superpowers/specs` or
  `docs/superpowers/plans` merely to remove old SEA terminology.

**Interfaces:**
- Verifies the complete package contract; produces no new API.

- [ ] **Step 1: Run the complete Windows verification gate**

Run:

```powershell
npm ci
npm run verify
git --no-pager diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Inspect packed contents and command behavior**

Run:

```powershell
npm pack --json --dry-run
npm run build
node .\dist\copilot-session-recovery.mjs --version
node .\dist\copilot-session-recovery.mjs --help
```

Expected:

- packed contents match the whitelist;
- version is `0.1.0`;
- help shows the public command surface and omits internal `launch-next`;
- no executable or private repository file is packed.

- [ ] **Step 3: Search for prohibited legacy implementation**

Run:

```powershell
rg -n "node:sea|isSea|sea-config|smoke:sea|windows-x64\.exe|scheduleSelfDelete|ensureUserPathEntry|installedExecutable|binDir" `
  src test scripts package.json .github README.md CONTRIBUTING.md AGENTS.md docs/architecture.md docs/security.md docs/troubleshooting.md
```

Expected: no matches. Investigate every match; do not suppress current-source
or current-documentation findings.

- [ ] **Step 4: Verify macOS CI and perform the manual release boundary**

Push no code from this task. Open the branch's GitHub Actions result after an
operator pushes it and require the `macos-latest` `npm run verify` job to pass.

Before the first public release, on a macOS x64 or arm64 machine:

```bash
npm pack
npm install --global ./copilot-session-recovery-0.1.0.tgz
copilot-session-recovery install
copilot-session-recovery doctor
copilot-session-recovery recover-sessions --dry-run
copilot-session-recovery recover-sessions
copilot-session-recovery uninstall --purge
npm uninstall --global copilot-session-recovery
```

Record in the release checklist:

- Apple Terminal displayed the Automation prompt;
- approving it opened one tab per test session;
- each tab resumed the expected session in the expected directory;
- no session/path/profile value appeared in AppleScript source;
- denial produced the documented remediation and retained the plan;
- uninstall removed the owned hook and purge removed application state.

If no macOS operator is available, mark release readiness **blocked** rather
than claiming the product is verified.

- [ ] **Step 5: Review the complete diff**

Run:

```powershell
git --no-pager status --short
git --no-pager diff --stat main...
git --no-pager diff --check main...
git --no-pager log --oneline main..HEAD
```

Expected: only planned npm/cross-platform changes are present, diff checks
pass, and generated `dist`, coverage, `node_modules`, and tarballs are absent
from Git status.

- [ ] **Step 6: Commit only verification-driven fixes**

If Steps 1-5 required source changes, rerun the affected focused test red/green
cycle and then:

```powershell
git add src test scripts package.json package-lock.json .github README.md CONTRIBUTING.md AGENTS.md docs/architecture.md docs/security.md docs/troubleshooting.md
git diff --cached --check
git commit -m "fix: close npm release verification gaps" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

If verification required no changes, do not create an empty commit.

---

## Operator-only publication checklist

These actions are intentionally outside implementation:

1. Confirm `copilot-session-recovery` is available directly on npmjs.com.
2. Authenticate to npm with the intended owner identity and 2FA.
3. Perform the first staged or direct publication from the reviewed package.
4. Configure npm trusted publishing for:
   - owner: `ketzalcode`;
   - repository: `copilot-session-recovery`;
   - workflow: `release.yml`.
5. Complete the first trusted publish within npm's current trusted-publisher
   activation window.
6. After trusted publishing succeeds, require 2FA and disallow traditional
   token publishing.
7. Create and push future `v*` tags only when the tag exactly matches
   `package.json`.

The implementation must prepare and document these actions but must not execute
them automatically.
