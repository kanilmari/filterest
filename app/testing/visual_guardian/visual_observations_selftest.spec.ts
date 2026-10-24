// visual_observations_selftest.spec.ts
// Plants one controlled defect per observation rule without visiting app pages.
// Connects routed in-memory media and screenshots to assertions on generated JSON.
// Uses empty browser identity and only Playwright-owned temporary output paths.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { startVisualObservations, type AllowEntry, type Expectations, type Report, type VisualOptions } from './visual_observer';

test.use({ storageState: { cookies: [], origins: [] } });
// A valid 32 x 32 PNG (G15's fixture until 562), kept here so G15 changes cannot move it.
const valid = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAoUlEQVR4nO3RvQmAMBCG4cxm4RIOYmUjuIVDuYKVY6gQCOa83E+8swp81UHep0hYt8N1oQG/Aec+x7kAqf42DABQB0YD7P+gHyfaAHcdcNfj5E8UQKqrDCkA6nJDBKB1ocEDRF1iMABbZw0KENZpowio6oSBAxX1koEA1XXUgMDHely3DGnBqv6M4oBhFAFsoxAwj2aAR7QIWEUzwCPaANUuQRtBWxLcjQcAAAAASUVORK5CYII=', 'base64');
const corrupt = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAoUlEQVR4nO3RvQmAMBCG4cxm4RIOYmUjuIVDuYKVY6gQCOa83E+8swp81UHep0hYt8N1oQG/Aec+x7kAqf42DABQB0YD7P+gHyfaAHcdcNfj5E8UQKqrDCkA6nJDBQBUBQBQBQBQBQBQBQBQBQBQBQBQBQBQBQBQ/ScAqgrW7AM/KKEoMHHcWAAAAABJRU5ErkJggg==', 'base64');
const base = 'https://vg-selftest.invalid';
const small = '<button id="small" style="width:30px;height:30px;padding:0">+</button>';

