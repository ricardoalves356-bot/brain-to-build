// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');
const files=['src','test','scripts','pilot'].flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(x=>x.endsWith('.mjs')).map(x=>`${dir}/${x}`));
for(const file of files) {
  const result=spawnSync(process.execPath,['--check',file],{cwd:root,encoding:'utf8'});
  if(result.status!==0) {process.stderr.write(result.stderr);process.exit(1);}
}
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
if(pkg.dependencies || pkg.devDependencies) throw Error('Review dependency policy before adding packages');
for(const file of files.filter(x=>x.startsWith('src/'))) {
  const body=fs.readFileSync(path.join(root,file),'utf8');
  if (/from ['"](?:node:)?(?:child_process|http|https|net|tls)['"]|\beval\s*\(|\bfetch\s*\(/.test(body)) throw Error(`Runtime cannot execute shell or network: ${file}`);
}
console.log(`PASS: syntax ${files.length} modules; runtime has no shell/network imports; zero external dependencies. This is a focused static check, not a full security audit or TypeScript check.`);
