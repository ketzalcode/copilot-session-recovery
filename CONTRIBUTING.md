# Contributing

## Requirements

- Windows x64 or macOS (x64 or arm64)
- Node.js 24.21.0, matching `.node-version`
- npm from the matching Node.js installation
- Windows Terminal on Windows or Apple Terminal on macOS for recovery behavior checks
- A persistent npm installation for `install`; `_npx` entrypoints are intentionally rejected

## Setup

```powershell
npm install
```

## Validate

```powershell
npm run verify
```

`npm run verify` runs type checking, source tests, the runtime no-network and package-metadata audit, the bundled CLI build, and the package smoke test.

For documentation and workflow changes, also run:

```powershell
git --no-pager diff --check
```

## Generated files

`dist\` is generated and ignored. It contains the bundled JavaScript, source map, and transient build files. Do not edit or commit generated files.

`copilot-session-recovery-0.1.0.tgz` can be created transiently during package smoke testing and is removed before the smoke script exits.

`node_modules\` and `coverage\` are also ignored.

## Package artifacts

The publishable package contains:

- `package.json`
- `README.md`
- `LICENSE`
- `dist/copilot-session-recovery.mjs`
- `dist/copilot-session-recovery.mjs.map`

Local validation does not publish a package.

## Release contract

- Public distribution is the global npm package `copilot-session-recovery`.
- `publishConfig.provenance=true` enables npm provenance on supported publish
  flows.
- Release automation publishes only from pushed `v*` tags in
  `.github/workflows/release.yml`.
- The publish job uses npm trusted publishing from GitHub Actions. Do not add
  long-lived npm automation tokens to the repository or workflows.

## Operator-only macOS release check

Hosted verification cannot prove live Apple Terminal tab automation. Before the
first public release, and whenever the terminal-launch contract changes, an
operator on macOS must run this sequence against the packed tarball:

```powershell
npm pack
npm install --global .\copilot-session-recovery-0.1.0.tgz
copilot-session-recovery install
copilot-session-recovery doctor
copilot-session-recovery recover-sessions --dry-run
copilot-session-recovery recover-sessions
copilot-session-recovery uninstall --purge
npm uninstall --global copilot-session-recovery
```

Record whether Apple Terminal prompted for Automation permission, whether each
tab resumed the expected session in the expected directory, whether denial kept
the launch plan for retry, and whether uninstall plus purge removed the owned
hook and application state.

## Pull request expectations

- Keep changes focused.
- Add or update tests with source behavior changes.
- Do not add runtime dependencies without design approval.
- Do not introduce network behavior, telemetry, background services, or private Copilot-state access.
- Run `npm run verify` before asking for review.
