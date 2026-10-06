# Architecture

Copilot Session Recovery uses official GitHub Copilot CLI lifecycle hooks to maintain a local registry of recoverable sessions. It does not inspect Copilot internals or private state.

## Data flow

1. `copilot-session-recovery install [--profile <name>]` copies the release executable to `%LOCALAPPDATA%\copilot-session-recovery\bin\copilot-session-recovery.exe`, creates default configuration and registry files, and writes `%USERPROFILE%\.copilot\hooks\copilot-session-recovery.json`.
2. Copilot invokes `copilot-session-recovery hook session-start` and `copilot-session-recovery hook session-end` with official JSON hook payloads.
3. Hook handlers validate payload shape, fields, and enum values, then update `%LOCALAPPDATA%\copilot-session-recovery\sessions.json` under `%LOCALAPPDATA%\copilot-session-recovery\sessions.lock`.
4. Registry writes use same-directory temporary files and atomic rename. Corrupt registries are copied to `%LOCALAPPDATA%\copilot-session-recovery\corrupt\` before the command fails.
5. `copilot-session-recovery recover-sessions` reads the registry and config, validates `wt.exe`, validates each launcher executable, skips records whose working directory is missing, shows a table, confirms once, and launches Windows Terminal with `new-tab` commands.
6. `copilot-session-recovery add` lets a user adopt a session that started before hook installation. It validates the full session UUID, working directory, and launcher profile, then applies the same locked `resume` lifecycle transition used by hooks.
6. Successful Windows Terminal launch does not remove registry records. Later Copilot `session-start` and clean `session-end` hooks remain authoritative.

## Components

| Component | Responsibility |
| --- | --- |
| `src/hooks/*` | Validate official hook payloads and fail open with diagnostics. |
| `src/session/*` | Model lifecycle events and clean versus recoverable end reasons. |
| `src/storage/*` | Resolve state paths, lock registry mutations, write JSON atomically, and preserve corrupt evidence. |
| `src/config/*` | Validate launcher profiles and default profile. |
| `src/launch/*` | Build recovery plans and Windows Terminal argument arrays without a shell. |
| `src/install/*` | Install hooks, manage current-user PATH, apply best-effort ACLs, run diagnostics, and uninstall safely. |
| `src/cli/*` | Parse commands and connect command handlers to production dependencies. |
| `scripts/*` | Test, build, checksum, audit, and smoke-test release artifacts. |

## Lifecycle reason policy

| Hook event | Source or reason | Registry behavior | Rationale |
| --- | --- | --- | --- |
| `sessionStart` | `startup` | Upsert record | A new active session may need recovery if the machine restarts. |
| `sessionStart` | `resume` | Upsert record | A resumed session is active again and should remain tracked. |
| `sessionStart` | `new` | Upsert record | A new active session may need recovery. |
| `sessionEnd` | `complete` | Remove record | The session finished cleanly. |
| `sessionEnd` | `user_exit` | Remove record | The user intentionally closed the session. |
| `sessionEnd` | `error` | Keep record | The session may still be recoverable. |
| `sessionEnd` | `abort` | Keep record | The session may still be recoverable. |
| `sessionEnd` | `timeout` | Keep record | The session may still be recoverable. |
| No end event | Not applicable | Keep record | Crashes and restarts naturally leave recoverable records behind. |

## Launcher profiles

The default profiles are:

```json
{
  "copilot": {
    "executable": "copilot",
    "args": ["--resume={sessionId}"]
  },
  "agency": {
    "executable": "agency",
    "args": ["copilot", "--resume={sessionId}"]
  }
}
```

Profiles are structured executable-plus-argument arrays. Supported placeholders are `{sessionId}`, `{cwd}`, and `{sessionIdPrefix}`.

## Build and release flow

`npm run verify` performs the full local validation pipeline:

```powershell
npm run typecheck
npm test
npm run audit:runtime
npm run build
npm run checksum
npm run smoke:sea
```

`npm run build` creates `dist/copilot-session-recovery.mjs` and `dist/copilot-session-recovery-windows-x64.exe`. `npm run checksum` creates `dist/copilot-session-recovery-windows-x64.exe.sha256`. The release workflow also creates `dist/copilot-session-recovery-windows-x64.spdx.json` and a GitHub provenance attestation.

Local commands do not publish releases. GitHub Releases are created only by `.github/workflows/release.yml` when a `v*` tag is pushed.
