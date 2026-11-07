// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Ricardo Alves
// Synthetic backlog ranking. Returned score replaces any input score; input is never mutated.
export function prioritize(tasks) {
  if (!Array.isArray(tasks)) throw new TypeError('tasks must be an array');
  const ids = new Set();
  const ranked = tasks.map(task => {
    if (!task || typeof task.id !== 'string' || !task.id.trim() || ids.has(task.id)) throw new TypeError('unique nonempty id required');
    ids.add(task.id);
    if (!Number.isInteger(task.impact) || task.impact < 1 || task.impact > 5 || !Number.isFinite(task.effort) || task.effort <= 0) throw new TypeError('impact 1–5 and positive finite effort required');
    const score = task.impact / task.effort;
    if (!Number.isFinite(score)) throw new TypeError('score must be finite');
    return {...task, score};
  });
  return ranked.sort((a,b) => (a.score === b.score ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.score > b.score ? -1 : 1));
}
