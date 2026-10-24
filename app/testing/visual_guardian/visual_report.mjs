// visual_report.mjs
// Merges run-scoped worker shards into deterministic, report-only artifacts.
// Connects screenshot observations, reviewed allowances and the CLI summary.
// Serializes writers with a bounded directory lock and atomic file replacement.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const checks = ['image-box', 'image-load', 'image-distortion', 'text-clip', 'page-x-scroll',
  'touch-size', 'overlap', 'offscreen', 'notice-cover', 'console', 'request', 'contrast'];
const requiredAllowance = ['id', 'check', 'selector', 'shot', 'viewport', 'theme', 'language',
  'reason', 'owner', 'expires', 'maxMatches', 'eventFingerprint'];

/** Strip origins, query values and fragments; inline media never becomes report content. */
export function sanitisePath(value) {
  if (!value || /^(data|blob|javascript):/i.test(value)) return '[inline]';
  try { return new URL(value, 'https://visual.invalid').pathname; } catch { return '[invalid-url]'; }
}

/** Apply the path privacy rule to URL tokens of every form before truncation. */
export function sanitiseDetail(value) {
  const cleanToken = token => {
    const punctuation = token.match(/[.,;!]+$/)?.[0] || '';
    const clean = sanitisePath(token.slice(0, token.length - punctuation.length));
    return clean === '[inline]' ? clean : clean + punctuation;
  };
  // Labels are prose, not schemes. Apply the existing relative-token rule only
  // between explicit URLs, splitting labels and wrappers without consuming them.
  const cleanRelative = text => text.replace(/[^\s()[\]{}"'<>]+/g, token => {
    const pathStart = token.search(/[/\\?#]/);
    if (pathStart < 0) return token;
    const labelEnd = token.lastIndexOf(':', pathStart) + 1;
    return token.slice(0, labelEnd) + cleanToken(token.slice(labelEnd));
  });
  // Retain the earlier executable-inline redaction separately from URL detection.
  const text = String(value).replace(/\bjavascript:[^\s)\]}"'<>]*/gi, '[inline]');
  // Only known :// schemes, // authorities and data/blob start URLs anywhere.
  // A paired IPv6 authority bracket belongs to the address, not its outer wrapper.
  const networkStart = /(?:(?:https?|wss?|ftp|file):)?\/\//.source;
  const inlineStart = /(?:data|blob):/.source;
  const body = /[^\s)\]}"'<>]/.source;
  const ipv6Authority = /(?:[^\s/()[\]{}"'<>]*\[[\da-z:.%_-]+\])?/.source;
  // A second URL start must never survive as pathname text inside the first.
  const urls = new RegExp(`${inlineStart}${body}*|${networkStart}${ipv6Authority}(?:(?!${networkStart}|${inlineStart})${body})*`, 'gi');
  let clean = '', end = 0;
  for (const match of text.matchAll(urls)) {
    clean += cleanRelative(text.slice(end, match.index)) + cleanToken(match[0]);
    end = match.index + match[0].length;
  }
  return (clean + cleanRelative(text.slice(end))).slice(0, 200);
}

/** Stable content identity; raw messages and image bytes never enter identifiers. */
export function fingerprint(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 20);
}

/** Replace one artifact atomically, including when several workers finish together. */
export async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, value); await fs.rename(temporary, file); }
  finally { await fs.rm(temporary, { force: true }); }
}

/** A small bounded lock owns both the manifest and the two report writes. Never steal a live lock. */
export async function withReportLock(reportDir, callback, timeoutMs = 3000) {
  await fs.mkdir(reportDir, { recursive: true });
  const lock = path.join(reportDir, '.visual-observations-lock');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error('Visual report lock timed out');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  try { return await callback(); } finally { await fs.rmdir(lock); }
}

