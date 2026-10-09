# Copilot Session Recovery

Recover GitHub Copilot CLI sessions after an unexpected restart.

Copilot Session Recovery records the IDs of active sessions through official Copilot
lifecycle hooks. When a machine restarts, one command reopens the recoverable
sessions in their original working directories.

- **Platforms:** Windows x64, macOS x64, macOS arm64
- **Launchers:** `copilot` and Microsoft `agency copilot`
- **Runtime:** Node.js 24 or newer

## Quick start

Install the global npm package, then run explicit setup:

```powershell
npm install --global copilot-session-recovery
copilot-session-recovery install
```

`install` is a persistent machine setup step. It requires a stable global npm
installation and rejects npm's transient `_npx` cache. Use `npx
copilot-session-recovery --help` or `npx copilot-session-recovery --version`
for one-off inspection only.

Microsoft employees using Agency can select that launcher during installation:

```powershell
copilot-session-recovery install --profile agency
```

If an existing terminal does not find `copilot-session-recovery` after the global
install, open a new terminal so your npm global bin directory is reloaded.

Recovery requires Windows Terminal on Windows and Apple Terminal on macOS. The
first macOS recovery can prompt for Terminal Automation permission.

## Recover after a restart

See what can be recovered:

```powershell
copilot-session-recovery list
```

Preview the recovery commands without opening terminal tabs:

```powershell
copilot-session-recovery recover-sessions --dry-run
```

Recover the sessions:

```powershell
copilot-session-recovery recover-sessions
```

Use `--yes` to skip confirmation or `--profile agency` to override the recorded
launcher for that recovery.

## Add an already-running session

Inside the Copilot session, run `/session id` to copy its full UUID. From the
same working directory, adopt it with:

```powershell
copilot-session-recovery add (Get-Clipboard)
```

Use `--cwd <path>` or `--profile <name>` when the current directory or default
launcher is not the one you want recorded.

## How it works

```text
 GitHub Copilot CLI
        |
        | official sessionStart / sessionEnd hooks
        v
 copilot-session-recovery hook
        |
        | locked, atomic local update
        v
 %LOCALAPPDATA%\copilot-session-recovery\sessions.json
        |
        | recover-sessions
        v
 Windows Terminal / Apple Terminal
   +-- tab: copilot --resume=<session-id>
   +-- tab: agency copilot --resume=<session-id>
```

A clean session ending removes its record. If the machine stops before the end
hook runs, the record remains available for recovery.

The owned Copilot hook file stores absolute Node-plus-entry commands:

- `"<absolute node path>" "<absolute package entry>" hook session-start`
- `"<absolute node path>" "<absolute package entry>" hook session-end`

That stable runtime contract is why persistent setup requires the global npm
installation instead of `npx`.

## Essential commands

| Command | Purpose |
| --- | --- |
| `copilot-session-recovery list` | List recoverable sessions. |
| `copilot-session-recovery recover-sessions` | Reopen sessions in the platform terminal. |
| `copilot-session-recovery add <session-id>` | Adopt an already-running session. |
| `copilot-session-recovery remove <id-prefix>` | Forget one recorded session. |
| `copilot-session-recovery prune --missing-cwd` | Remove sessions whose directories no longer exist. |
| `copilot-session-recovery status` | Check the installation and dependencies. |
| `copilot-session-recovery doctor` | Show detailed diagnostics. |
| `copilot-session-recovery config show` | Show launcher configuration. |

Run `copilot-session-recovery --help` for the complete command surface.

## Local by design

The registry contains only session IDs, working directories, launcher profiles,
lifecycle sources, and timestamps. Copilot Session Recovery does **not** store prompts,
responses, source files, tool output, credentials, tokens, or private Copilot
state.

There is no runtime network behavior, telemetry, daemon, scheduler, or cloud
sync. State stays under `%LOCALAPPDATA%\copilot-session-recovery` on Windows
or `~/Library/Application Support/copilot-session-recovery` on macOS.

## Limitations

- Recovery is for the same user profile and machine.
- It restores sessions, not the exact previous Terminal layout or window state.
- Missing working directories are skipped individually.
- Authentication still belongs to Copilot or Agency.

## Uninstall

Keep saved state for a later reinstall:

```powershell
copilot-session-recovery uninstall
```

Remove the installation and all saved state:

```powershell
copilot-session-recovery uninstall --purge
```

After removing hooks and any optional saved state, remove the global package:

```powershell
npm uninstall --global copilot-session-recovery
```

## Documentation

- [Architecture](docs/architecture.md)
- [Security and privacy](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

Licensed under the [MIT License](LICENSE).
