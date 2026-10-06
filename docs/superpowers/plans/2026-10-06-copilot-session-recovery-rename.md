# Copilot Session Recovery Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the unreleased project, command, installation, and release identity from Copilot Auto Save to Copilot Session Recovery, then publish the verified repository at `ketzalcode/copilot-session-recovery`.

**Architecture:** Keep all session lifecycle, registry, locking, launcher, and recovery behavior unchanged. Replace the identity at every runtime, packaging, test, documentation, and GitHub surface; ship no legacy compatibility; handle the existing development installation with a separate one-time PowerShell migration.

**Tech Stack:** TypeScript 7, Node.js 24.21.0, Node SEA, esbuild, PowerShell, GitHub Actions, GitHub CLI

**Spec:** `docs/superpowers/specs/2026-10-06-copilot-session-recovery-rename-design.md`

## Global Constraints

- Product name: `Copilot Session Recovery`.
- Repository: `ketzalcode/copilot-session-recovery`.
- Installed command: `copilot-session-recovery`.
- Installed executable: `%LOCALAPPDATA%\copilot-session-recovery\bin\copilot-session-recovery.exe`.
- Release executable: `dist/copilot-session-recovery-windows-x64.exe`.
- Copilot hook file: `%USERPROFILE%\.copilot\hooks\copilot-session-recovery.json`, or the equivalent path under `COPILOT_HOME`.
- Internal environment prefix: `COPILOT_SESSION_RECOVERY_*`.
- npm package name: `copilot-session-recovery`.
- Existing subcommands, flags, schemas, launcher profiles, privacy boundaries, and recovery behavior must not change.
- Do not add runtime dependencies, network behavior, telemetry, background services, or shipped legacy-name compatibility.
- Use Node.js `24.21.0` for every verification command.
- Do not remove the existing local `copilot-auto-save` installation during the active Copilot session.

---

## File Map

### Runtime identity

- `src/cli/main.ts`: CLI usage banner.
- `src/storage/paths.ts`: application directory, installed executable, and hook filename.
- `src/hooks/handler.ts`: fail-open diagnostic prefix.
- `src/install/installer.ts`: installation success text.
- `src/install/self-delete.ts`: PowerShell environment-variable contract.
- `src/install/user-path.ts`: PATH-update environment-variable contract.

### Runtime contract tests

- `test/cli/main.test.ts`: exact help output.
- `test/storage/paths.test.ts`: resolved application and hook paths.
- `test/hooks/handler.test.ts`: diagnostic prefix.
- `test/install/installer.test.ts`: installed path and success output.
- `test/install/copilot-hooks.test.ts`: hook filename and executable path.
- `test/install/diagnostics.test.ts`: diagnostic paths.
- `test/install/self-delete.test.ts`: cleanup environment variables.
- `test/install/user-path.test.ts`: PATH environment variable.
- Remaining `test/**/*.ts` files: fixture paths, temporary-directory prefixes, and fake environment names.

### Packaging and release

- `package.json`, `package-lock.json`: package identity.
- `sea-config.json`: bundled entry and release executable.
- `scripts/build.mjs`: bundle, SEA compatibility entry, and blob names.
- `scripts/checksum.mjs`: checksum target.
- `scripts/smoke-sea.mjs`: isolated install paths, environment variables, and expected output.
- `test/build/build.test.ts`: SEA and executable contract.
- `.github/workflows/ci.yml`: artifact name and paths.
- `.github/workflows/release.yml`: executable, checksum, SBOM, and provenance paths.

### User-facing documentation

- `README.md`: product name, install commands, architecture diagram, commands, state paths, and uninstall examples.
- `CONTRIBUTING.md`: generated and release artifact names.
- `SECURITY.md`, `LICENSE`: product name.
- `docs/architecture.md`, `docs/security.md`, `docs/troubleshooting.md`: command, paths, release artifacts, and product copy.
- `.github/ISSUE_TEMPLATE/bug.yml`, `.github/ISSUE_TEMPLATE/feature.yml`: product and diagnostic command copy.

