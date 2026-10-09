# Task 10 Report

## Files changed
- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/troubleshooting.md`
- `.github/ISSUE_TEMPLATE/bug.yml`

## Summary
- Documented the exact npm-only install and uninstall contract, including the
  persistent global install requirement and the intentional `_npx` rejection for
  `install`.
- Documented the Windows/macOS platform matrix, state paths, absolute
  Node-plus-entry hook contract, and the macOS static AppleScript plus locked
  `launch-next` broker model.
- Documented npm provenance, GitHub Actions trusted publishing, and the
  operator-only Apple Terminal manual release verification boundary.
- Removed active SEA, EXE, checksum, and SmartScreen guidance from current
  product docs while preserving historical records under `docs/superpowers` and
  `.superpowers`.

## Validation
- `git --no-pager diff --check`
- `rg -n "windows-x64\.exe|smoke:sea|sea-config|SmartScreen|checksum|self-contained executable" README.md CONTRIBUTING.md AGENTS.md docs .github/ISSUE_TEMPLATE`
- `npm run verify`

## Review note
- The user explicitly required no subagents, so I completed the review and
  documentation pass directly.

## Concerns
- Historical SEA and EXE references intentionally remain under
  `docs/superpowers` and `.superpowers`.
- The Apple Terminal manual release check remains operator work, not something
  CI or local automation can fully prove.

## Round 1 fixes
- Clarified across `README.md`, `CONTRIBUTING.md`, `AGENTS.md`,
  `docs/architecture.md`, `docs/security.md`, and `docs/troubleshooting.md`
  that the supported persistent-hook setup is the global npm install, while the
  actual enforcement only rejects transient `_npx` cache entrypoints. The docs
  now state that project-local absolute paths may technically launch but are
  unsupported and unstable for persistent hooks.
- Corrected the platform-troubleshooting guidance to match the package
  manifest and runtime enforcement. The docs now explain that `os` and Node
  version checks can fail at install time, but architecture support is enforced
  when commands run because the package has no `cpu` field. Windows arm64 is
  called out as a concrete install-succeeds/runtime-fails example.

## Round 1 validation
- `git --no-pager diff --check`
- `rg -n "global npm|_npx|project-local|Unsupported platform: win32 arm64|cpu field|unsupported architecture" README.md CONTRIBUTING.md AGENTS.md docs`
