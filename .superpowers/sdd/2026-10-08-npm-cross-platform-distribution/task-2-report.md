# Task 2 Report

## Files changed
- `src/launch/process-runner.ts`
- `src/platform/platform.ts`
- `src/platform/windows.ts`
- `src/platform/macos.ts`
- `src/platform/windows-permissions.ts` (moved from `src/install/acl.ts`)
- `src/platform/macos-permissions.ts`
- `src/install/installer.ts`
- `src/install/diagnostics.ts`
- `test/launch/process-runner.test.ts`
- `test/platform/platform.test.ts`
- `test/platform/windows-permissions.test.ts` (moved from `test/install/acl.test.ts`)
- `test/platform/macos-permissions.test.ts`

## Red / green commands

### Red
1. `node --test --test-concurrency=1 --test-isolation=none test\launch\process-runner.test.ts test\platform\windows-permissions.test.ts test\platform\macos-permissions.test.ts test\platform\platform.test.ts`
   - Result: exit 1 as expected.
   - Evidence: `runner is not a function` for new platform-aware `commandExists` expectations, missing `src/platform/macos-permissions.ts` and `src/platform/windows-permissions.ts`, and missing adapter methods such as `protectState`.

### Green
1. `node --test --test-concurrency=1 --test-isolation=none test\launch\process-runner.test.ts test\platform\windows-permissions.test.ts test\platform\macos-permissions.test.ts test\platform\platform.test.ts`
   - Result: exit 0, 16/16 tests passed.
2. `npm run typecheck`
   - Result: exit 0.
3. `npm run verify`
   - Result: exit 0.
   - Evidence: 144/144 tests passed, then `audit:runtime`, `build`, `checksum`, and `smoke:sea` all completed successfully.
4. `git --no-pager diff --check`
   - Result: exit 0 before commit.

## Commit
- `e0e55bdc2b9a0a5ab298f91353f0032d52d344ec` — `feat: protect state across supported platforms`

## Self-review
- Extended `PlatformAdapter` only with the Task 2 surface: `protectState`, `checkStateProtection`, and `terminalAvailable`.
- Kept later recovery abstraction out of scope.
- Preserved structured Windows ACL commands while relocating them to the platform layer.
- Added macOS permission handling with injected filesystem dependencies, symlink rejection, ownership checks, strict mode verification, and adapter wiring.
- Kept command discovery structured and platform-aware, including `/usr/bin/which` for macOS and `where.exe` for Windows.
- Updated only tightly coupled imports outside the brief (`installer.ts`, `diagnostics.ts`) to follow the moved Windows permissions module.
- Performed inline review instead of dispatching a reviewer because nested delegation was explicitly disallowed for this task.

## Concerns
- No blocking concerns.
- `.superpowers\...\task-2-report.md` remains intentionally uncommitted per instruction.

## Round 1/5 fix

### Exact fix
- Reworked `src/platform/macos-permissions.ts` to stop using pathname-based `stat()` and `chmod()` after an initial `lstat()`.
- Added secure handle-based access with `open(..., O_RDONLY | O_NOFOLLOW)`, then used the file handle for `stat()` and `chmod()`.
- Compared `dev`/`ino` from the initial `lstat()` with the opened handle's `stat()` result, and re-checked the path with `lstat()` after chmod/check verification.
- Returned a failure when the path identity changed or became a symlink during the operation, so replaced paths can no longer be reported as protected.
- Updated `test/platform/macos-permissions.test.ts` to use injected secure-open dependencies and added a regression test for replacement between inspection and verification.

### Commands
1. `node --test --test-name-pattern "protectMacState rejects a path replaced between inspection and chmod verification" test\platform\macos-permissions.test.ts`
   - Result before fix: exit 1.
   - Evidence: returned `{ protected: true, detail: "State paths are protected for the current user." }` instead of rejecting the replaced path.
2. `node --test --test-name-pattern "protectMacState rejects a path replaced between inspection and chmod verification" test\platform\macos-permissions.test.ts`
   - Result after fix: exit 0.
3. `node --test test\platform\macos-permissions.test.ts`
   - Result: exit 0, 6/6 tests passed.
4. `node --test --test-concurrency=1 --test-isolation=none test\launch\process-runner.test.ts test\platform\windows-permissions.test.ts test\platform\macos-permissions.test.ts test\platform\platform.test.ts`
   - Result: exit 0, 17/17 tests passed.
5. `npm run typecheck`
   - Result: exit 0.
6. `git --no-pager diff --check`
   - Result: exit 0.

### Self-review
- The fix closes the original symlink/TOCTOU gap by binding chmod and stat verification to an already-open non-symlink handle.
- Post-operation identity checks ensure a concurrent rename cannot swap in a different pathname target and still return `protected: true`.
- Test coverage stays focused on the reported race and the pre-existing permission checks.
## Round 2/5 fix

### Exact fix
- Kept the secure `O_RDONLY | O_NOFOLLOW` handle path for readable entries.
- Added a narrow fallback for `EACCES`/`EPERM` during `protectMacState`: inspect the owned non-symlink path by name with `lstat` + `stat`, apply pathname `chmod`, then immediately reopen with `O_NOFOLLOW` and verify the same inode/device and final mode before returning success.
- This restores repair for owned mode `000` files and directories without accepting swapped or symlinked replacements as protected.
- Extended macOS permission tests with fallback coverage for owned unreadable paths and for replacement during the fallback window.

### Commands
1. `node --test --test-name-pattern "protectMacState repairs owned unreadable state paths with pathname chmod fallback and secure verification|protectMacState rejects unreadable paths replaced during pathname chmod fallback" test\platform\macos-permissions.test.ts`
   - Result before fix: exit 1.
   - Evidence: no fallback `chmod` occurred for unreadable owned paths, and unreadable replacements failed as `could not be opened securely: denied` instead of the expected path-change rejection.
2. `node --test --test-name-pattern "protectMacState repairs owned unreadable state paths with pathname chmod fallback and secure verification|protectMacState rejects unreadable paths replaced during pathname chmod fallback" test\platform\macos-permissions.test.ts`
   - Result after fix: exit 0.
3. `node --test test\platform\macos-permissions.test.ts`
   - Result: exit 0, 8/8 tests passed.
4. `node --test --test-concurrency=1 --test-isolation=none test\launch\process-runner.test.ts test\platform\windows-permissions.test.ts test\platform\macos-permissions.test.ts test\platform\platform.test.ts`
   - Result: exit 0, 19/19 tests passed.
5. `npm run typecheck`
   - Result: exit 0.

### Self-review
- The fallback is limited to permission-denied opens during protection; normal readable paths still use handle-only chmod and verification.
- Success now requires post-chmod secure reopen plus inode/device equality, so fallback repairs do not report swapped targets as protected.
- The current Node/macOS surface still cannot guarantee that a pathname-target race avoids mutating the replacement before detection, because Node does not expose `fchmodat`/`openat`-style primitives for unreadable entries.
