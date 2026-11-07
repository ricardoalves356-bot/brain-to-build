<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# Security policy and limitations

## Supported deployment

The included MCP transport is local stdio for a user-controlled client. Do not expose it as a network service or run it under a privileged account. The server process inherits the operating-system permissions of its host. This project is not a sandbox, permission broker, identity provider, secrets manager, or isolation boundary against an AI host that has other tools.

## Data handling

- Vault retrieval is allowlist-based and read-only. The MCP does not write to the vault.
- Task, handoff, backup and evidence files are local. They may contain sensitive project context; `.local/` is ignored by Git but not encrypted, and Windows ACLs are not changed by the installer.
- Do not commit local config, transcripts, evidence, backups or vault contents. Review the exact staged files before committing.
- The built-in secret filter is heuristic and can miss secrets or suppress benign notes. Run a dedicated scanner locally before sharing a release.

## Integrity and trust boundaries

Actor names, reviewer independence, test results, GitHub PR proof and CI proof are supplied by the local host/client. Review records set `reviewerIdentityVerified: false`; actor-label difference is not authenticated reviewer identity. PR proof uses `hostProofValidated` only for local structure/content checks and sets `providerAuthenticated: false`. CI evidence is also supplied JSON, not an authenticated provider response. Hashes detect later file changes relative to recorded evidence, but do not authenticate who created the evidence. A user with write access to local state can alter records. Provider-backed GitHub evidence is not implemented by this core.

Task mutation uses a local exclusive lock and optimistic revision. A task lease can be reclaimed after expiry if no lock is held. A lock left by a crashed process is not automatically deleted. Inspect the recorded PID and ensure no Brain-to-Build process is still active before manual recovery; malformed or live locks must be left in place.

Path containment and symlink checks reduce accidental escape but cannot eliminate filesystem time-of-check/time-of-use races. Keep the installation and vault under a trusted account and avoid shared writable directories.

## Reporting

Do not submit sensitive notes, tokens, logs or proof files in an issue. Describe the affected component and a minimal synthetic reproduction. For suspected exposed credentials, revoke them with the issuing provider before investigating history. Security fixes should be reviewed with tests; passing tests are not proof of complete security.
