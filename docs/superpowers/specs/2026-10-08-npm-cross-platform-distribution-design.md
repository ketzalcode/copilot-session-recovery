# npm-Only Cross-Platform Distribution Design

**Date:** October 8, 2026

## Goal

Replace the unreleased Windows SEA executable with one public, dependency-free
npm CLI that supports Windows x64 plus macOS on Intel and Apple Silicon. Users
install it globally and then run an explicit setup command:

```text
npm install --global copilot-session-recovery
copilot-session-recovery install
```

The package requires Node.js 24 or newer. The product keeps its existing
privacy boundary: it uses only official Copilot lifecycle-hook metadata and
never reads or stores prompts, responses, source content, tool output,
credentials, tokens, or private Copilot state.

## Product decisions

| Surface | Decision |
| --- | --- |
| Distribution | Public npm package only |
| Package and command | `copilot-session-recovery` |
| Runtime | Node.js 24 or newer |
| Supported platforms | Windows x64; macOS x64 and arm64 |
| Windows recovery UI | Windows Terminal |
| macOS recovery UI | Apple Terminal tabs |
| Setup | Global npm install followed by explicit `install` |
| Runtime dependencies | None |
| Legacy executable | Remove all SEA and EXE behavior and artifacts |
| Publishing | Version tags through GitHub Actions and npm trusted publishing |

The repository is unreleased, so this is a clean replacement. It does not
include compatibility aliases, dual distribution, executable migration, or
legacy installation cleanup.

## Rejected approaches

### Native binaries inside an npm package

This retains platform-specific executable builds, duplicates release paths, and
does not provide the requested npm-only architecture.

### Persistent hooks through `npx`

`npx` resolves packages through an npm cache and may download or select mutable
package content when a lifecycle hook runs. Its package location is not a
stable installation target. It is unsuitable for persistent hooks and would
weaken offline behavior and supply-chain boundaries.

The CLI may allow transient commands such as
`npx copilot-session-recovery --help`, but `install` must reject a package
entrypoint under npm's temporary `_npx` cache. Documentation and diagnostics
must require a global npm installation.

## Architecture

### Shared core

The following behavior remains platform-neutral:

- lifecycle-hook payload validation;
- session lifecycle transitions;
- registry locking and atomic JSON writes;
- corrupt-registry preservation;
- launcher profile validation and placeholder expansion;
- recovery-plan construction;
- CLI parsing and output;
- runtime network API auditing.

Shared modules depend on explicit platform interfaces instead of importing
Windows behavior directly.

### Platform adapter

A platform adapter selected from `process.platform` owns:

- state and Copilot hook paths;
- state-directory and file permissions;
- terminal availability diagnostics;
- recovery tab launch behavior;
- platform-specific installation diagnostics.

The accepted platform and architecture pairs are `win32` with `x64`, plus
`darwin` with `x64` or `arm64`. Other combinations fail with an explicit
unsupported-platform error before changing files.

### Paths

Windows retains:

```text
%LOCALAPPDATA%\copilot-session-recovery
%USERPROFILE%\.copilot\hooks\copilot-session-recovery.json
```

macOS uses:

```text
~/Library/Application Support/copilot-session-recovery
~/.copilot/hooks/copilot-session-recovery.json
```

`COPILOT_HOME` continues to override the default Copilot directory on both
platforms. State schemas remain identical across platforms.

## Installation and hooks

`install` performs product setup but no longer installs the runtime:

1. Confirm the current platform is supported.
2. Resolve the absolute bundled CLI entry file and reject a transient `_npx`
   cache entry.
3. Create the state, diagnostics, and corrupt-evidence directories.
4. Create or validate configuration and the session registry.
5. Write the official Copilot lifecycle-hook configuration.
6. Apply platform-appropriate user-only protection.
7. Run installation diagnostics and report actionable failures.

The hook configuration uses the absolute `process.execPath` as `exec`. Its
structured arguments are the absolute bundled CLI entry file followed by
`hook session-start` or `hook session-end`. It never depends on shell command
resolution or npm-generated command shims.

An npm or Node installation moved after setup can invalidate those absolute
paths. `status` and `doctor` must detect this and instruct the user to rerun
`copilot-session-recovery install`.

No npm `postinstall`, `preuninstall`, or other lifecycle script changes the
machine. Setup and teardown remain explicit and auditable.

`uninstall` removes the Copilot hook and preserves state by default. With
`--purge`, it also removes application state. Documentation requires users to
run it before:

```text
npm uninstall --global copilot-session-recovery
```

## Permissions

Windows retains current-user ACL protection through structured `whoami.exe`
and `icacls.exe` process calls.

macOS creates the application directory with mode `0700` and state files with
mode `0600`. Installation repairs overly broad modes on existing owned paths.
Symlinks, paths not owned by the current user, and permission changes that
cannot be verified cause explicit installation failures rather than silent
success.

