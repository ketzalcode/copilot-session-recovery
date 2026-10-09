# Security

## Hook payload validation

Hook handlers accept only official JSON object shapes:

- `sessionStart`: `sessionId`, `timestamp`, `cwd`, `source`
- `sessionEnd`: `sessionId`, `timestamp`, `cwd`, `reason`

Unexpected fields fail validation. Session IDs must be valid UUIDs, timestamps must be safe non-negative integers, working directories must be non-empty strings, start sources must be `startup`, `resume`, or `new`, and end reasons must be `complete`, `error`, `abort`, `timeout`, or `user_exit`.

Hooks fail open for Copilot. On validation or storage errors, the hook writes a diagnostic log when possible, prints a warning to stderr, prints `{}` to stdout, and exits successfully so Copilot is not blocked.

## Persistent npm installation contract

The documented persistent-hook setup is a persistent global npm installation.
The owned Copilot hook file records absolute paths to:

- the current `process.execPath`; and
- the bundled package entry file in the global installation.

If the runtime entry file resolves under npm's transient `_npx` cache, `install`
fails before mutating the filesystem. `npx` is intentionally limited to
transient commands such as `--help` and `--version`. Other absolute package
paths, including project-local installs, may technically launch but remain
unsupported for persistent hooks because the recorded paths can stop working if
that package location changes.

## No shell execution

Copilot Session Recovery launches processes with structured executable and argument arrays. It does not concatenate session IDs, paths, or profile values into shell command strings for recovery.

Windows Terminal recovery uses `wt.exe` arguments built as an array. Launcher profiles are also executable-plus-argument arrays.

## macOS launch broker

Apple Terminal automation eventually executes shell text, so the product keeps
session and profile data out of AppleScript entirely.

`recover-sessions` writes a locked launch plan whose entries contain validated
structured process definitions. `/usr/bin/osascript` receives only:

- the static AppleScript source; and
- the required tab count.

Each Apple Terminal tab then runs the constant broker command
`copilot-session-recovery launch-next`. That broker locks the launch plan,
claims a single pending entry, changes to its validated working directory, and
spawns the launcher with structured executable and argument arrays. Permission
denials preserve the plan for retry instead of losing recovery state.

Public retry validates the existing plan under the same lock and opens only the
number of entries still marked `pending` or `failed`. It reuses their persisted
structured process data. Current registry and `--profile` changes never replace
an active plan silently. Explicit discard is available through
`recover-sessions --discard-plan` and refuses to remove a plan with an active
`launching` claim.

## Custom profile trust boundary

Custom launcher profiles are trusted local configuration. The tool validates their schema and placeholder syntax, but it does not decide whether a local executable is safe. Add profiles only for launchers you trust.

Supported placeholders are `{sessionId}`, `{cwd}`, and `{sessionIdPrefix}`.

## User-only state protection

State is stored under `%LOCALAPPDATA%\copilot-session-recovery` on Windows and `~/Library/Application Support/copilot-session-recovery` on macOS. Install applies best-effort current-user ACL protection with the current Windows SID and `icacls.exe`, and it enforces user-only `0700` / `0600` permissions on macOS. `status` and `doctor` report whether the platform check can verify current-user protection.

Windows ACL hardening remains best effort and reports a warning when it cannot
be verified. macOS protection is mandatory. Install rejects symlinked,
foreign-owned, or unverifiable pre-existing state paths before state writes.
After creating directories and state files, it protects and revalidates them
before writing the Copilot hook. A mandatory protection failure exits nonzero,
removes state created by that failed attempt, leaves no hook active, and
surfaces any cleanup failure together with the protection error.

## Atomic writes and corrupt evidence

Registry mutations use an exclusive lock file, bounded retries, stale-lock handling, reread-under-lock, same-directory temporary files, file sync, and atomic rename.

If `sessions.json` is corrupt, the original bytes are preserved under the platform `corrupt` directory using a timestamp and SHA-256-addressed filename. The registry is reset only when the user explicitly runs:

```powershell
copilot-session-recovery doctor --repair-registry
```

## No network or telemetry

V1 has no runtime network behavior and no telemetry. `npm run audit:runtime` fails if source imports forbidden Node networking modules or uses `fetch` or `WebSocket`, and it fails if runtime npm dependencies are added.

## Release integrity

Local package verification:

- inspects `npm pack --json` output for the exact publish whitelist;
- smoke-installs the generated tarball into an isolated npm prefix;
- exercises `--version`, `--help`, `install`, and `uninstall --purge`;
- removes the generated tarball and temporary prefix afterward.

The package manifest enables npm provenance for supported publish flows. The
release workflow publishes only from pushed `v*` tags, uses GitHub Actions OIDC
trusted publishing, and avoids long-lived npm automation tokens. Local
commands build and validate artifacts only. They do not publish packages.

## Manual Apple Terminal release boundary

Hosted CI cannot approve macOS Automation prompts or verify that live Apple
Terminal tabs resume the expected sessions. Before the first public release, and
after any terminal-launch contract change, an operator must manually verify the
packed tarball on macOS and record the result in the release checklist.

## Private Copilot state prohibition

Copilot Session Recovery must not read, parse, store, infer, or depend on private Copilot state, internal cache files, prompts, responses, tool output, credentials, tokens, source files, or environment dumps. The only Copilot input accepted by the product is the official lifecycle-hook payload.
