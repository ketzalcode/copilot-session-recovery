# Agent Instructions

This repository builds a V1 npm-distributed utility for recovering GitHub Copilot CLI sessions from official lifecycle-hook metadata.

## Development rules

- Keep the approved V1 platform matrix limited to Windows x64 plus macOS x64/arm64 unless a newer design change expands it.
- Keep distribution npm-only. The supported install contract is `npm install --global copilot-session-recovery` followed by `copilot-session-recovery install`.
- Allow `npx copilot-session-recovery --help` and `--version` only as transient inspection. `install` must keep rejecting `_npx` runtime paths.
- Use test-driven development for source behavior changes. Watch the relevant test fail before implementation, then run it green.
- Never read, parse, store, infer, or depend on private Copilot state, internal cache files, prompts, responses, tool output, credentials, tokens, or source content.
- Do not add runtime npm dependencies without design approval. V1 must keep `"dependencies"` empty or absent.
- Use structured process arguments only. Do not build shell command strings from session, path, or profile data.
- On macOS, preserve the static AppleScript plus locked `launch-next` broker design. Do not interpolate session, cwd, executable, or profile values into AppleScript text.
- Treat custom launcher profiles as trusted local configuration. Validate shape and placeholders, but do not execute them through a shell.
- Run source tests and the package smoke test before claiming success:

  ```powershell
  npm run verify
  ```

- For documentation or workflow-only changes, also run:

  ```powershell
  git --no-pager diff --check
  ```

- Do not automatically commit, push, publish packages or releases, create remotes, or create tags. Prepare commands for the operator instead.
- Do not reintroduce active legacy binary-release or PATH-management instructions outside historical records under `docs\superpowers\` or `.superpowers\`.
- Keep generated output out of source control. `dist\`, `coverage\`, and `node_modules\` are ignored.

## Release constraints

- Use the pinned GitHub Actions versions in `.github\workflows\*.yml`.
- Release automation may publish only from pushed `v*` tags in GitHub Actions.
- npm trusted publishing and provenance belong only to the GitHub Actions release flow. Do not introduce long-lived npm publish tokens.
- Local commands may build, pack, and smoke-test artifacts, but must not publish packages or create GitHub Releases.
- Public release readiness still requires the operator-run Apple Terminal manual check because hosted verification cannot prove live macOS automation prompts and tab behavior.
