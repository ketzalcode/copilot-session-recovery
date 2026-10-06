# Copilot Session Recovery

Recover GitHub Copilot CLI sessions after an unexpected Windows restart.

Copilot Session Recovery records the IDs of active sessions through official Copilot
lifecycle hooks. When a machine restarts, one command reopens the recoverable
sessions as Windows Terminal tabs in their original working directories.

- **Platform:** Windows x64
- **Launchers:** `copilot` and Microsoft `agency copilot`

## Quick start

Download `copilot-session-recovery-windows-x64.exe` from the latest GitHub Release,
then install it for the current Windows user:

```powershell
.\copilot-session-recovery-windows-x64.exe install
```

Microsoft employees using Agency can select that launcher during installation:

```powershell
.\copilot-session-recovery-windows-x64.exe install --profile agency
```

Open a new terminal after installation so the updated user `PATH` is available.
No Node.js installation or administrator access is required.

## Recover after a restart

See what can be recovered:

```powershell
copilot-session-recovery list
```

Preview the Windows Terminal tabs without opening them:

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
 Windows Terminal
   +-- tab: copilot --resume=<session-id>
   +-- tab: agency copilot --resume=<session-id>
```

A clean session ending removes its record. If Windows stops before the end hook
runs, the record remains available for recovery.

## Essential commands

| Command | Purpose |
| --- | --- |
| `copilot-session-recovery list` | List recoverable sessions. |
| `copilot-session-recovery recover-sessions` | Reopen sessions in Windows Terminal. |
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
sync. State stays under `%LOCALAPPDATA%\copilot-session-recovery`.

## Limitations

- Recovery is for the same Windows user profile and machine.
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

## Documentation

- [Architecture](docs/architecture.md)
- [Security and privacy](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)
- [Security reporting](SECURITY.md)

Licensed under the [MIT License](LICENSE).
