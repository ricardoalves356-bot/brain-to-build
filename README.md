<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# Brain-to-Build Community Edition v0.3.0-beta.1

Brain-to-Build is a local MCP server and task contract for AI-assisted software work. An MCP client can retrieve explicitly allowlisted Markdown context, create a measurable local task, read task state, and write a local handoff. The human and their chosen coding tools do the implementation.

This beta is a Windows-first source distribution. It is not an autonomous coding agent, sandbox, credential manager, or GitHub client. The server does not invoke a model, execute shell commands, access the network, authenticate to GitHub, or write to the vault.

## What the MCP server does

It exposes five tools:

- brain_context reads only visible Markdown files explicitly listed for the selected project.
- brain_create_task creates a local task with acceptance criteria.
- brain_get_task reads a local task.
- brain_handoff writes a local Markdown handoff; it does not message another client.
- brain_github_route returns locally configured routing metadata; it does not contact GitHub or verify access.

The server uses local stdio transport. It has no npm runtime dependencies and does not enable paid services.

## Requirements and compatibility

- Windows is the only installation path prepared and tested.
- Node.js 22 or newer is required. Git is optional for work performed by the host client.
- Automated core and synthetic-flow tests are included.
- Direct Codex App Server-to-MCP calls were exercised with synthetic data. This does not validate autonomous model tool selection or every Codex client workflow.
- Autonomous model tool choice, complete Claude Code or Claude Desktop integration, and other clients are not verified. Do not infer support from configuration examples.

See [Known limitations](docs/LIMITATIONS.md), [Integration notes](docs/INTEGRATIONS.md), and the [public validation summary](docs/VALIDATION.md).

## Quick start with a fictional vault

Follow [the synthetic quick start](docs/QUICKSTART-SYNTHETIC.md) to create a disposable Markdown vault, configure one allowlisted note, and make a read-only MCP context request. It uses temporary paths and does not require your personal vault or client settings.

## Install on Windows

1. Extract the package to a stable directory outside your vault and repositories.
2. Install Node.js 22 or newer.
3. In PowerShell, run setup with an existing vault, explicit project ID, and note allowlist:

    node .\scripts\setup-windows.mjs --vault "D:\Notes\MyVault" --project-id sample-app --project-name "Sample App" --aliases "sample,demo" --notes "Projects\Sample App.md" --repositories-root "D:\Source"

Setup creates ignored local state at .local/config.json. It does not enumerate the vault or change client settings. Use only notes safe to expose to the selected MCP client.

4. Review the client configuration preview:

    node .\scripts\install-windows.mjs

The preview makes no changes. Applying the helper updates configured Codex and Claude Code MCP settings and makes backups; it can also update Claude Desktop if an explicit Desktop path is configured. Review every path shown before applying:

    node .\scripts\install-windows.mjs --apply

The helper does not install or authenticate clients. Restart may be required. Rollback is available with:

    node .\scripts\install-windows.mjs --rollback

You can configure another compatible MCP stdio client manually. See [Integration notes](docs/INTEGRATIONS.md). Follow that client's own configuration format and review the exact server path before saving.

## Security and privacy

The MCP reads only configured Markdown allowlists and never writes to the vault. Local task, handoff, backup, and evidence files can still contain sensitive project information. Local state is not encrypted by this project; Windows ACLs are not changed by the installer. Keep installation and state directories under a trusted account.

Path checks reject tested static junction escapes, but this software is not an OS isolation boundary. It cannot prevent a malicious process running as the same user from racing a path check and file access. It also cannot constrain shell or filesystem tools the host client may have independently. Do not use it to protect against an untrusted host process.

Review [Security policy](SECURITY.md) and [Known limitations](docs/LIMITATIONS.md) before using real notes.

## Contribute or report a problem

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Report security issues according to [SECURITY.md](SECURITY.md). Use synthetic examples; do not post vault content, credentials, client transcripts, private paths, or sensitive logs.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
