# Architecture

Copilot Session Recovery uses official GitHub Copilot CLI lifecycle hooks to maintain a local registry of recoverable sessions. It does not inspect Copilot internals or private state.

## Data flow

1. `npm install --global copilot-session-recovery` provides the runtime, and `copilot-session-recovery install [--profile <name>]` creates the default configuration and registry files and writes the owned Copilot hook file under the current user's home directory.
2. Copilot invokes `copilot-session-recovery hook session-start` and `copilot-session-recovery hook session-end` with official JSON hook payloads.
3. Hook handlers validate payload shape, fields, and enum values, then update the platform state registry under its lock file.
4. Registry writes use same-directory temporary files and atomic rename. Corrupt registries are copied to the platform `corrupt` directory before the command fails.
5. `copilot-session-recovery recover-sessions` reads the registry and config, validates the platform terminal and each launcher executable, skips records whose working directory is missing, shows a table, confirms once, and launches Windows Terminal or Apple Terminal with structured arguments.
6. `copilot-session-recovery add` lets a user adopt a session that started before hook installation. It validates the full session UUID, working directory, and launcher profile, then applies the same locked `resume` lifecycle transition used by hooks.
7. Successful terminal launch does not remove registry records. Later Copilot `session-start` and clean `session-end` hooks remain authoritative.

## Components

| Component | Responsibility |
| --- | --- |
| `src/hooks/*` | Validate official hook payloads and fail open with diagnostics. |
| `src/session/*` | Model lifecycle events and clean versus recoverable end reasons. |
| `src/storage/*` | Resolve state paths, lock registry mutations, write JSON atomically, and preserve corrupt evidence. |
| `src/config/*` | Validate launcher profiles and default profile. |
| `src/launch/*` | Build recovery plans and platform terminal launch arguments without a shell. |
| `src/install/*` | Install hooks, validate the npm runtime location, apply platform protections, run diagnostics, and uninstall safely. |
| `src/cli/*` | Parse commands and connect command handlers to production dependencies. |
| `scripts/*` | Test, build, audit, pack, and smoke-test the npm package. |

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
npm run smoke:package
```

`npm run build` creates `dist/copilot-session-recovery.mjs` and `dist/copilot-session-recovery.mjs.map`. `npm run smoke:package` builds the tarball, verifies the publish whitelist, installs it into an isolated npm prefix, exercises `--version`, `--help`, `install`, and `uninstall --purge`, then removes the temporary prefix and tarball.

Local commands do not publish packages. Publish automation is handled separately in GitHub Actions.
