// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {atomicJson,hash} from '../src/core.mjs';

test('clean synthetic install can retrieve context, create a task, hand off, and keep projects isolated',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'btb-community-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const vault=path.join(root,'synthetic-vault');fs.mkdirSync(path.join(vault,'Projects'),{recursive:true});
  const alpha=path.join(vault,'Projects','Alpha.md'),beta=path.join(vault,'Projects','Beta.md');
  fs.writeFileSync(alpha,'# Alpha\nAlpha uses an offline queue with retry limits.');
  fs.writeFileSync(beta,'# Beta\nBeta uses a separate offline queue and retry limits.');
  const before={alpha:hash(fs.readFileSync(alpha)),beta:hash(fs.readFileSync(beta))};
  const config={vault,projects:[{id:'alpha',name:'Alpha',aliases:['alpha app'],notes:['Projects/Alpha.md']},{id:'beta',name:'Beta',aliases:['beta app'],notes:['Projects/Beta.md']}],repositoriesRoot:root,paths:{workingDirectory:path.join(root,'work'),logDirectory:path.join(root,'logs'),backupDirectory:path.join(root,'backups')},clients:{},github:{enabled:false,accounts:[],organizations:[],allowedRepositories:[]},maxContextChars:6000,maxNotes:6,maxAttempts:3,maxToolCalls:30,maxUsd:0,staleDays:90};
  atomicJson(path.join(root,'.local','config.json'),config);
  const child=spawn(process.execPath,[path.resolve(import.meta.dirname,'../src/mcp.mjs')],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,BRAIN_TO_BUILD_ROOT:root},stdio:['pipe','pipe','pipe'],windowsHide:true});
  t.after(()=>child.kill());
  let buffer='',next=0;const pending=new Map(),errors=[];
  child.stdout.on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let msg;try{msg=JSON.parse(line)}catch{continue}pending.get(msg.id)?.(msg);pending.delete(msg.id);}});
  child.stderr.on('data',chunk=>errors.push(chunk.toString()));
  const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('MCP request timed out'))},5000);pending.set(id,msg=>{clearTimeout(timer);resolve(msg)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await request('initialize',{protocolVersion:'2025-11-25'});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const context=await request('tools/call',{name:'brain_context',arguments:{project:'alpha',query:'offline queue retry'}});
  const selected=JSON.parse(context.result.content[0].text);assert.equal(selected.project,'alpha');assert.deepEqual(selected.sources.map(s=>s.source),['Projects/Alpha.md']);assert.ok(!JSON.stringify(selected).includes('Beta uses'));
  const created=await request('tools/call',{name:'brain_create_task',arguments:{idea:'Alpha offline queue retry bounds',project:'alpha',actor:'codex',acceptance:['The retry limit is configurable and verified by a regression test']}});
  assert.equal(created.result.isError,false);const task=JSON.parse(created.result.content[0].text);assert.equal(task.phase,'specified');assert.equal(task.project,'alpha');
  const current=await request('tools/call',{name:'brain_get_task',arguments:{id:task.id}});assert.equal(JSON.parse(current.result.content[0].text).id,task.id);
  const handoff=await request('tools/call',{name:'brain_handoff',arguments:{id:task.id}});assert.equal(handoff.result.isError,false);
  const record=JSON.parse(handoff.result.content[0].text),body=fs.readFileSync(record.file,'utf8');assert.match(body,/The retry limit is configurable/);assert.match(body,new RegExp(task.id));
  assert.equal(hash(fs.readFileSync(alpha)),before.alpha);assert.equal(hash(fs.readFileSync(beta)),before.beta);
  assert.deepEqual(fs.readdirSync(vault),['Projects']);assert.equal(errors.length,0);
  child.stdin.end();await new Promise(resolve=>child.once('close',resolve));
});
