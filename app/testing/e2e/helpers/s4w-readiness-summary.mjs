// s4w-readiness-summary.mjs
// Summarizes one or more WO69 S4w reporting-mode JSONL files.
// Connects per-call, value-free helper observations with nightly review numbers.
// Quantiles use nearest rank over successful observations; nulls count as misses.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Group independent input files together without mixing helper/condition pairs. */
export function summarizeReadiness(records) {
  const groups = new Map();
  for (const record of records) {
    const { helper, conditionId, trueAtStart, msToTrue, fixedWaitMs } = record;
    if (typeof helper !== 'string' || typeof conditionId !== 'string'
        || typeof trueAtStart !== 'boolean' || !Number.isFinite(fixedWaitMs) || fixedWaitMs <= 0
        || !(msToTrue === null || (Number.isFinite(msToTrue) && msToTrue >= 0 && msToTrue <= fixedWaitMs))
        || (trueAtStart && msToTrue !== 0)) throw new Error('Invalid readiness record');
    const key = JSON.stringify([helper, conditionId]);
    if (!groups.has(key)) groups.set(key, { helper, conditionId, calls: 0, starts: 0, misses: 0, times: [] });
    const group = groups.get(key);
    group.calls += 1;
    group.starts += Number(trueAtStart);
    group.misses += Number(msToTrue === null);
    if (msToTrue !== null) group.times.push(msToTrue);
  }
  return [...groups.values()].sort((a, b) =>
    a.helper.localeCompare(b.helper) || a.conditionId.localeCompare(b.conditionId)).map(group => {
    group.times.sort((a, b) => a - b);
    const quantile = fraction => group.times[Math.ceil(group.times.length * fraction) - 1] ?? null;
    return {
      helper: group.helper, conditionId: group.conditionId, calls: group.calls,
      trueAtStartPct: 100 * group.starts / group.calls,
      p50MsToTrue: quantile(0.5), p90MsToTrue: quantile(0.9), maxMsToTrue: quantile(1),
      neverTruePct: 100 * group.misses / group.calls,
    };
  });
}

/** Read only the named files; malformed input fails without echoing its contents. */
export function readReadinessFiles(files) {
  return files.flatMap(file => readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => {
    try { return JSON.parse(line); }
    catch { throw new Error('Invalid readiness JSONL'); }
  }));
}

/** Stable TSV for both a terminal and saved nightly artifacts. */
export function formatReadinessSummary(groups) {
  const lines = ['helper\tconditionId\tcalls\ttrueAtStart%\tp50MsToTrue\tp90MsToTrue\tmaxMsToTrue\tneverTrue%'];
  for (const group of groups) lines.push([
    group.helper, group.conditionId, group.calls, group.trueAtStartPct.toFixed(2),
    group.p50MsToTrue ?? '-', group.p90MsToTrue ?? '-', group.maxMsToTrue ?? '-', group.neverTruePct.toFixed(2),
  ].join('\t'));
  return `${lines.join('\n')}\n`;
}

/** Return the CLI status; keep failures content-free even for malformed input. */
export function runReadinessSummary(files, output = process) {
  try {
    if (!files.length) throw new Error('No input files');
    output.stdout.write(formatReadinessSummary(summarizeReadiness(readReadinessFiles(files))));
    return 0;
  } catch {
    output.stderr.write('Readiness summary failed: supply readable files containing valid readiness JSONL.\n');
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runReadinessSummary(process.argv.slice(2));
}
