// @vitest-environment node
// visual_report.test.mjs
// Proves merging, allowances, privacy and report-only screenshot semantics.
// Connects isolated worker shards with the public JSON/Markdown/CLI contracts.
// Removes every temporary artifact even after a failed assertion.
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { applyAllowlist, emptyReport, mergeShards, renderMarkdown, runCli, sanitiseDetail,
  sanitisePath, summaryLine, writeShardAndMerge, mergeReportDirectory, withReportLock } from './visual_report.mjs';
import { startVisualObservations } from './visual_observer';

const roots = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function directory() { const root = await fs.mkdtemp(path.join(tmpdir(), 'vg-unit-')); roots.push(root); return root; }
const at = '2026-10-22T12:00:00.000Z';
const messageUrls = [
  ['//demo:example@host/x?private=value', '/x'],
  ['https://demo:example@host/x?private=value#fragment', '/x'],
  ['http://demo:example@host/x#fragment', '/x'],
  ['//demo:example@host/x#fragment', '/x'],
  ['ftp://demo:example@host/x?private=value#fragment', '/x'],
  ['file:///x?private=value#fragment', '/x'],
  ['//demo:example@[::1]/x?private=value#fragment', '/x'],
  [String.raw`\\demo:example@host\x?private=value#fragment`, '/x'],
  ['data:image/png;base64,private-value#fragment', '[inline]'],
  ['blob:https://host/private-value?private=value#fragment', '[inline]'],
  ['javascript:private-value', '[inline]'],
  ['/x?private=value#fragment', '/x'],
  ['/x#fragment', '/x'],
  ['x?private=value#fragment', '/x'],
  ['assets/x?private=value#fragment', '/assets/x'],
  ['assets/x:y?private=value#fragment', '/assets/x:y'],
  ['väri/x?private=value#fragment', '/v%C3%A4ri/x'],
  ['./x?private=value#fragment', '/x'],
  ['../x#fragment', '/x'],
  ['?private=value#fragment', '/'],
  ['#fragment', '/'],
];
// One matrix exercises direct sanitisation and every collector message source.
const privateUrl = 'https://demo:example@host/x?private=value#fragment';
const messageDetails = [
  ...messageUrls.map(([url, clean]) => [`failed ${url}`, `failed ${clean}`]),
  ['failed Error:[https://demo:example@host/x?private=value]', 'failed Error:[/x]'],
  ['failed Error:[data:image/png;base64,private-value]', 'failed Error:[[inline]]'],
  ...[['[', ']'], ['(', ')'], ['{', '}'], ['"', '"'], ["'", "'"], ['<', '>']]
    .flatMap(([open, close]) => [
      [privateUrl, '/x'], ['//demo:example@host/x?private=value#fragment', '/x'],
      ['/x?private=value#fragment', '/x'], ['data:image/png;base64,private-value', '[inline]'],
      ['blob:https://host/private-value?private=value#fragment', '[inline]'],
    ].map(([url, clean]) => [`failed ${open}${url}${close} retry`, `failed ${open}${clean}${close} retry`])),
  ...['Error:', 'TypeError: Failed to fetch ', 'net::ERR_FAILED ']
    .flatMap(label => [[privateUrl, '/x'], ['data:image/png;base64,private-value', '[inline]']]
      .map(([url, clean]) => [`${label}${url}`, `${label}${clean}`])),
  ...['HTTP', 'HTTPS', 'WS', 'WSS', 'FTP']
    .map(scheme => [`failed ${scheme}://demo:example@host/x?private=value#fragment`, 'failed /x']),
  ['failed FILE:///x?private=value#fragment', 'failed /x'],
  ['failed DATA:image/png;base64,private-value', 'failed [inline]'],
  ['failed BLOB:https://host/private-value?private=value#fragment', 'failed [inline]'],
  ['failed data:private-value!!!', 'failed [inline]'],
  ['failed blob:https://host/private-value!!!', 'failed [inline]'],
  ['failed ws://demo:example@host/x?private=value#fragment', 'failed /x'],
  ['failed wss://demo:example@host/x?private=value#fragment', 'failed /x'],
  ['failed https://demo%40example:private%40value@host/x?private=value#fragment', 'failed /x'],
  [`failed ${privateUrl} then ws://demo:example@host/y?private=value#fragment`, 'failed /x then /y'],
  [`failed [${privateUrl}],(blob:https://host/private-value)`, 'failed [/x],([inline])'],
  ['failed https://demo:example@host/x,https://demo:example@host/y?private=value', 'failed /x,/y'],
  ['failed https://demo:example@host/x/data:image/png;base64,private-value', 'failed /x/[inline]'],
  ['failed [//demo:example@[::1]/x?private=value#fragment]', 'failed [/x]'],
  ...['.', ',', ';', '!'].map(mark => [`failed ${privateUrl}${mark}`, `failed /x${mark}`]),
  ['failed https://demo:example@host/x.', 'failed /x.'],
  [`failed https://host/x?${'private=value&'.repeat(80)} after ${privateUrl}`, 'failed /x after /x'],
  ['failed Error:/x?private=value#fragment', 'failed Error:/x'],
  [String.raw`failed Error:\\demo:example@host\x?private=value#fragment`, 'failed Error:/x'],
  ...['Error: readable', 'Error:[readable]', 'TypeError: Failed to fetch', 'net::ERR_FAILED',
    'at file:line:col', 'custom: readable', 'TypeError: failed to fetch; retry: later.']
    .map(detail => [detail, detail]),
];
function shot(id = 'phone', retry = 0) {
  return { id, test: 'controlled', project: 'chromium', retry, pageId: 'page', navigation: 1,
    file: `${id}.png`, pagePath: '/fixture', target: null, clip: null, fullPage: false,
    viewport: { width: 390, height: 800, dpr: 1 }, theme: 'dark', osTheme: 'light', language: 'fi',
    scrolls: [{ selector: ':root', x: 0, y: 0 }], capturedAt: at, status: 'complete', coverage: [] };
}
function finding(id = 'small', shotId = 'phone', severity = 'medium') {
  return { id, shotId, check: 'touch-size', severity, selector: '#small', relatedSelector: null,
    rect: { x: 10, y: 10, width: 30, height: 30 }, relatedRect: null, rule: 'effective-target',
    measured: { width: 30, height: 30 }, expected: { minimum: 43.5 }, intentSource: null, suppressedBy: null, eventIds: [] };
}
function report() {
  return { ...emptyReport('run', at), status: 'complete', shots: [shot()], findings: [finding()] };
}
function allowance(overrides = {}) {
  return { id: 'approved', check: 'touch-size', selector: '#small', shot: 'phone',
    viewport: { width: 390, height: 800 }, theme: 'dark', language: 'fi', reason: 'Reviewed fixture exception',
    owner: 'visual QA', expires: '2099-12-31', maxMatches: 1, eventFingerprint: null, ...overrides };
}
const now = new Date(at);
const apply = (entry, source = report(), selectors = { phone: ['#small'] }) => applyAllowlist(source, [entry], selectors, now);

