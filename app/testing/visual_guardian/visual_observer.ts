// visual_observer.ts
// Collects optional visual observations immediately beside each screenshot.
// Connects Playwright events, the isolated page pass and run-scoped reports.
// Observer failures are data; screenshot failures keep their original identity.
import type { Locator, Page, TestInfo } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { observeVisualState } from './visual_observer_page.js';
import { validateImageBytes } from './visual_image_structure.mjs';
import { emptyReport, fingerprint, sanitiseDetail, sanitisePath, summaryLine, writeShardAndMerge } from './visual_report.mjs';
import type { AllowEntry, Check, Coverage, Event, Expectations, Finding, Rect, Report, Shot, Theme } from './visual_observer_types';
export type * from './visual_observer_types';

export type VisualOptions = {
  enabled?: boolean;
  reportDir?: string;
  expectations?: Expectations | string;
  allowlist?: AllowEntry[] | string;
  meta?: { runId?: string; revision?: string | null; dirty?: boolean | null; theme?: Theme; language?: string };
};
export type VisualShotOptions = { path: string; target?: Locator; fullPage?: boolean;
  clip?: { x: number; y: number; width: number; height: number }; animations?: 'disabled' | 'allow';
  name?: string; expect?: string[] };

const safeName = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
const defaults = __dirname;
const activeChecks: Check[] = ['image-load', 'image-box', 'image-distortion', 'text-clip', 'page-x-scroll', 'touch-size', 'console', 'request'];
type PageObservation = { findings: Omit<Finding, 'id' | 'shotId'>[]; coverage: Coverage[];
  errors: string[]; images: { selector: string | null; rect: Rect; src: string; problem: string | null }[];
  fingerprint: { selector: string; rect: Rect }[]; selectors: string[]; viewport: Shot['viewport'];
  theme: Theme; osTheme: Theme; language: string; scrolls: Shot['scrolls']; target: string | null };

function expectationsValid(value: Expectations): boolean {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.entries)) return false;
  const ids = new Set();
  return value.entries.every(entry => {
    if (!entry || ids.has(entry.id)) return false;
    ids.add(entry.id);
    const base = ['id', 'selector', 'shot', 'reason', 'source'].every(key => typeof entry[key] === 'string' && entry[key].trim())
      && entry.viewport && Number.isFinite(entry.viewport.minWidth) && Number.isFinite(entry.viewport.maxWidth)
      && entry.viewport.minWidth >= 0 && entry.viewport.maxWidth >= entry.viewport.minWidth;
    return base && (entry.kind === 'image-box' ? Number.isFinite(entry.width) && entry.width! > 0
      && Number.isFinite(entry.height) && entry.height! > 0 && ['border', 'content'].includes(entry.box!)
      : entry.kind === 'truncation' ? Number.isInteger(entry.lines) && entry.lines! > 0
        : entry.kind === 'expanded-target' && entry.via === '::after');
  });
}

