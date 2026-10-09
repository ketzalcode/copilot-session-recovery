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
