// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {Brain, atomicJson, hash, retrieve, route, safePath} from '../src/core.mjs';
import {prioritize} from '../pilot/priority.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'btb-test-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const vault = path.join(root,'vault'); fs.mkdirSync(vault);
  fs.writeFileSync(path.join(vault,'Alpha.md'),'---\natualizado: 2020-01-01\n---\n# Alpha\nUse queue for offline retries.');
  fs.writeFileSync(path.join(vault,'Beta.md'),'# Beta\nUse polling for queue.');
  const config = {vault,projects:[{id:'alpha',name:'Alpha',aliases:['primeiro'],notes:['Alpha.md']},{id:'beta',name:'Beta',aliases:['segundo'],notes:['Beta.md']}],maxContextChars:2000,maxNotes:3,maxAttempts:2,maxToolCalls:30,maxUsd:0,staleDays:90};
  atomicJson(path.join(root,'.local/config.json'),config);
  return {root,vault,config,brain:new Brain(root)};
}
function create(brain) { return brain.create({idea:'Alpha offline queue',actor:'codex',acceptance:['Queues must retry after reconnect']}); }
test('routing handles accents, aliases and boundaries; ambiguity fails closed', t => {
  const {config}=fixture(t);
  assert.equal(route(config,'primeiro queue').id,'alpha');
  assert.throws(()=>route(config,'alphabet soup'),/Unknown/);
  assert.throws(()=>route(config,'Alpha and Beta'),/Ambiguous/);
  assert.throws(()=>route(config,'x','other'),/authorized/);
});
test('retrieval isolates projects and emits current hash, stale flag and bounded context',t=>{
  const {config,vault}=fixture(t);
  const r=retrieve(config,'alpha','queue');
  assert.equal(r.sources.length,1); assert.equal(r.sources[0].source,'Alpha.md');
  assert.equal(r.sources[0].stale,true);
  assert.equal(r.sources[0].sha256,hash(fs.readFileSync(path.join(vault,'Alpha.md'))));
  assert.ok(JSON.stringify(r).length<=config.maxContextChars);
  assert.equal(r.metrics.apiCostUsd,0);
  fs.appendFileSync(path.join(vault,'Alpha.md'),'\nChanged queue implementation');
  assert.notEqual(retrieve(config,'alpha','queue').sources[0].sha256,r.sources[0].sha256);
});
test('secret-like notes are excluded and vault is never written',t=>{
  const {config,vault}=fixture(t); const file=path.join(vault,'Alpha.md');
  fs.writeFileSync(file,'# Alpha\napi_key = abcdefghijklmnopqrst'); const before=hash(fs.readFileSync(file));
  assert.equal(retrieve(config,'alpha','Alpha').sources.length,0);
  assert.equal(hash(fs.readFileSync(file)),before);
});
test('path traversal, hidden notes and absolute paths are rejected',t=>{
  const {root,config}=fixture(t);
  assert.throws(()=>safePath(root,'../escape'));
  assert.throws(()=>safePath(root,root));
  config.projects[0].notes=['.obsidian/secret.md'];
  assert.throws(()=>retrieve(config,'alpha','queue'));
});
test('vault roots and allowlisted paths reject Windows junctions and symlinks',t=>{
  const {root,vault,config}=fixture(t),outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'Private.md'),'# Outside');
  try{fs.symlinkSync(outside,path.join(vault,'linked'),'junction');}catch(error){t.skip(`Junction creation unavailable: ${error.code||error.message}`);return;}
  config.projects[0].notes=['linked/Private.md'];atomicJson(path.join(root,'.local/config.json'),config);
  assert.throws(()=>retrieve(config,'alpha','Private'),/Links are forbidden/);
  config.vault=path.join(root,'vault-alias');atomicJson(path.join(root,'.local/config.json'),config);
  try{fs.symlinkSync(vault,config.vault,'junction');}catch(error){t.skip(`Vault junction creation unavailable: ${error.code||error.message}`);return;}
  assert.throws(()=>new Brain(root),/Links are forbidden/);
});
test('criteria required and optimistic revision prevents lost updates',t=>{
  const {brain}=fixture(t);
  assert.throws(()=>brain.create({idea:'Alpha',actor:'codex',acceptance:[]}));
  const task=create(brain); const owned=brain.claim(task.id,{actor:'codex',revision:task.revision});
  assert.throws(()=>brain.claim(task.id,{actor:'claude',revision:task.revision}),/Stale/);
  assert.throws(()=>brain.claim(task.id,{actor:'claude',revision:owned.revision}),/another agent/);
  assert.throws(()=>brain.advance(task.id,{actor:'codex',revision:owned.revision,phase:'implementing'}),/Illegal/);
});
test('lease expiration, release and claim allow safe cross-agent handoff',t=>{
  const {brain}=fixture(t); let task=create(brain);
  task=brain.claim(task.id,{actor:'codex',revision:task.revision});
  task=brain.release(task.id,{actor:'codex',revision:task.revision});
  task=brain.claim(task.id,{actor:'claude',revision:task.revision});
  assert.equal(task.owner,'claude');
  task.leaseUntil='2000-01-01'; atomicJson(brain.taskFile(task.id),task);
  assert.throws(()=>brain.plan(task.id,{actor:'claude',revision:task.revision,steps:['x']}),/ownership/);
  assert.equal(brain.claim(task.id,{actor:'work',revision:task.revision}).owner,'work');
});
test('exclusive filesystem lock rejects simultaneous mutation',t=>{
  const {brain}=fixture(t); const task=create(brain);
  fs.writeFileSync(brain.taskFile(task.id)+'.lock','');
  assert.throws(()=>brain.claim(task.id,{actor:'codex',revision:task.revision}),/Task is locked/);
  assert.ok(fs.existsSync(brain.taskFile(task.id)+'.lock'),'an unknown lock must never be auto-deleted');
});
test('failed checks stop at configured retry budget',t=>{
  const {brain,root}=fixture(t); let task=create(brain);
  const opts=()=>({actor:'codex',revision:task.revision});
  task=brain.claim(task.id,opts()); task=brain.plan(task.id,{...opts(),steps:['Implement acceptance']});
  task=brain.advance(task.id,{...opts(),phase:'implementing'}); task=brain.advance(task.id,{...opts(),phase:'testing'});
  fs.writeFileSync(path.join(root,'failure.txt'),'FAIL: queue lost');
  task=brain.recordCheck(task.id,{...opts(),passed:false,evidence:'failure.txt'});
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'review'}),/Passing/);
  task=brain.recordCheck(task.id,{...opts(),passed:false,evidence:'failure.txt'});
  assert.equal(task.blocked,'Retry budget exhausted');
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'review'}),/blocked/);
});
test('tool-call limit stops work and still permits ownership release',t=>{
  const {brain}=fixture(t); let task=create(brain); task=brain.claim(task.id,{actor:'codex',revision:task.revision});
  task.toolCalls=brain.config.maxToolCalls; atomicJson(brain.taskFile(task.id),task);
  assert.throws(()=>brain.plan(task.id,{actor:'codex',revision:task.revision,steps:['x']}),/budget/);
  assert.equal(brain.release(task.id,{actor:'codex',revision:task.revision}).owner,null);
});
test('checks, review and verifiable patch are mandatory lifecycle gates',t=>{
  const {brain,root}=fixture(t); let task=create(brain); const opts=()=>({actor:'codex',revision:task.revision});
  task=brain.claim(task.id,opts()); task=brain.plan(task.id,{...opts(),steps:['Implement acceptance']});
  task=brain.advance(task.id,{...opts(),phase:'implementing'}); task=brain.advance(task.id,{...opts(),phase:'testing'});
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'review'}),/evidence/);
  fs.writeFileSync(path.join(root,'result.txt'),'PASS: all criteria');
  task=brain.recordCheck(task.id,{...opts(),passed:true,evidence:'result.txt'});
  task=brain.advance(task.id,{...opts(),phase:'review'});
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'pr_ready'}),/Review/);
  task=brain.recordReview(task.id,{...opts(),summary:'Inspected code and security boundaries'});
  task=brain.advance(task.id,{...opts(),phase:'pr_ready'});
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'done'}),/Verifiable/);
  atomicJson(path.join(root,'remote.json'),{url:'https://github.com/example/pilot/pull/2',state:'open',merged:false,private:true,head:'a'.repeat(40),status:'success'});
  assert.throws(()=>brain.recordPr(task.id,{...opts(),url:'https://github.com/example/pilot/pull/1',verification:'remote.json'}),/proof/);
  atomicJson(path.join(root,'remote.json'),{url:'https://github.com/example/pilot/pull/1',state:'open',merged:false,private:true,head:'a'.repeat(40),status:'success'});
  task=brain.recordPr(task.id,{...opts(),url:'https://github.com/example/pilot/pull/1',verification:'remote.json'});assert.equal(task.pr.hostProofValidated,true);assert.equal(task.pr.providerAuthenticated,false);
  fs.writeFileSync(path.join(root,'change.patch'),'diff --git a/file b/file\n+implementation\n');
  task=brain.recordPr(task.id,{...opts(),patch:'change.patch'});
  task=brain.advance(task.id,{...opts(),phase:'done'});
  assert.equal(task.pr.kind,'local-equivalent');
  assert.match(fs.readFileSync(brain.handoff(task.id).file,'utf8'),/Spec: 1/);
});
test('paid configuration is refused',t=>{
  const {root,config}=fixture(t); config.maxUsd=1; atomicJson(path.join(root,'.local/config.json'),config);
  assert.throws(()=>new Brain(root),/disabled/);
});
test('remote-ci policy binds review files and commit and requires hosted CI; successors inherit budget',t=>{
  const {brain,root}=fixture(t);let prior=create(brain);prior=brain.claim(prior.id,{actor:'codex',revision:prior.revision});
  let task=brain.create({idea:'Alpha remote CI successor',project:'alpha',actor:'codex',acceptance:['Hosted CI and reviewed code required'],deliveryPolicy:'remote-ci',predecessor:prior.id});
  assert.equal(task.toolCalls,prior.toolCalls);assert.equal(task.predecessor,prior.id);
  const opts=()=>({actor:task.owner??'codex',revision:task.revision});
  task=brain.claim(task.id,opts());task=brain.plan(task.id,{...opts(),steps:['Implement']});
  task=brain.advance(task.id,{...opts(),phase:'implementing'});task=brain.advance(task.id,{...opts(),phase:'testing'});
  fs.writeFileSync(path.join(root,'tests.tap'),'PASS');fs.writeFileSync(path.join(root,'code.mjs'),'export const value=1;');
  task=brain.recordCheck(task.id,{...opts(),passed:true,evidence:'tests.tap'});task=brain.advance(task.id,{...opts(),phase:'review'});
  task=brain.release(task.id,opts());task=brain.claim(task.id,{actor:'claude-code',revision:task.revision});fs.writeFileSync(path.join(root,'review.md'),'Independent review approved');
  assert.throws(()=>brain.recordReview(task.id,{...opts(),summary:'Reviewed all delivery requirements',evidence:'review.md'}),/commit-bound/);
  task=brain.recordReview(task.id,{...opts(),summary:'Reviewed all delivery requirements',evidence:'review.md',commit:'a'.repeat(40),files:['code.mjs']});
  fs.appendFileSync(path.join(root,'code.mjs'),'//changed');assert.throws(()=>brain.advance(task.id,{...opts(),phase:'pr_ready'}),/Reviewed code changed/);
  fs.writeFileSync(path.join(root,'code.mjs'),'export const value=1;');task=brain.advance(task.id,{...opts(),phase:'pr_ready'});
  fs.writeFileSync(path.join(root,'patch.diff'),'diff --git a/code.mjs b/code.mjs\n+code');task=brain.recordPr(task.id,{...opts(),patch:'patch.diff'});
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'done'}),/Host-validated PR proof/);
  const pr={url:'https://github.com/example/pilot/pull/3',state:'open',merged:false,private:true,head:'b'.repeat(40),reviewedCommit:'c'.repeat(40),readStatus:'success'};
  atomicJson(path.join(root,'pr.json'),pr);assert.throws(()=>brain.recordPr(task.id,{...opts(),url:pr.url,verification:'pr.json'}),/reviewed commit/);
  pr.reviewedCommit='a'.repeat(40);atomicJson(path.join(root,'pr.json'),pr);assert.throws(()=>brain.recordPr(task.id,{...opts(),url:pr.url,verification:'pr.json'}),/head must equal/);
  pr.head='a'.repeat(40);pr.private=false;atomicJson(path.join(root,'pr.json'),pr);task=brain.recordPr(task.id,{...opts(),url:pr.url,verification:'pr.json'});assert.equal(task.pr.private,false);
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'done'}),/Host-validated PR proof/);
  pr.title='tampered proof';atomicJson(path.join(root,'pr.json'),pr);assert.throws(()=>brain.advance(task.id,{...opts(),phase:'done'}),/Integration evidence changed/);
  delete pr.title;atomicJson(path.join(root,'pr.json'),pr);
  atomicJson(path.join(root,'ci.json'),{url:'https://github.com/example/pilot/actions/runs/123',head:pr.head,event:'pull_request',conclusion:'success'});
  task=brain.recordCi(task.id,{...opts(),evidence:'ci.json'});task=brain.advance(task.id,{...opts(),phase:'done'});assert.equal(task.phase,'done');
  assert.throws(()=>brain.recordMetrics(task.id,{...opts(),evidence:'ci.json'}),/frozen/);
});

