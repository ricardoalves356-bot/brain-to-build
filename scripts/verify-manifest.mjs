// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,distributionFiles} from './distribution-files.mjs';
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if(manifest.schemaVersion!==1||manifest.algorithm!=='SHA-256'||!Array.isArray(manifest.files))throw Error('Invalid manifest schema');
const expected=distributionFiles(),actual=manifest.files.map(x=>x.path);
if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Manifest path list differs from the explicit distribution contents');
for(const file of manifest.files){const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file.path))).digest('hex');if(digest!==file.sha256)throw Error(`Manifest hash mismatch: ${file.path}`);}
console.log(`PASS: ${manifest.files.length} distribution files match their SHA-256 entries. The manifest excludes its own hash.`);
