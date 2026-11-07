<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Ricardo Alves -->
# Synthetic-vault quick start

This walkthrough uses a fictional project and disposable vault. It writes temporary files under your Windows temporary directory and the package’s ignored .local directory. It does not access a personal vault or client profile.

Open PowerShell in the extracted package directory and run:

    $demo = Join-Path $env:TEMP 'btb-community-demo'
    $vault = Join-Path $demo 'vault'
    $projects = Join-Path $vault 'Projects'
    New-Item -ItemType Directory -Force -Path $projects, (Join-Path $demo 'repositories') | Out-Null
    @'
    # Blue Lantern
    Updated: 2026-01-01

    Demo note: the fictional launch room is called Cedar Room.
    '@ | Set-Content -LiteralPath (Join-Path $projects 'Blue Lantern.md') -Encoding utf8

Create the local allowlist. The client config paths below also point to disposable files in the temporary demo folder:

    node .\scripts\setup-windows.mjs --vault $vault --project-id blue-lantern --project-name "Blue Lantern" --aliases "lantern,demo" --notes "Projects\Blue Lantern.md" --repositories-root (Join-Path $demo 'repositories') --codex-config (Join-Path $demo 'client\codex.toml') --claude-code-config (Join-Path $demo 'client\claude.json') --work-dir (Join-Path $demo 'work') --log-dir (Join-Path $demo 'logs') --backup-dir (Join-Path $demo 'backups')

Review the setup summary. It should report one project and one allowlisted note. The package's .local/config.json contains only this synthetic setup.

## Make a read-only MCP context request

The following sends the standard MCP initialize exchange and one brain_context call to the local stdio server. The returned context should include the fictional note, including Cedar Room. It does not create a task or handoff.

    $env:BRAIN_TO_BUILD_ROOT = (Get-Location).Path
    @'
    {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}
    {"jsonrpc":"2.0","method":"notifications/initialized"}
    {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"brain_context","arguments":{"query":"Cedar Room","project":"blue-lantern"}}}
    '@ | node .\src\mcp.mjs
    Remove-Item Env:BRAIN_TO_BUILD_ROOT

An MCP stdio client starts node with the absolute path to src/mcp.mjs, sends JSON-RPC messages on stdin, and reads JSON-RPC responses on stdout.

## Preview client configuration

    node .\scripts\install-windows.mjs

The preview uses disposable Codex and Claude Code paths from the synthetic configuration. It does not modify them. If you choose to apply, the helper writes only to those temporary paths:

    node .\scripts\install-windows.mjs --apply

This preview/apply demonstration covers file handling; it does not certify a complete live client integration. After checking the exact paths, remove the temporary demo and package .local directory:

    Remove-Item -LiteralPath $demo -Recurse -Force
    Remove-Item -LiteralPath .\.local -Recurse -Force