describe('allowance boundaries', () => {
  test('retains the suppressed finding and all required fields', () => {
    const result = apply(allowance());
    expect(result.findings).toEqual([{ ...finding(), suppressedBy: 'approved' }]);
    expect(result.states[0]).toMatchObject({ state: 'matched', matchCount: 1, shotIds: ['phone'] });
  });
  test('empty reason suppresses nothing', () => {
    const result = apply(allowance({ reason: '  ' }));
    expect(result.findings[0].suppressedBy).toBeNull(); expect(result.errors).toHaveLength(1);
  });
  test('expired entries suppress nothing', () => {
    const result = apply(allowance({ expires: '2026-10-21' }));
    expect(result.states[0].state).toBe('expired'); expect(result.findings[0].suppressedBy).toBeNull();
  });
  test('exceeding maxMatches suppresses none, including the first match', () => {
    const source = report(); source.findings.push(finding('second'));
    const result = apply(allowance(), source);
    expect(result.findings.every(finding => finding.suppressedBy === null)).toBe(true);
    expect(result.errors[0]).toContain('maxMatches');
  });
  test('explicit any matches only context fields', () => {
    const result = apply(allowance({ shot: 'any', viewport: 'any', theme: 'any', language: 'any' }));
    expect(result.findings[0].suppressedBy).toBe('approved');
    for (const override of [{ selector: 'any' }, { check: 'any' }, { eventFingerprint: 'any' }]) {
      expect(apply(allowance(override)).findings[0].suppressedBy).toBeNull();
    }
  });
  test.each([{ shot: 'other' }, { viewport: { width: 400, height: 800 } }, { theme: 'light' }, { language: 'en' }])('context mismatch %j is untested', override => {
    const result = apply(allowance(override));
    expect(result.states[0].state).toBe('untested'); expect(result.findings[0].suppressedBy).toBeNull();
  });
  test('missing-selector requires observed context and selector evidence', () => {
    const source = report(); source.findings = [];
    expect(apply(allowance(), source, { phone: [] }).states[0].state).toBe('missing-selector');
    expect(apply(allowance(), source, {}).states[0].state).toBe('untested');
    expect(apply(allowance(), source).states[0].state).toBe('untested');
  });
  test('events match root and fingerprint, not just a message/check', () => {
    const source = report(); source.findings[0] = { ...finding(), check: 'console', selector: ':root', eventIds: ['event'] };
    source.events = [{ id: 'event', pageId: 'page', navigation: 1, at, kind: 'console-error', method: null,
      path: null, status: null, detail: 'fixture', fingerprint: 'specific' }];
    expect(apply(allowance({ check: 'console', selector: ':root', eventFingerprint: 'specific' }), source).findings[0].suppressedBy).toBe('approved');
    expect(apply(allowance({ check: 'console', selector: ':root', eventFingerprint: 'other' }), source).findings[0].suppressedBy).toBeNull();
  });
  test('rejects impossible dates, missing fields and extra wildcard contexts', () => {
    const missing = allowance(); delete missing.owner;
    for (const entry of [missing, allowance({ expires: '2099-02-30' }), allowance({ maxMatches: 0 }),
      allowance({ viewport: { width: 'any', height: 800 } })]) {
      const result = apply(entry);
      expect(result.findings[0].suppressedBy).toBeNull(); expect(result.errors).toHaveLength(1);
    }
  });
});