### Local-only migration and publication

- Create outside the repository:
  `C:\Users\senrique\.copilot\session-state\502ed8ca-ce22-4e92-b6a7-34eaec25c59d\files\migrate-copilot-session-recovery.ps1`.
- Rename checkout:
  `C:\src\copilot-auto-save` to `C:\src\copilot-session-recovery`.
- Create and push:
  `ketzalcode/copilot-session-recovery`.

---

### Task 1: Rename the runtime identity contract

**Files:**
- Modify: `test/cli/main.test.ts`
- Modify: `test/storage/paths.test.ts`
- Modify: `test/hooks/handler.test.ts`
- Modify: `test/install/installer.test.ts`
- Modify: `test/install/copilot-hooks.test.ts`
- Modify: `test/install/diagnostics.test.ts`
- Modify: `test/install/self-delete.test.ts`
- Modify: `test/install/user-path.test.ts`
- Modify: `src/cli/main.ts`
- Modify: `src/storage/paths.ts`
- Modify: `src/hooks/handler.ts`
- Modify: `src/install/installer.ts`
- Modify: `src/install/self-delete.ts`
- Modify: `src/install/user-path.ts`

**Interfaces:**
- Consumes: Existing `AppPaths`, CLI help text, installer dependency interfaces, hook diagnostics, and structured PowerShell process calls.
- Produces: Runtime paths and messages using only the `copilot-session-recovery` identity and `COPILOT_SESSION_RECOVERY_*` environment variables.

- [ ] **Step 1: Change the runtime contract tests to the new identity**

Update the exact help expectation:

```ts
const HELP_TEXT = [
  "Usage: copilot-session-recovery <command>",
  // Keep every existing command line unchanged.
].join("\n");
```

Update path expectations:

```ts
assert.equal(
  paths.registryFile,
  "C:\\Users\\ruben\\AppData\\Local\\copilot-session-recovery\\sessions.json",
);
assert.equal(
  paths.copilotHookFile,
  "C:\\Users\\ruben\\.copilot\\hooks\\copilot-session-recovery.json",
);
```

Update installer, hook, diagnostic, self-delete, and PATH assertions so they
expect:

```text
copilot-session-recovery.exe
copilot-session-recovery.json
Installed copilot-session-recovery
copilot-session-recovery hook warning:
COPILOT_SESSION_RECOVERY_PARENT_PID
COPILOT_SESSION_RECOVERY_INSTALLED_EXE
COPILOT_SESSION_RECOVERY_APP_DIR
COPILOT_SESSION_RECOVERY_PURGE
COPILOT_SESSION_RECOVERY_BIN_DIR
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```powershell
nvm use 24.21.0
node --test --test-concurrency=1 --test-isolation=none `
  test/cli/main.test.ts `
  test/storage/paths.test.ts `
  test/hooks/handler.test.ts `
  test/install/installer.test.ts `
  test/install/copilot-hooks.test.ts `
  test/install/diagnostics.test.ts `
  test/install/self-delete.test.ts `
  test/install/user-path.test.ts
```

Expected: failures show old `copilot-auto-save` help, paths, messages, or
environment-variable names. No behavioral assertion should fail for a reason
unrelated to identity.

- [ ] **Step 3: Rename the runtime source**

In `src/storage/paths.ts`, use the new application and hook identity:

```ts
const appDir = path.win32.join(localAppData, "copilot-session-recovery");
const binDir = path.win32.join(appDir, "bin");

