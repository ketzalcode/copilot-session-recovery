# Task 7 Report

## Files changed
- `src/cli/arguments.ts`
- `src/cli/commands.ts`
- `src/cli/main.ts`
- `src/launch/launch-next.ts`
- `src/launch/macos-terminal.ts`
- `src/platform/macos.ts`
- `test/cli/main.test.ts`
- `test/cli/recover.test.ts`
- `test/install/diagnostics.test.ts`
- `test/launch/macos-terminal.test.ts`
- `test/platform/platform.test.ts`

## Red / green commands

### Red
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\macos-terminal.test.ts test\cli\recover.test.ts test\cli\main.test.ts test\platform\platform.test.ts test\install\diagnostics.test.ts`
   - Result: exit 1 as expected.
   - Evidence: `parseCliArguments(["launch-next"])` still failed with `Unknown command: launch-next`, the new Apple Terminal test files failed with `ERR_MODULE_NOT_FOUND` because `src\launch\macos-terminal.ts` did not exist yet, and macOS diagnostics still reported the terminal as unavailable.
2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\cli\main.test.ts`
   - Result: exit 1 as expected.
   - Evidence: `main does not print stale failed-launch errors when a claimed child exits nonzero after spawning` failed because `launch-next` printed a prior failed-entry message (`stale spawn failure`) instead of only reporting current spawn failures.

### Green
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\macos-terminal.test.ts test\cli\recover.test.ts test\cli\main.test.ts test\platform\platform.test.ts test\install\diagnostics.test.ts`
   - Result: exit 0, 37/37 tests passed.
2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\windows-terminal.test.ts test\launch\macos-terminal.test.ts test\launch\launch-plan.test.ts test\launch\launch-next.test.ts test\cli\recover.test.ts test\cli\main.test.ts test\platform\platform.test.ts test\install\diagnostics.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run typecheck`
   - Result: exit 0.
   - Evidence: 52/52 targeted and adjacent tests passed, then `tsc --noEmit` passed.
3. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run verify`
   - Result: exit 0.
   - Evidence: `typecheck`, 177/177 source tests, `audit:runtime`, `build`, `checksum`, and `smoke:sea` all completed successfully.

## Self-review
- Added a real Apple Terminal launcher that:
  - checks `/usr/bin/osascript` plus `open -Ra Terminal`;
  - writes the launch plan before invoking `osascript`;
  - passes only a static AppleScript plus the tab count;
  - maps known Automation denials to actionable remediation text.
- Added the internal `launch-next` CLI command, routed it before normal CLI setup, and kept it hidden from public help.
- Preserved the launch plan on macOS Automation denial and added dry-run output that shows only the broker command and tab count.
- Replaced the temporary macOS unavailable gate in platform and diagnostics coverage with real launcher expectations.
- During direct review, found and fixed one bug: `launch-next` was printing stale failed-entry errors when a newly spawned child later exited nonzero. Added a regression for that case.

## Review note
- The task required no subagents, so I did a direct self-review instead of dispatching an external code-review agent.

## Commit
- `d6a2ac48f5e1ed3bc1927d25b810eb30ec64e9b1` — `feat: launch recovery in Apple Terminal`

## Concerns
- Hosted verification still cannot prove real Apple Terminal GUI tab creation or the live macOS Automation consent prompt. The design’s manual macOS operator check remains required before release.

## Round 1/5 fix

### Findings addressed
- AppleScript only remediated `-1743` Apple Events Automation denials even though the new-tab path depends on `System Events` UI scripting and Accessibility permission.
- Fixed `delay 0.2` sleeps plus unverified focus/selected-tab state could send `cmd-T` to the wrong app or run `copilot-session-recovery launch-next` twice in the same tab.

### Exact fix
- Updated `src/launch/macos-terminal.ts` to map Automation denials and `System Events` Accessibility denials separately, and both remediations now state that the launch plan was preserved.
- Replaced fixed sleeps with static bounded polling helpers that activate Terminal, wait for the Terminal process to become frontmost, wait for the first tab when a new window is created, then wait for both tab-count growth and selected-tab-index change before running the broker in the newly opened tab.
- Kept the AppleScript static except for the structured tab-count argv; no session, path, profile, or process values are interpolated into the script text.

### Red / green evidence
1. Red: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\macos-terminal.test.ts test\cli\recover.test.ts`
   - Result: exit 1 as expected.
   - Evidence: the script still used `delay 0.2`, Automation denials did not say the launch plan was preserved, and `System Events` `-25211` failures were surfaced raw instead of Accessibility remediation.