/** Attach before navigation. Disabled calls are a direct screenshot wrapper with no observer side effects. */
export function startVisualObservations(page: Page, testInfo: TestInfo, options: VisualOptions = {}) {
  const enabled = options.enabled ?? process.env.FILTEREST_VISUAL_OBSERVATIONS === '1';
  const takeScreenshot = ({ target, name: _name, expect: _expect, ...original }: VisualShotOptions) =>
    target ? target.screenshot(original) : page.screenshot(original);
  if (!enabled) return { shot: takeScreenshot, finish: async () => {} };

  let reportDir: string;
  let directoryError = false;
  try { reportDir = path.resolve(options.reportDir || path.join(testInfo.project.outputDir, 'visual-observations')); }
  catch { reportDir = path.resolve(testInfo.outputPath('visual-observations')); directoryError = true; }
  const pageId = randomUUID(), startedAt = new Date().toISOString();
  const report = emptyReport(options.meta?.runId ? safeName(options.meta.runId) : '', startedAt) as Report;
  report.revision = options.meta?.revision ?? null;
  report.dirty = options.meta?.dirty ?? null;
  const eventSeverity = new Map<string, Finding['severity']>();
  const imageResults = new Map<string, { problem: string; eventId: string | null; navigation: number }>();
  const pending = new Set<Promise<void>>();
  const selectorsByShot: Record<string, string[]> = {};
  let navigation = 0, finished = false, expectations: Expectations = { schemaVersion: 1, entries: [] };
  let allowlist: AllowEntry[] = [];
  const error = (message: string) => { report.errors.push(message); report.status = 'partial'; };
  if (directoryError) error('Invalid visual output configuration; using test output');
  const initialisation = (async () => {
    try {
      expectations = typeof options.expectations === 'object' ? options.expectations
        : JSON.parse(await fs.readFile(options.expectations || path.join(defaults, 'visual_expectations.json'), 'utf8'));
      if (!expectationsValid(expectations)) throw new Error('invalid');
    } catch { expectations = { schemaVersion: 1, entries: [] }; error('Invalid visual expectations file or entries'); }
    try {
      allowlist = Array.isArray(options.allowlist) ? options.allowlist
        : JSON.parse(await fs.readFile(options.allowlist || path.join(defaults, 'visual_allowlist.json'), 'utf8'));
      if (!Array.isArray(allowlist)) throw new Error('invalid');
    } catch { allowlist = []; error('Invalid visual allowlist file'); }
  })();
  const addEvent = (kind: Event['kind'], detail: string, method: string | null = null,
    url: string | null = null, status: number | null = null, severity: Finding['severity'] = 'medium') => {
    const clean = sanitiseDetail(detail), cleanPath = url ? sanitisePath(url) : null;
    const event: Event = { id: `${pageId}-event-${report.events.length + 1}`, pageId, navigation,
      at: new Date().toISOString(), kind, method, path: cleanPath, status, detail: clean,
      fingerprint: fingerprint(JSON.stringify([kind, method, cleanPath, status, clean])) };
    report.events.push(event); eventSeverity.set(event.id, severity);
    return event.id;
  };
  const guarded = <T extends unknown[]>(callback: (...args: T) => void) => (...args: T) => {
    try { callback(...args); } catch { error('Visual event observer failed'); }
  };
  const consoleListener = guarded((message: import('@playwright/test').ConsoleMessage) => {
    if (message.type() === 'error') addEvent('console-error', message.text());
  });
  const pageErrorListener = guarded((value: Error) => { addEvent('pageerror', value.message, null, null, null, 'high'); });
  const navigationListener = guarded((frame: import('@playwright/test').Frame) => {
    if (frame === page.mainFrame()) navigation++;
  });
  const failedListener = guarded((request: import('@playwright/test').Request) => {
    const detail = request.failure()?.errorText || 'Request failed';
    const required = ['image', 'script', 'stylesheet', 'font', 'document'].includes(request.resourceType());
    const id = addEvent('requestfailed', detail, request.method(), request.url(), null,
      required ? 'high' : /abort|cancel/i.test(detail) ? 'low' : 'medium');
    if (request.resourceType() === 'image') imageResults.set(request.url(), { problem: 'requestfailed', eventId: id, navigation });
  });
  const responseListener = guarded((response: import('@playwright/test').Response) => {
    const responseNavigation = navigation;
    const request = response.request(), status = response.status(), url = response.url();
    let eventId: string | null = null;
    if (status >= 400) {
      const required = ['image', 'script', 'stylesheet', 'font', 'document'].includes(request.resourceType());
      const firstParty = new URL(url).origin === new URL(page.url()).origin;
      eventId = addEvent('http', `HTTP ${status}`, request.method(), url, status, required || firstParty && status >= 500 ? 'high' : 'medium');
      if (request.resourceType() === 'image') imageResults.set(url, { problem: `http-${status}`, eventId, navigation });
    }
    const task = (async () => {
      try {
        const type = await response.headerValue('content-type') || '';
        if (!type.toLowerCase().startsWith('image/')) return;
        const size = Number(await response.headerValue('content-length'));
        if (size > 2 * 1024 * 1024) { error('Image structure not checked: response exceeds 2 MB'); return; }
        const bytes = await response.body();
        if (bytes.length > 2 * 1024 * 1024) { error('Image structure not checked: response exceeds 2 MB'); return; }
        const result = validateImageBytes(bytes, type);
        if (result.format === 'unknown') return; // SVG/AVIF and other containers have no V-1 structure check.
        if (result.problem?.includes('exceeds 64 MB')) { error('Image structure not checked: inflated size limit'); return; }
        if (!result.ok) imageResults.set(url, { problem: result.problem!, eventId, navigation: responseNavigation });
      } catch { error('Image response structure observer failed'); }
    })();
    pending.add(task); void task.finally(() => pending.delete(task));
  });
  page.on('console', consoleListener); page.on('pageerror', pageErrorListener);
  page.on('framenavigated', navigationListener); page.on('requestfailed', failedListener); page.on('response', responseListener);

  const drainResponses = async () => {
    if (!pending.size) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const settled = await Promise.race([Promise.all([...pending]).then(() => true),
        new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 500); })]);
      if (!settled) error('Image response validation still pending');
    } finally { clearTimeout(timer); }
  };
  const appendEvents = (shot: Shot) => {
    const groups = new Map<string, Event[]>();
    for (const event of report.events.filter(event => event.navigation === shot.navigation)) {
      groups.set(event.fingerprint, [...(groups.get(event.fingerprint) || []), event]);
    }
    for (const events of groups.values()) {
      const first = events[0];
      const existing = report.findings.find(finding => finding.shotId === shot.id && finding.eventIds.includes(first.id) && finding.selector === ':root');
      if (existing) { existing.measured.count = events.length; existing.eventIds = events.map(event => event.id); continue; }
      report.findings.push({ id: `${shot.id}-event-${first.fingerprint}`, shotId: shot.id,
        check: first.kind === 'console-error' || first.kind === 'pageerror' ? 'console' : 'request',
        severity: eventSeverity.get(first.id) || 'medium', selector: ':root', relatedSelector: null,
        rect: null, relatedRect: null, rule: first.kind, measured: { count: events.length, path: first.path,
          status: first.status, detail: first.detail, fingerprint: first.fingerprint }, expected: {},
        intentSource: null, suppressedBy: null, eventIds: events.map(event => event.id) });
    }
  };
  const markPartial = (shot: Shot, message: string) => {
    shot.status = 'partial';
    for (const coverage of shot.coverage.filter(item => item.status !== 'skipped')) {
      coverage.status = 'partial';
      // Keep the page pass's specific reasons/counts in the persisted report.
      coverage.reason = coverage.reason ? `${coverage.reason}; ${message}` : message;
    }
  };

  /** Scroll, settle, observe once, capture unchanged options, then verify geometry. */
  async function shot(input: VisualShotOptions) {
    let observed: PageObservation | undefined;
    const shotId = `${safeName(testInfo.testId)}-${fingerprint(testInfo.testId)}-${safeName(testInfo.project.name)}-${testInfo.retry}-${safeName(input.name || path.basename(input.path, path.extname(input.path)))}-${report.shots.length}`;
    const record: Shot = { id: shotId, test: testInfo.titlePath.join(' > '), project: testInfo.project.name,
      retry: testInfo.retry, pageId, navigation, file: path.relative(reportDir, path.resolve(input.path)).split(path.sep).join('/'),
      pagePath: sanitisePath(page.url()), target: null, clip: input.clip || null, fullPage: input.fullPage || false,
      viewport: { ...(page.viewportSize() || { width: 0, height: 0 }), dpr: 1 }, theme: options.meta?.theme || 'unknown',
      osTheme: 'unknown', language: options.meta?.language || 'unknown', scrolls: [], capturedAt: new Date().toISOString(),
      status: 'complete', coverage: activeChecks.map(check => ({ check, status: 'partial', examined: 0,
        excluded: 0, reason: 'Observer did not complete', durationMs: 0 })) };
    let ready = true;
    try {
      await initialisation;
      if (input.target) await input.target.scrollIntoViewIfNeeded({ timeout: 500 });
      try {
        await page.waitForFunction(() => {
          if (document.fonts?.status !== 'loaded') return false;
          const visible = (node: Element) => { const box = node.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight; };
          return [...document.images].every(image => image.complete || !visible(image))
            && !document.getAnimations().some(animation => (animation.pending || animation.playState === 'running')
              && animation.effect?.getTiming().iterations !== Infinity);
        }, null, { timeout: 500, polling: 'raf' });
      } catch { ready = false; }
      const handle = input.target ? await input.target.elementHandle({ timeout: 500 }) : null;
      try {
        observed = await page.evaluate(observeVisualState, { target: handle, clip: input.clip,
          fullPage: input.fullPage, name: input.name || path.basename(input.path, path.extname(input.path)),
          expectations: expectations.entries, requiredSelectors: input.expect || [],
          allowlistSelectors: allowlist.map(entry => entry?.selector).filter(selector => typeof selector === 'string') }) as PageObservation;
      } finally { await handle?.dispose(); }
      Object.assign(record, { navigation, pagePath: sanitisePath(page.url()), target: observed.target,
        viewport: observed.viewport, theme: options.meta?.theme || observed.theme, osTheme: observed.osTheme,
        language: options.meta?.language || observed.language, scrolls: observed.scrolls, coverage: observed.coverage });
      report.errors.push(...observed.errors);
      selectorsByShot[shotId] = observed.selectors;
      for (const [index, finding] of observed.findings.entries()) {
        report.findings.push({ ...finding, id: `${shotId}-finding-${index}`, shotId });
      }
      if (!ready || report.errors.length || observed.coverage.some(item => item.status === 'partial')) {
        markPartial(record, !ready ? 'Readiness exceeded 500 ms' : 'Observation coverage incomplete');
      }
    } catch { error('Visual shot observer failed'); markPartial(record, 'Observer exception'); }
    report.shots.push(record);
    record.capturedAt = new Date().toISOString();
    // Deliberately outside observer catches: the original screenshot rejection propagates unchanged.
    let screenshot: Buffer;
    try { screenshot = await takeScreenshot(input); }
    catch (originalError) { markPartial(record, 'Screenshot failed'); throw originalError; }
    try {
      await drainResponses();
      if (observed) {
        for (const image of observed.images) {
          const result = imageResults.get(image.src);
          if (!result || result.navigation !== record.navigation) continue;
          const existing = report.findings.find(finding => finding.shotId === shotId && finding.check === 'image-load' && finding.selector === image.selector);
          if (existing) {
            existing.measured.structureProblem = result.problem;
            if (result.eventId) existing.eventIds.push(result.eventId);
          } else report.findings.push({ id: `${shotId}-structure-${report.findings.length}`, shotId, check: 'image-load',
            severity: 'high', selector: image.selector, relatedSelector: null, rect: image.rect, relatedRect: null,
            rule: 'image-structure', measured: { problem: result.problem, path: sanitisePath(image.src) }, expected: {},
            intentSource: null, suppressedBy: null, eventIds: result.eventId ? [result.eventId] : [] });
        }
        const after = await page.evaluate(observeVisualState, { fingerprint: observed.fingerprint });
        if (JSON.stringify(after) !== JSON.stringify(observed.fingerprint)) markPartial(record, 'Geometry changed during screenshot');
      }
      appendEvents(record);
      if (report.errors.length) markPartial(record, 'Observer errors; see report.errors');
    } catch { error('Visual post-screenshot observer failed'); markPartial(record, 'Post-screenshot observer exception'); }
    return screenshot;
  }

  /** Detach listeners, flush this worker/retry shard, and merge the run without failing the test. */
  async function finish() {
    if (finished) return;
    finished = true;
    try {
      await initialisation;
      await drainResponses();
      page.off('console', consoleListener); page.off('pageerror', pageErrorListener);
      page.off('framenavigated', navigationListener); page.off('requestfailed', failedListener); page.off('response', responseListener);
      const last = report.shots.at(-1);
      if (last) appendEvents(last);
      if (report.errors.length) for (const record of report.shots) markPartial(record, 'Observer errors; see report.errors');
      report.status = report.shots.length && !report.errors.length && report.shots.every(shot => shot.status === 'complete') ? 'complete' : 'partial';
      const shardName = `${safeName(testInfo.testId)}-${fingerprint(testInfo.testId)}-${safeName(testInfo.project.name)}-${testInfo.retry}`;
      const merged = await writeShardAndMerge(reportDir, { report, allowlistEntries: allowlist, selectorsByShot }, shardName);
      console.log(summaryLine(merged, reportDir));
    } catch {
      error('Visual report write or merge failed');
      // Keep a best-effort error shard even if the lock/report pair is unavailable.
      try {
        const { atomicWrite } = await import('./visual_report.mjs');
        await atomicWrite(path.join(reportDir, 'shards', `${report.runId || 'unknown'}-${safeName(testInfo.testId)}-${safeName(testInfo.project.name)}-${testInfo.retry}.json`),
          JSON.stringify({ report, allowlistEntries: allowlist, selectorsByShot }));
      } catch { /* Unwritable output must not alter the test's outcome. */ }
    }
  }
  return { shot, finish };
}
