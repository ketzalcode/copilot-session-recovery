# Troubleshooting

Start with these commands:

```powershell
copilot-session-recovery status
copilot-session-recovery doctor
copilot-session-recovery list
copilot-session-recovery recover-sessions --dry-run
```

Review output for sensitive local paths before sharing it.

## Recovery terminal is unavailable

### Windows: `wt.exe` is missing

`recover-sessions`, `status`, and `doctor` require Windows Terminal to be
available as `wt.exe` on PATH. Install Windows Terminal or repair PATH, then
restart the terminal and run:

```powershell
copilot-session-recovery doctor
```

### macOS: Apple Terminal is unavailable

`recover-sessions`, `status`, and `doctor` require Apple Terminal to be
installed and launchable. If diagnostics report that Apple Terminal is
unavailable, run:

```powershell
copilot-session-recovery doctor
```

Repair the local Terminal installation, then retry recovery.

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

## `install` rejects `npx`

Persistent setup writes absolute hook commands for the current Node executable
and the globally installed package entry file. `npx` runs from a transient
`_npx` cache, so `install` rejects it by design. Use:

```powershell
npm install --global copilot-session-recovery
copilot-session-recovery install
```

The supported persistent-hook setup is the global npm install above. A
project-local or other absolute package path may technically launch because the
runtime check specifically rejects `_npx`, but that setup is unsupported and
can become unstable when the package directory moves or is cleaned up.

## Existing terminal does not find `copilot-session-recovery`

Global npm installs expose `copilot-session-recovery` through your npm prefix. Already-open terminals keep their old environment. After:

```powershell
npm install --global copilot-session-recovery
```

open a new terminal so your npm global bin directory is reloaded. Then run:

```powershell
copilot-session-recovery install
```

## Diagnostics say the installed npm runtime is unavailable

If `status` or `doctor` reports that the installed npm runtime is unavailable,
the absolute Node path or package entry file recorded at install time likely
moved or was removed. Reinstall or repair Node.js or the global package, then
rerun:

```powershell
copilot-session-recovery install
copilot-session-recovery doctor
```

## Install fails or commands report an unsupported platform

The package requires Node.js 24 or newer and supports Windows x64 plus macOS x64 or arm64. Check:

```powershell
node --version
npm --version
```

`npm install` can reject unsupported operating systems because the package
declares `os`, and Node or npm can reject older Node.js versions because the
package declares `engines.node >=24`.

The package does not declare a `cpu` field, so architecture support is enforced
when `copilot-session-recovery` commands start. An unsupported architecture
such as Windows arm64 can therefore install successfully and then fail at
runtime with `Unsupported platform: win32 arm64.`

If install or command startup reports an unsupported platform, move to a
supported machine. If Node is older than 24, install the version from
`.node-version` and retry the global install.

## macOS recovery reports Automation or Accessibility denial

The first macOS recovery can trigger Apple Terminal Automation permission
prompts. If recovery reports an Automation denial, allow your terminal app in:

`System Settings > Privacy & Security > Automation`

If recovery reports that `System Events` denied tab automation, allow your
terminal app or `osascript` in:

`System Settings > Privacy & Security > Accessibility`

After approval, rerun:

```powershell
copilot-session-recovery recover-sessions
```

The launch plan stays on disk so the sessions remain recoverable while you fix
permissions.

The next `copilot-session-recovery recover-sessions` call validates and resumes
that plan before reading a new registry/profile selection. It opens only the
entries still marked pending or failed and keeps their original structured
working directories and process arguments. If the registry changed or you pass
a different `--profile`, the command states that the preserved plan wins; it
does not silently replace the plan.

Preview the preserved retry without opening tabs:

```powershell
copilot-session-recovery recover-sessions --dry-run
```

To intentionally abandon the preserved selection, run this standalone command:

```powershell
copilot-session-recovery recover-sessions --discard-plan
```

Discard validates the plan under its lock and refuses while an entry is
currently launching. After a successful discard, rerun `recover-sessions` to
build a new plan from the current registry and profile selection.

## macOS install rejects or cannot protect the application path

macOS setup requires the application directory and state files to be owned by
the current user, non-symlinked, and verifiably restricted to user-only modes.
An unsafe pre-existing application path is rejected before state writes or hook
activation.

If protection fails after setup created new state, install exits nonzero,
removes state created by that failed attempt, and does not activate the Copilot
hook. Cleanup failures are reported with the original protection error. Inspect
the named path and ownership; do not replace the application directory with a
symlink. After correcting the path, rerun:

```powershell
copilot-session-recovery install
copilot-session-recovery doctor
```

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