describe('run artifacts', () => {
  test('two concurrent workers and a retry merge; other runs are excluded', async () => {
    const root = await directory();
    const shard = (id, retry) => ({ report: { ...report(), shots: [shot(id, retry)], findings: [finding(id, id)] },
      allowlistEntries: [], selectorsByShot: { [id]: ['#small'] } });
    await Promise.all(['worker-a', 'worker-b'].map(id => new Promise((resolve, reject) => {
      const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(`
        import { workerData } from 'node:worker_threads';
        const { writeShardAndMerge } = await import(workerData.moduleUrl);
        await writeShardAndMerge(workerData.root, workerData.shard, workerData.name);
      `)), { workerData: { root, shard: shard(id, 0), name: id + '-0',
        moduleUrl: new URL('./visual_report.mjs', import.meta.url).href } });
      worker.once('error', reject);
      worker.once('exit', code => code === 0 ? resolve() : reject(new Error(`Worker exited ${code}`)));
    })));
    await writeShardAndMerge(root, shard('worker-a-retry', 1), 'worker-a-1');
    await fs.writeFile(path.join(root, 'shards', 'old-worker.json'), JSON.stringify({ report: { ...report(), runId: 'old' } }));
    const merged = await mergeReportDirectory(root);
    expect(merged.shots).toHaveLength(3); expect(merged.shots.map(shot => shot.retry)).toContain(1);
    expect(merged.findings).toHaveLength(3); expect(merged.status).toBe('complete');
    expect(JSON.parse(await fs.readFile(path.join(root, 'visual-observations.json'), 'utf8'))).toEqual(merged);
    expect((await fs.readdir(root)).some(file => file.endsWith('.tmp') || file.includes('lock'))).toBe(false);
  });
  test('merge recomputes allowances from raw findings across every worker', () => {
    const shard = id => ({ report: { ...report(), shots: [shot(id)], findings: [finding(id, id)] },
      allowlistEntries: [allowance({ shot: 'any' })], selectorsByShot: { [id]: ['#small'] } });
    const merged = mergeShards([shard('a'), shard('b')], { runId: 'run', startedAt: at, now });
    expect(merged.findings.every(finding => finding.suppressedBy === null)).toBe(true);
    expect(merged.errors[0]).toContain('maxMatches');
  });
  test('Markdown sorts severity then shot/check/selector and puts suppressions/unknowns last', () => {
    const source = report(); source.shots.push(shot('alpha'), shot('zebra'));
    source.findings = [finding('low', 'phone', 'low'), finding('high-z', 'zebra', 'high'),
      finding('medium', 'phone', 'medium'), finding('high-a', 'alpha', 'high'),
      { ...finding('hidden'), suppressedBy: 'approved' }];
    source.shots[0].coverage = [{ check: 'contrast', status: 'skipped', examined: 0, excluded: 0, reason: 'unknown', durationMs: 0 }];
    const md = renderMarkdown(source);
    expect(md.indexOf('| high | [alpha]')).toBeLessThan(md.indexOf('| high | [zebra]'));
    expect(md.indexOf('| high | [zebra]')).toBeLessThan(md.indexOf('| medium |'));
    expect(md.indexOf('| medium |')).toBeLessThan(md.indexOf('| low |'));
    expect(md.indexOf('## Suppressions')).toBeGreaterThan(md.indexOf('| low |'));
    expect(md.indexOf('## Unknowns')).toBeGreaterThan(md.indexOf('hidden: suppressed'));
  });
  test('the CLI prints exactly one required line', async () => {
    const root = await directory();
    const print = vi.fn();
    expect(await runCli(['merge', root], print)).toBe(0);
    const result = JSON.parse(await fs.readFile(path.join(root, 'visual-observations.json'), 'utf8'));
    expect(print.mock.calls).toEqual([[`VISUAL_OBSERVATIONS run=${result.runId} high=0 medium=0 low=0 coverage=partial report=${root}/visual-observations.md`]]);
    expect(summaryLine(report(), 'shots')).toBe('VISUAL_OBSERVATIONS run=run high=0 medium=1 low=0 coverage=complete report=shots/visual-observations.md');
    expect(await runCli([], print)).toBe(2);
  });
  test('an empty run says incomplete, not a clean pass', () => {
    const result = mergeShards([], { runId: 'empty', startedAt: at });
    expect(result.status).toBe('partial'); expect(renderMarkdown(result)).toContain('No findings; observations are incomplete.');
    expect(Object.keys(result).sort()).toEqual(['schemaVersion', 'runId', 'startedAt', 'revision', 'dirty', 'status', 'shots', 'findings', 'events', 'allowlist', 'errors'].sort());
  });
  test('a held lock times out and CLI reporting still returns success', async () => {
    const root = await directory(); await fs.mkdir(path.join(root, '.visual-observations-lock'));
    await expect(withReportLock(root, () => {}, 30)).rejects.toThrow('timed out');
  });
  test('CLI write failures still print one partial summary and exit zero', async () => {
    const root = await directory(), blocked = path.join(root, 'output-file');
    await fs.writeFile(blocked, 'not a directory');
    const print = vi.fn();
    expect(await runCli(['merge', blocked], print)).toBe(0);
    expect(print.mock.calls).toEqual([[`VISUAL_OBSERVATIONS run=unknown high=0 medium=0 low=0 coverage=partial report=${blocked}/visual-observations.md`]]);
  });
  test('sanitises URL values, inline bytes and long messages', () => {
    expect(sanitisePath('https://user:pass@host/path?private=value#fragment')).toBe('/path');
    expect(sanitisePath('data:image/png;base64,abcdef')).toBe('[inline]');
    const detail = sanitiseDetail('failed https://host/a?private=value /relative?private=value ' + 'x'.repeat(500));
    expect(detail).not.toContain('value'); expect(detail).not.toContain('host'); expect(detail).toHaveLength(200);
  });
  test.each(messageUrls)('normalises the message URL %s using the path privacy rule', (url, clean) => {
    expect(sanitisePath(url)).toBe(clean);
    expect(sanitiseDetail(`failed ${url}`)).toBe(`failed ${clean}`);
  });
  test.each(messageDetails)('sanitises embedded URLs and preserves labels/delimiters: %s', (detail, clean) => {
    expect(sanitiseDetail(detail)).toBe(clean);
  });
  test('sanitises multiple quoted and relative URL forms before the length limit', () => {
    expect(sanitiseDetail('failed "//demo:example@host/x?private=value" assets/x#fragment'))
      .toBe('failed "/x" /assets/x');
  });
  test('retains ordinary error labels and message prose', () => {
    const detail = 'TypeError: failed to fetch; retry: later.';
    expect(sanitiseDetail(detail)).toBe(detail);
  });
  test('drops authority even when a network URL adjoins message punctuation', () => {
    for (const detail of ['failed url=//demo:example@host/x?private=value#fragment',
      'failed (//demo:example@host/x?private=value#fragment)']) {
      expect(sanitiseDetail(detail)).not.toMatch(/demo|example|host|private|value|fragment/);
    }
  });
});