async function fixtures(page: Page, html: string, width = 390) {
  await page.setViewportSize({ width, height: 800 });
  await page.route(`${base}/**`, route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/missing.png') return route.fulfill({ status: 404, contentType: 'image/png', body: '' });
    if (name === '/wide.svg') return route.fulfill({ contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="blue"/></svg>' });
    return route.fulfill({ contentType: 'image/png', body: name === '/corrupt.png' ? corrupt : valid });
  });
  await page.setContent(`<html lang="en"><head><style>body{margin:8px;font:16px/20px sans-serif}img{display:block;object-fit:cover}</style></head><body>${html}</body></html>`);
}
async function capture(page: Page, info: TestInfo, html: string, options: VisualOptions = {}, width = 390) {
  const reportDir = info.outputPath('observations');
  const visual = startVisualObservations(page, info, { enabled: true, reportDir, ...options });
  try {
    await fixtures(page, html, width);
    await visual.shot({ path: path.join(reportDir, 'fixture.png'), name: 'fixture', animations: 'disabled' });
  } finally { await visual.finish(); }
  return JSON.parse(await fs.readFile(path.join(reportDir, 'visual-observations.json'), 'utf8')) as Report;
}
const byCheck = (report: Report, check: string) => report.findings.filter(finding => finding.check === check);
const frame = (height: number) => `<div class="front-page-blocks"><div class="supplemental-dataset-thumbnail"><div id="frame" class="card_small_image_inner" style="width:76px;height:${height}px"><img id="photo" src="${base}/valid.png" style="width:100%;height:100%"></div></div></div>`;
const truncation: Expectations = { schemaVersion: 1, entries: [{ id: 'fixture-title', kind: 'truncation',
  selector: '#text', shot: 'any', viewport: { minWidth: 0, maxWidth: 2000 }, reason: 'Reviewed one-line test contract',
  source: 'visual_observations_selftest.spec.ts:ellipsis', lines: 1 }] };
const allowance = (expires: string): AllowEntry => ({ id: 'small-fixture', check: 'touch-size', selector: '#small',
  shot: 'any', viewport: 'any', theme: 'any', language: 'any', reason: 'Deliberate self-test small button', owner: 'Visual QA',
  expires, maxMatches: 1, eventFingerprint: null });

test('a: corrupt PNG is caught by the structure check (decode() may also reject)', async ({ page }, info) => {
  const result = await capture(page, info, `<img id="broken" width="76" height="76" src="${base}/corrupt.png">`);
  const findings = byCheck(result, 'image-load');
  expect(findings).toHaveLength(1); expect(findings[0].severity).toBe('high');
  expect(findings[0].rule === 'image-structure' || typeof findings[0].measured.structureProblem === 'string').toBe(true);
});
test('b: valid PNG in the reviewed 76 × 76 Home slot is quiet', async ({ page }, info) => {
  const result = await capture(page, info, frame(76));
  expect(result.findings).toEqual([]); expect(result.status).toBe('complete');
});
test('b: 76 × 40 Home slot reports expected 76 × 76 and height short by 36', async ({ page }, info) => {
  const result = await capture(page, info, frame(40));
  const findings = byCheck(result, 'image-box');
  expect(findings).toHaveLength(2); // The actual media and its frame are both measured.
  expect(findings.every(finding => finding.expected.width === 76 && finding.expected.height === 76
    && finding.measured.heightError === -36)).toBe(true);
});
test('c: a 200 × 100 image with fill in 76 × 76 is distorted', async ({ page }, info) => {
  const result = await capture(page, info, `<img src="${base}/wide.svg" style="object-fit:fill;width:76px;height:76px">`);
  expect(byCheck(result, 'image-distortion')).toHaveLength(1);
});
test('c: cover deliberately crops the same image and is quiet', async ({ page }, info) => {
  const result = await capture(page, info, `<img src="${base}/wide.svg" style="object-fit:cover;width:76px;height:76px">`);
  expect(result.findings).toEqual([]);
});
test('d: overflow-hidden ancestor exposing 50% reports ancestor-clip', async ({ page }, info) => {
  const result = await capture(page, info, `<div id="clip" style="width:38px;height:76px;overflow:hidden"><img id="photo" src="${base}/valid.png" style="width:76px;height:76px;max-width:none"></div>`);
  expect(byCheck(result, 'image-box')).toEqual([expect.objectContaining({ rule: 'ancestor-clip',
    selector: '#photo', relatedSelector: '#clip', measured: { visibleFraction: .5 } })]);
});
test('e: clipped text reports one text-clip without duplicate ancestors', async ({ page }, info) => {
  const result = await capture(page, info, '<section style="width:80px;overflow:hidden"><p id="text" style="width:80px;white-space:nowrap;overflow:hidden">A deliberately long line of text clipped at its edge</p></section>');
  expect(byCheck(result, 'text-clip')).toEqual([expect.objectContaining({ selector: '#text' })]);
});
test('e: ellipsis with a reviewed truncation contract is quiet', async ({ page }, info) => {
  const result = await capture(page, info, '<p id="text" style="width:80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">A deliberately long line of text</p>', { expectations: truncation });
  expect(byCheck(result, 'text-clip')).toEqual([]);
});
test('e: a clamp without a truncation contract is reported', async ({ page }, info) => {
  const result = await capture(page, info, '<p id="text" style="width:80px;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden">A deliberately long paragraph with enough words for several lines.</p>');
  expect(byCheck(result, 'text-clip')).toEqual([expect.objectContaining({ rule: 'unapproved-clamp', selector: '#text' })]);
});
test('f: at 390px a 500px block reports page overflow and the protruding element', async ({ page }, info) => {
  const result = await capture(page, info, '<div id="wide" style="width:500px;height:60px"></div>');
  const findings = byCheck(result, 'page-x-scroll'); expect(findings).toHaveLength(1);
  expect(Object.values(findings[0].measured)).toContain('#wide');
  expect(findings[0].measured).toHaveProperty('rootOverflowX'); expect(findings[0].measured).toHaveProperty('bodyOverflowX');
});
test('f: a nested horizontal scroller alone is quiet', async ({ page }, info) => {
  const result = await capture(page, info, '<div style="width:300px;overflow-x:auto"><div style="width:500px;height:60px"></div></div>');
  expect(byCheck(result, 'page-x-scroll')).toEqual([]);
});
test('g: a 30 × 30 phone button is too small', async ({ page }, info) => {
  const result = await capture(page, info, small);
  expect(byCheck(result, 'touch-size')).toEqual([expect.objectContaining({ selector: '#small', expected: { minimum: 43.5 } })]);
});
test('g: an inline link in prose is excluded', async ({ page }, info) => {
  const result = await capture(page, info, '<p>Read the <a href="#next">next part</a> of this sentence.</p>');
  expect(byCheck(result, 'touch-size')).toEqual([]);
});
test('g: the registered Home stretched link passes all five hit tests', async ({ page }, info) => {
  const result = await capture(page, info, '<style>.row{position:relative;width:200px;height:76px}a{display:block;width:40px;height:20px}a::after{content:"";position:absolute;inset:0}</style><div class="front-page-blocks"><div class="row supplemental-dataset-result"><div class="supplemental-dataset-result-text"><a id="stretched" href="#next">Title</a></div></div></div>');
  expect(byCheck(result, 'touch-size')).toEqual([]);
  expect(result.shots[0].coverage.find(item => item.check === 'touch-size')?.status).toBe('complete');
});
test('g: a 20 × 20 desktop button uses the 24px rule', async ({ page }, info) => {
  const result = await capture(page, info, '<button id="small" style="width:20px;height:20px;padding:0">+</button>', {}, 1440);
  expect(byCheck(result, 'touch-size')).toEqual([expect.objectContaining({ expected: { minimum: 24 } })]);
});
test('h: console.error, a thrown error and a 404 image have sanitised fingerprints', async ({ page }, info) => {
  const reportDir = info.outputPath('events');
  const visual = startVisualObservations(page, info, { enabled: true, reportDir });
  try {
    await fixtures(page, `<img id="missing" width="76" height="76" src="${base}/missing.png?private=must-not-appear">`);
    const thrown = page.waitForEvent('pageerror');
    await page.evaluate(() => { console.error('fixture https://vg-selftest.invalid/problem?private=must-not-appear');
      setTimeout(() => { throw new Error('planted error'); }, 0); });
    await thrown;
    await visual.shot({ path: path.join(reportDir, 'events.png') });
  } finally { await visual.finish(); }
  const result = JSON.parse(await fs.readFile(path.join(reportDir, 'visual-observations.json'), 'utf8')) as Report;
  for (const kind of ['console-error', 'pageerror', 'http']) expect(result.events.some(event => event.kind === kind && event.fingerprint.length > 0)).toBe(true);
  expect(JSON.stringify(result)).not.toContain('must-not-appear');
  expect(result.events.some(event => event.status === 404 && event.path === '/missing.png')).toBe(true);
});
test('i: a current allowance retains the phone finding as suppressed', async ({ page }, info) => {
  const result = await capture(page, info, small, { allowlist: [allowance('2099-12-31')] });
  expect(byCheck(result, 'touch-size')).toEqual([expect.objectContaining({ suppressedBy: 'small-fixture' })]);
  expect(result.allowlist[0].state).toBe('matched');
});
test('i: an expired allowance leaves the finding unsuppressed', async ({ page }, info) => {
  const result = await capture(page, info, small, { allowlist: [allowance('2020-01-01')] });
  expect(byCheck(result, 'touch-size')[0].suppressedBy).toBeNull(); expect(result.allowlist[0].state).toBe('expired');
});
test('j: disabled captures a screenshot without any observation artifact', async ({ page }, info) => {
  const reportDir = info.outputPath('absent');
  const visual = startVisualObservations(page, info, { enabled: false, reportDir });
  await fixtures(page, small);
  const screenshot = info.outputPath('disabled.png');
  await visual.shot({ path: screenshot }); await visual.finish();
  expect((await fs.stat(screenshot)).size).toBeGreaterThan(0);
  await expect(fs.stat(reportDir)).rejects.toMatchObject({ code: 'ENOENT' });
});
test('k: an invalid expectations file produces partial coverage while the test passes', async ({ page }, info) => {
  const invalid = info.outputPath('invalid-expectations.json'); await fs.writeFile(invalid, '{broken');
  const result = await capture(page, info, '<p>Quiet content</p>', { expectations: invalid });
  expect(result.status).toBe('partial'); expect(result.errors).toContain('Invalid visual expectations file or entries');
  expect(result.shots[0].status).toBe('partial');
});
test('l: concurrent independent worker identities merge their shards into one report', async ({ page }, info) => {
  const second = await page.context().newPage(), reportDir = info.outputPath('merged');
  try {
    await Promise.all([page, second].map(async (workerPage, index) => {
      const workerInfo = { testId: `${info.testId}-worker-${index}`, titlePath: info.titlePath,
        project: info.project, retry: info.retry } as TestInfo;
      const visual = startVisualObservations(workerPage, workerInfo, { enabled: true, reportDir, meta: { runId: 'concurrent-selftest' } });
      try {
        await fixtures(workerPage, small);
        await visual.shot({ path: path.join(reportDir, `worker-${index}.png`) });
      } finally { await visual.finish(); }
    }));
    const result = JSON.parse(await fs.readFile(path.join(reportDir, 'visual-observations.json'), 'utf8')) as Report;
    expect(result.shots).toHaveLength(2); expect(new Set(result.shots.map(shot => shot.pageId)).size).toBe(2);
    expect(byCheck(result, 'touch-size')).toHaveLength(2); expect(await fs.readdir(path.join(reportDir, 'shards'))).toHaveLength(2);
  } finally { await second.close(); }
});

test('m: viewport and full-page clips observe only their captured controls after scrolling', async ({ page }, info) => {
  const reportDir = info.outputPath('clips');
  const visual = startVisualObservations(page, info, { enabled: true, reportDir });
  try {
    await fixtures(page, '<style>body{height:2000px}button{position:absolute;width:30px;height:30px;padding:0}</style><button id="outside" style="top:100px">+</button><button id="inside" style="top:900px">+</button>');
    await page.evaluate(() => scrollTo(0, 500));
    await visual.shot({ path: path.join(reportDir, 'viewport.png'), name: 'viewport', clip: { x: 0, y: 350, width: 200, height: 200 } });
    await visual.shot({ path: path.join(reportDir, 'document.png'), name: 'document', fullPage: true,
      clip: { x: 0, y: 850, width: 200, height: 200 } });
  } finally { await visual.finish(); }
  const result = JSON.parse(await fs.readFile(path.join(reportDir, 'visual-observations.json'), 'utf8')) as Report;
  expect(result.shots).toHaveLength(2);
  expect(byCheck(result, 'touch-size')).toHaveLength(2);
  expect(byCheck(result, 'touch-size').every(finding => finding.selector === '#inside')).toBe(true);
});

test('n: full-page touch coverage reports the below-viewport control as not examined', async ({ page }, info) => {
  const reportDir = info.outputPath('full-page-touch');
  const visual = startVisualObservations(page, info, { enabled: true, reportDir });
  try {
    await fixtures(page, '<style>body{height:1400px}button{position:absolute;left:100px;width:30px;height:30px;padding:0}</style><button id="upper" style="top:100px">+</button><button id="lower" style="top:1000px">+</button>');
    await visual.shot({ path: path.join(reportDir, 'full-page.png'), fullPage: true });
  } finally { await visual.finish(); }
  const result = JSON.parse(await fs.readFile(path.join(reportDir, 'visual-observations.json'), 'utf8')) as Report;
  expect(result.status).toBe('partial'); expect(result.shots[0].status).toBe('partial');
  expect(result.shots[0].coverage.find(item => item.check === 'touch-size')).toMatchObject({
    status: 'partial', examined: 1, excluded: 1,
    reason: expect.stringContaining('1 captured touch targets not examined'),
  });
  expect(byCheck(result, 'touch-size').map(finding => finding.selector)).toEqual(['#upper']);
});
