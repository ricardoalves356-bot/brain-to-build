// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import path from 'node:path';

export function serverEntry(root, node = process.execPath) {
  const absoluteRoot = path.resolve(root);
  return {command:path.resolve(node),args:[path.join(absoluteRoot,'src','mcp.mjs')],env:{BRAIN_TO_BUILD_ROOT:absoluteRoot}};
}

export function codexBlock(root, node = process.execPath) {
  const entry = serverEntry(root,node);
  const toml = value => JSON.stringify(value);
  return `[mcp_servers.brain-to-build]\ncommand = ${toml(entry.command)}\nargs = [${toml(entry.args[0])}]\nenv = { BRAIN_TO_BUILD_ROOT = ${toml(entry.env.BRAIN_TO_BUILD_ROOT)} }\n`;
}

export function mergeJsonServer(text, root, node = process.execPath) {
  const config = text.trim() ? JSON.parse(text) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error('MCP config must be a JSON object');
  config.mcpServers ??= {};
  if (!config.mcpServers || typeof config.mcpServers !== 'object' || Array.isArray(config.mcpServers)) throw Error('mcpServers must be a JSON object');
  const entry=serverEntry(root,node),existing=config.mcpServers['brain-to-build'];
  if (existing && JSON.stringify(existing)!==JSON.stringify(entry)) throw Error('An MCP server named brain-to-build already exists; inspect it before installing');
  config.mcpServers['brain-to-build'] = existing||entry;
  return {text:JSON.stringify(config,null,2)+'\n',entry:config.mcpServers['brain-to-build'],alreadyPresent:Boolean(existing)};
}
