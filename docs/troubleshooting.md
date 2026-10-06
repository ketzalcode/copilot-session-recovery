# Troubleshooting

Start with these commands:

```powershell
copilot-auto-save status
copilot-auto-save doctor
copilot-auto-save list
copilot-auto-save recover-sessions --dry-run
```

Review output for sensitive local paths before sharing it.

## `wt.exe` is missing

`recover-sessions`, `status`, and `doctor` require Windows Terminal to be available as `wt.exe` on PATH. Install Windows Terminal or repair PATH, then restart the terminal and run:

```powershell
copilot-auto-save doctor
```

## Launcher is missing

If diagnostics report that the default launcher is unavailable, check the active profile:

```powershell
copilot-auto-save config show
```

For standard GitHub Copilot CLI recovery, make sure `copilot` is on PATH. For Agency recovery, make sure `agency` is on PATH and set:

```powershell
copilot-auto-save config set default-profile agency
```

Preview with:

```powershell
copilot-auto-save recover-sessions --dry-run
```

## Working directory is missing

Recovery skips records whose `cwd` no longer exists and prints `working-directory-missing`. Remove stale records with:

```powershell
copilot-auto-save prune --missing-cwd
```

Or remove a specific record by full ID or unambiguous prefix:

```powershell
copilot-auto-save remove <id-prefix>
```

## Registry is corrupt

`status` and `doctor` report preserved evidence when `%LOCALAPPDATA%\copilot-auto-save\sessions.json` cannot be parsed or validated. Review the evidence path, then repair explicitly:

```powershell
copilot-auto-save doctor --repair-registry
```

Repair preserves corrupt evidence and creates an empty registry.

## Enterprise hook policy blocks hooks

If sessions never appear in `copilot-auto-save list`, run:

```powershell
copilot-auto-save doctor
```

If the session started before Copilot Auto Save was installed, enter
`/session id` inside Copilot and adopt it from the session working directory:

```powershell
copilot-auto-save add (Get-Clipboard)
```

Confirm the owned hook exists at `%USERPROFILE%\.copilot\hooks\copilot-auto-save.json`, or under `%COPILOT_HOME%\hooks\copilot-auto-save.json` when `COPILOT_HOME` is set.

If your organization disables or overrides user hooks, Copilot may not invoke `hook session-start` or `hook session-end`. In that case, recovery cannot work until hooks are allowed by policy.

## Existing terminal does not find `copilot-auto-save`

Install updates the current user's PATH, but already-open terminals keep their old environment. Restart Windows Terminal after:

```powershell
.\copilot-auto-save-windows-x64.exe install
```

Until the terminal is restarted, run the installed executable by full path:

```powershell
& "$env:LOCALAPPDATA\copilot-auto-save\bin\copilot-auto-save.exe" status
```

## Unsigned first release warning

Early releases may be unsigned and can trigger Windows SmartScreen or enterprise application-control warnings. Verify the downloaded executable against the release checksum before deciding whether to run it:

```powershell
Get-FileHash .\copilot-auto-save-windows-x64.exe -Algorithm SHA256
Get-Content .\copilot-auto-save-windows-x64.exe.sha256
```

The hash from `Get-FileHash` must match the first field in the `.sha256` file. If your organization requires signed binaries, do not bypass policy.

## Recovery preview works but launch fails

Run:

```powershell
copilot-auto-save recover-sessions --dry-run
```

Check that each listed working directory exists and that the launcher command matches the intended profile. Then run:

```powershell
copilot-auto-save doctor
```

Fix any `ERROR` diagnostics before launching without `--dry-run`.
