// s4w-readiness-summary.test.ts
// Checks nightly readiness statistics against a hand-calculated sample.
// Connects actual concurrent JSONL appends, multiple input files and the Node CLI.
// Keeps worker-safe recording and percentile semantics reviewable without a browser.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { appendReadinessRecord, type ReadinessRecord } from './s4w-readiness-report';
import { formatReadinessSummary, readReadinessFiles, runReadinessSummary, summarizeReadiness } from './s4w-readiness-summary.mjs';

vi.mock('@playwright/test', () => ({ test: { info: () => { throw new Error('No running test'); } } }));

const temporaryDirectories: string[] = [];
async function directory() {
  const root = await mkdtemp(join(tmpdir(), 'filterest-s4w-'));
  temporaryDirectories.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

function sample(helper: 'login' | 'waitForDataLoaded' = 'login'): ReadinessRecord[] {
  return [0, 0, 50, 100, 150, 200, 400, null].map(msToTrue => ({
    helper, conditionId: helper === 'login' ? 'shell-ready-revealed-v1' : 'candidate-selected-results-committed-v1',
    trueAtStart: msToTrue === 0, msToTrue, fixedWaitMs: 500,
    specFile: 'sample.spec.ts', testTitle: 'sample', workerIndex: 0,
    probeErrors: 0, probeIncomplete: false,
  }));
}

const expectedOutput = 'helper\tconditionId\tcalls\ttrueAtStart%\tp50MsToTrue\tp90MsToTrue\tmaxMsToTrue\tneverTrue%\n'
  + 'login\tshell-ready-revealed-v1\t8\t25.00\t100\t400\t400\t12.50\n'
  + 'waitForDataLoaded\tcandidate-selected-results-committed-v1\t8\t25.00\t100\t400\t400\t12.50\n';

test('matches nearest-rank p50/p90/max and includes nulls only in call/miss counts', () => {
  const groups = summarizeReadiness([...sample(), ...sample('waitForDataLoaded')]);
  expect(groups[0]).toEqual({
    helper: 'login', conditionId: 'shell-ready-revealed-v1', calls: 8, trueAtStartPct: 25,
    p50MsToTrue: 100, p90MsToTrue: 400, maxMsToTrue: 400, neverTruePct: 12.5,
  });
  expect(formatReadinessSummary(groups)).toBe(expectedOutput);
});

test('keeps different conditions separate and reports missing quantiles for all-null groups', () => {
  const records = sample();
  records.push({ ...records[0], conditionId: 'other-candidate', trueAtStart: false, msToTrue: null, probeErrors: 1 });
  const groups = summarizeReadiness(records);
  expect(groups).toHaveLength(2);
  expect(groups.find(group => group.conditionId === 'other-candidate')).toMatchObject({
    calls: 1, trueAtStartPct: 0, neverTruePct: 100,
    p50MsToTrue: null, p90MsToTrue: null, maxMsToTrue: null,
  });
  expect(formatReadinessSummary(groups)).toContain('other-candidate\t1\t0.00\t-\t-\t-\t100.00');
  expect(summarizeReadiness([])).toEqual([]);
});

test('concurrent appends preserve complete individual lines and all worker indexes', async () => {
  const root = await directory();
  const records = Array.from({ length: 64 }, (_, workerIndex) => ({ ...sample()[workerIndex % 8], workerIndex }));
  await Promise.all(records.map(record => appendReadinessRecord(root, record)));
  const filename = join(root, 's4w_readiness.jsonl');
  const contents = await readFile(filename, 'utf8');
  expect(contents.endsWith('\n')).toBe(true);
  expect(contents.trim().split('\n')).toHaveLength(64);
  const read = readReadinessFiles([filename]);
  expect(read.sort((a, b) => a.workerIndex - b.workerIndex)).toEqual(records);
});

test('CLI merges multiple real files and prints exactly the hand-calculated sample', async () => {
  const root = await directory();
  const files = [join(root, 'one.jsonl'), join(root, 'two.jsonl')];
  await writeFile(files[0], sample().map(record => JSON.stringify(record)).join('\n') + '\n\n');
  await writeFile(files[1], sample('waitForDataLoaded').map(record => JSON.stringify(record)).join('\n') + '\n');
  const output = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
  expect(runReadinessSummary(files, output)).toBe(0);
  expect(output.stderr.write).not.toHaveBeenCalled();
  expect(output.stdout.write).toHaveBeenCalledExactlyOnceWith(expectedOutput);
});

test.each([{}, { msToTrue: -1 }, { msToTrue: 501 }, { msToTrue: null, trueAtStart: true }, { fixedWaitMs: 0 }])(
  'refuses invalid statistics input: %j', overrides => {
    const record = Object.keys(overrides).length ? { ...sample()[0], ...overrides } : {};
    expect(() => summarizeReadiness([record])).toThrow('Invalid readiness record');
  },
);

test('CLI reports malformed or absent input as failure without echoing record contents', async () => {
  const root = await directory();
  const filename = join(root, 'bad.jsonl');
  await writeFile(filename, 'private-canary-invalid-json');
  for (const args of [[], [filename], [join(root, 'missing.jsonl')]]) {
    const output = { stdout: { write: vi.fn() }, stderr: { write: vi.fn() } };
    expect(runReadinessSummary(args, output)).toBe(1);
    expect(output.stdout.write).not.toHaveBeenCalled();
    expect(output.stderr.write).toHaveBeenCalledExactlyOnceWith(
      'Readiness summary failed: supply readable files containing valid readiness JSONL.\n',
    );
  }
});
