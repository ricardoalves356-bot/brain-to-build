// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {summarizeTask} from './metrics.mjs';

export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export const normalize = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const identifier = /^[a-z0-9][a-z0-9-]{0,79}$/;
const phases = ['specified', 'planned', 'implementing', 'testing', 'review', 'pr_ready', 'done'];
const secretPattern = /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})|(?:api[_-]?key|password|secret|token)\s*[:=]\s*["']?[^\s"']{8,})/i;
function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}
function assertNoLinks(absolutePath) {
  const resolved = path.resolve(absolutePath), parsed = path.parse(resolved);
  let cursor = parsed.root;
  for (const segment of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor,segment);
    try { if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Links are forbidden in configured paths'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

export function safePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) throw Error('Relative path required');
  const base = fs.realpathSync(root);
  const target = path.resolve(base, relative);
  const rel = path.relative(base, target);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw Error('Path escapes root');
  let cursor = base;
  for (const segment of rel.split(path.sep)) {
    if (!segment || segment === '.') continue;
    cursor = path.join(cursor, segment);
    try {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Links are forbidden');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return target;
}
export function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
export function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temporary, file);
}
export function loadConfig(root) {
  const configFile = safePath(root,'.local/config.json');
  const config = readJson(configFile);
  if (!Array.isArray(config.projects) || !config.projects.length) throw Error('Explicit project registry required');
  for (const p of config.projects) {
    if (!p || !identifier.test(p.id) || typeof p.name !== 'string' || !p.name.trim() || !Array.isArray(p.notes) || !p.notes.every(x => typeof x === 'string') || !Array.isArray(p.aliases) || !p.aliases.every(x => typeof x === 'string'&&x.trim())) throw Error('Invalid project registry');
    if (p.notes.some(note => !note.endsWith('.md') || path.isAbsolute(note) || note.split(/[\\/]/).some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.')))) throw Error('Project notes must be visible, relative Markdown paths');
  }
  if (new Set(config.projects.map(p => p.id)).size !== config.projects.length) throw Error('Duplicate project IDs');
  const noteOwners = new Map();
  for (const project of config.projects) for (const note of project.notes) {
    const normalized = note.replaceAll('\\','/').toLowerCase();
    if (noteOwners.has(normalized) && noteOwners.get(normalized) !== project.id) throw Error('A note cannot be allowlisted for multiple projects');
    noteOwners.set(normalized,project.id);
  }
  for (const [key, minimum, maximum] of [['maxContextChars', 500, 12000], ['maxNotes', 1, 10], ['maxAttempts', 1, 5], ['maxToolCalls', 1, 100], ['staleDays', 1, 365]]) {
    if (!Number.isInteger(config[key]) || config[key] < minimum || config[key] > maximum) throw Error(`Invalid ${key}`);
  }
  if (config.maxUsd !== 0) throw Error('Paid API use is disabled in this version');
  if (!path.isAbsolute(config.vault)) throw Error('Vault path must be absolute');
  assertNoLinks(config.vault);
  if (!fs.lstatSync(config.vault).isDirectory()) throw Error('Vault root must be a real directory');
  return config;
}
export function route(config, idea, explicit) {
  if (typeof idea !== 'string' || !idea.trim() || idea.length > 10000) throw Error('Idea must contain 1–10000 characters');
  if (explicit) {
    const selected = config.projects.find(p => p.id === explicit);
    if (!selected) throw Error('Project is not authorized');
    return selected;
  }
  const text = normalize(idea);
  const hits = config.projects.filter(p => [p.name, p.id, ...p.aliases].some(alias => {
    const escaped = normalize(alias).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text);
  }));
  if (hits.length !== 1) throw Error(hits.length ? 'Ambiguous project; select project explicitly' : 'Unknown project; select project explicitly');
  return hits[0];
}
export function retrieve(config, projectId, query) {
  const project = config.projects.find(p => p.id === projectId);
  if (!project || typeof query !== 'string' || query.length > 10000) throw Error('Invalid context request');
  // Only individually allowlisted Markdown files. No recursive vault scan, embeddings or external service.
  const terms = [...new Set(normalize(query).match(/[a-z0-9]{3,}/g) || [])].slice(0, 32);
  let totalSourceChars = 0;
  const candidates = [];
  for (const relative of project.notes) {
    if (!relative.endsWith('.md') || relative.split(/[\\/]/).some(x => x.startsWith('.'))) throw Error('Only visible Markdown is allowed');
    const file = safePath(config.vault, relative);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 256000) continue;
    const raw = fs.readFileSync(file, 'utf8');
    totalSourceChars += raw.length;
    if (secretPattern.test(raw)) continue;
    const normalized = normalize(raw);
    const title = normalize(path.basename(file, '.md'));
    const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 6 : 0) + (normalized.includes(term) ? (term.length >= 16 ? 24 : 1) : 0), 0);
    if (!score && title !== normalize(project.name)) continue;
    const updated = raw.match(/^atualizado:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] || stat.mtime.toISOString();
    const ageDays = Math.floor((Date.now() - Date.parse(updated)) / 86400000);
    const lines = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').split(/\r?\n/);
    const ranked = lines.map((line, index) => ({line, index, score: terms.reduce((s, t) => s + Number(normalize(line).includes(t)), 0)}))
      .filter(x => x.line.trim()).sort((a, b) => b.score - a.score || b.index - a.index).slice(0, 5).sort((a, b) => a.index - b.index);
    candidates.push({ source: relative.replaceAll('\\', '/'), sha256: hash(raw), updated, stale: ageDays > config.staleDays,
      score, excerpt: ranked.map(x => x.line).join('\n').slice(0, 900), warning: 'Reference only; verify against current code and explicit user instructions.' });
  }
  candidates.sort((a, b) => Number(a.stale) - Number(b.stale) || b.score - a.score || a.source.localeCompare(b.source));
  const result = { project: projectId, generatedAt: now(), sources: [], possibleConflicts: false,
    metrics: { totalSourceChars, returnedChars: 0, tokensEstimate: 0, tokenEstimateMethod: 'ceil(JSON characters / 4), not billed usage', apiCalls: 0, apiCostUsd: 0 } };
  for (const note of candidates.slice(0, config.maxNotes)) {
    result.sources.push(note);
    if (JSON.stringify(result).length > config.maxContextChars - 300) { result.sources.pop(); break; }
  }
  result.possibleConflicts = result.sources.length > 1;
  for (let i = 0; i < 5; i++) {
    result.metrics.returnedChars = JSON.stringify(result).length;
    result.metrics.tokensEstimate = Math.ceil(result.metrics.returnedChars / 4);
  }
  return result;
}