return {
  appDir,
  binDir,
  installedExecutable: path.win32.join(
    binDir,
    "copilot-session-recovery.exe",
  ),
  // Existing config, registry, lock, diagnostics, and corrupt filenames stay.
  copilotHookFile: path.win32.join(
    copilotHome,
    "hooks",
    "copilot-session-recovery.json",
  ),
};
```

Update the CLI banner and user-visible diagnostics:

```ts
"Usage: copilot-session-recovery <command>"
```

```ts
process.stderr.write(
  `copilot-session-recovery hook warning: ${message}\n`,
);
```

```ts
deps.output.out(
  `Installed copilot-session-recovery to ${deps.paths.installedExecutable}.`,
);
```

Rename every environment variable in `src/install/self-delete.ts` and
`src/install/user-path.ts` from `COPILOT_AUTO_SAVE_*` to
`COPILOT_SESSION_RECOVERY_*`. Keep values passed through `env` and keep
PowerShell scripts free of interpolated user paths.

- [ ] **Step 4: Run the focused tests and confirm the green state**

Run the Step 2 command again.

Expected: all focused runtime identity tests pass.

- [ ] **Step 5: Commit the runtime identity**

```powershell
git add src test
git diff --cached --check
$message = "refactor: rename runtime to Copilot Session Recovery`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`nCopilot-Session: 502ed8ca-ce22-4e92-b6a7-34eaec25c59d"
git commit -m $message
```

---

### Task 2: Rename package, build, and release artifacts

**Files:**
- Modify: `test/build/build.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `sea-config.json`
- Modify: `scripts/build.mjs`
- Modify: `scripts/checksum.mjs`
- Modify: `scripts/smoke-sea.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: The unchanged `npm run verify` pipeline and Node SEA build process.
- Produces: `dist/copilot-session-recovery-windows-x64.exe`, matching checksum and SBOM names, and CI/release workflows that publish those files.

- [ ] **Step 1: Change the build contract tests first**

Update the SEA expectation:

```ts
assert.deepEqual(config, {
  main: "dist/copilot-session-recovery.mjs",
  mainFormat: "module",
  output: "dist/copilot-session-recovery-windows-x64.exe",
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  useVfs: false,
});
```

Add a package identity assertion inside the package-script test:

```ts
assert.equal(packageJson.name, "copilot-session-recovery");
```

Run the built executable from:

```ts
result = await runCommand(
  "dist/copilot-session-recovery-windows-x64.exe",
  ["--version"],
);
```

- [ ] **Step 2: Run the build test and confirm the red state**

Run:

```powershell
nvm use 24.21.0
node --test --test-concurrency=1 --test-isolation=none test/build/build.test.ts
```

Expected: the SEA configuration, package name, or executable path assertions
fail because packaging still uses the old identity.

- [ ] **Step 3: Rename package and build files**

Set the package name:

```json
{
  "name": "copilot-session-recovery"
}
```

Refresh the lockfile through npm rather than editing it manually:

```powershell
npm install --package-lock-only --ignore-scripts
```

Use these exact generated names:

```text
dist/copilot-session-recovery.mjs
dist/copilot-session-recovery-sea.cjs
dist/copilot-session-recovery.blob
dist/copilot-session-recovery-windows-x64.exe
dist/copilot-session-recovery-windows-x64.exe.sha256
dist/copilot-session-recovery-windows-x64.spdx.json
```

Rename the smoke-test environment variable to:

```text
COPILOT_SESSION_RECOVERY_BIN_DIR
```

Update the smoke test’s isolated application directory, installed executable,
hook filename, temporary-directory prefix, and expected installation output.
Update CI artifact names and release paths to the same identity.

- [ ] **Step 4: Run the build test and confirm the green state**

Run the Step 2 command again.

Expected: the source entry test, SEA configuration test, package script test,
runtime audit test, and self-contained executable build test all pass.

- [ ] **Step 5: Verify packaging files agree**

Run:

```powershell
rg -n "copilot-auto-save|COPILOT_AUTO_SAVE" `
  package.json package-lock.json sea-config.json scripts test/build `
  .github/workflows CONTRIBUTING.md