function validAllowance(entry) {
  return entry && requiredAllowance.every(key => Object.hasOwn(entry, key))
    && Object.keys(entry).every(key => requiredAllowance.includes(key))
    && ['id', 'selector', 'shot', 'language', 'owner'].every(key => typeof entry[key] === 'string' && entry[key].trim())
    && entry.id !== 'any' && entry.selector !== 'any' && checks.includes(entry.check)
    && typeof entry.reason === 'string' && entry.reason.trim()
    && ['light', 'dark', 'unknown', 'any'].includes(entry.theme)
    && (entry.viewport === 'any' || entry.viewport && Object.keys(entry.viewport).sort().join() === 'height,width'
      && ['width', 'height'].every(key => Number.isFinite(entry.viewport[key]) && entry.viewport[key] > 0))
    && /^\d{4}-\d{2}-\d{2}$/.test(entry.expires) && Number.isFinite(Date.parse(`${entry.expires}T23:59:59.999Z`))
    && new Date(`${entry.expires}T23:59:59.999Z`).toISOString().slice(0, 10) === entry.expires
    && Number.isInteger(entry.maxMatches) && entry.maxMatches > 0
    && (entry.eventFingerprint === null || typeof entry.eventFingerprint === 'string'
      && entry.eventFingerprint.length > 0 && entry.eventFingerprint !== 'any')
    && (['console', 'request'].includes(entry.check)
      ? entry.selector === ':root' && entry.eventFingerprint !== null : entry.eventFingerprint === null);
}

function inContext(entry, shot) {
  return (entry.shot === 'any' || entry.shot === shot.id || entry.shot === path.posix.basename(shot.file, path.posix.extname(shot.file)))
    && (entry.viewport === 'any' || entry.viewport.width === shot.viewport.width && entry.viewport.height === shot.viewport.height)
    && (entry.theme === 'any' || entry.theme === shot.theme)
    && (entry.language === 'any' || entry.language === shot.language);
}

/** Apply bounded, reasoned allowances to raw findings, retaining suppressed rows in JSON. */
export function applyAllowlist(report, entries = [], selectorsByShot = {}, now = new Date()) {
  const findings = report.findings.map(finding => ({ ...finding, suppressedBy: null }));
  const states = [];
  const errors = [];
  const ids = entries.map(entry => entry?.id);
  for (const entry of entries) {
    if (!validAllowance(entry) || ids.filter(id => id === entry.id).length > 1) {
      errors.push('Invalid visual allowlist entry (required fields, reason, context or duplicate id)');
      continue;
    }
    const contexts = report.shots.filter(shot => inContext(entry, shot));
    const shotIds = contexts.map(shot => shot.id);
    const matches = findings.filter(finding => shotIds.includes(finding.shotId)
      && finding.check === entry.check && finding.selector === entry.selector
      && (entry.eventFingerprint === null || finding.eventIds.some(id => report.events.some(event =>
        event.id === id && event.fingerprint === entry.eventFingerprint))));
    let state = 'untested';
    if (Date.parse(`${entry.expires}T23:59:59.999Z`) < now.getTime()) state = 'expired';
    else if (matches.length > entry.maxMatches) errors.push(`Visual allowance ${entry.id} exceeds maxMatches`);
    else if (matches.length) {
      state = 'matched';
      for (const finding of matches) finding.suppressedBy ||= entry.id;
    } else if (contexts.length && contexts.every(shot => Array.isArray(selectorsByShot[shot.id]))
      && contexts.every(shot => !selectorsByShot[shot.id].includes(entry.selector))) state = 'missing-selector';
    states.push({ id: entry.id, reason: entry.reason, state, matchCount: matches.length, shotIds });
  }
  return { findings, states, errors };
}

/** Required report fields, including an explicitly incomplete empty run. */
export function emptyReport(runId, startedAt = new Date().toISOString()) {
  return { schemaVersion: 1, runId, startedAt, revision: null, dirty: null, status: 'partial',
    shots: [], findings: [], events: [], allowlist: [], errors: [] };
}

