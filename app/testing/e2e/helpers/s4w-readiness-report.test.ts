// s4w-readiness-report.test.ts
// Exercises reporting through the actual login and dataset helper pauses.
// Connects fake pages/timers, safe test metadata and a single-write JSONL sink.
// Proves readiness, transport and reporting failures cannot shorten or extend waits.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { login } from './auth';
import { waitForDataLoaded } from './navigation';
import { readReadinessCondition, type ReadinessRecord } from './s4w-readiness-report';

const sink = vi.hoisted(() => ({
  writes: [] as { line: string; filename: string }[],
  noTestInfo: false, failStorage: false,
}));
vi.mock('@playwright/test', () => ({
  expect: vi.fn(),
  test: { info: () => {
    if (sink.noTestInfo) throw new Error('Outside test');
    return { config: { rootDir: '/suite' }, file: '/suite/example.spec.ts', title: 'report test', workerIndex: 3 };
  } },
}));
vi.mock('node:fs/promises', () => {
  const filesystem = {
  mkdir: vi.fn(async () => { if (sink.failStorage) throw new Error('Storage unavailable'); }),
  open: vi.fn(async (filename: string, flag: string) => {
    expect(flag).toBe('a');
    return {
      write: async (line: string) => { sink.writes.push({ line, filename }); },
      close: async () => {},
    };
  }),
  };
  return { ...filesystem, default: filesystem };
});
vi.mock('./auth_identity', () => ({ readVerifiedTestIdentity: () => 42, writeVerifiedTestIdentity: vi.fn() }));
vi.mock('../../../server_tools/lib/browser_test_credentials.mjs', () => ({
  loadBrowserTestCredentials: vi.fn(), resolveBrowserTestCredentialFilePath: vi.fn(),
  resolveBrowserTestOtpCode: vi.fn(), writeBrowserTestCredentialsFile: vi.fn(),
}));

type Scenario = number | 'never' | 'throw' | 'reject' | 'hang';
function fakePage(scenario: Scenario, waitError?: Error) {
  const started = performance.now();
  const sampleTimes: number[] = [];
  const page = {
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    url: () => 'https://example.invalid/',
    request: { get: vi.fn(async () => ({
      ok: () => true, headers: () => ({ 'content-type': 'application/json' }),
      json: async () => ({ user_id: 42 }),
    })) },
    evaluate: vi.fn(() => {
      sampleTimes.push(performance.now() - started);
      if (scenario === 'throw') throw new Error('private-page-text-must-not-be-recorded');
      if (scenario === 'reject') return Promise.reject(new Error('private-page-text-must-not-be-recorded'));
      if (scenario === 'hang') return new Promise(() => {});
      return Promise.resolve(typeof scenario === 'number' && performance.now() - started >= scenario);
    }),
    waitForTimeout: vi.fn((ms: number) => new Promise<void>((resolve, reject) => {
      setTimeout(() => { if (waitError) reject(waitError); else resolve(); }, ms);
    })),
  };
  return { page: page as unknown as Page, sampleTimes, request: page.request, evaluate: page.evaluate };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
  sink.writes.length = 0; sink.noTestInfo = false; sink.failStorage = false;
  vi.stubEnv('E2E_LOGDIR', '/tmp/s4w-report-output');
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  document.body.replaceChildren();
  delete (window as unknown as { __filterestShellBoot?: unknown }).__filterestShellBoot;
});

const helpers = {
  login: (page: Page) => login(page, { username: 'synthetic-name', password: 'synthetic-pass' }),
  waitForDataLoaded: (page: Page) => waitForDataLoaded(page, 'demo'),
};