```

Expected: no matches and exit code `1`.

- [ ] **Step 6: Commit packaging and release identity**

```powershell
git add package.json package-lock.json sea-config.json scripts test/build `
  .github/workflows CONTRIBUTING.md
git diff --cached --check
$message = "build: rename Copilot Session Recovery artifacts`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`nCopilot-Session: 502ed8ca-ce22-4e92-b6a7-34eaec25c59d"
git commit -m $message
```

---

### Task 3: Rename remaining tests and user documentation

**Files:**
- Modify: `test/**/*.ts` files still containing the legacy identity.
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `LICENSE`
- Modify: `docs/architecture.md`
- Modify: `docs/security.md`
- Modify: `docs/troubleshooting.md`
- Modify: `.github/ISSUE_TEMPLATE/bug.yml`
- Modify: `.github/ISSUE_TEMPLATE/feature.yml`

**Interfaces:**
- Consumes: Runtime and packaging identities produced by Tasks 1 and 2.
- Produces: Complete user-facing documentation and fixtures with no legacy identity outside the historical rename design and plan.

- [ ] **Step 1: Rename remaining test fixtures**

Update temporary-directory prefixes, fixture paths, sample working directories,
fake command environment variables, and expected executable/hook paths:

```text
copilot-session-recovery-
C:\src\copilot-session-recovery
COPILOT_SESSION_RECOVERY_FAKE_NAME
COPILOT_SESSION_RECOVERY_FAKE_LOG
COPILOT_SESSION_RECOVERY_FAKE_COMMAND_PATH
```

Do not change test behavior, UUIDs, registry schema, lifecycle reasons, launcher
profiles, lock semantics, or recovery expectations.

- [ ] **Step 2: Run all source tests**

Run:

```powershell
nvm use 24.21.0
npm test
```

Expected: 128 tests pass, 0 fail.

- [ ] **Step 3: Rename user-facing documentation**

Apply the new product, command, executable, application directory, hook, release
asset, and environment-variable identity throughout the listed documentation
and issue templates. Keep the README structure and all behavior claims
unchanged.

The README quick start must begin with:

```markdown
# Copilot Session Recovery

Recover GitHub Copilot CLI sessions after an unexpected Windows restart.
```

The install example must be:

```powershell
.\copilot-session-recovery-windows-x64.exe install
```

The command examples must use:

```powershell
copilot-session-recovery list
copilot-session-recovery recover-sessions
copilot-session-recovery add (Get-Clipboard)
```

- [ ] **Step 4: Prove the legacy identity is absent from product surfaces**

Run from the repository root:

```powershell
rg -n "copilot-auto-save|Copilot Auto Save|COPILOT_AUTO_SAVE" . `
  -g "!docs/superpowers/specs/2026-10-06-copilot-session-recovery-rename-design.md" `
  -g "!docs/superpowers/plans/2026-10-06-copilot-session-recovery-rename.md" `
  -g "!dist/**" `
  -g "!node_modules/**"
```

Expected: no matches and exit code `1`.

- [ ] **Step 5: Commit remaining tests and documentation**

