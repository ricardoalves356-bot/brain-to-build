// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {atomicJson,hash,normalize} from '../src/core.mjs';

const source=path.resolve(import.meta.dirname,'..');
const fixtureConfig=(root,vault,note)=>({vault,projects:[{id:'release-smoke',name:'Release Smoke',aliases:[],notes:[note]}],repositoriesRoot:root,paths:{workingDirectory:path.join(root,'work'),logDirectory:path.join(root,'logs'),backupDirectory:path.join(root,'backups')},clients:{},github:{enabled:false,accounts:[],organizations:[],allowedRepositories:[]},maxContextChars:2000,maxNotes:2,maxAttempts:2,maxToolCalls:20,maxUsd:0,staleDays:90});
const mcpId=idea=>`task-${hash(`release-smoke:${normalize(idea).trim()}`).slice(0,24)}`;

function startMcp(root,t){
  const child=spawn(process.execPath,[path.join(source,'src/mcp.mjs')],{cwd:source,env:{...process.env,BRAIN_TO_BUILD_ROOT:root},stdio:['pipe','pipe','ignore'],windowsHide:true});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  let buffer='',next=0;const pending=new Map();
  child.stdout.on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let message;try{message=JSON.parse(line);}catch{continue;}const resolve=pending.get(message.id);if(resolve){pending.delete(message.id);resolve(message);}}});
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error(`MCP timeout: ${method}`));},5000);pending.set(id,message=>{clearTimeout(timer);resolve(message);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  return {child,request};
}

function tryJunction(target,link){
  try{fs.symlinkSync(target,link,'junction');return null;}
  catch(error){if(['EPERM','EACCES','ENOTSUP','UNKNOWN'].includes(error.code))return error.code;throw error;}
}

test('MCP tools reject Windows junctions that escape authorized read and write roots',async t=>{
  if(process.platform!=='win32'){t.skip('Windows junction security is exercised on windows-latest');return;}
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'btb-junction-mcp-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const vault=path.join(root,'vault'),outside=path.join(root,'outside'),local=path.join(root,'.local');
  fs.mkdirSync(path.join(vault,'Projects'),{recursive:true});fs.mkdirSync(outside);fs.mkdirSync(local);
  fs.writeFileSync(path.join(vault,'Projects','Alpha.md'),'# Release Smoke\nSynthetic context only.');
  fs.writeFileSync(path.join(outside,'Private.md'),'Outside canary: copper comet 31.');
  const outsideTasks=path.join(outside,'tasks'),outsideHandoffs=path.join(outside,'handoffs');fs.mkdirSync(outsideTasks);fs.mkdirSync(outsideHandoffs);
  const junctions=[[outside,path.join(vault,'linked')],[outsideTasks,path.join(local,'tasks')],[outsideHandoffs,path.join(local,'handoffs')]];
  for(const [target,link] of junctions){const error=tryJunction(target,link);if(error){for(const [,createdLink] of junctions){try{fs.rmdirSync(createdLink);}catch{}}t.skip(`Junction creation unavailable: ${error}`);return;}}
  atomicJson(path.join(local,'config.json'),fixtureConfig(root,vault,'linked/Private.md'));
  const {child,request}=startMcp(root,t);
  const initialized=await request('initialize',{protocolVersion:'2025-11-25'});assert.ok(initialized.result);child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');

  const context=await request('tools/call',{name:'brain_context',arguments:{project:'release-smoke',query:'Outside canary'}});
  assert.equal(context.result?.isError,true);assert.match(context.result.content[0].text,/Links are forbidden/);assert.ok(!JSON.stringify(context).includes('copper comet 31'));

  const config=fixtureConfig(root,vault,'Projects/Alpha.md');atomicJson(path.join(local,'config.json'),config);
  const tasksLink=path.join(local,'tasks');
  const readId=`task-${'a'.repeat(24)}`;
  atomicJson(path.join(outsideTasks,`${readId}.json`),{schemaVersion:1,id:readId,project:'release-smoke',revision:1,phase:'specified',acceptance:['Synthetic outside task'],events:[{at:new Date().toISOString(),actor:'test',action:'created',revision:1}],evidence:[],deliveryPolicy:'local-or-pr',toolCalls:0,attempts:0});
  const read=await request('tools/call',{name:'brain_get_task',arguments:{id:readId}});
  assert.equal(read.result?.isError,true);assert.match(read.result.content[0].text,/Links are forbidden/);assert.ok(!JSON.stringify(read).includes('Synthetic outside task'));
  const writeIdea='Synthetic task write through junction';
  const create=await request('tools/call',{name:'brain_create_task',arguments:{idea:writeIdea,project:'release-smoke',actor:'junction-test',acceptance:['The junction cannot redirect this task write']}});
  assert.equal(create.result?.isError,true);assert.match(create.result.content[0].text,/Links are forbidden/);assert.equal(fs.existsSync(path.join(outsideTasks,`${mcpId(writeIdea)}.json`)),false);
  fs.rmdirSync(tasksLink);

  const taskIdea='Synthetic handoff junction test';
  const created=await request('tools/call',{name:'brain_create_task',arguments:{idea:taskIdea,project:'release-smoke',actor:'junction-test',acceptance:['The task remains within the temporary root']}});
  assert.equal(created.result?.isError,false);const task=JSON.parse(created.result.content[0].text);
  const handoffLink=path.join(local,'handoffs');
  const handoff=await request('tools/call',{name:'brain_handoff',arguments:{id:task.id}});
  assert.equal(handoff.result?.isError,true);assert.match(handoff.result.content[0].text,/Links are forbidden/);assert.deepEqual(fs.readdirSync(outsideHandoffs),[]);

  child.stdin.end();await new Promise(resolve=>child.once('close',resolve));
});
