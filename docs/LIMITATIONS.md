<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# Known limitations

## Platform and client support

- Windows is the only installation path prepared here. macOS and Linux are not verified.
- The core does not invoke a model. Autonomous tool selection and compliance with agent workflow instructions have not been tested.
- A direct Codex App Server-to-MCP smoke test used synthetic data. It is protocol/tool communication evidence, not an endorsement of autonomous behavior or every Codex workflow.
- Complete Claude Code, Claude Desktop, and other client integrations are not verified. Installer configuration support is not a completed client handshake.

## Security boundaries

- The MCP process inherits the operating-system permissions of its host. It cannot constrain the host AI client’s own shell or filesystem tools.
- The core is not an OS sandbox, permission broker, identity provider, or secrets manager.
- Static Windows junction escapes in the tested MCP context/task/handoff paths were covered by a hosted Windows regression. Other reparse-point types were not comprehensively tested.
- Path checks cannot fully prevent filesystem time-of-check/time-of-use races or protect against a malicious process running as the same account. Keep the installation, vault, and writable state under a trusted account; avoid shared writable directories.
- Local task, handoff, backup, and evidence files may contain sensitive project context. They are not encrypted by this project, and the installer does not change Windows ACLs.
- The built-in secret filter and privacy checks are heuristic. They may miss secrets or suppress benign notes.

## Functionality and evidence

- Obsidian access is selective local Markdown reading only. There is no Obsidian plugin, recursive vault indexing, or live Obsidian API.
- The GitHub routing tool returns local metadata only; it does not call GitHub, authenticate, or verify repository permissions.
- Cross-client handoff is a local file, not messaging.
- Token usage is estimated from characters. Subscription use and actual provider charges are not measured.
- Actor labels, reviewer independence, PR evidence, and CI evidence supplied to the local task lifecycle are not provider-authenticated.
- A crashed task lease may expire and be claimed by another agent. A lock left by a crashed process is not silently removed; verify that no process is active before manual recovery.

These boundaries define the beta’s scope. Passing tests do not prove complete security.
