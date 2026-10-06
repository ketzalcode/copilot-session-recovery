# Agent Instructions

This repository builds a Windows-only V1 utility for recovering GitHub Copilot CLI sessions from official lifecycle-hook metadata.

## Development rules

- Keep V1 Windows x64 only unless a design change explicitly approves another platform.
- Use test-driven development for source behavior changes. Watch the relevant test fail before implementation, then run it green.
- Never read, parse, store, infer, or depend on private Copilot state, internal cache files, prompts, responses, tool output, credentials, tokens, or source content.
- Do not add runtime npm dependencies without design approval. V1 must keep `"dependencies"` empty or absent.
- Use structured process arguments only. Do not build shell command strings from session, path, or profile data.
- Treat custom launcher profiles as trusted local configuration. Validate shape and placeholders, but do not execute them through a shell.
- Run source tests and the SEA smoke test before claiming success:

  ```powershell
  npm run verify
  ```

- For documentation or workflow-only changes, also run:

  ```powershell
  git --no-pager diff --check
  ```

- Do not automatically commit, push, publish releases, create remotes, or create tags. Prepare commands for the operator instead.
- Keep generated output out of source control. `dist\`, `coverage\`, and `node_modules\` are ignored.

## Release constraints

- Use the pinned GitHub Actions versions in `.github\workflows\*.yml`.
- Release automation may publish only from pushed `v*` tags in GitHub Actions.
- Local commands may build, checksum, and smoke-test artifacts, but must not create GitHub Releases.
