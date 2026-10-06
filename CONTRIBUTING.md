# Contributing

## Requirements

- Windows x64
- Node.js 24.21.0, matching `.node-version`
- npm from the matching Node.js installation
- Windows Terminal for recovery behavior and SEA smoke coverage

## Setup

```powershell
npm install
```

## Validate

```powershell
npm run verify
```

`npm run verify` runs type checking, source tests, the runtime no-network audit, the Windows executable build, SHA-256 generation, and the self-contained executable smoke test.

For documentation and workflow changes, also run:

```powershell
git --no-pager diff --check
```

## Generated files

`dist\` is generated and ignored. It contains the bundled JavaScript, Windows x64 executable, checksum, and transient build files. Do not edit or commit generated files.

`node_modules\` and `coverage\` are also ignored.

## Release artifacts

The release workflow publishes these assets for pushed `v*` tags:

- `dist/copilot-auto-save-windows-x64.exe`
- `dist/copilot-auto-save-windows-x64.exe.sha256`
- `dist/copilot-auto-save-windows-x64.spdx.json`
- GitHub build provenance attestation for the executable

Local validation does not publish a release.

## Pull request expectations

- Keep changes focused.
- Add or update tests with source behavior changes.
- Do not add runtime dependencies without design approval.
- Do not introduce network behavior, telemetry, background services, or private Copilot-state access.
- Run `npm run verify` before asking for review.
