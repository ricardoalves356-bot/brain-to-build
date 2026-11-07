// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import {root,distributionFiles} from './distribution-files.mjs';

const checks=[
  ['private-key-header',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ['common-secret-assignment',/(?:api[_-]?key|password|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'][^"']{8,}/i],
  ['provider-token-shape',/\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,})\b/],
  ['personal-windows-profile',/\b[A-Z]:[\\/]Users[\\/](?!example(?:[\\/]|$)|sample(?:[\\/]|$))[^\\/\s"']+[\\/](?:OneDrive|AppData|Documents|\.codex|\.claude)(?:[\\/]|$)/i],
  ['private-vault-config',/(?:\.cerebro[\\/]|OneDrive[\\/]Documents[\\/]|claude_[a-z0-9]{8,})/i],
  ['non-synthetic-github-pr',/https:\/\/github\.com\/(?!example\/)[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/(?:pull|issues)\/\d+/i]
];
const findings=[];
for(const file of distributionFiles()){
  if(!/\.(?:md|json|mjs|yml|toml)$/i.test(file))continue;
  const body=fs.readFileSync(path.join(root,file),'utf8');
  for(const [category,pattern]of checks){pattern.lastIndex=0;if(pattern.test(body))findings.push({file,category});}
}
if(findings.length){console.error(JSON.stringify({status:'findings',findings}));process.exitCode=1;}
else console.log(`PASS: ${distributionFiles().length} allowlisted files scanned for configured secret and personal-data patterns; no matches. Heuristic only.`);
