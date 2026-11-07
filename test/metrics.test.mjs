// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRun,summarizeTask} from '../src/metrics.mjs';
const base={id:'r1',task:'t1',provider:'codex'};
test('Codex input includes cache; Claude input excludes cache',()=>{
  const c=normalizeRun({...base,usage:{input_tokens:100,cached_input_tokens:80,output_tokens:7}});
  assert.equal(c.inputTokens,100); assert.equal(c.uncachedInputTokens,20);
  const a=normalizeRun({...base,provider:'claude',usage:{input_tokens:20,cache_read_input_tokens:80,cache_creation_input_tokens:10}});
  assert.equal(a.inputTokens,110);assert.equal(a.uncachedInputTokens,20);
});
test('unknown values stay null, explicit zeros survive',()=>{
  assert.equal(normalizeRun(base).inputTokens,null);
  const z=normalizeRun({...base,usage:{input_tokens:0,cached_input_tokens:0,output_tokens:0},durationMs:0,corrections:0,nominalCostUsd:0});
  assert.equal(z.uncachedInputTokens,0);assert.equal(z.nominalCostUsd,0);assert.equal(z.actualBilledUsd,null);
  assert.equal(summarizeTask('t1',[]).testsPassed,null);
});
test('missing cache is unknown, never assumed free or zero',()=>{
  assert.equal(normalizeRun({...base,usage:{input_tokens:100}}).uncachedInputTokens,null);
  assert.equal(normalizeRun({...base,provider:'claude',usage:{input_tokens:20}}).inputTokens,null);
});
test('invalid counts, infinity, string costs and impossible cache rejected',()=>{
  for(const n of [-1,Infinity,NaN,1.5,'1']) assert.throws(()=>normalizeRun({...base,usage:{input_tokens:n}}));
  assert.throws(()=>normalizeRun({...base,usage:{input_tokens:1,cached_input_tokens:2}}));
  assert.throws(()=>normalizeRun({...base,nominalCostUsd:'0.1'}));
  assert.throws(()=>normalizeRun({...base,testsPassed:'yes'}));
});
test('nominal is never promoted to actual billing; receipt required',()=>{
  assert.equal(normalizeRun({...base,nominalCostUsd:1}).actualBilledUsd,null);
  assert.throws(()=>normalizeRun({...base,actualBilledUsd:0}));
  assert.equal(normalizeRun({...base,actualBilledUsd:0,billingEvidence:'invoice-reference'}).actualBilledUsd,0);
});
test('task isolation, duplicate events and unsupported provider',()=>{
  assert.throws(()=>summarizeTask('other',[base]));
  assert.throws(()=>summarizeTask('t1',[base,base]));
  assert.throws(()=>normalizeRun({...base,provider:'unknown'}));
});
test('mixed coverage cannot produce misleading partial totals; input immutable',()=>{
  const one={...base,usage:{input_tokens:100,cached_input_tokens:80,output_tokens:5},nominalCostUsd:1,testsPassed:true};
  const before=structuredClone(one);
  const result=summarizeTask('t1',[one,{...base,id:'r2',testsPassed:false}]);
  assert.equal(result.totals.nominalCostUsd,null);assert.equal(result.coverage.nominalCostUsd,1);
  assert.equal(result.testsPassed,false);assert.equal(result.financialSavings,null);assert.deepEqual(one,before);
});