/** Merge all workers and retries of one run; selectors are shard-only evidence, never a DOM dump. */
export function mergeShards(shards, { runId, startedAt, errors = [], now } = {}) {
  const report = emptyReport(runId, startedAt);
  const selected = shards.filter(shard => shard.report.runId === runId)
    .sort((left, right) => left.report.startedAt.localeCompare(right.report.startedAt));
  const selectors = {}, allowances = new Map();
  for (const shard of selected) {
    const source = shard.report;
    report.startedAt = source.startedAt < report.startedAt ? source.startedAt : report.startedAt;
    report.revision ??= source.revision;
    report.dirty ??= source.dirty;
    report.shots.push(...source.shots);
    report.findings.push(...source.findings);
    report.events.push(...source.events);
    report.errors.push(...source.errors);
    if (source.status === 'partial' && !source.errors.length && !source.shots.some(shot => shot.status === 'partial')) {
      report.errors.push('Incomplete worker observations');
    }
    Object.assign(selectors, shard.selectorsByShot);
    for (const entry of shard.allowlistEntries || []) {
      const key = entry?.id || JSON.stringify(entry);
      if (allowances.has(key) && JSON.stringify(allowances.get(key)) !== JSON.stringify(entry)) {
        report.errors.push('Conflicting visual allowance across shards');
        allowances.set(key, { id: key });
      } else allowances.set(key, entry);
    }
  }
  report.shots.sort((a, b) => a.id.localeCompare(b.id));
  report.findings.sort((a, b) => `${a.shotId}/${a.check}/${a.selector}/${a.id}`.localeCompare(`${b.shotId}/${b.check}/${b.selector}/${b.id}`));
  report.events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const allowed = applyAllowlist(report, [...allowances.values()], selectors, now);
  report.findings = allowed.findings;
  report.allowlist = allowed.states;
  report.errors = [...new Set([...report.errors, ...errors, ...allowed.errors])];
  report.status = report.shots.length && !report.errors.length && report.shots.every(shot => shot.status === 'complete') ? 'complete' : 'partial';
  return report;
}

/** Count only unsuppressed findings for the human and machine summaries. */
export function findingCounts(report) {
  const result = { high: 0, medium: 0, low: 0 };
  for (const finding of report.findings) if (!finding.suppressedBy) result[finding.severity]++;
  return result;
}

const markdown = value => String(value ?? '—').replace(/[|\n\r]/g, ' ').replace(/</g, '&lt;');

/** Render coverage first, then severity/shot/check/selector, suppressions and unknowns. */
export function renderMarkdown(report) {
  const counts = findingCounts(report);
  const lines = [`# Visual observations`, '', `Coverage: **${report.status}**${report.status === 'partial' ? ' — incomplete' : ''}.`,
    `Unsuppressed: high=${counts.high}, medium=${counts.medium}, low=${counts.low}.`, ''];
  const sorted = report.findings.filter(finding => !finding.suppressedBy).sort((a, b) =>
    ['high', 'medium', 'low'].indexOf(a.severity) - ['high', 'medium', 'low'].indexOf(b.severity)
    || `${a.shotId}/${a.check}/${a.selector}`.localeCompare(`${b.shotId}/${b.check}/${b.selector}`));
  lines.push('## Findings', '', '| Severity | Shot | Check / rule | Selector | Measured | Expected | Intent / related |',
    '| --- | --- | --- | --- | --- | --- | --- |');
  for (const finding of sorted) {
    const shot = report.shots.find(shot => shot.id === finding.shotId);
    const link = shot ? `[${markdown(shot.id)}](<${encodeURI(shot.file).replace(/[<>]/g, '')}>)` : markdown(finding.shotId);
    lines.push(`| ${finding.severity} | ${link} | ${finding.check} / ${markdown(finding.rule)} | ${markdown(finding.selector)} | ${markdown(JSON.stringify(finding.measured))} | ${markdown(JSON.stringify(finding.expected))} | ${markdown(finding.intentSource)} / ${markdown(finding.relatedSelector)} |`);
  }
  if (!sorted.length) lines.push('', report.status === 'partial' ? 'No findings; observations are incomplete.' : 'No findings.');
  lines.push('', '## Suppressions', '');
  for (const finding of report.findings.filter(finding => finding.suppressedBy)) {
    lines.push(`- ${markdown(finding.id)}: suppressed by ${markdown(finding.suppressedBy)}`);
  }
  for (const state of report.allowlist) lines.push(`- ${markdown(state.id)}: ${state.state} (${state.matchCount}); ${markdown(state.reason)}`);
  lines.push('', '## Unknowns and errors', '');
  for (const shot of report.shots) for (const coverage of shot.coverage.filter(item => item.status !== 'complete')) {
    lines.push(`- ${markdown(shot.id)} / ${coverage.check}: ${coverage.status}; ${markdown(coverage.reason)}`);
  }
  for (const error of report.errors) lines.push(`- ${markdown(error)}`);
  return lines.join('\n') + '\n';
}

