// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const excluded=new Set(['.git','.local','node_modules','.audit-tools']);
export function distributionFiles(){
  const files=[];
  function visit(directory){
    for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
      const absolute=path.join(directory,entry.name),relative=path.relative(root,absolute).replaceAll('\\','/');
      if(entry.isSymbolicLink())throw Error(`Links are not allowed in the distribution tree: ${relative}`);
      if(relative.split('/').some(part=>excluded.has(part)))continue;
      if(entry.isDirectory())visit(absolute);else if(entry.isFile()&&relative!=='manifest.json')files.push(relative);
    }
  }
  visit(root);return files.sort();
}