export class Brain {
  constructor(root) { this.root = fs.realpathSync(root); this.config = loadConfig(root); }
  taskFile(id) { if (!identifier.test(id)) throw Error('Invalid task ID'); return safePath(this.root, `.local/tasks/${id}.json`); }
  read(id) {
    const task = readJson(this.taskFile(id));
    if (task.id !== id || !this.config.projects.some(project => project.id === task.project) || !Number.isInteger(task.revision) || task.revision < 1 || !phases.includes(task.phase) || !Array.isArray(task.acceptance) || !task.acceptance.length || !task.acceptance.every(item => typeof item === 'string') || !Array.isArray(task.events) || !task.events.length || !Array.isArray(task.evidence) || !['local-or-pr','remote-ci'].includes(task.deliveryPolicy??'local-or-pr') || !Number.isInteger(task.toolCalls) || task.toolCalls < 0 || !Number.isInteger(task.attempts) || task.attempts < 0) throw Error('Task record is invalid or corrupted');
    return task;
  }
  locked(id, callback) {
    const lock = this.taskFile(id) + '.lock';
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const token = crypto.randomUUID();
    let fd;
    try {
      fd = fs.openSync(lock, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({pid:process.pid, token, startedAt:now()}));
    } catch (error) {
      if (error.code === 'EEXIST') {
        let owner = null;
        try { owner = readJson(lock); } catch {}
        const staleHint = owner?.pid && !processIsAlive(owner.pid) ? ' Owner process is not running; inspect and recover manually after confirming no Brain-to-Build process is active.' : ' Do not remove a possibly active lock.';
        throw Object.assign(Error(`Task is locked.${staleHint}`), {code:'ETASKLOCKED'});
      }
      throw error;
    }
    try { return callback(); } finally {
      fs.closeSync(fd);
      try { if (readJson(lock).token === token) fs.unlinkSync(lock); } catch {}
    }
  }
  create({idea, project, acceptance, actor, deliveryPolicy = 'local-or-pr', predecessor}) {
    if(!['local-or-pr','remote-ci'].includes(deliveryPolicy))throw Error('Invalid delivery policy');
    const selected = route(this.config, idea, project);
    if (!actor || typeof actor !== 'string' || actor.length > 100) throw Error('Actor required');
    if (!Array.isArray(acceptance) || !acceptance.length || acceptance.some(x => typeof x !== 'string' || x.trim().length < 8 || x.length > 1000)) throw Error('Measurable acceptance criteria required before code');
    const context = retrieve(this.config, selected.id, idea);
    const id = `task-${hash(selected.id + ':' + normalize(idea).trim()).slice(0,24)}`;
    if (fs.existsSync(this.taskFile(id))) {
      const existing = this.read(id);
      if (JSON.stringify(existing.acceptance) !== JSON.stringify(acceptance)||(existing.deliveryPolicy??'local-or-pr')!==deliveryPolicy) throw Error('Existing idea has different criteria; create explicit successor task');
      return existing;
    }
    const previous=predecessor?this.read(predecessor):null;
    if(previous && (previous.project!==selected.id||previous.phase==='done'))throw Error('Invalid predecessor');
    const task = { schemaVersion: 1, id, project: selected.id, idea, specVersion: 1, revision: 1, phase: 'specified',deliveryPolicy,predecessor:predecessor??null,
      acceptance, owner: null, leaseUntil: null, attempts: 0, toolCalls: 0, blocked: null,
      nextAction: 'Claim task and write implementation plan', sensitive: false, review: null,
      plan: [], evidence: [], pr: null, context, createdAt: now(), updatedAt: now(),
      events: [{at: now(), actor, action: 'created', revision: 1}], cost: {apiCalls: 0, apiCostUsd: 0, subscriptionUsage: 'not measurable by local CLI'} };
    if(previous){task.attempts=previous.attempts;task.toolCalls=previous.toolCalls;task.inheritedBudget={task:previous.id,attempts:previous.attempts,toolCalls:previous.toolCalls};}
    fs.mkdirSync(path.dirname(this.taskFile(id)), { recursive: true });
    fs.writeFileSync(this.taskFile(id), JSON.stringify(task, null, 2) + '\n', { flag: 'wx' });
    return task;
  }
  mutate(id, {actor, revision}, action, callback) {
    if (typeof actor !== 'string' || !actor || actor.length > 100) throw Error('Actor required');
    return this.locked(id, () => {
      const task = this.read(id);
      if (revision !== task.revision) throw Error('Stale revision; reread task');
      if (action !== 'claim' && (task.owner !== actor || Date.parse(task.leaseUntil) <= Date.now())) throw Error('Active ownership required');
      if (task.toolCalls >= this.config.maxToolCalls && action !== 'release') throw Error('Tool-call budget reached; handoff required');
      callback(task);
      task.revision++; task.toolCalls++; task.updatedAt = now();
      task.events.push({at: now(), actor, action, revision: task.revision});
      atomicJson(this.taskFile(id), task);
      return task;
    });
  }
  claim(id, opts) { return this.mutate(id, opts, 'claim', t => {
    if (t.owner && t.owner !== opts.actor && Date.parse(t.leaseUntil) > Date.now()) throw Error('Task is owned by another agent');
    t.owner = opts.actor; t.leaseUntil = new Date(Date.now() + 30 * 60000).toISOString();
  }); }
  release(id, opts) { return this.mutate(id, opts, 'release', t => { t.owner = null; t.leaseUntil = null; }); }
  plan(id, opts) { return this.mutate(id, opts, 'plan', t => {
    if (t.phase !== 'specified' || !Array.isArray(opts.steps) || !opts.steps.length || opts.steps.some(x => typeof x !== 'string' || !x.trim())) throw Error('Plan required in specified phase');
    t.plan = opts.steps; t.phase = 'planned'; t.nextAction = 'Implement on isolated branch';
  }); }
  advance(id, opts) { return this.mutate(id, opts, 'advance', t => {
    if (phases.indexOf(opts.phase) !== phases.indexOf(t.phase) + 1 || opts.phase === 'planned') throw Error('Illegal phase transition');
    if (t.blocked) throw Error('Task is blocked; create an explicit handoff');
    if (opts.phase === 'review' && (!t.evidence.length || !t.evidence.at(-1).passed)) throw Error('Passing test evidence required');
    if (['review','pr_ready','done'].includes(opts.phase)) for (const e of t.evidence) {
      if (hash(fs.readFileSync(safePath(this.root,e.path))) !== e.sha256) throw Error('Evidence changed after recording');
    }
    if (opts.phase === 'pr_ready' && (!t.review || t.review.revision !== t.specVersion)) throw Error('Review required');
    if (t.review?.evidence && hash(fs.readFileSync(safePath(this.root,t.review.evidence.path))) !== t.review.evidence.sha256) throw Error('Review evidence changed');
    for(const f of t.review?.files||[])if(hash(fs.readFileSync(safePath(this.root,f.path)))!==f.sha256)throw Error('Reviewed code changed; successor review required');
    if (opts.phase === 'done' && !t.pr) throw Error('Verifiable PR or local equivalent required');
    if (opts.phase === 'done') for (const proof of [t.pr?.verification,t.ci?.evidence,t.metricsEvidence].filter(Boolean)) {
      if(hash(fs.readFileSync(safePath(this.root,proof.path)))!==proof.sha256)throw Error('Integration evidence changed');
    }
    if(opts.phase==='done' && t.ci && t.ci.head!==t.pr?.head)throw Error('CI head differs from PR');
    if(opts.phase==='done' && t.deliveryPolicy==='remote-ci' && (!t.pr?.hostProofValidated||!t.ci||t.pr.reviewedCommit!==t.review?.commit))throw Error('Host-validated PR proof, hosted CI assertion, and commit-bound review required');
    t.phase = opts.phase; t.nextAction = ({implementing:'Implement criteria',testing:'Run checks',review:'Review code and security',pr_ready:'Prepare PR without merging',done:'Memory handoff via existing capture hook'})[opts.phase];
  }); }
  recordCheck(id, opts) { return this.mutate(id, opts, 'check', t => {
    if (t.phase !== 'testing') throw Error('Checks require testing phase');
    if (typeof opts.passed !== 'boolean') throw Error('Boolean test result required');
    const file = safePath(this.root, opts.evidence);
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1000000) throw Error('Invalid evidence file');
    const content = fs.readFileSync(file);
    if (secretPattern.test(content.toString())) throw Error('Secret-like evidence rejected');
    t.evidence.push({path: opts.evidence, sha256: hash(content), passed: opts.passed, at: now(), actor: opts.actor});
    if (!opts.passed) {
      t.attempts++;
      const previous=t.evidence.at(-2);
      if(previous?.passed===false && previous.sha256===hash(content))t.blocked='Repeated identical failure; no progress';
      if(t.attempts>=this.config.maxAttempts)t.blocked='Retry budget exhausted';
      if(t.blocked)t.nextAction='Handoff with failed evidence; no automatic retry';
    }
  }); }
  recordReview(id, opts) { return this.mutate(id, opts, 'review', t => {
    if (t.phase !== 'review' || typeof opts.summary !== 'string' || opts.summary.trim().length < 12) throw Error('Review summary required');
    if (t.sensitive) throw Error('Sensitive changes require explicit human review outside this local workflow');
    const implementer = t.events.find(e => e.action === 'advance')?.actor || t.events[0].actor;
    const independent = opts.actor !== implementer;
    let evidence = null;
    if (independent) {
      if (!opts.evidence) throw Error('Cross-agent review requires persisted evidence');
      const content = fs.readFileSync(safePath(this.root, opts.evidence));
      if (content.length > 1000000 || secretPattern.test(content.toString())) throw Error('Invalid review evidence');
      evidence = {path:opts.evidence,sha256:hash(content)};
    }
    let files=[];
    if(t.deliveryPolicy==='remote-ci'){
      if(!independent||!/^([a-f0-9]{40})$/.test(opts.commit)||!Array.isArray(opts.files)||!opts.files.length)throw Error('Independent commit-bound file review required');
      files=opts.files.map(file=>({path:file,sha256:hash(fs.readFileSync(safePath(this.root,file)))}));
    }
    t.review = {actor: opts.actor, summary: opts.summary, revision: t.specVersion, at: now(),
      differentActorLabel: independent, reviewerIdentityVerified: false, evidence,
      commit:opts.commit??null,files};
  }); }
  recordPr(id, opts) { return this.mutate(id, opts, 'pr', t => {
    if (t.phase !== 'pr_ready') throw Error('PR requires pr_ready phase');
    if (opts.url && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(opts.url)) {
      t.pr = {kind:'github', url: opts.url, hostProofValidated:false, providerAuthenticated:false};
      if(opts.verification){
        const file=safePath(this.root,opts.verification);const proof=readJson(file);
        // readStatus proves the host API read succeeded; CI has its own recordCi gate.
        if(proof.url!==opts.url||proof.state!=='open'||proof.merged!==false||typeof proof.private!=='boolean'||!/^([a-f0-9]{40})$/.test(proof.head)||(t.deliveryPolicy==='remote-ci'?proof.readStatus:proof.status)!=='success')throw Error('Remote PR proof does not match an open validated PR');
        if(t.deliveryPolicy==='remote-ci' && (proof.reviewedCommit!==t.review?.commit||proof.head!==t.review?.commit))throw Error('PR head must equal reviewed commit');
        for(const f of t.review?.files||[])if(hash(fs.readFileSync(safePath(this.root,f.path)))!==f.sha256)throw Error('Reviewed code changed');
        t.pr={...t.pr,hostProofValidated:true,providerAuthenticated:false,head:proof.head,reviewedCommit:proof.reviewedCommit??null,private:proof.private,verification:{path:opts.verification,sha256:hash(fs.readFileSync(file))}};
      }
    }
    else if (opts.patch) {
      const file = safePath(this.root, opts.patch);
      const body = fs.readFileSync(file, 'utf8');
      if (!body.includes('diff --git ') || secretPattern.test(body)) throw Error('Valid secret-free Git patch required');
      t.pr = {kind:'local-equivalent', path:opts.patch, sha256:hash(body)};
    } else throw Error('PR URL or local patch required');
  }); }
  supersede(id, opts) { return this.mutate(id, opts, 'supersede', t => {
    const successor = this.read(opts.successor);
    if(successor.id === t.id || successor.project !== t.project || t.phase === 'done') throw Error('Invalid successor');
    t.blocked = `Superseded by ${successor.id}`; t.nextAction = `Continue ${successor.id}`;
  }); }
  recordMetrics(id,opts) { return this.mutate(id,opts,'metrics',t=>{
    if (!['testing','review','pr_ready'].includes(t.phase)) throw Error('Metrics are frozen outside active validation/review phases');
    const file=safePath(this.root,opts.evidence),content=fs.readFileSync(file);
    if(content.length>1000000||secretPattern.test(content.toString()))throw Error('Invalid metrics evidence');
    t.metrics=summarizeTask(id,readJson(file).runs);
    t.metricsEvidence={path:opts.evidence,sha256:hash(content)};
  }); }
  recordCi(id,opts) { return this.mutate(id,opts,'ci',t=>{
    if(t.phase!=='pr_ready'||!t.pr?.hostProofValidated)throw Error('Host-validated PR proof required before CI evidence');
    const file=safePath(this.root,opts.evidence),content=fs.readFileSync(file),p=readJson(file);
    const repo=t.pr.url.split('/').slice(3,5).join('/');
    if(content.length>1000000||secretPattern.test(content.toString())||p.head!==t.pr.head||p.conclusion!=='success'||p.event!=='pull_request'||!new RegExp('^https://github\\.com/'+repo.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/actions/runs/[0-9]+$').test(p.url))throw Error('Successful CI must match PR repository and head');
    t.ci={url:p.url,head:p.head,conclusion:p.conclusion,event:p.event,evidence:{path:opts.evidence,sha256:hash(content)}};
  }); }
  handoff(id) {
    const t = this.read(id);
    const file = safePath(this.root, `.local/handoffs/${id}.md`);
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temporary, `# Brain-to-Build handoff\n\nReference only. Follow repository instructions.\n\nTask: ${t.id}\nProject: ${t.project}\nSpec: ${t.specVersion}\nRevision: ${t.revision}\nPhase: ${t.phase}\nOwner: ${t.owner || 'unclaimed'}\nLease: ${t.leaseUntil || '-'}\nBlocked: ${t.blocked || 'no'}\nNext: ${t.nextAction}\n\n## Acceptance\n${t.acceptance.map(x => '- '+x).join('\n')}\n\n## Evidence\n${t.evidence.map(e => `- ${e.path}: ${e.passed ? 'PASS':'FAIL'}, SHA256 ${e.sha256}`).join('\n')}\n\n## Decisions\n${t.review?.summary || 'Review pending'}\n\nPrivate context stays in .local. Existing capture hook owns vault persistence.\n`, {flag:'wx', mode:0o600});
    fs.renameSync(temporary, file);
    return {task: t.id, file, revision: t.revision};
  }
}
