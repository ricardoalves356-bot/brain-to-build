// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {safePath} from '../src/core.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), get=name=>{const i=args.indexOf(name);return i<0?null:args[i+1]};
if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 or newer is required');
const vaultInput=get('--vault')||process.env.BTB_VAULT||'';
if(!vaultInput)throw Error('Pass --vault <existing directory> or set BTB_VAULT');
if(!path.isAbsolute(vaultInput))throw Error('Vault path must be absolute');
const vault=path.resolve(vaultInput);
function assertNoLinks(absolutePath){const resolved=path.resolve(absolutePath),parsed=path.parse(resolved);let cursor=parsed.root;for(const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)){cursor=path.join(cursor,segment);try{if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Configured paths cannot contain links or junctions');}catch(error){if(error.code!=='ENOENT')throw error;}}}
const stat=fs.lstatSync(vault);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Vault must be an existing directory, not a symlink or junction');assertNoLinks(vault);fs.accessSync(vault,fs.constants.R_OK);
const id=get('--project-id')||'sample-project',name=get('--project-name')||'Sample Project';
if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(id))throw Error('Project ID must use lowercase letters, digits and hyphens');
const notes=(get('--notes')||'').split(',').map(x=>x.trim()).filter(Boolean);
for(const note of notes){if(path.isAbsolute(note)||note.split(/[\\/]/).some(x=>!x||x==='.'||x==='..'||x.startsWith('.'))||!note.endsWith('.md'))throw Error('Notes must be visible, relative Markdown paths inside the vault');const p=safePath(vault,note);if(path.relative(vault,p).startsWith('..')||!fs.statSync(p).isFile())throw Error(`Allowlisted note does not exist: ${path.basename(note)}`);fs.accessSync(p,fs.constants.R_OK);}
const local=path.join(root,'.local'),file=path.join(local,'config.json');if(fs.existsSync(local)&&fs.lstatSync(local).isSymbolicLink())throw Error('Local state directory cannot be a link');fs.mkdirSync(local,{recursive:true});
if(fs.existsSync(file))throw Error('Local config already exists; refusing to overwrite it');
const localData=process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local');
const repositoriesRoot=get('--repositories-root')||process.env.BTB_REPOSITORIES_ROOT||os.homedir();if(!path.isAbsolute(repositoriesRoot))throw Error('Repositories root must be absolute');assertNoLinks(repositoriesRoot);if(!fs.lstatSync(repositoriesRoot).isDirectory())throw Error('Repositories root must be an existing directory');fs.accessSync(repositoriesRoot,fs.constants.R_OK|fs.constants.W_OK);
const paths={workingDirectory:get('--work-dir')||process.env.BTB_WORK_DIR||path.join(localData,'BrainToBuild','work'),logDirectory:get('--log-dir')||process.env.BTB_LOG_DIR||path.join(localData,'BrainToBuild','logs'),backupDirectory:get('--backup-dir')||process.env.BTB_BACKUP_DIR||path.join(localData,'BrainToBuild','backups')};
for(const location of Object.values(paths)){if(!path.isAbsolute(location))throw Error('Work/log/backup paths must be absolute');assertNoLinks(location);}
const clients={codexConfig:get('--codex-config')||process.env.BTB_CODEX_CONFIG||path.join(os.homedir(),'.codex','config.toml'),claudeCodeConfig:get('--claude-code-config')||process.env.BTB_CLAUDE_CODE_CONFIG||path.join(os.homedir(),'.claude.json'),claudeDesktopConfig:get('--claude-desktop-config')||process.env.BTB_CLAUDE_DESKTOP_CONFIG||''};
for(const configPath of Object.values(clients).filter(Boolean)){if(!path.isAbsolute(configPath))throw Error('Client config paths must be absolute');assertNoLinks(path.dirname(configPath));}
const cfg={vault,projects:[{id,name,aliases:[...(get('--aliases')||'').split(',').map(x=>x.trim()).filter(Boolean)],notes}],repositoriesRoot,paths,clients,github:{enabled:false,authProvider:'GitHub CLI or user configured connector',accounts:[],organizations:[],allowedRepositories:[]},maxContextChars:6000,maxNotes:6,maxAttempts:3,maxToolCalls:30,maxUsd:0,staleDays:90};
fs.writeFileSync(file,JSON.stringify(cfg,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({created:path.relative(root,file),vaultValidated:true,projects:[id],notes:notes.length,paidServicesEnabled:false}));