for (const [helper, run] of Object.entries(helpers)) {
  test.each([0, 100, 'never', 'throw', 'reject', 'hang'] as Scenario[])(
    `${helper}: records %s while keeping the whole 500 ms pause`, async scenario => {
      const { page, sampleTimes, request, evaluate } = fakePage(scenario);
      let finished = false;
      const result = run(page).then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(499);
      expect(finished).toBe(false);
      expect(request.get).not.toHaveBeenCalled();
      expect(sink.writes).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(finished).toBe(true);
      expect(performance.now()).toBe(500);
      expect(page.waitForTimeout).toHaveBeenCalledExactlyOnceWith(500);
      expect(sink.writes).toHaveLength(1);
      expect(sink.writes[0].filename).toBe('/tmp/s4w-report-output/s4w_readiness.jsonl');
      const record: ReadinessRecord = JSON.parse(sink.writes[0].line);
      expect(record).toEqual({
        helper, conditionId: helper === 'login' ? 'shell-ready-revealed-v1' : 'candidate-selected-results-committed-v1',
        trueAtStart: scenario === 0, msToTrue: typeof scenario === 'number' ? scenario : null,
        fixedWaitMs: 500, specFile: 'example.spec.ts', testTitle: 'report test',
        workerIndex: 3,
        probeErrors: ['throw', 'reject'].includes(String(scenario)) ? 20 : 0,
        probeIncomplete: scenario === 'hang',
      });
      expect(sink.writes[0].line.split('\n')).toHaveLength(2);
      expect(sink.writes[0].line).not.toMatch(/private-page-text|synthetic-name|synthetic-pass|https:/);
      expect(sampleTimes[0]).toBe(0);
      expect(sampleTimes.every(time => time < 500)).toBe(true);
      expect(sampleTimes.every((time, index) => index === 0 || time - sampleTimes[index - 1] <= 25)).toBe(true);
      if (scenario === 'hang') expect(sampleTimes).toHaveLength(20);
      const evaluations = evaluate.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1000);
      expect(page.evaluate).toHaveBeenCalledTimes(evaluations);
      expect(sink.writes).toHaveLength(1);
    },
  );

  test(`${helper}: preserves the original wait rejection`, async () => {
    const failure = new Error('Original wait failed');
    const { page } = fakePage('throw', failure);
    const result = run(page);
    const assertion = expect(result).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(sink.writes).toHaveLength(1);
  });

  test(`${helper}: reporting storage failure leaves completion unchanged`, async () => {
    sink.failStorage = true;
    const { page } = fakePage(0);
    const result = run(page);
    await vi.advanceTimersByTimeAsync(500);
    await expect(result).resolves.toBeUndefined();
    expect(performance.now()).toBe(500);
  });
}

test.each(['resolve', 'reject'])('late probe %s is ignored after the fixed wait has finished', async completion => {
  const { page, evaluate } = fakePage('hang');
  let resolveProbe!: (value: boolean) => void;
  let rejectProbe!: (reason: Error) => void;
  evaluate.mockImplementation(() => new Promise((resolve, reject) => { resolveProbe = resolve; rejectProbe = reject; }));
  const result = waitForDataLoaded(page);
  await vi.advanceTimersByTimeAsync(500); await result;
  const line = sink.writes[0].line;
  if (completion === 'resolve') resolveProbe(true);
  else rejectProbe(new Error('Late private error'));
  await vi.advanceTimersByTimeAsync(0);
  expect(sink.writes).toHaveLength(1);
  expect(sink.writes[0].line).toBe(line);
  expect(JSON.parse(line).msToTrue).toBeNull();
});

test('uses the results folder without E2E_LOGDIR and explicit null metadata outside a test', async () => {
  vi.stubEnv('E2E_LOGDIR', '');
  vi.stubEnv('FILTEREST_TEST_RUNTIME_ROOT', '/tmp/s4w-setup-output');
  let result = waitForDataLoaded(fakePage(0).page);
  await vi.advanceTimersByTimeAsync(500); await result;
  expect(sink.writes[0].filename).toBe('/tmp/s4w-setup-output/test-results/s4w_readiness.jsonl');
  sink.noTestInfo = true;
  result = waitForDataLoaded(fakePage(0).page);
  await vi.advanceTimersByTimeAsync(500); await result;
  expect(sink.writes[1].filename).toBe('/tmp/s4w-setup-output/test-results/s4w_readiness.jsonl');
  expect(JSON.parse(sink.writes[1].line)).toMatchObject({
    specFile: null, testTitle: null, workerIndex: null,
  });
});

test('reads shell ready AND reveal, never invokes the ready handshake', () => {
  const state = { ready: false, revealed: false };
  const handshake = vi.fn();
  (window as unknown as { __filterestShellBoot: unknown }).__filterestShellBoot = {
    status: () => state, ready: handshake,
  };
  expect(readReadinessCondition({ helper: 'login' })).toBe(false);
  state.revealed = true; // The fail-open reveal cap alone is not ready.
  expect(readReadinessCondition({ helper: 'login' })).toBe(false);
  state.ready = true;
  expect(readReadinessCondition({ helper: 'login' })).toBe(true);
  expect(handshake).not.toHaveBeenCalled();
});

test('candidate requires the selected, visible committed surface, including an empty result', () => {
  document.body.innerHTML = `<div id="old_tab_parts_container"><div class="scrollable_content">
    <div class="dataset-results-surface"></div></div></div>
    <div id="demo_tab_parts_container"><div class="scrollable_content"></div></div>`;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
  sessionStorage.setItem('selected_dataset', 'demo');
  const check = () => readReadinessCondition({ helper: 'waitForDataLoaded' });
  expect(check()).toBe(false); // Mounted containers/old datasets do not prove rendering.
  const container = document.querySelector<HTMLElement>('#demo_tab_parts_container .scrollable_content')!;
  container.innerHTML = '<div class="dataset-results-surface"></div>';
  expect(check()).toBe(true);
  container.style.display = 'none';
  expect(check()).toBe(false);
  expect(readReadinessCondition({ helper: 'waitForDataLoaded', tableName: 'missing' })).toBe(false);
});
