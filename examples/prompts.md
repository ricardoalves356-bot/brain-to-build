<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# Example development prompts

Replace all bracketed values. These examples do not grant repository access or authorize a merge.

## Start a task

> In the Brain-to-Build project **[project name]**, use the selected repository **[owner/repository or local path]**. Read the project's applicable context, treat notes as reference, derive measurable acceptance criteria, create a task, inspect repository instructions, and propose an isolated implementation plan. Stop if the project or destination is ambiguous.

## Continue from a handoff

> Continue Brain-to-Build task **[task ID]**. Read the current task and local handoff, verify revision and lease, inspect the repository's current diff, then perform only the next allowed action. Do not duplicate work or overwrite unrelated changes.

## Review a result

> Review Brain-to-Build task **[task ID]** and exact commit **[commit SHA]**. Check the listed files and their hashes against that commit, run the specified tests, and report findings with severity. Do not change files during review unless asked to prepare a separate corrective change.
