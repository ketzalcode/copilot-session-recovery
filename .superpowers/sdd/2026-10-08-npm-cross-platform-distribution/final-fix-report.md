# Final review fix report

Date: 2026-10-09

## Outcome

All three Important final-review findings were fixed with focused TDD cycles.
No subagents were dispatched, as required.

## 1. macOS CI fixtures

### Root cause

- End-to-end and concurrency tests forced Windows environment variables,
  Windows application paths, `;` PATH separation, and `.cmd` shims.
- Runtime installation tests constructed Windows file URLs and expected
  Windows paths on every host.
- The absolute executable fixture did not set POSIX execute permission.

### Fix

- Added shared platform fixture helpers that use `HOME` and POSIX application
  paths on macOS, `LOCALAPPDATA`/`USERPROFILE` on Windows, and
  `path.delimiter`.
- Added native `.cmd` shims on Windows and executable `#!/bin/sh` shims on
  macOS.
- Made the worker's fake command lookup require `X_OK` on POSIX and provided a
  real macOS terminal test adapter while preserving Windows Terminal
  assertions.
- Made runtime file-URL expectations platform-native.
- Made the process-runner absolute executable fixture executable on POSIX.

### Red / green evidence

Red:

```powershell
node --test --test-concurrency=1 --test-isolation=none test\fixtures\platform-fixture.test.ts
```

Exit 1: `ERR_MODULE_NOT_FOUND` for the not-yet-created platform fixture helper.

Green:

```powershell
node --test --test-concurrency=1 --test-isolation=none test\fixtures\platform-fixture.test.ts test\cli\end-to-end.test.ts test\hooks\concurrency.test.ts test\runtime\installation.test.ts test\launch\process-runner.test.ts
```

Exit 0: 13/13 tests passed.

## 2. Preserved macOS recovery-plan retry

### Root cause

`recover-sessions` always rebuilt the current registry selection and called
`createLaunchPlan`. A valid preserved plan therefore blocked public retry, even
though locked broker APIs could retry its failed entries.

### Deterministic behavior

- Public recovery first validates and inspects the preserved plan under the
  launch-plan lock.
- It opens exactly the number of entries still marked `pending` or `failed`.
- It reuses the plan's persisted structured `cwd`, executable, arguments, and
  environment. Current registry changes and `--profile` are explicitly ignored
  until that plan completes or is discarded.
- `recover-sessions --discard-plan` is the explicit standalone conflict
  resolution. It validates under lock and refuses while any entry is
  `launching`.
- No process data is interpolated into shell or AppleScript text.

### Red / green evidence

Red:

```powershell
node --test --test-concurrency=1 --test-isolation=none test\launch\launch-plan.test.ts test\launch\macos-terminal.test.ts test\cli\recover.test.ts
```

Exit 1: 6 failures. Missing locked inspect/discard APIs, no preserved launcher
surface, `--discard-plan` was unknown, and denial retry returned nonzero.

Green:

```powershell
node --test --test-concurrency=1 --test-isolation=none test\launch\launch-plan.test.ts test\launch\macos-terminal.test.ts test\cli\recover.test.ts
```

Exit 0: 33/33 tests passed, including denial-then-retry success, preserved
structured-data equality, pending/failed tab count, conflicting profile
selection, and safe discard.

## 3. macOS install security ordering

### Root cause

Install wrote configuration, registry, and the Copilot hook before checking
mandatory macOS protection, then treated protection failure as a warning.

### Fix

- macOS now validates existing state paths before state mutation.
- Protection covers the application directory, configuration, registry,
  diagnostics/corrupt directories, registry lock, launch plan, and launch-plan
  lock when present.
- New directories/files are protected and revalidated before hook activation.
- Mandatory protection failure returns nonzero, removes the owned hook,
  removes state created by the failed attempt, and surfaces cleanup failures
  together with the original failure.
- Unsafe pre-existing application state is not mutated.
- Windows retains the approved best-effort warning behavior.

### Red / green evidence

Initial red:

```powershell
node --test --test-concurrency=1 --test-isolation=none test\install\installer.test.ts
```

Exit 1: 4 failures. Unsafe macOS paths still succeeded, protection failure
activated hooks, and cleanup errors were not surfaced.

Hook-deactivation red:

```powershell
node --test --test-concurrency=1 --test-isolation=none --test-name-pattern "macOS install rejects an unsafe pre-existing application path|macOS install cleans newly created state" test\install\installer.test.ts
```

Exit 1: 2/2 failures because protection failure did not remove the owned hook.

Expanded-path red:

```powershell
node --test --test-concurrency=1 --test-isolation=none --test-name-pattern "symlinked diagnostics" test\platform\macos-permissions.test.ts
```

Exit 1: diagnostics-directory symlinks were not yet checked.

Green:

```powershell
node --test --test-concurrency=1 --test-isolation=none test\platform\macos-permissions.test.ts test\install\installer.test.ts
```

Exit 0: 19/19 tests passed.

## Integration and final verification

An intermediate `npm run typecheck` correctly failed because a test
`InstallerDependencies` fixture lacked the new `pathExists` dependency. After
updating the fixture, `npm run typecheck` exited 0.

Focused final-review suite:

```powershell
node --test --test-concurrency=1 --test-isolation=none test\fixtures\platform-fixture.test.ts test\cli\end-to-end.test.ts test\hooks\concurrency.test.ts test\runtime\installation.test.ts test\launch\process-runner.test.ts test\launch\launch-plan.test.ts test\launch\macos-terminal.test.ts test\cli\recover.test.ts test\cli\main.test.ts test\install\installer.test.ts
```

Exit 0: 63/63 tests passed.

Final repository gate:

```powershell
npm run verify
```

Exit 0: typecheck, 197/197 source tests, runtime audit, build, and package smoke
test passed.

```powershell
git --no-pager diff --check
```

Exit 0.

## Review and boundaries

- Direct review found and fixed an additional fail-closed gap: mandatory macOS
  protection failures now remove a pre-existing owned hook as well as avoiding
  new activation.
- Direct review also expanded macOS protection to diagnostics, corrupt, lock,
  and launch-plan paths.
- Actual hosted `macos-latest` CI and live Apple Terminal Automation/
  Accessibility prompts cannot be executed from this Windows worktree.
- Release readiness remains operator-blocked until the branch is pushed,
  macOS CI passes, and the documented live Apple Terminal release check is
  recorded.
