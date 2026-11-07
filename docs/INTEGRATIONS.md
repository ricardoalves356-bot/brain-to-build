<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# MCP client integration notes

## Compatibility status

The included helpers build configuration entries for Codex and Claude Code and can optionally edit a Claude Desktop JSON file. Configuration editing is not the same as a live client handshake.

A direct Codex App Server-to-MCP smoke test exercised tool discovery and synthetic operations. Autonomous model selection was not tested. Complete Claude Code, Claude Desktop, and other client integrations are not verified or officially homologated by this beta.

## Generic MCP stdio configuration

MCP clients use different configuration formats. Follow the selected client’s current instructions. A JSON-based client configuration may look like this; replace the installation path with the absolute path on your computer:

    {
      "mcpServers": {
        "brain-to-build": {
          "command": "node",
          "args": ["C:\\Tools\\brain-to-build\\src\\mcp.mjs"]
        }
      }
    }

Codex uses TOML configuration. The equivalent entry is:

    [mcp_servers.brain-to-build]
    command = "node"
    args = ["C:\\Tools\\brain-to-build\\src\\mcp.mjs"]

Both examples start a local process using stdio. The server reads the local project registry from .local/config.json beside the package. Configure that registry first with scripts/setup-windows.mjs.

## Configuration helper

Run the preview before any apply:

    node .\scripts\install-windows.mjs

The helper shows the exact configuration paths it will process. Applying it modifies configured Codex and Claude Code settings and saves verified backups. If a Claude Desktop path is explicitly configured, that file is included too. Do not apply until every path and client entry is expected.

## Obsidian data scope

The server reads only visible Markdown notes listed for a project in .local/config.json. It does not recursively scan the vault, read hidden .obsidian files, or write notes. Use separate project summaries if projects need overlapping context; project note allowlists must be disjoint.

## Handoff and GitHub routing

A handoff is a local Markdown file for another agent with access to the same installation. It does not send a message. brain_github_route returns routing metadata from local configuration; it does not authenticate to GitHub or test repository access.
