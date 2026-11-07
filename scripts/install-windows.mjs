// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Brain,readJson,hash,safePath} from '../src/core.mjs';
import {codexBlock,mergeJsonServer,serverEntry} from '../src/client-config.mjs';

const root=fs.realpathSync(path.resolve(process.env.BRAIN_TO_BUILD_INSTALL_ROOT||path.join(path.dirname(fileURLToPath(import.meta.url)),'..')));
const local=path.join(root,'.local'),stateFile=safePath(root,'.local/client-install.json');
const args=process.argv.slice(2),rollback=args.includes('--rollback'),apply=args.includes('--apply');
if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 or newer is required');
const config=readJson(safePath(root,'.local/config.json'));
function atomicWrite(file,text){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(tmp,text,{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}
function readText(file){return fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';}
function assertNoLinks(absolutePath){const resolved=path.resolve(absolutePath),parsed=path.parse(resolved);let cursor=parsed.root;for(const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,segment);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Refusing a configured path containing a symlink or junction');}catch(error){if(error.code!=='ENOENT')throw error;}}}
function prepareDirectory(dir,writeProbe){if(!path.isAbsolute(dir))throw Error('Configured directories must be absolute');assertNoLinks(dir);if(!fs.existsSync(dir)&&!writeProbe)return;fs.mkdirSync(dir,{recursive:true});if(writeProbe){const probe=path.join(dir,`.btb-write-${crypto.randomUUID()}`);fs.writeFileSync(probe,'ok',{flag:'wx',mode:0o600});fs.rmSync(probe);}}
function parseCodex(file,rootPath){
  const old=readText(file),block=codexBlock(rootPath),existing=old.match(/^\[mcp_servers\.brain-to-build\]\r?\n(?:[^\[]|\[(?!mcp_servers\.))*/mi)?.[0];
  if(existing){if(old.includes(block))return {old,next:old,block:old.slice(old.indexOf(existing),old.indexOf(existing)+existing.length),kind:'toml',alreadyPresent:true};throw Error(`Codex already contains brain-to-build; inspect ${path.basename(file)} before installing`);}
  return {old,next:old+(old&&!old.endsWith('\n')?'\n':'')+'\n'+block,block:'\n'+block,kind:'toml'};
}
function parseJson(file,rootPath){const old=readText(file),merged=mergeJsonServer(old,rootPath);return {old,next:merged.text,entry:merged.entry,kind:'json',alreadyPresent:merged.alreadyPresent};}
function targets(config){const c=config.clients||{},home=process.env.BRAIN_TO_BUILD_CLIENT_HOME||os.homedir();const list=[];
  const resolveConfig=value=>{if(!path.isAbsolute(value))throw Error('Client config paths must be absolute');return path.resolve(value);};
  list.push({client:'Codex',file:resolveConfig(c.codexConfig||process.env.BTB_CODEX_CONFIG||path.join(home,'.codex','config.toml')),parse:parseCodex});
  list.push({client:'Claude Code',file:resolveConfig(c.claudeCodeConfig||process.env.BTB_CLAUDE_CODE_CONFIG||path.join(home,'.claude.json')),parse:parseJson});
  const desktop=c.claudeDesktopConfig||process.env.BTB_CLAUDE_DESKTOP_CONFIG;if(desktop)list.push({client:'Claude Desktop',file:resolveConfig(desktop),parse:parseJson});
  return list;
}
function rollbackState(state){let restored=0,conflicts=0;
  if(!Array.isArray(state.entries)||!state.entries.length)throw Error('Invalid local installation record');
  const configured=new Map(targets(config).map(target=>[target.file,target.client]));
  for(const entry of [...state.entries].reverse()){
    const expectedClient=configured.get(entry.file);
    if(!expectedClient||expectedClient!==entry.client||!['json','toml'].includes(entry.kind)||!/^([a-f0-9]{64})$/.test(entry.beforeHash)||!/^([a-f0-9]{64})$/.test(entry.installedHash)){conflicts++;continue;}
    assertNoLinks(path.dirname(entry.file));
    const backupDir=path.resolve(config.paths?.backupDirectory||path.join(local,'backups'));
    if(entry.backup){const relative=path.relative(backupDir,path.resolve(entry.backup));if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)){conflicts++;continue;}assertNoLinks(path.dirname(entry.backup));}
    if(entry.kind==='json'&&JSON.stringify(entry.entry)!==JSON.stringify(serverEntry(root))){conflicts++;continue;}
    if(entry.kind==='toml'&&entry.block!=='\n'+codexBlock(root)){conflicts++;continue;}
    const current=readText(entry.file);
    if(hash(current)===entry.installedHash){
      if(entry.existed){const backup=fs.readFileSync(entry.backup);if(hash(backup)!==entry.beforeHash)throw Error(`Backup integrity check failed for ${path.basename(entry.file)}`);atomicWrite(entry.file,backup.toString('utf8'));}
      else fs.rmSync(entry.file,{force:true});
      restored++;continue;
    }
    if(entry.kind==='json'&&current){
      let cfg;try{cfg=JSON.parse(current)}catch{conflicts++;continue;}const found=cfg.mcpServers?.['brain-to-build'];
      if(JSON.stringify(found)===JSON.stringify(entry.entry)){delete cfg.mcpServers['brain-to-build'];if(!Object.keys(cfg.mcpServers).length)delete cfg.mcpServers;atomicWrite(entry.file,JSON.stringify(cfg,null,2)+'\n');restored++;continue;}
    }
    if(entry.kind==='toml'&&current.includes(entry.block)){atomicWrite(entry.file,current.replace(entry.block,'\n'));restored++;continue;}
    conflicts++;
  }
  return {restored,conflicts};
}
if(rollback){if(!fs.existsSync(stateFile))throw Error('No installation record exists');const result=rollbackState(readJson(stateFile));if(!result.conflicts)fs.rmSync(stateFile,{force:true});console.log(JSON.stringify({rollback:true,...result}));if(result.conflicts)process.exitCode=2;process.exit();}
const brain=new Brain(root); // validates vault, budgets and explicit project allowlist
if(fs.existsSync(stateFile)){
  const state=readJson(stateFile);if(state.entries.every(entry=>fs.existsSync(entry.file)&&hash(fs.readFileSync(entry.file))===entry.installedHash)){console.log(JSON.stringify({alreadyInstalled:true,clients:state.entries.map(entry=>entry.client)}));process.exit();}
  throw Error('A previous installation record exists with changed settings; review it or roll it back before reinstalling');
}
const selected=targets(config),backupDir=path.resolve(config.paths?.backupDirectory||path.join(local,'backups'));
const directories=[config.paths?.workingDirectory,config.paths?.logDirectory,backupDir].filter(Boolean);
for(const dir of directories){if(!path.isAbsolute(dir))throw Error('Configured data directories must be absolute');prepareDirectory(path.resolve(dir),apply);}
for(const target of selected){assertNoLinks(path.dirname(target.file));if(fs.existsSync(target.file)&&fs.lstatSync(target.file).isSymbolicLink())throw Error(`Refusing linked client config ${path.basename(target.file)}`);if(apply)prepareDirectory(path.dirname(target.file),true);}
const changes=selected.map(target=>({...target,...target.parse(target.file,root)}));
if(!apply){console.log(JSON.stringify({preview:true,node:process.version,root,projectCount:config.projects.length,clients:changes.map(x=>({client:x.client,configExists:fs.existsSync(x.file),alreadyPresent:Boolean(x.alreadyPresent),path:x.file})),backups:backupDir,paidServicesEnabled:false}));process.exit();}
const pending=changes.filter(change=>!change.alreadyPresent);
if(!pending.length){console.log(JSON.stringify({alreadyConfigured:true,clients:changes.map(x=>x.client)}));process.exit();}
fs.mkdirSync(local,{recursive:true});fs.mkdirSync(backupDir,{recursive:true});
const entries=[];
for(const change of pending){
  const existed=fs.existsSync(change.file),old=change.old;
  const backup=existed?path.join(backupDir,`${path.basename(change.file)}.${new Date().toISOString().replace(/[:.]/g,'-')}.${crypto.randomUUID()}.bak`):null;
  if(existed){fs.copyFileSync(change.file,backup,fs.constants.COPYFILE_EXCL);if(hash(fs.readFileSync(backup))!==hash(old))throw Error(`Backup verification failed for ${path.basename(change.file)}`);}
  entries.push({client:change.client,file:change.file,kind:change.kind,block:change.block,entry:change.entry,existed,backup,beforeHash:hash(old),installedHash:hash(change.next)});
}
const state={createdAt:new Date().toISOString(),entries};atomicWrite(stateFile,JSON.stringify(state,null,2)+'\n');
try{for(let i=0;i<pending.length;i++)atomicWrite(pending[i].file,pending[i].next);}
catch(error){rollbackState(state);throw error;}
console.log(JSON.stringify({applied:true,clients:pending.map(x=>x.client),verifiedBackups:entries.filter(x=>x.existed).length,createdConfigs:entries.filter(x=>!x.existed).length,paidServicesEnabled:false}));
