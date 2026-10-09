# Task 9 Report

## Files changed
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `scripts/check-release-version.d.mts`
- `scripts/check-release-version.mjs`
- `test/build/release-version.test.ts`

## Red / green commands

### Red
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/release-version.test.ts test/build/build.test.ts`
   - Result: exit 1 as expected.
   - Evidence: `scripts/check-release-version.mjs` did not exist yet, so the new release-contract test failed immediately and the old workflows still targeted the Windows executable release path.

### Green
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/release-version.test.ts test/build/build.test.ts`
   - Result: exit 0, 10/10 tests passed.
   - Evidence: the new tag/version validator worked, CI asserted the Windows/macOS matrix, and release asserted the separate verify jobs plus trusted npm publish flow.
2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run verify`
   - Result: exit 0.
   - Evidence: `tsc --noEmit` passed, all 184 tests passed, `audit:runtime` passed, `build` succeeded, and `smoke:package` succeeded.
3. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; git --no-pager diff --check`
   - Result: exit 0.

## Root-cause fixes during verification
- `npm run verify` initially failed at `tsc --noEmit` because the new TypeScript test imported `scripts/check-release-version.mjs` without a declaration file.
  - Fix: added `scripts/check-release-version.d.mts`.
- `git add` initially failed under `core.safecrlf=true` because `.ts` files in this repo must stay LF while the modified workflow/script files are auto-text in a Windows worktree.
  - Fix: normalized `test/build/release-version.test.ts` to LF and restored the modified workflow/script files to CRLF.

## Self-review
- CI now verifies on a Windows/macOS matrix while keeping the commit-metadata guard steps on the Windows leg only.
- Release now runs separate Windows and macOS verification jobs and gates a distinct publish job on both, matching the binding-ledger ruling.
- Publish uses pinned `actions/checkout@v7.0.1` and `actions/setup-node@v7.0.0`, npm registry setup, OIDC trusted publishing, and an exact tag/package version check.
- The workflows no longer mention `.exe`, checksum, SBOM binary input, provenance attestation jobs, artifact uploads, or GitHub Release asset creation.

## Review note
- The user explicitly required no subagents, so I did a direct self-review instead of dispatching a reviewer.

## Commit
- `ff42980` — `ci: publish npm package from version tags`

## Concerns
- npm trusted publishing still requires one-time trusted publisher configuration in npm for this repository and `release.yml` before the first tagged release can succeed.
- Hosted verification still cannot prove live Apple Terminal automation behavior; the existing manual macOS runtime boundary remains.

## Round 1/5 fix
- Finding verified: `release.yml` still granted `id-token: write` workflow-wide, so both verify jobs could mint OIDC before the version check and publish gate.
- Root cause: Task 9's original contract test only asserted that `permissions` contained both keys somewhere in the workflow, which let the unsafe top-level grant ship unnoticed.
- Fix: tightened `test/build/release-version.test.ts` to require workflow-level `permissions` to stay `contents: read` only and to require `publish` to declare `contents: read` plus `id-token: write` itself.
- Fix: moved the OIDC grant to `jobs.publish.permissions` in `.github/workflows/release.yml`, leaving the workflow-wide permission as `contents: read`.
- Verification:
  1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/release-version.test.ts`
     - Result: exit 1 before the workflow change, with the new contract test failing on the workflow-wide `id-token: write`.
  2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/release-version.test.ts test/build/build.test.ts`
     - Result: exit 0, 10/10 tests passed after the workflow and contract-test updates.
  3. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/release-version.test.ts test/build/build.test.ts; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; npm run verify; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; git --no-pager diff --check`
     - Result: exit 0.
     - Evidence: 10/10 targeted tests passed, `npm run verify` passed with all 184 tests green plus `typecheck`, `audit:runtime`, `build`, and `smoke:package`, and `git diff --check` stayed clean.