describe('observer outcome boundaries', () => {
  const info = { testId: 'unit', titlePath: ['unit'], project: { name: 'chromium' }, retry: 0 };
  function fakePage() {
    return { screenshot: vi.fn(async () => Buffer.from('shot')), on: vi.fn(), off: vi.fn(),
      evaluate: vi.fn(async () => { throw new Error('observer injection'); }), waitForFunction: vi.fn(async () => {}),
      url: () => 'https://vg.invalid/fixture?private=value', viewportSize: () => ({ width: 390, height: 800 }) };
  }
  test.each(messageDetails)('keeps %s private in stored events, findings, shard JSON and Markdown', async (detail, clean) => {
    const root = await directory(), page = fakePage();
    page.evaluate.mockImplementation(async (_observer, args) => args.fingerprint || {
      findings: [], coverage: [], errors: [], images: [], fingerprint: [], selectors: [],
      viewport: { width: 390, height: 800, dpr: 1 }, theme: 'light', osTheme: 'dark',
      language: 'fi', scrolls: [], target: null,
    });
    const visual = startVisualObservations(page, info, { enabled: true, reportDir: root });
    const listener = name => page.on.mock.calls.find(([event]) => event === name)[1];
    listener('console')({ type: () => 'error', text: () => detail });
    listener('pageerror')(new Error(detail));
    listener('requestfailed')({ failure: () => ({ errorText: detail }), resourceType: () => 'fetch',
      method: () => 'GET', url: () => privateUrl });
    try { await visual.shot({ path: path.join(root, 'shot.png') }); }
    finally { await visual.finish(); }
    const json = await fs.readFile(path.join(root, 'visual-observations.json'), 'utf8');
    const md = await fs.readFile(path.join(root, 'visual-observations.md'), 'utf8');
    const result = JSON.parse(json);
    expect(result.events.map(event => event.kind).sort()).toEqual(['console-error', 'pageerror', 'requestfailed']);
    expect(result.events.every(event => event.detail === clean)).toBe(true);
    expect(result.events.find(event => event.kind === 'requestfailed').path).toBe('/x');
    expect(result.findings).toHaveLength(3);
    for (const finding of result.findings) {
      expect(finding.measured.detail).toBe(clean);
      expect(md).toContain(JSON.stringify(finding.measured).replace(/</g, '&lt;'));
    }
    const shards = await Promise.all((await fs.readdir(path.join(root, 'shards')))
      .map(file => fs.readFile(path.join(root, 'shards', file), 'utf8')));
    expect(shards).toHaveLength(1);
    for (const privatePart of ['demo', 'example', 'host', 'private', 'value', 'fragment', '%40', 'base64', 'image/png']) {
      for (const artifact of [json, md, ...shards]) expect(artifact).not.toContain(privatePart);
    }
  });
  test('disabled uses the original screenshot options, without listeners, evaluate or artifacts', async () => {
    const root = path.join(await directory(), 'absent'), page = fakePage();
    const visual = startVisualObservations(page, info, { enabled: false, reportDir: root });
    const options = { path: '/tmp/example.png', fullPage: true, animations: 'disabled', name: 'helper-only', expect: ['image-load'] };
    await visual.shot(options); await visual.finish();
    expect(page.screenshot).toHaveBeenCalledExactlyOnceWith({ path: options.path, fullPage: true, animations: 'disabled' });
    expect(page.on).not.toHaveBeenCalled(); expect(page.evaluate).not.toHaveBeenCalled();
    await expect(fs.stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('environment opt-in applies only when the explicit option is undefined', async () => {
    const root = await directory(), page = fakePage();
    vi.stubEnv('FILTEREST_VISUAL_OBSERVATIONS', '1');
    const enabled = startVisualObservations(page, info, { reportDir: root });
    expect(page.on).toHaveBeenCalledTimes(5); await enabled.finish();
    page.on.mockClear();
    const disabled = startVisualObservations(page, info, { enabled: false, reportDir: path.join(root, 'absent') });
    await disabled.shot({ path: '/tmp/example.png' }); await disabled.finish();
    expect(page.on).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(root, 'absent'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  test('original screenshot error propagates as the exact same object', async () => {
    const root = await directory(), page = fakePage(), original = new Error('screenshot');
    page.screenshot.mockRejectedValue(original);
    const visual = startVisualObservations(page, info, { enabled: true, reportDir: root });
    try { await expect(visual.shot({ path: path.join(root, 'shot.png') })).rejects.toBe(original); }
    finally { await visual.finish(); }
    expect(page.off).toHaveBeenCalledTimes(5);
  });
  test('invalid expectations and injected page observer errors produce partial reports and a successful screenshot', async () => {
    const root = await directory(), page = fakePage();
    const visual = startVisualObservations(page, info, { enabled: true, reportDir: root, expectations: { schemaVersion: 2, entries: [] } });
    try { await expect(visual.shot({ path: path.join(root, 'shot.png') })).resolves.toEqual(Buffer.from('shot')); }
    finally { await visual.finish(); }
    const result = JSON.parse(await fs.readFile(path.join(root, 'visual-observations.json'), 'utf8'));
    expect(result.status).toBe('partial'); expect(result.errors).toContain('Invalid visual expectations file or entries');
    expect(result.errors).toContain('Visual shot observer failed');
  });
  test('finish never rejects when both report and fallback shard writes fail', async () => {
    const root = await directory(), blocked = path.join(root, 'output-file'); await fs.writeFile(blocked, 'not a directory');
    const visual = startVisualObservations(fakePage(), info, { enabled: true, reportDir: blocked });
    await expect(visual.finish()).resolves.toBeUndefined();
  });
});