/** The single stable log line consumed by future runner integration. */
export function summaryLine(report, reportDir) {
  const { high, medium, low } = findingCounts(report);
  return `VISUAL_OBSERVATIONS run=${report.runId} high=${high} medium=${medium} low=${low} coverage=${report.status} report=${path.join(reportDir, 'visual-observations.md').split(path.sep).join('/')}`;
}

async function readRun(reportDir, runId) {
  const manifestPath = path.join(reportDir, 'run.json');
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { /* A new run directory. */ }
  if (!manifest || !/^[a-zA-Z0-9_-]+$/.test(manifest.runId || '') || !Number.isFinite(Date.parse(manifest.startedAt))
    || runId && manifest.runId !== runId) {
    manifest = { runId: runId || randomUUID(), startedAt: new Date().toISOString() };
    await atomicWrite(manifestPath, JSON.stringify(manifest));
  }
  return manifest;
}

async function mergeUnlocked(reportDir, manifest) {
  const shards = [], errors = [];
  let files = [];
  try { files = await fs.readdir(path.join(reportDir, 'shards')); } catch (error) {
    if (error.code !== 'ENOENT') errors.push('Cannot read visual shards');
  }
  for (const file of files.filter(file => file.startsWith(manifest.runId + '-') && file.endsWith('.json')).sort()) {
    try { shards.push(JSON.parse(await fs.readFile(path.join(reportDir, 'shards', file), 'utf8'))); }
    catch { errors.push('Cannot parse a visual shard'); }
  }
  const report = mergeShards(shards, { ...manifest, errors });
  await atomicWrite(path.join(reportDir, 'visual-observations.json'), JSON.stringify(report, null, 2) + '\n');
  await atomicWrite(path.join(reportDir, 'visual-observations.md'), renderMarkdown(report));
  return report;
}

/** Persist one raw shard and merge only its run under the same writer lock. */
export async function writeShardAndMerge(reportDir, shard, shardName) {
  return withReportLock(reportDir, async () => {
    const manifest = await readRun(reportDir, shard.report.runId || undefined);
    shard.report.runId = manifest.runId;
    await atomicWrite(path.join(reportDir, 'shards', `${manifest.runId}-${shardName}.json`), JSON.stringify(shard, null, 2));
    return mergeUnlocked(reportDir, manifest);
  });
}

/** Merge the current run, including an empty run; observer failures remain a partial report. */
export async function mergeReportDirectory(reportDir) {
  return withReportLock(reportDir, async () => mergeUnlocked(reportDir, await readRun(reportDir)));
}

/** CLI errors in observation/reporting return success; only a malformed command returns 2. */
export async function runCli(args, print = console.log) {
  if (args.length !== 2 || args[0] !== 'merge' || !args[1]) return 2;
  let report;
  try { report = await mergeReportDirectory(args[1]); }
  catch { report = emptyReport('unknown'); report.errors.push('Visual report merge failed'); }
  print(summaryLine(report, args[1]));
  return 0;
}

if (path.basename(process.argv[1] || '') === 'visual_report.mjs') {
  void runCli(process.argv.slice(2)).then(code => { process.exitCode = code; });
}