test('identical failed evidence blocks retries even before general budget',t=>{
  const {brain,root}=fixture(t);brain.config.maxAttempts=3;
  let task=create(brain);const opts=()=>({actor:'codex',revision:task.revision});
  task=brain.claim(task.id,opts());task=brain.plan(task.id,{...opts(),steps:['Implement']});
  task=brain.advance(task.id,{...opts(),phase:'implementing'});task=brain.advance(task.id,{...opts(),phase:'testing'});
  fs.writeFileSync(path.join(root,'failure.txt'),'same assertion failure');
  task=brain.recordCheck(task.id,{...opts(),passed:false,evidence:'failure.txt'});
  task=brain.recordCheck(task.id,{...opts(),passed:false,evidence:'failure.txt'});
  assert.match(task.blocked,/no progress/);assert.equal(task.attempts,2);
});

test('metrics isolate tasks and CI requires matching successful remote evidence',t=>{
  const {brain,root}=fixture(t);let task=create(brain);const opts=()=>({actor:'codex',revision:task.revision});
  task=brain.claim(task.id,opts());task=brain.plan(task.id,{...opts(),steps:['Implement']});
  task=brain.advance(task.id,{...opts(),phase:'implementing'});task=brain.advance(task.id,{...opts(),phase:'testing'});
  fs.writeFileSync(path.join(root,'pass.txt'),'PASS');task=brain.recordCheck(task.id,{...opts(),passed:true,evidence:'pass.txt'});
  task=brain.advance(task.id,{...opts(),phase:'review'});task=brain.recordReview(task.id,{...opts(),summary:'Inspected implementation and test results'});
  task=brain.advance(task.id,{...opts(),phase:'pr_ready'});
  const pr={url:'https://github.com/example/pilot/pull/2',head:'a'.repeat(40),state:'open',merged:false,private:true,status:'success'};
  atomicJson(path.join(root,'pr.json'),pr);task=brain.recordPr(task.id,{...opts(),url:pr.url,verification:'pr.json'});
  atomicJson(path.join(root,'usage.json'),{runs:[{id:'r1',task:'other',provider:'codex'}]});
  assert.throws(()=>brain.recordMetrics(task.id,{...opts(),evidence:'usage.json'}),/Cross-task/);
  atomicJson(path.join(root,'usage.json'),{runs:[{id:'r1',task:task.id,provider:'codex'}]});
  task=brain.recordMetrics(task.id,{...opts(),evidence:'usage.json'});assert.equal(task.metrics.totals.actualBilledUsd,null);
  const ci={url:'https://github.com/example/pilot/actions/runs/123',head:pr.head,event:'pull_request',conclusion:'failure'};
  atomicJson(path.join(root,'ci.json'),ci);assert.throws(()=>brain.recordCi(task.id,{...opts(),evidence:'ci.json'}),/Successful CI/);
  ci.conclusion='success';ci.head='b'.repeat(40);atomicJson(path.join(root,'ci.json'),ci);
  assert.throws(()=>brain.recordCi(task.id,{...opts(),evidence:'ci.json'}),/Successful CI/);
  ci.head=pr.head;atomicJson(path.join(root,'ci.json'),ci);task=brain.recordCi(task.id,{...opts(),evidence:'ci.json'});
  fs.appendFileSync(path.join(root,'ci.json'),' ');assert.throws(()=>brain.advance(task.id,{...opts(),phase:'done'}),/Integration evidence changed/);
});
test('independent reviewer must provide evidence and altered review is rejected',t=>{
  const {brain,root}=fixture(t);let task=create(brain);const opts=()=>({actor:task.owner||'codex',revision:task.revision});
  task=brain.claim(task.id,opts());task=brain.plan(task.id,{...opts(),steps:['Implement acceptance']});
  task=brain.advance(task.id,{...opts(),phase:'implementing'});task=brain.advance(task.id,{...opts(),phase:'testing'});
  fs.writeFileSync(path.join(root,'checks.txt'),'PASS');task=brain.recordCheck(task.id,{...opts(),passed:true,evidence:'checks.txt'});
  task=brain.advance(task.id,{...opts(),phase:'review'});task=brain.release(task.id,opts());task=brain.claim(task.id,{actor:'claude-code',revision:task.revision});
  assert.throws(()=>brain.recordReview(task.id,{...opts(),summary:'Independent review completed'}),/evidence/);
  fs.writeFileSync(path.join(root,'review.md'),'Independent reviewer approved after running tests');
  task=brain.recordReview(task.id,{...opts(),summary:'Independent review completed',evidence:'review.md'});assert.equal(task.review.differentActorLabel,true);assert.equal(task.review.reviewerIdentityVerified,false);
  fs.appendFileSync(path.join(root,'review.md'),'changed');assert.throws(()=>brain.advance(task.id,{...opts(),phase:'pr_ready'}),/Review evidence changed/);
});
test('superseded task cannot advance and identifies its successor',t=>{
  const {brain}=fixture(t);let original=create(brain);original=brain.claim(original.id,{actor:'codex',revision:original.revision});
  const next=brain.create({project:'alpha',idea:'Alpha successor refined criteria',actor:'codex',acceptance:['Refined measurable acceptance requirement']});
  original=brain.supersede(original.id,{actor:'codex',revision:original.revision,successor:next.id});
  assert.equal(original.nextAction,`Continue ${next.id}`);assert.match(original.blocked,/Superseded/);
});
test('same idea reuses task without resetting budgets; scope change fails',t=>{
  const {brain}=fixture(t); const task=create(brain);
  assert.equal(create(brain).id,task.id);
  assert.throws(()=>brain.create({idea:task.idea,actor:'work',project:'alpha',acceptance:['Different requirement entirely']}),/successor/);
});
test('evidence cannot be changed after test recording',t=>{
  const {brain,root}=fixture(t); let task=create(brain);const opts=()=>({actor:'codex',revision:task.revision});
  task=brain.claim(task.id,opts());task=brain.plan(task.id,{...opts(),steps:['Implement']});
  task=brain.advance(task.id,{...opts(),phase:'implementing'});task=brain.advance(task.id,{...opts(),phase:'testing'});
  fs.writeFileSync(path.join(root,'checks.txt'),'PASS');task=brain.recordCheck(task.id,{...opts(),passed:true,evidence:'checks.txt'});
  fs.writeFileSync(path.join(root,'checks.txt'),'changed');
  assert.throws(()=>brain.advance(task.id,{...opts(),phase:'review'}),/Evidence changed/);
});
test('installer preserves previous MCP and hooks; backup rollback restores exact bytes',t=>{
  const {root}=fixture(t); const home=path.join(root,'client-home');
  fs.mkdirSync(path.join(home,'.codex'),{recursive:true});fs.mkdirSync(path.join(home,'.claude'),{recursive:true});
  const originals={'.codex/config.toml':'model = "existing"\n[mcp_servers.blender]\ncommand = "blender"\n', '.claude.json':JSON.stringify({mcpServers:{blender:{command:'existing'}},privateSetting:'preserve'}),'.codex/AGENTS.md':'# Existing instructions\nDo not write vault.\n','.claude/CLAUDE.md':'# Existing Claude instructions\n'};
  for(const [file,body] of Object.entries(originals))fs.writeFileSync(path.join(home,file),body);
  const invoke=args=>spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../scripts/install-clients.mjs'),...args],{env:{...process.env,BRAIN_TO_BUILD_INSTALL_ROOT:root,BRAIN_TO_BUILD_CLIENT_HOME:home},encoding:'utf8',timeout:10000});
  assert.equal(invoke([]).status,0);
  for(const [file,body] of Object.entries(originals))assert.equal(fs.readFileSync(path.join(home,file),'utf8'),body);
  const installed=invoke(['--apply']);assert.equal(installed.status,0,installed.stderr);
  const claude=JSON.parse(fs.readFileSync(path.join(home,'.claude.json'),'utf8'));
  assert.equal(claude.mcpServers.blender.command,'existing');assert.ok(claude.mcpServers['brain-to-build']);
  assert.equal(claude.privateSetting,'preserve');assert.equal(invoke(['--apply']).status,0);
  const rolledBack=invoke(['--rollback']);assert.equal(rolledBack.status,0,rolledBack.stderr);
  for(const [file,body] of Object.entries(originals))assert.equal(fs.readFileSync(path.join(home,file),'utf8'),body);
});
test('MCP subprocess initializes, lists tools, retrieves and rejects invalid calls',t=>{
  const {root}=fixture(t);
  const messages=[
    {id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}}},
    {method:'notifications/initialized'},
    {id:2,method:'tools/list'},
    {id:3,method:'tools/call',params:{name:'brain_context',arguments:{query:'Alpha queue'}}},
    {id:4,method:'tools/call',params:{name:'brain_context',arguments:{query:'Alpha',unexpected:true}}},
    {id:5,method:'tools/call',params:{name:'brain_context',arguments:{query:'Alpha',project:'unauthorized'}}},
    {id:6,method:'shell/run'}
  ].map(x=>JSON.stringify({jsonrpc:'2.0',...x})).join('\n')+'\n';
  const result=spawnSync(process.execPath,['src/mcp.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,BRAIN_TO_BUILD_ROOT:root},input:messages,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
  const responses=result.stdout.trim().split('\n').map(x=>JSON.parse(x));
  assert.equal(responses.length,6); assert.equal(responses[0].result.protocolVersion,'2025-11-25');
  assert.equal(responses[1].result.tools.length,5);
  assert.equal(JSON.parse(responses[2].result.content[0].text).sources[0].source,'Alpha.md');
  assert.equal(responses[3].error.code,-32602); assert.equal(responses[4].result.isError,true);
  assert.equal(responses[5].error.code,-32601);
});
test('pilot ranks, tie-breaks and does not mutate input',()=>{
  const input=[{id:'b',impact:4,effort:2},{id:'a',impact:2,effort:1},{id:'c',impact:5,effort:1}];
  const before=structuredClone(input);
  assert.deepEqual(prioritize(input).map(x=>x.id),['c','a','b']); assert.deepEqual(input,before);
});
test('running MCP reloads project allowlist after an authorized registry update',async t=>{
  const {root,config,vault}=fixture(t);
  const child=spawn(process.execPath,[path.resolve(import.meta.dirname,'../src/mcp.mjs')],{env:{...process.env,BRAIN_TO_BUILD_ROOT:root},stdio:['pipe','pipe','pipe'],windowsHide:true});
  t.after(()=>child.kill());let buffer='';const pending=new Map();let next=0;
  child.stdout.on('data',chunk=>{buffer+=chunk.toString();let i;while((i=buffer.indexOf('\n'))>=0){const message=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);pending.get(message.id)?.(message);pending.delete(message.id);}});
  const request=(method,params)=>{const id=++next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MCP response timeout')),5000);pending.set(id,m=>{clearTimeout(timer);resolve(m)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});};
  await request('initialize',{protocolVersion:'2025-11-25'});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  await request('tools/list',{});
  fs.writeFileSync(path.join(vault,'Gamma.md'),'# Gamma\nGamma uses queues safely.');
  config.projects.push({id:'gamma',name:'Gamma',aliases:[],notes:['Gamma.md']});atomicJson(path.join(root,'.local/config.json'),config);
  const response=await request('tools/call',{name:'brain_context',arguments:{project:'gamma',query:'Beta'}});
  assert.equal(response.result.isError,false);assert.equal(JSON.parse(response.result.content[0].text).project,'gamma');
  child.stdin.end();await new Promise(resolve=>child.on('close',resolve));
});
test('pilot rejects invalid data and duplicate IDs',()=>{
  for(const input of [null,[{id:'a',impact:6,effort:1}],[{id:'a',impact:1,effort:0}],[{id:'a',impact:1,effort:Infinity}],[{id:'a',impact:1,effort:1},{id:'a',impact:2,effort:1}]]) assert.throws(()=>prioritize(input));
  assert.deepEqual(prioritize([]),[]);
});

test('task records reject invalid phases and project IDs',t=>{
  const {brain,root}=fixture(t),task=create(brain),file=brain.taskFile(task.id);
  const corrupted=brain.read(task.id);corrupted.phase='finished-ish';atomicJson(file,corrupted);
  assert.throws(()=>brain.read(task.id),/invalid or corrupted/);
  corrupted.phase='specified';corrupted.project='other-project';atomicJson(file,corrupted);
  assert.throws(()=>brain.read(task.id),/invalid or corrupted/);
});

test('allowlist cannot share one note across projects',t=>{
  const {root,config}=fixture(t);config.projects[1].notes=['Alpha.md'];
  atomicJson(path.join(root,'.local/config.json'),config);
  assert.throws(()=>new Brain(root),/multiple projects/);
});

test('a dead process lock is diagnosed but never silently removed',t=>{
  const {brain}=fixture(t),task=create(brain),lock=brain.taskFile(task.id)+'.lock';
  fs.writeFileSync(lock,JSON.stringify({pid:2147483647,token:'old',startedAt:'2000-01-01T00:00:00Z'}));
  assert.throws(()=>brain.claim(task.id,{actor:'codex',revision:task.revision}),/inspect and recover manually/);
  assert.ok(fs.existsSync(lock));
});