2. Green: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\macos-terminal.test.ts test\cli\recover.test.ts`
   - Result: exit 0, 18/18 tests passed.
3. Task 7 suite + typecheck: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\windows-terminal.test.ts test\launch\macos-terminal.test.ts test\launch\launch-plan.test.ts test\launch\launch-next.test.ts test\cli\recover.test.ts test\cli\main.test.ts test\platform\platform.test.ts test\install\diagnostics.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run typecheck`
   - Result: exit 0, 55/55 targeted and adjacent tests passed, then `tsc --noEmit` passed.
4. Verification: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run verify; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git --no-pager diff --check`
   - Result: exit 0.
   - Evidence: `verify` passed with 179/179 source tests plus runtime audit, build, checksum, and SEA smoke test; `git diff --check` completed cleanly.

### Self-review
- The new script now waits on concrete GUI state instead of guessing with fixed sleeps.
- Selected-tab verification uses tab indices instead of AppleScript object identity, avoiding unstable reference comparisons while still proving the new tab is selected before `do script`.
- Hosted validation still cannot prove real Apple Terminal GUI timing or live permission prompts, so a manual macOS operator check remains required before release.

## Round 2/5 fix

### Findings addressed
- After `Cmd+T`, newer Terminal builds can surface a replacement front window whose selected tab still reports `count of tabs = 1` and `index of selected tab = 1`.
- The Round 1 polling logic only accepted legacy tab-count growth plus selected-index change, so it could time out even though Terminal had already switched to the correct new UI tab/window.

### Exact fix
- Updated `src/launch/macos-terminal.ts` to record `id of front window` before sending `Cmd+T`, pass that id into the bounded polling helper, and accept either:
  - a verified front-window identity change; or
  - the legacy `currentTabCount > previousTabCount` plus selected-index change path.
- Kept the existing static-script invariant, Terminal frontmost verification, bounded polling loops, denial remediation, and constant `copilot-session-recovery launch-next` broker command.
- Continued running the broker in the selected tab of the current front window once either valid post-`Cmd+T` state is observed.

### Red / green evidence
1. Red: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\macos-terminal.test.ts`
   - Result: exit 1 as expected.
   - Evidence: `buildAppleTerminalScript()` did not include any `previousFrontWindowId` / `currentFrontWindowId` tracking, so the new focused regression failed on the missing front-window identity predicate.
2. Green: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\macos-terminal.test.ts`
   - Result: exit 0, 5/5 tests passed.
3. Task 7 suite + typecheck + verify: `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test\launch\windows-terminal.test.ts test\launch\macos-terminal.test.ts test\launch\launch-plan.test.ts test\launch\launch-next.test.ts test\cli\recover.test.ts test\cli\main.test.ts test\platform\platform.test.ts test\install\diagnostics.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run typecheck; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run verify`
   - Result: exit 0.
   - Evidence: 55/55 Task 7 targeted tests passed, `tsc --noEmit` passed, then `npm run verify` passed with 179/179 source tests plus runtime audit, build, checksum, and SEA smoke test.

### Self-review
- The regression stays script-focused and proves the added window-identity branch without weakening the existing static-script and selected-tab assertions.
- The production change is minimal: it broadens only the success predicate inside the existing bounded polling helper and preserves all remediation and launch-plan behavior.
