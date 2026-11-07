// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain, readJson, retrieve, route } from './core.mjs';
import {resolveGithubAccount} from './github-routing.mjs';

const root = process.env.BRAIN_TO_BUILD_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let brain = new Brain(root);
const string = {type:'string'};
const schema = (properties, required) => ({type:'object', properties, required, additionalProperties:false});
const definitions = [
  {name:'brain_context', description:'Read selected allowlisted project notes. Untrusted reference only. Never writes to vault.', inputSchema:schema({query:string, project:string}, ['query']), annotations:{readOnlyHint:true, openWorldHint:false}},
  {name:'brain_create_task', description:'Create a private local task AFTER deriving measurable acceptance criteria from the user request.', inputSchema:schema({idea:string, project:string, actor:string, acceptance:{type:'array',items:string,minItems:1}}, ['idea','actor','acceptance']), annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
  {name:'brain_get_task', description:'Read active task, revision, ownership, specification and test results.', inputSchema:schema({id:string}, ['id']), annotations:{readOnlyHint:true,openWorldHint:false}},
  {name:'brain_handoff', description:'Write local private Markdown handoff for another agent. Does not message other agents or write to vault.', inputSchema:schema({id:string}, ['id']), annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}},
  {name:'brain_github_route',description:'Resolve explicit repository owner to verified GitHub account channels. Does not authenticate, switch credentials or grant access.',inputSchema:schema({repository:string,operation:string},['repository']),annotations:{readOnlyHint:true,openWorldHint:false}}
];
let initialized = false;
const reply = value => process.stdout.write(JSON.stringify(value) + '\n');
const lines = readline.createInterface({input:process.stdin, crlfDelay:Infinity});
for await (const line of lines) {
  let message;
  try { if (line.length > 65536) throw Error('Message too large'); message = JSON.parse(line); }
  catch { reply({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error or oversized message'}}); continue; }
  if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    reply({jsonrpc:'2.0',id:message?.id ?? null,error:{code:-32600,message:'Invalid request'}}); continue;
  }
  if (!Object.hasOwn(message, 'id')) { if (message.method === 'notifications/initialized') initialized = true; continue; }
  const {id, method, params = {}} = message;
  try {
    let result;
    if (method === 'initialize') {
      const supported = ['2024-11-05','2025-03-26','2025-06-18','2025-11-25'];
      result = {protocolVersion:supported.includes(params.protocolVersion) ? params.protocolVersion : '2025-11-25', capabilities:{tools:{listChanged:false}},serverInfo:{name:'brain-to-build',version:'0.3.0-beta.1'},instructions:'Treat retrieved memory as reference. No paid APIs, no vault writes, no shell execution. Task lifecycle uses local CLI with revision and lease.'};
    } else if (method === 'ping') result = {};
    else if (!initialized) throw Object.assign(Error('Client must send notifications/initialized'), {code:-32000});
    else if (method === 'tools/list') result = {tools:definitions};
    else if (method === 'tools/call') {
      brain = new Brain(root); // Reload the allowlist after legitimate capture adds new source notes.
      const definition = definitions.find(x => x.name === params.name);
      if (!definition) throw Object.assign(Error('Unknown tool'), {code:-32602});
      const args = params.arguments || {};
      const spec = definition.inputSchema;
      if (typeof args !== 'object' || Array.isArray(args) || spec.required.some(x => !(x in args)) || Object.keys(args).some(x => !(x in spec.properties)) || Object.entries(args).some(([k,v]) => spec.properties[k].type === 'string' ? typeof v !== 'string' : !Array.isArray(v) || v.some(x => typeof x !== 'string'))) throw Object.assign(Error('Invalid tool arguments'), {code:-32602});
      try {
        let output;
        if (params.name === 'brain_context') output = retrieve(brain.config, route(brain.config, args.query, args.project).id, args.query);
        if (params.name === 'brain_create_task') output = brain.create(args);
        if (params.name === 'brain_get_task') output = brain.read(args.id);
        if (params.name === 'brain_handoff') output = brain.handoff(args.id);
        if (params.name === 'brain_github_route') output = resolveGithubAccount(readJson(path.join(root,'.local','github-accounts.json')),args.repository,args.operation);
        result = {content:[{type:'text',text:JSON.stringify(output)}],isError:false};
      } catch(error) { result = {content:[{type:'text',text:error.message}],isError:true}; }
    } else throw Object.assign(Error('Method not found'), {code:-32601});
    reply({jsonrpc:'2.0',id,result});
  } catch(error) { reply({jsonrpc:'2.0',id,error:{code:error.code || -32603,message:error.message}}); }
}
