# Architecture

Copilot Session Recovery uses official GitHub Copilot CLI lifecycle hooks to maintain a local registry of recoverable sessions. It does not inspect Copilot internals or private state.

## Platform contract

| Platform | Architectures | Recovery terminal | State root | Owned hook file |
| --- | --- | --- | --- | --- |
| Windows | x64 | Windows Terminal (`wt.exe`) | `%LOCALAPPDATA%\copilot-session-recovery` | `%USERPROFILE%\.copilot\hooks\copilot-session-recovery.json` |
| macOS | x64, arm64 | Apple Terminal | `~/Library/Application Support/copilot-session-recovery` | `~/.copilot/hooks/copilot-session-recovery.json` |

`COPILOT_HOME` overrides the default Copilot hook root on both platforms. The
documented persistent-hook setup is a global npm installation because the owned
hook file stores absolute runtime paths and `install` rejects `_npx` cache
entrypoints. Project-local absolute paths may technically launch, but they are
unsupported because persistent hooks become fragile if that package path moves
or is cleaned up.

## Data flow

1. `npm install --global copilot-session-recovery` provides the runtime, and `copilot-session-recovery install [--profile <name>]` creates the default configuration and registry files and writes the owned Copilot hook file under the current user's home directory.
2. `install` writes absolute Node-plus-entry hook commands, not shell text:
   - `"<absolute node path>" "<absolute package entry>" hook session-start`
   - `"<absolute node path>" "<absolute package entry>" hook session-end`
3. Copilot invokes those hook commands with official JSON hook payloads.
4. Hook handlers validate payload shape, fields, and enum values, then update the platform state registry under its lock file.
5. Registry writes use same-directory temporary files and atomic rename. Corrupt registries are copied to the platform `corrupt` directory before the command fails.
6. `copilot-session-recovery recover-sessions` reads the registry and config, validates the platform terminal and each launcher executable, skips records whose working directory is missing, shows a table, confirms once, and launches Windows Terminal or Apple Terminal with structured arguments.
7. `copilot-session-recovery add` lets a user adopt a session that started before hook installation. It validates the full session UUID, working directory, and launcher profile, then applies the same locked `resume` lifecycle transition used by hooks.
8. Successful terminal launch does not remove registry records. Later Copilot `session-start` and clean `session-end` hooks remain authoritative.

The package manifest declares supported operating systems and Node.js 24+, but
it does not declare a `cpu` field. Unsupported architectures are therefore
rejected when commands run through `assertSupportedPlatform`, not necessarily
during `npm install`. For example, Windows arm64 can install the package and
then fail when an operational command starts.

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

## Platform recovery launch

### Windows

Windows recovery launches `wt.exe` with structured arguments only. Session
paths, launcher executables, and launcher arguments stay in separate argv
elements.

### macOS

macOS uses a launch broker so AppleScript never contains session or profile
data:

1. `recover-sessions` writes a locked launch plan under the application state directory.
2. `/usr/bin/osascript` receives only a static AppleScript and the number of required tabs.
3. Each Apple Terminal tab runs the constant command `copilot-session-recovery launch-next`.
4. `launch-next` locks the launch plan, claims one pending entry, changes to its validated working directory, and starts the launcher with structured process arguments.
5. Launch failures stay recorded for retry, and macOS permission denials keep the plan in place.

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

The package manifest sets `publishConfig.access=public` and
`publishConfig.provenance=true`. Publish automation runs only from pushed `v*`
tags in `.github/workflows/release.yml`, where GitHub Actions verifies the tag,
runs `npm run verify` on Windows and macOS, and publishes through npm trusted
publishing.

Hosted verification cannot prove live Apple Terminal automation prompts or tab
behavior. Public release readiness therefore includes an operator-run macOS
check against the packed tarball.
