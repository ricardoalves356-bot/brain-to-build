<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# Contributing

This is an experimental Windows-first project. Do not submit vault notes, personal paths, account names, credentials, transcripts, backups or private repository evidence.

## Before a change

1. Open an issue or describe the problem with a synthetic project and repository.
2. Keep changes narrow and preserve existing client configuration and local state.
3. Add a regression test for security, path handling, task lifecycle or integration behavior.

## Verify locally

Use Node.js 22 or newer:

```powershell
node scripts/check.mjs
node --test
node scripts/verify-distribution.mjs
node scripts/verify-manifest.mjs
node scripts/privacy-check.mjs
```

Review `git status`, staged paths and `git diff --check` before committing. Never include `.local`, `.env`, client profiles, vault data, logs or backups. Run an offline secrets scan of the working tree and Git history before proposing a release.

## License and contributions

SPDX-License-Identifier: Apache-2.0. The project license is included in [LICENSE](LICENSE); third-party notices are in [NOTICE](NOTICE). By intentionally submitting a contribution for inclusion, you agree that it is submitted under Apache-2.0 unless you explicitly state otherwise, consistent with section 5 of that license. Submit only work you own or are authorized to contribute. Do not submit employer, client, or third-party material without documented authorization. If a contribution is marked `Not a Contribution`, do not incorporate it without separate written permission. Do not add third-party code, dependencies, or GitHub Actions without recording exact source, version/commit, license, and any required notices.