```powershell
git add test README.md SECURITY.md LICENSE docs .github/ISSUE_TEMPLATE
git diff --cached --check
$message = "docs: rename product to Copilot Session Recovery`n`nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`nCopilot-Session: 502ed8ca-ce22-4e92-b6a7-34eaec25c59d"
git commit -m $message
```

---

### Task 4: Verify and review the complete rename

**Files:**
- Review: all changes since commit `956194c`.

**Interfaces:**
- Consumes: Completed runtime, packaging, test, and documentation rename.
- Produces: A clean, reviewed commit history ready for publication.

- [ ] **Step 1: Run the full release verification pipeline**

Run:

```powershell
nvm use 24.21.0
npm run verify
```

Expected:

```text
TypeScript typecheck exits 0
128 tests pass, 0 fail
Runtime no-network audit exits 0
SEA build exits 0
Checksum generation exits 0
Node-free SEA smoke test exits 0
```

- [ ] **Step 2: Inspect the renamed executable**

Run:

```powershell
.\dist\copilot-session-recovery-windows-x64.exe --help
.\dist\copilot-session-recovery-windows-x64.exe --version
Get-FileHash .\dist\copilot-session-recovery-windows-x64.exe -Algorithm SHA256
Get-Content .\dist\copilot-session-recovery-windows-x64.exe.sha256
```

Expected:

- Help starts with `Usage: copilot-session-recovery <command>`.
- Version is `0.1.0`.
- The executable hash equals the first checksum-file field.

- [ ] **Step 3: Run final repository checks**

Run:

```powershell
git diff --check 956194c..HEAD
git status --short
rg -n "copilot-auto-save|Copilot Auto Save|COPILOT_AUTO_SAVE" . `
  -g "!docs/superpowers/specs/2026-10-06-copilot-session-recovery-rename-design.md" `
  -g "!docs/superpowers/plans/2026-10-06-copilot-session-recovery-rename.md" `
  -g "!dist/**" `
  -g "!node_modules/**"
```

Expected: no whitespace errors, clean status, and no legacy identity matches.

- [ ] **Step 4: Review the rename diff**

Review:

```powershell
git --no-pager diff --stat 956194c..HEAD
git --no-pager diff 956194c..HEAD
```

Reject changes that alter lifecycle behavior, registry schema, lock behavior,
process argument structure, or privacy guarantees.

---

### Task 5: Rename the checkout and publish the repository

**Files:**
- Move: `C:\src\copilot-auto-save` to `C:\src\copilot-session-recovery`.
- Configure: Git remote `origin`.

**Interfaces:**
- Consumes: Clean verified local `main` branch.
- Produces: Public GitHub repository `ketzalcode/copilot-session-recovery` with `main` pushed.

- [ ] **Step 1: Confirm publication preconditions**

Run:

```powershell
git -C C:\src\copilot-auto-save status --short
git -C C:\src\copilot-auto-save remote -v
gh repo view ketzalcode/copilot-session-recovery --json nameWithOwner 2>$null
```

Expected: clean status, no configured remote, and the repository lookup fails
because the name is still available.

- [ ] **Step 2: Rename the local checkout directory**

Run from `C:\src`:

```powershell
Move-Item -LiteralPath C:\src\copilot-auto-save `
  -Destination C:\src\copilot-session-recovery
```

Expected: `git -C C:\src\copilot-session-recovery status --short` succeeds and
is clean.

- [ ] **Step 3: Create the public repository and push `main`**

Use the authenticated `RubenSaucedo` token only for this process:

```powershell
$env:GH_TOKEN = gh auth token --user RubenSaucedo
gh repo create ketzalcode/copilot-session-recovery `
  --public `
  --description "Recover GitHub Copilot CLI sessions after unexpected device restarts." `
  --source C:\src\copilot-session-recovery `
  --remote origin `
  --push
```

Expected: GitHub creates the public repository, configures `origin`, and pushes
local `main`. The default persisted `gh` account remains unchanged.

- [ ] **Step 4: Verify the remote**

Run:

```powershell
git -C C:\src\copilot-session-recovery remote -v
git -C C:\src\copilot-session-recovery status --short --branch
$env:GH_TOKEN = gh auth token --user RubenSaucedo
gh repo view ketzalcode/copilot-session-recovery `
  --json nameWithOwner,visibility,description,defaultBranchRef,url
```

Expected:

- `origin` points to `ketzalcode/copilot-session-recovery`.
- Local `main` tracks `origin/main`.
- Visibility is `PUBLIC`.
- Description matches the approved text.
- Default branch is `main`.

---

### Task 6: Prepare the one-time local migration

**Files:**
- Create outside repository:
  `C:\Users\senrique\.copilot\session-state\502ed8ca-ce22-4e92-b6a7-34eaec25c59d\files\migrate-copilot-session-recovery.ps1`

