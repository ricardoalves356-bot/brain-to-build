// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
// Provider usage is evidence, not proof of an invoice. Missing values stay unknown.
const number = (v, name, integer = false) => {
  if (v == null) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || (integer && !Number.isSafeInteger(v))) throw new TypeError(`Invalid ${name}`);
  return v;
};
const sum = values => values.length && values.every(v => v !== null) ? values.reduce((a,b) => a+b, 0) : null;
export function normalizeRun(run) {
  if (!run || !['codex','claude'].includes(run.provider) || ![run.id,run.task].every(v => typeof v === 'string' && v.trim())) throw new TypeError('Run id, task and supported provider required');
  const u = run.usage ?? {};
  const input = number(u.input_tokens,'input',true);
  const cacheRead = number(run.provider === 'codex' ? u.cached_input_tokens : u.cache_read_input_tokens,'cache read',true);
  const cacheWrite = run.provider === 'codex' ? null : number(u.cache_creation_input_tokens,'cache write',true);
  if (run.provider === 'codex' && input !== null && cacheRead !== null && cacheRead > input) throw new TypeError('Cache exceeds total input');
  const totalInput = run.provider === 'codex' ? input : sum([input,cacheRead,cacheWrite]);
  const uncached = run.provider === 'codex' ? (input !== null && cacheRead !== null ? input-cacheRead : null) : input;
  const billed = number(run.actualBilledUsd,'actual billing');
  if (billed !== null && (typeof run.billingEvidence !== 'string' || !run.billingEvidence.trim())) throw new TypeError('Billing evidence required');
  if (run.model != null && (typeof run.model !== 'string' || !run.model.trim())) throw new TypeError('Invalid model');
  if (run.testsPassed != null && typeof run.testsPassed !== 'boolean') throw new TypeError('Invalid test result');
  return {id:run.id,task:run.task,provider:run.provider,model:run.model ?? null,
    inputTokens:totalInput,uncachedInputTokens:uncached,cacheReadTokens:cacheRead,cacheWriteTokens:cacheWrite,
    outputTokens:number(u.output_tokens,'output',true),nominalCostUsd:number(run.nominalCostUsd,'nominal cost'),
    actualBilledUsd:billed,billingEvidence:billed === null ? null : run.billingEvidence,
    durationMs:number(run.durationMs,'duration'),corrections:number(run.corrections,'corrections',true),testsPassed:run.testsPassed ?? null};
}
export function summarizeTask(task, runs) {
  if (typeof task !== 'string' || !task.trim() || !Array.isArray(runs)) throw new TypeError('Task and runs required');
  const normalized = runs.map(normalizeRun), ids = new Set();
  for (const r of normalized) {
    if (r.task !== task) throw new TypeError('Cross-task metrics rejected');
    if (ids.has(r.id)) throw new TypeError('Duplicate run rejected');
    ids.add(r.id);
  }
  const fields=['inputTokens','uncachedInputTokens','cacheReadTokens','cacheWriteTokens','outputTokens','nominalCostUsd','actualBilledUsd','durationMs','corrections'];
  return {task,runs:normalized,models:[...new Set(normalized.map(r=>r.model).filter(Boolean))],
    totals:Object.fromEntries(fields.map(f=>[f,sum(normalized.map(r=>r[f]))])),
    coverage:Object.fromEntries(fields.map(f=>[f,normalized.filter(r=>r[f]!==null).length])),
    testsPassed:normalized.length && normalized.every(r=>r.testsPassed !== null) ? normalized.every(r=>r.testsPassed) : null,
    financialSavings:null,billingNote:'Nominal API-equivalent cost is not an actual subscription charge. No controlled savings comparison.'};
}
