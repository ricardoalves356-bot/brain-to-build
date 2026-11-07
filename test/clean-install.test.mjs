// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hash} from '../src/core.mjs';

const source=path.resolve(import.meta.dirname,'..');
function cleanCopy(destination){
  const excluded=new Set(['.git','.local','node_modules','.audit-tools']);
  fs.cpSync(source,destination,{recursive:true,filter:item=>{
    const rel=path.relative(source,item),first=rel.split(path.sep)[0];
    return !rel||!excluded.has(first)&&!rel.split(path.sep).some(part=>part.endsWith('.bak')||part==='coverage'||part==='dist');
  }});
}
const run=(copy,args,env={})=>spawnSync(process.execPath,args.map(arg=>arg),{cwd:copy,env:{...process.env,...env},encoding:'utf8',timeout:15000,windowsHide:true});

test('Windows setup and client install/rollback work from a clean copy and synthetic profile',t=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'btb-clean-install-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const copy=path.join(temp,'brain-to-build-community');fs.mkdirSync(copy);cleanCopy(copy);
  assert.equal(fs.existsSync(path.join(copy,'.git')),false,'new distribution copy must not inherit Git history');
  const allowlist=run(copy,['scripts/verify-distribution.mjs']);assert.equal(allowlist.status,0,allowlist.stderr);
  const manifest=run(copy,['scripts/verify-manifest.mjs']);assert.equal(manifest.status,0,manifest.stderr);
  const vault=path.join(temp,'synthetic-vault'),clientHome=path.join(temp,'client-profile');
  const codex=path.join(clientHome,'.codex','config.toml'),claude=path.join(clientHome,'.claude.json'),desktop=path.join(clientHome,'desktop','claude_desktop_config.json');
  fs.mkdirSync(path.join(vault,'Projects'),{recursive:true});fs.mkdirSync(path.dirname(codex),{recursive:true});fs.mkdirSync(path.dirname(desktop),{recursive:true});
  fs.writeFileSync(path.join(vault,'Projects','Alpha.md'),'# Alpha\nSynthetic notes only.');
  const originals={[codex]:'model = "example-model"\n[mcp_servers.example]\ncommand = "example-server"\n',[claude]:JSON.stringify({theme:'dark',mcpServers:{example:{command:'example-server'}}},null,2)+'\n',[desktop]:JSON.stringify({locale:'en-CA',mcpServers:{example:{command:'example-server'}}},null,2)+'\n'};
  for(const [file,value]of Object.entries(originals))fs.writeFileSync(file,value);
  const rejectedRelativePath=run(copy,['scripts/setup-windows.mjs','--vault','relative-vault']);assert.notEqual(rejectedRelativePath.status,0);assert.equal(fs.existsSync(path.join(copy,'.local','config.json')),false);
  const configured=run(copy,['scripts/setup-windows.mjs','--vault',vault,'--project-id','alpha','--project-name','Alpha','--notes','Projects/Alpha.md','--repositories-root',temp,'--work-dir',path.join(temp,'work'),'--log-dir',path.join(temp,'logs'),'--backup-dir',path.join(temp,'backups'),'--codex-config',codex,'--claude-code-config',claude,'--claude-desktop-config',desktop]);
  assert.equal(configured.status,0,configured.stderr);assert.equal(JSON.parse(configured.stdout).vaultValidated,true);
  const preview=run(copy,['scripts/install-windows.mjs']);assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).preview,true);
  for(const dir of ['work','logs','backups'])assert.equal(fs.existsSync(path.join(temp,dir)),false,'preview must be read-only');
  const installed=run(copy,['scripts/install-windows.mjs','--apply']);assert.equal(installed.status,0,installed.stderr);
  const state=JSON.parse(fs.readFileSync(path.join(copy,'.local','client-install.json'),'utf8'));
  assert.equal(state.entries.length,3);for(const entry of state.entries){assert.equal(hash(fs.readFileSync(entry.backup)),entry.beforeHash);assert.equal(hash(fs.readFileSync(entry.file)),entry.installedHash);}
  const codexText=fs.readFileSync(codex,'utf8');assert.match(codexText,/mcp_servers\.example/);assert.match(codexText,/mcp_servers\.brain-to-build/);
  const claudeConfig=JSON.parse(fs.readFileSync(claude,'utf8'));assert.ok(claudeConfig.mcpServers.example);assert.ok(claudeConfig.mcpServers['brain-to-build']);assert.equal(claudeConfig.theme,'dark');
  const desktopConfig=JSON.parse(fs.readFileSync(desktop,'utf8'));assert.ok(desktopConfig.mcpServers.example);assert.ok(desktopConfig.mcpServers['brain-to-build']);assert.equal(desktopConfig.locale,'en-CA');
  const messages=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'brain_context',arguments:{project:'alpha',query:'Synthetic notes'}}}].map(x=>JSON.stringify(x)).join('\n')+'\n';
  const mcp=spawnSync(process.execPath,['src/mcp.mjs'],{cwd:copy,env:{...process.env,BRAIN_TO_BUILD_ROOT:copy},input:messages,encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(mcp.status,0,mcp.stderr);const response=mcp.stdout.trim().split('\n').map(JSON.parse).find(x=>x.id===2);assert.equal(response.result.content[0].type,'text');assert.equal(JSON.parse(response.result.content[0].text).sources[0].source,'Projects/Alpha.md');
  const updatedClaude=JSON.parse(fs.readFileSync(claude,'utf8'));updatedClaude.theme='light';fs.writeFileSync(claude,JSON.stringify(updatedClaude,null,2)+'\n');
  const rollback=run(copy,['scripts/install-windows.mjs','--rollback']);assert.equal(rollback.status,0,rollback.stderr);
  for(const file of [codex,desktop])assert.equal(fs.readFileSync(file,'utf8'),originals[file]);
  const afterRollback=JSON.parse(fs.readFileSync(claude,'utf8'));assert.equal(afterRollback.theme,'light');assert.ok(afterRollback.mcpServers.example);assert.equal(afterRollback.mcpServers['brain-to-build'],undefined);
  assert.equal(fs.existsSync(path.join(copy,'.local','client-install.json')),false);
});
