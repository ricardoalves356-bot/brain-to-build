// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Brain, readJson, retrieve, route } from './core.mjs';
import {resolveGithubAccount} from './github-routing.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const brain = new Brain(root);
  const [command = 'help', payload = '{}'] = process.argv.slice(2);
  const input = JSON.parse(payload);
  let output;
  if (command === 'start') output = brain.create(input);
  else if (command === 'context') output = retrieve(brain.config, route(brain.config, input.query, input.project).id, input.query);
  else if (command === 'get') output = brain.read(input.id);
  else if (command === 'handoff') output = brain.handoff(input.id);
  else if (command === 'github') output = resolveGithubAccount(readJson(path.join(root,'.local','github-accounts.json')),input.repository,input.operation);
  else if (['claim','release','plan','advance','recordCheck','recordReview','recordPr','supersede','recordMetrics','recordCi'].includes(command)) output = brain[command](input.id, input);
  else output = {commands:['start','context','get','claim','release','plan','advance','recordCheck','recordReview','recordPr','recordMetrics','recordCi','supersede','handoff'],
    usage:'node src/cli.mjs start JSON', required:['idea','actor','acceptance'], note:'Use explicit project if routing is unknown or ambiguous. API calls and arbitrary command execution are disabled.'};
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
