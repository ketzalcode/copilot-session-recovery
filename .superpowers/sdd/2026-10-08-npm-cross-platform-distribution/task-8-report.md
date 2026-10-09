# Task 8 Report

## Files changed
- `AGENTS.md`
- `CONTRIBUTING.md`
- `README.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/troubleshooting.md`
- `package-lock.json`
- `package.json`
- `scripts/audit-runtime.mjs`
- `scripts/build.mjs`
- `scripts/smoke-package.mjs`
- `test/build/build.test.ts`
- deleted `scripts/checksum.mjs`
- deleted `scripts/smoke-sea.mjs`
- deleted `sea-config.json`

## Red / green commands

### Red
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/build.test.ts`
   - Result: exit 1 as expected.
   - Evidence: `package.json` was still `private`, the build still emitted SEA and `.exe` artifacts into `dist`, and `npm pack --json --dry-run` still included the full repository instead of the publish whitelist.

### Green
1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/build.test.ts`
   - Result: exit 0, 4/4 tests passed.
   - Evidence: package metadata matched the exact public npm contract, the built entry started with `#!/usr/bin/env node`, and the dry-run tarball contained only `LICENSE`, `README.md`, `package.json`, and the two bundled `dist` files.
2. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node scripts\smoke-package.mjs`
   - Result: exit 0.
   - Evidence: the tarball installed into an isolated temporary npm prefix, `--version`, `--help`, `install`, and `uninstall --purge` all succeeded, the hook JSON used absolute Node and bundled CLI paths, and the temporary prefix and tarball were removed afterward.
3. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; npm run verify`
   - Result: exit 0.
   - Evidence: `typecheck` passed, all 178 source tests passed, `audit:runtime` passed, `build` produced only the bundled `.mjs` and `.map`, and `smoke:package` passed with cleanup.
4. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; git --no-pager diff --check`
   - Result: exit 0.

## Root cause fix during smoke verification
- `scripts/smoke-package.mjs` initially failed after installation because the process inherited `NPM_CONFIG_PREFIX=C:\.tools\.npm-global`, so `npm install --global` ignored the intended temporary prefix and installed into the real global prefix instead.
- Evidence: running `npm prefix --global` under the spawned smoke environment returned `C:\.tools\.npm-global` even though the script had set `npm_config_prefix` to the temporary directory.
- Fix: strip conflicting case-variant environment keys before applying smoke-script overrides, then assert `npm prefix --global` matches the temporary prefix before installation.

## Self-review
- Replaced the SEA/executable build with a dependency-free npm package contract: `node >=24`, `os: ["win32", "darwin"]`, exact `files` whitelist, public provenance-enabled publish config, and a bundled CLI `bin`.
- Rewrote the build to emit only `dist/copilot-session-recovery.mjs` plus its source map, with a Node shebang and no SEA probing, fuse mutation, resource injection, checksum, or executable copying.
- Strengthened the runtime audit so it still blocks runtime dependencies and networking APIs, and now also guards the exact supported `os`, publishability, and the absence of npm lifecycle install/uninstall scripts.
- Added the package smoke script with structured process spawning, isolated setup/uninstall verification, absolute hook-path checks, and targeted cleanup of only the generated tarball and known temporary prefix.
- Updated directly related docs and repo instructions to describe npm installation, uninstall, verification, and generated artifacts.

## Review note
- The user explicitly required no subagents, so I did a direct self-review instead of dispatching an external reviewer.

## Commit
- `build: replace executable with npm package`

## Concerns
- `.github/workflows/ci.yml` and `.github/workflows/release.yml` still reference the old executable artifacts. That migration is scoped to Task 9, so local verification is green but tagged release automation is intentionally not updated in this task.
- Hosted verification still cannot prove live Apple Terminal tab creation or the macOS Automation permission prompt. The manual macOS boundary from the design remains.

## Round 1/5 follow-up
- Finding addressed: `scripts/smoke-package.mjs` previously let ambient `npm_config_ignore_scripts` skip `prepack`, and ambient `npm_config_pack_destination` changed where npm wrote the tarball while `filename` still resolved as a basename.
- Fix: force deterministic pack behavior with `npm pack --json --ignore-scripts=false --pack-destination <known-temp-dir>`, resolve the tarball from that directory, assert it exists, and clean up the actual emitted tarball plus the known temporary directory.
- Regression coverage: `test/build/build.test.ts` now runs the real smoke script with hostile ambient `npm_config_ignore_scripts=true` and `npm_config_pack_destination=<temp dir>`, after temporarily removing `dist`, and asserts the smoke script succeeds and leaves the hostile pack destination empty.
- Verification:
  1. `Set-Location C:\src\copilot-session-recovery\.worktrees\npm-cross-platform; node --test --test-concurrency=1 --test-isolation=none test/build/build.test.ts`
     - Result: exit 0, 5/5 tests passed.
