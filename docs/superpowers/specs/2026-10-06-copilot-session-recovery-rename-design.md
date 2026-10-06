# Copilot Session Recovery Rename Design

**Date:** October 6, 2026

## Goal

Rename the unreleased Copilot Auto Save project to **Copilot Session Recovery**
before its first public push. The rename must cover every public and internal
identity without changing session-tracking or recovery behavior.

## Product contract

| Surface | New value |
| --- | --- |
| Product name | Copilot Session Recovery |
| Repository | `ketzalcode/copilot-session-recovery` |
| Installed command | `copilot-session-recovery` |
| Windows executable | `copilot-session-recovery.exe` |
| Release executable | `copilot-session-recovery-windows-x64.exe` |
| Application directory | `%LOCALAPPDATA%\copilot-session-recovery` |
| Copilot hook file | `%USERPROFILE%\.copilot\hooks\copilot-session-recovery.json` |
| Internal environment prefix | `COPILOT_SESSION_RECOVERY_*` |
| npm package name | `copilot-session-recovery` |

The existing subcommands, flags, registry schema, launcher profiles, privacy
boundary, and recovery behavior remain unchanged.

## Implementation approach

Use a clean replacement rather than compatibility aliases:

1. Change contract tests first for CLI help, resolved paths, installer output,
   build artifacts, hook configuration, and environment-variable names.
2. Confirm the updated tests fail against the old identity.
3. Rename runtime source, build scripts, tests, workflows, documentation, issue
   templates, package metadata, and release assets.
4. Require searches of product code, tests, user documentation, workflows, and
   package metadata for `copilot-auto-save`, `Copilot Auto Save`, and
   `COPILOT_AUTO_SAVE` to return no matches. This historical design record is
   excluded from that check.
5. Run the full Node 24 verification pipeline and inspect the renamed
   self-contained executable.

No migration or legacy-name compatibility code will ship because the old name
was never publicly released.

## Local development installation

The current machine already has the unreleased `copilot-auto-save` executable,
hook, PATH entry, configuration, and session registry. That state will be
migrated once, outside the product:

1. Wait until the current Copilot session has ended so its old lifecycle hook
   is not removed while active.
2. Back up the old configuration and session registry.
3. Copy the configuration and registry into the new application directory.
4. Install the renamed executable and verify `status` and `list`.
5. Confirm the new registry contains the expected recoverable sessions.
6. Remove the old hook, PATH entry, executable, and state only after the new
   installation is verified.

The one-time migration will be provided as a PowerShell procedure after the
repository is published. It will not be committed or included in releases.

## Publishing

After implementation and verification:

1. Commit the rename separately from the initial implementation commit.
2. Rename the local checkout directory to
   `C:\src\copilot-session-recovery`.
3. Create the public `ketzalcode/copilot-session-recovery` repository.
4. Configure `origin` and push `main`.

GitHub operations will use the already-authenticated `RubenSaucedo` identity,
which has active administrator access to the `ketzalcode` organization. The
default `gh` identity will not be changed.

## Error handling and safety

- Do not overwrite or delete legacy local state before the renamed
  installation has copied and verified it.
- Do not copy lock files or temporary files during the one-time migration.
- Keep structured process arguments and existing no-shell recovery behavior.
- Keep the no-network and no-telemetry runtime guarantees.
- Stop publishing if tests, the runtime audit, the SEA build, checksum, smoke
  test, staged diff check, or repository identity search fails.

## Verification

The rename is complete only when:

- Contract tests demonstrate the new command, paths, hook name, package name,
  environment prefix, and release assets.
- `npm run verify` passes on Node.js 24.21.0.
- The built executable reports the expected help and version.
- The three legacy identity searches return no matches outside this historical
  design record.
- Git status is clean after the rename commit.
- The public repository exists at `ketzalcode/copilot-session-recovery` and
  `main` is pushed to its configured `origin`.
