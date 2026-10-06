# Security Policy

## Reporting a vulnerability

After this repository has a GitHub remote, report vulnerabilities through GitHub private vulnerability reporting.

Until private reporting is available, local reviewers should not file public issues or comments containing exploit details, secrets, private paths, tokens, prompts, responses, or source content. Share only the minimum private reproduction information with the repository owner through an approved private channel.

## Supported version

V1 supports the latest released Windows x64 build.

## Security boundaries

Copilot Auto Save stores only approved local metadata: session ID, working directory, launcher profile, lifecycle source, and timestamps. It must not store prompts, responses, tool output, credentials, tokens, source files, or private Copilot state.

The tool has no runtime network behavior and no telemetry.
