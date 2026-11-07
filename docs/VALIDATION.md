<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# Validation summary

This summary describes tested scope and known gaps for v0.3.0-beta.1.

## Validated behavior

- MCP JSON-RPC core and synthetic context, task, and handoff operations have automated tests.
- Windows installation and rollback tests use clean copies and disposable configuration.
- The homologation-baseline hosted Windows run executed 42 tests successfully with zero failures and zero skips, including static junction read/write regression coverage. This isolated source package has documentation and version-metadata changes and a new Git history; it has not had its own hosted CI run.
- This package's local suite ran 42 tests: 40 passed, 0 failed, and 2 junction tests skipped because this managed Windows host returned EPERM when creating junctions.
- Direct Codex App Server communication with the MCP tools was exercised using synthetic data in a temporary profile. This was not a model-driven turn.
- The package uses an explicit file allowlist, a SHA-256 manifest, a configured privacy heuristic, and Gitleaks scanning.

## Not verified

- Autonomous model selection or behavior.
- Complete Claude Code or Claude Desktop integration.
- Other client integrations not directly tested.
- Protection against all Windows reparse-point types, filesystem races, or malicious processes running under the same user.

A passing test suite is evidence only for the tested cases. This summary does not claim security certification or OS-level isolation.