## Recovery launch flow

### Windows

Windows keeps the current structured `wt.exe` invocation. Session paths,
profile executables, and profile arguments remain separate process arguments.

### macOS

Apple Terminal's automation API launches commands as shell text. Interpolating
session IDs, working directories, or launcher profile values into that text
would violate the product's structured-argument security boundary.

macOS therefore uses a launch broker:

1. `recover-sessions` validates every planned entry and atomically writes one
   active launch plan under the application state directory.
2. The plan records pending entries using the existing structured process
   model. Only one plan may contain unclaimed entries at a time.
3. A static AppleScript receives only the number of required tabs as a
   structured `osascript` argument.
4. Each Apple Terminal tab runs the same constant command:
   `copilot-session-recovery launch-next`.
5. `launch-next` locks the active plan, atomically claims one pending entry,
   changes to its validated working directory, and starts its launcher with
   structured process arguments and inherited terminal I/O.
6. A spawn failure is recorded as failed and remains available for retry.
   The plan is removed after every entry is claimed successfully or explicitly
   discarded.

No session ID, working directory, executable, profile argument, or generated
shell fragment is embedded in AppleScript.

The first macOS recovery may trigger the operating system's Terminal automation
permission prompt. Denial is reported with a direct remediation message, and
the launch plan remains recoverable.

## Package contents and build

`package.json` will:

- remove `private`;
- require `node >=24`;
- expose `copilot-session-recovery` through `bin`;
- declare the repository, license, and supported operating systems;
- whitelist the bundled CLI, README, and license through `files`;
- configure public npm publication.

npm package metadata cannot express different CPU lists per operating system,
so the package does not declare a global `cpu` field. The platform adapter
enforces the supported platform and architecture pairs before setup or runtime
state access.

The build produces the bundled ESM CLI and its source map. It removes:

- `sea-config.json`;
- Node SEA detection and resource injection;
- executable copying and self-deletion;
- application-owned PATH changes;
- executable checksum and SEA smoke scripts;
- executable artifacts, SBOM inputs, tests, and documentation.

The runtime dependency audit continues to require an empty or absent
`dependencies` object and rejects network APIs.

## Publishing and supply-chain security

The unscoped public package name is `copilot-session-recovery`. Before
implementation is considered releasable, the operator must confirm that name
directly on npmjs.com.

The first package registration is an explicit operator bootstrap. After the
package exists, the operator configures this repository and release workflow as
its npm trusted publisher. Long-lived npm automation tokens are not stored in
GitHub.

Subsequent releases occur only when a pushed `v*` tag exactly matches
`package.json`:

1. Check out the tagged commit with the repository's pinned action versions.
2. Install from the lockfile.
3. Run the complete Windows and macOS verification gates.
4. Build and inspect the npm tarball.
5. Publish from a GitHub-hosted runner through npm OIDC trusted publishing.

npm trusted publishing generates provenance automatically. The release
workflow publishes no Windows executable, executable checksum, or binary
GitHub Release asset.

## Error handling

- Unsupported platforms fail before file changes.
- Invalid or transient npm installation paths fail before hook changes.
- Existing invalid configuration or registry data is never silently replaced.
- Hook writes and launch-plan transitions use locked, atomic updates.
- Partial platform setup reports the completed and failed operations and exits
  unsuccessfully.
- Missing Node, moved global packages, missing terminal applications, denied
  macOS automation, and unavailable launcher profiles have distinct diagnostic
  messages.
- Runtime behavior remains offline and telemetry-free.

## Verification

Source behavior changes follow test-driven development: each changed contract
must first fail in the relevant test before implementation.

CI runs on `windows-latest` and `macos-latest` and covers:

- shared lifecycle, storage, configuration, and recovery behavior;
- platform selection and unsupported-platform errors;
- Windows and macOS path resolution and permissions;
- hook commands targeting Node plus the bundled entry file;
- `_npx` rejection;
- Windows Terminal argument construction;
- macOS launch-plan locking, claiming, retry, and cleanup;
- static AppleScript generation with no session or profile interpolation;
- runtime dependency and network API auditing;
- npm package-content inspection;
- installation of the generated tarball into a temporary global prefix;
- command, help, version, setup, and teardown smoke behavior.

Hosted CI cannot reliably verify Apple Terminal GUI tabs or the macOS Automation
permission prompt. Before the first public release, an operator must manually
install the packed tarball on macOS, approve the prompt, recover multiple test
sessions into Apple Terminal tabs, and verify cleanup. This is the only manual
release verification boundary.

Implementation is complete only when `npm run verify` covers both supported
platforms, the packed npm CLI passes the platform smoke tests, the manual
Apple Terminal check is recorded, and repository searches find no SEA or EXE
release behavior outside historical design records.
