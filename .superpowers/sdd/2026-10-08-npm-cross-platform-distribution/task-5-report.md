# Task 5 Report

## Files changed
- `src/cli/commands.ts`
- `src/cli/main.ts`
- `src/install/diagnostics.ts`
- `src/launch/terminal.ts`
- `src/launch/windows-terminal.ts`
- `src/platform/macos.ts`
- `src/platform/platform.ts`
- `src/platform/windows.ts`
- `test/cli/main.test.ts`
- `test/cli/recover.test.ts`
- `test/install/installer.test.ts`
- `test/launch/windows-terminal.test.ts`
- `test/platform/platform.test.ts`

## Red / green commands

### Red
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/cli/recover.test.ts test/launch/windows-terminal.test.ts`
   - Result: exit 1 as expected.
   - Evidence: recovery still imported and named Windows Terminal directly, so the new injected-terminal expectations failed and `createWindowsTerminalLauncher` did not exist yet.

### Green
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/cli/recover.test.ts test/launch/windows-terminal.test.ts`
   - Result: exit 0, 12/12 tests passed.
2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run typecheck`
   - Result: exit 0.
3. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/install/diagnostics.test.ts test/platform/platform.test.ts test/cli/main.test.ts test/install/installer.test.ts`
   - Result: exit 0, 26/26 tests passed.
4. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/cli/end-to-end.test.ts`
   - Result: exit 0, 1/1 test passed after fixing `main()` to thread recovery terminal overrides into the Windows launcher for the end-to-end worker.
5. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run verify; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git --no-pager diff --check`
   - Result: exit 0.
   - Evidence: 155/155 source tests passed, then `audit:runtime`, `build`, `checksum`, `smoke:sea`, and `git diff --check` all completed successfully.

## Commit
- `95ab8fc5ac6c85c6ef2b9529f895463b6e14ca8a` — `refactor: abstract recovery terminal launch`

## Self-review
- Added a `TerminalLauncher` abstraction and moved Windows Terminal availability, preview, and launch behavior behind it.
- Reworked recovery command wiring so `recover-sessions` consumes an injected terminal instead of importing Windows-specific functions and messages directly.
- Migrated diagnostics from `platform.terminalAvailable()` to `platform.terminal.available()` while keeping launcher checks platform-aware.
- Preserved the existing end-to-end test harness by recreating the Windows terminal launcher with injected `commandExists` and `runProcess` overrides when `main()` runs under the fake worker.
- Kept macOS terminal availability checks intact while using a temporary unsupported launcher placeholder for recovery until the later Apple Terminal task lands.

## Concerns
- Apple Terminal recovery launch/preview remains intentionally unimplemented in this task; `createMacosPlatformAdapter()` now exposes the terminal abstraction for availability checks, and Task 7 is still needed for real macOS recovery launching.
- `.superpowers\sdd\2026-10-08-npm-cross-platform-distribution\task-5-report.md` is intentionally left uncommitted; the task brief's commit step targets only the source and test files for this refactor.

## Fix round 1/5 - macOS availability guard

### Root cause
- `src/platform/macos.ts` treated Apple Terminal discovery as recovery support and returned `terminal.available() === true` even though `preview()` and `launch()` still threw placeholder errors.
- That let `recover-sessions` and `doctor` advertise macOS recovery support and fail later at runtime.

### Red
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\platform\platform.test.ts test\cli\recover.test.ts test\install\diagnostics.test.ts`
   - Result: exit 1 as expected.
   - Evidence: recovery still reported `Apple Terminal was not found.`, diagnostics still stayed healthy on macOS, and the macOS adapter still returned `available() === true`.

### Green
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\platform\platform.test.ts test\cli\recover.test.ts test\install\diagnostics.test.ts`
   - Result: exit 0, 26/26 tests passed.
2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run verify; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git --no-pager diff --check`
   - Result: exit 0.
   - Evidence: typecheck passed, then `verify` passed with 156/156 tests green plus `audit:runtime`, `build`, `checksum`, and `smoke:sea`, and `git diff --check` completed cleanly.

### Changes
- Made the macOS terminal launcher explicitly unavailable until native recovery launch support exists.
- Added explicit unavailable copy/fix metadata so recovery and diagnostics fail early with supportable messaging.
- Covered the behavior in focused platform, recover, and diagnostics tests.
