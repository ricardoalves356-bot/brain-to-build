// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import {root,distributionFiles} from './distribution-files.mjs';
const config=JSON.parse(fs.readFileSync(path.join(root,'distribution-files.json'),'utf8'));
if(config.schemaVersion!==1||!Array.isArray(config.files)||config.files.some(x=>typeof x!=='string'||path.isAbsolute(x)||x.split('/').some(p=>p==='..'||p==='.git')))throw Error('Invalid explicit distribution allowlist');
const declared=[...config.files,'distribution-files.json'].sort((a,b)=>a.localeCompare(b,'en'));
if(new Set(declared).size!==declared.length)throw Error('Duplicate paths in distribution allowlist');
const actual=distributionFiles();
const missing=declared.filter(x=>!actual.includes(x)),unexpected=actual.filter(x=>!declared.includes(x));
if(missing.length||unexpected.length)throw Error(JSON.stringify({missing,unexpected}));
console.log(`PASS: explicit distribution allowlist covers ${actual.length} files; local state, tool cache, dependencies and Git metadata excluded.`);
