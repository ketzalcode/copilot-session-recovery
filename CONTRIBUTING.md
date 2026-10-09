# Contributing

## Requirements

- Windows x64 or macOS (x64 or arm64)
- Node.js 24.21.0, matching `.node-version`
- npm from the matching Node.js installation
- Windows Terminal on Windows or Apple Terminal on macOS for recovery behavior checks

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

## Pull request expectations

- Keep changes focused.
- Add or update tests with source behavior changes.
- Do not add runtime dependencies without design approval.
- Do not introduce network behavior, telemetry, background services, or private Copilot-state access.
- Run `npm run verify` before asking for review.
