// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {root,distributionFiles} from './distribution-files.mjs';
import './verify-distribution.mjs';
const files=distributionFiles().map(file=>({path:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
const manifest={schemaVersion:1,algorithm:'SHA-256',selfHash:'omitted to avoid recursive hashing',files};
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`Wrote manifest for ${files.length} files.`);
