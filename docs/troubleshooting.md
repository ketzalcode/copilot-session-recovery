# Troubleshooting

Start with these commands:

```powershell
copilot-session-recovery status
copilot-session-recovery doctor
copilot-session-recovery list
copilot-session-recovery recover-sessions --dry-run
```

Review output for sensitive local paths before sharing it.

## `wt.exe` is missing

`recover-sessions`, `status`, and `doctor` require Windows Terminal to be available as `wt.exe` on PATH. Install Windows Terminal or repair PATH, then restart the terminal and run:

```powershell
copilot-session-recovery doctor
```

## Launcher is missing

If diagnostics report that the default launcher is unavailable, check the active profile:

```powershell
copilot-session-recovery config show
```

For standard GitHub Copilot CLI recovery, make sure `copilot` is on PATH. For Agency recovery, make sure `agency` is on PATH and set:

```powershell
copilot-session-recovery config set default-profile agency
```

Preview with:

```powershell
copilot-session-recovery recover-sessions --dry-run
```

## Working directory is missing

Recovery skips records whose `cwd` no longer exists and prints `working-directory-missing`. Remove stale records with:

```powershell
copilot-session-recovery prune --missing-cwd
```

Or remove a specific record by full ID or unambiguous prefix:

```powershell
copilot-session-recovery remove <id-prefix>
```

## Registry is corrupt

`status` and `doctor` report preserved evidence when `%LOCALAPPDATA%\copilot-session-recovery\sessions.json` cannot be parsed or validated. Review the evidence path, then repair explicitly:

```powershell
copilot-session-recovery doctor --repair-registry
```

Repair preserves corrupt evidence and creates an empty registry.

## Enterprise hook policy blocks hooks

If sessions never appear in `copilot-session-recovery list`, run:

```powershell
copilot-session-recovery doctor
```

If the session started before Copilot Session Recovery was installed, enter
`/session id` inside Copilot and adopt it from the session working directory:

```powershell
copilot-session-recovery add (Get-Clipboard)
```

Confirm the owned hook exists at `%USERPROFILE%\.copilot\hooks\copilot-session-recovery.json`, or under `%COPILOT_HOME%\hooks\copilot-session-recovery.json` when `COPILOT_HOME` is set.

If your organization disables or overrides user hooks, Copilot may not invoke `hook session-start` or `hook session-end`. In that case, recovery cannot work until hooks are allowed by policy.

## Existing terminal does not find `copilot-session-recovery`

Install updates the current user's PATH, but already-open terminals keep their old environment. Restart Windows Terminal after:

```powershell
.\copilot-session-recovery-windows-x64.exe install
```

Until the terminal is restarted, run the installed executable by full path:

```powershell
& "$env:LOCALAPPDATA\copilot-session-recovery\bin\copilot-session-recovery.exe" status
```

## Unsigned first release warning

Early releases may be unsigned and can trigger Windows SmartScreen or enterprise application-control warnings. Verify the downloaded executable against the release checksum before deciding whether to run it:

```powershell
Get-FileHash .\copilot-session-recovery-windows-x64.exe -Algorithm SHA256
Get-Content .\copilot-session-recovery-windows-x64.exe.sha256
```

The hash from `Get-FileHash` must match the first field in the `.sha256` file. If your organization requires signed binaries, do not bypass policy.

## Recovery preview works but launch fails

Run:

```powershell
copilot-session-recovery recover-sessions --dry-run
```

Check that each listed working directory exists and that the launcher command matches the intended profile. Then run:

```powershell
copilot-session-recovery doctor
```

Fix any `ERROR` diagnostics before launching without `--dry-run`.
