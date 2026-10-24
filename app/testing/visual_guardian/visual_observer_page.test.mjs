// @vitest-environment jsdom
// visual_observer_page.test.mjs
// Proves captured touch targets never disappear behind complete coverage.
// Connects mocked DOM geometry to the page pass and persisted report artifacts.
// Uses no browser or application, restoring globals and removing temporary output.
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { observeVisualState } from './visual_observer_page.js';
import { startVisualObservations } from './visual_observer';

const { document } = globalThis;
let hitTest;

beforeEach(() => {
  // The gate's probe: identical 30x30 buttons at document y=100 and y=1000.
  document.body.innerHTML = '<button id="upper"></button><button id="lower"></button>';
  const boxes = new Map([
    [document.documentElement, { x: 0, y: 0, width: 390, height: 1400 }],
    [document.head, { x: 0, y: 0, width: 0, height: 0 }],
    [document.body, { x: 0, y: 0, width: 390, height: 1400 }],
    [document.querySelector('#upper'), { x: 100, y: 100, width: 30, height: 30 }],
    [document.querySelector('#lower'), { x: 100, y: 1000, width: 30, height: 30 }],
  ]);
  for (const [element, bounds] of boxes) {
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(bounds);
    vi.spyOn(element, 'getClientRects').mockReturnValue([bounds]);
  }
  for (const [name, value] of Object.entries({ clientWidth: 390, scrollWidth: 390, scrollHeight: 1400 })) {
    vi.spyOn(document.documentElement, name, 'get').mockReturnValue(value);
  }
  for (const [name, value] of Object.entries({ innerWidth: 390, innerHeight: 800,
    devicePixelRatio: 1, scrollX: 0, scrollY: 0 })) vi.stubGlobal(name, value);
  vi.stubGlobal('CSS', { escape: value => value });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  vi.stubGlobal('getComputedStyle', () => ({ display: 'block', visibility: 'visible', opacity: '1',
    overflowX: 'visible', overflowY: 'visible', pointerEvents: 'auto' }));
  hitTest = vi.fn((x, y) => {
    if (x < 0 || y < 0 || x >= globalThis.innerWidth || y >= globalThis.innerHeight) return null;
    return [...boxes].reverse().find(([, bounds]) => x >= bounds.x && x < bounds.x + bounds.width
      && y >= bounds.y && y < bounds.y + bounds.height)?.[0] || null;
  });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hitTest });
});

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete document.elementFromPoint;
  document.body.replaceChildren();
});

const touchCoverage = result => result.coverage.find(item => item.check === 'touch-size');

test('full-page capture counts the below-viewport button as not examined with partial coverage', async () => {
  const result = await observeVisualState({ fullPage: true });
  expect(touchCoverage(result)).toMatchObject({ status: 'partial', examined: 1, excluded: 1,
    reason: '1 captured touch targets not examined: no viewport hit-test evidence' });
  expect(result.findings.filter(item => item.check === 'touch-size').map(item => item.selector)).toEqual(['#upper']);
  expect(hitTest).toHaveBeenCalledWith(115, 1015);
});

test('viewport-only capture excludes the uncaptured lower button without claiming missing coverage', async () => {
  expect(touchCoverage(await observeVisualState({}))).toMatchObject({ status: 'complete', examined: 1, excluded: 0, reason: null });
  expect(hitTest).not.toHaveBeenCalledWith(115, 1015);
});

test('full-page coverage is complete when both captured controls have hit-test evidence', async () => {
  vi.stubGlobal('innerHeight', 1400);
  const result = await observeVisualState({ fullPage: true });
  expect(touchCoverage(result)).toMatchObject({ status: 'complete', examined: 2, excluded: 0 });
  expect(result.findings.filter(item => item.check === 'touch-size')).toHaveLength(2);
});

test('missing hit-test evidence counts every unexamined target', async () => {
  hitTest.mockReturnValue(null);
  expect(touchCoverage(await observeVisualState({ fullPage: true }))).toMatchObject({ status: 'partial',
    examined: 0, excluded: 2, reason: '2 captured touch targets not examined: no viewport hit-test evidence' });
});

test('an exposed control covered by another element remains an intentional exclusion', async () => {
  hitTest.mockReturnValue(document.body);
  expect(touchCoverage(await observeVisualState({}))).toMatchObject({ status: 'complete', examined: 0, excluded: 1 });
});

test('partial coverage and its unexamined count survive capture, merging, JSON and Markdown', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'vg-touch-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const page = { on: vi.fn(), off: vi.fn(), screenshot: vi.fn(async () => Buffer.from('fixture')),
    evaluate: async (observer, args) => observer(args), waitForFunction: vi.fn(async () => {}),
    url: () => 'https://visual.invalid/fixture', viewportSize: () => ({ width: 390, height: 800 }) };
  const visual = startVisualObservations(page, { testId: 'touch', titlePath: ['touch'],
    project: { name: 'fixture' }, retry: 0 }, { enabled: true, reportDir: root, expectations: { schemaVersion: 1, entries: [] }, allowlist: [] });
  try {
    try { await visual.shot({ path: path.join(root, 'fixture.png'), fullPage: true }); }
    finally { await visual.finish(); }
    const report = JSON.parse(await fs.readFile(path.join(root, 'visual-observations.json'), 'utf8'));
    expect(report.status).toBe('partial'); expect(report.shots[0].status).toBe('partial');
    expect(touchCoverage(report.shots[0])).toMatchObject({ status: 'partial', examined: 1, excluded: 1,
      reason: expect.stringContaining('1 captured touch targets not examined') });
    expect(await fs.readFile(path.join(root, 'visual-observations.md'), 'utf8'))
      .toContain('1 captured touch targets not examined');
    expect(page.screenshot).toHaveBeenCalledExactlyOnceWith({ path: path.join(root, 'fixture.png'), fullPage: true });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
