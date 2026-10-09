# Task 6 Report

## Files changed
- `src/launch/launch-next.ts`
- `src/launch/launch-plan.ts`
- `test/launch/launch-next.test.ts`
- `test/launch/launch-plan.test.ts`

## Red / green commands

### Red
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\launch-plan.test.ts test\launch\launch-next.test.ts`
   - Result: exit 1 as expected.
   - Evidence: both tests failed with `ERR_MODULE_NOT_FOUND` because `src\launch\launch-plan.ts` and `src\launch\launch-next.ts` did not exist yet.

### Green
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\launch-plan.test.ts test\launch\launch-next.test.ts`
   - Result: exit 0, 12/12 tests passed.
2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run typecheck`
   - Result: exit 0.
3. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run verify`
   - Result: exit 0.
   - Evidence: `typecheck`, 168/168 source tests, `audit:runtime`, `build`, `checksum`, and `smoke:sea` all completed successfully.

## Binding ruling applied
- `launchNext` now completes the claimed plan entry after the child reaches the `"spawn"` event, then awaits child exit without calling `unref()`, and returns the child exit code.

## Self-review
- Added a locked launch-plan state machine with strict unknown validation, atomic writes, unique entry IDs, retryable failed entries, and stale-token rejection.
- Sanitized persisted plan entries down to `cwd`, structured process data, generated IDs, and status so recovery metadata never writes session titles or other tab-only fields.
- Added injected-spawner coverage for claim completion, exit-code propagation, retryable spawn failure recording, and empty-plan short-circuit behavior.

## Commit
- Local commit message: `feat: add secure macOS launch broker`

## Concerns
- The new broker modules are intentionally not wired into CLI routing yet; Task 7 still owns the Apple Terminal launcher, `launch-next` argument parsing, and `main()` integration.

## Round 1

### Finding addressed
- `parseLaunchPlan` accepted duplicate non-empty `claimToken` values across `launching` entries, so repeated `completeLaunch` or `failLaunch` calls with the same stale token could mutate more than one entry over time.

### Changes
- Rejected duplicate active claim tokens while validating launch plans loaded from disk.
- Added a regression that rejects an on-disk plan containing two `launching` entries with the same claim token.
- Added a focused regression that proves a completed claim token remains single-use and cannot complete a second entry.

### Red / green evidence
1. Red: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\launch-plan.test.ts test\launch\launch-next.test.ts`
   - Result: exit 1.
   - Evidence: `claimNextLaunch rejects invalid stored plans without replacing them` failed because duplicate active claim tokens were still accepted.
2. Green: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\launch-plan.test.ts test\launch\launch-next.test.ts`
   - Result: exit 0, 13/13 tests passed.
3. Verification: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run verify`
   - Result: exit 0.
   - Evidence: `tsc --noEmit`, all 169 source tests, runtime audit, build, checksum, and SEA smoke test passed.