**Interfaces:**
- Consumes: Existing `%LOCALAPPDATA%\copilot-auto-save` configuration and registry plus the verified renamed build.
- Produces: A user-run migration that copies state, installs and verifies the new command, and optionally removes the legacy development installation.

- [ ] **Step 1: Write the migration script**

Create this script outside the Git repository:

```powershell
param(
    [string]$NewExecutable = "C:\src\copilot-session-recovery\dist\copilot-session-recovery-windows-x64.exe",
    [switch]$RemoveLegacy
)

$ErrorActionPreference = "Stop"

$oldRoot = Join-Path $env:LOCALAPPDATA "copilot-auto-save"
$newRoot = Join-Path $env:LOCALAPPDATA "copilot-session-recovery"
$oldExecutable = Join-Path $oldRoot "bin\copilot-auto-save.exe"
$newInstalledExecutable = Join-Path $newRoot "bin\copilot-session-recovery.exe"
$backupRoot = Join-Path $env:LOCALAPPDATA (
    "copilot-session-recovery-migration-backup-" +
    [DateTimeOffset]::UtcNow.ToString("yyyyMMdd-HHmmss")
)

if (-not (Test-Path -LiteralPath $NewExecutable -PathType Leaf)) {
    throw "Renamed executable not found: $NewExecutable"
}

if (Test-Path -LiteralPath (Join-Path $oldRoot "sessions.lock")) {
    throw "Legacy registry is locked. End active Copilot sessions and retry."
}

foreach ($name in @("config.json", "sessions.json")) {
    if (Test-Path -LiteralPath (Join-Path $newRoot $name)) {
        throw "New state already exists at $newRoot. Refusing to overwrite it."
    }
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $newRoot -Force | Out-Null

foreach ($name in @("config.json", "sessions.json")) {
    $source = Join-Path $oldRoot $name
    if (Test-Path -LiteralPath $source -PathType Leaf) {
        Copy-Item -LiteralPath $source -Destination $backupRoot -Force
        Copy-Item -LiteralPath $source -Destination $newRoot -Force
    }
}

& $NewExecutable install
if ($LASTEXITCODE -ne 0) {
    throw "Copilot Session Recovery installation failed."
}

& $newInstalledExecutable status
if ($LASTEXITCODE -ne 0) {
    throw "Copilot Session Recovery status check failed."
}

& $newInstalledExecutable list
if ($LASTEXITCODE -ne 0) {
    throw "Copilot Session Recovery registry verification failed."
}

if ($RemoveLegacy) {
    if (-not (Test-Path -LiteralPath $oldExecutable -PathType Leaf)) {
        throw "Legacy executable not found: $oldExecutable"
    }

    & $oldExecutable uninstall --purge
    if ($LASTEXITCODE -ne 0) {
        throw "Legacy uninstall failed."
    }
}

Write-Output "Migration verified. Backup: $backupRoot"
if (-not $RemoveLegacy) {
    Write-Output "After confirming the new command works, remove the legacy installation with:"
    Write-Output "& `"$oldExecutable`" uninstall --purge"
}
```

- [ ] **Step 2: Validate script syntax without executing migration**

Run:

```powershell
$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  "C:\Users\senrique\.copilot\session-state\502ed8ca-ce22-4e92-b6a7-34eaec25c59d\files\migrate-copilot-session-recovery.ps1",
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) { $errors; exit 1 }
```

Expected: no parser errors. Do not run the migration while this Copilot session
is active.

- [ ] **Step 3: Report the deferred migration command**

After the current Copilot session ends, run:

```powershell
& "C:\Users\senrique\.copilot\session-state\502ed8ca-ce22-4e92-b6a7-34eaec25c59d\files\migrate-copilot-session-recovery.ps1"
```

After verifying the new command from a fresh terminal, remove the legacy
installation with:

```powershell
& "$env:LOCALAPPDATA\copilot-auto-save\bin\copilot-auto-save.exe" uninstall --purge
```
