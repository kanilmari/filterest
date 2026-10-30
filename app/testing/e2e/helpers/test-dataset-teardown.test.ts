// test-dataset-teardown.test.ts
// Proves reservation, identity capture, test isolation and failure-safe teardown.
// Replaces API/ownership boundaries with mocks; no server, browser or credentials.
import { afterEach, expect, test, vi } from 'vitest';
import type { APIRequestContext, TestInfo } from '@playwright/test';
import { createTestDatasetRegistry, freshAdminRequest, testDatasetTeardown } from './test-dataset-teardown';
import { cleanupDatasetViaRequest } from './temp-dataset';
import { readDatasetTableUIDFromRequest } from './test-artifact-dataset-identity-reader';
import { listRegisteredTestArtifacts, requireConfirmedTestArtifact, unregisterTestArtifact } from './test-artifact-run-registry';

vi.mock('./temp-dataset', () => ({ cleanupDatasetViaRequest: vi.fn() }));
vi.mock('./test-artifact-dataset-identity-reader', () => ({ readDatasetTableUIDFromRequest: vi.fn() }));
vi.mock('./test-artifact-run-registry', () => ({ listRegisteredTestArtifacts: vi.fn(),
  requireConfirmedTestArtifact: vi.fn(), unregisterTestArtifact: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

test('reserve → record → drain retains exact creation identity and drains once', async () => {
  const registry = createTestDatasetRegistry(), remove = vi.fn();
  registry.reserve('A', 'owned_a'); registry.record('A', 'owned_a', 17);
  await registry.drain('A', remove); await registry.drain('A', remove);
  expect(remove).toHaveBeenCalledExactlyOnceWith({ name: 'owned_a', serverId: 17 });
  expect(registry.has('A')).toBe(false);
});

test('test IDs isolate serial siblings, including an interrupted create with name only', async () => {
  const registry = createTestDatasetRegistry(), remove = vi.fn();
  registry.reserve('A', 'owned_a'); registry.reserve('B', 'owned_b'); registry.record('B', 'owned_b', 18);
  await registry.drain('A', remove);
  expect(remove).toHaveBeenCalledExactlyOnceWith({ name: 'owned_a' });
  expect(registry.has('B')).toBe(true);
  await registry.drain('B', remove);
  expect(remove).toHaveBeenLastCalledWith({ name: 'owned_b', serverId: 18 });
});

test('rejects conflicting names/identities and records only reserved ownership', () => {
  const registry = createTestDatasetRegistry(); registry.reserve('A', 'owned_a');
  expect(() => registry.reserve('B', 'owned_a')).toThrow('already reserved');
  expect(() => registry.record('B', 'owned_a', 17)).toThrow('Invalid dataset ownership');
  expect(() => registry.record('A', 'owned_a', 0)).toThrow('Invalid dataset ownership');
  registry.record('A', 'owned_a', 17);
  expect(() => registry.record('A', 'owned_a', 18)).toThrow('identity changed');
});

test('failed removal retains its reservation, attempts others and can be retried', async () => {
  const registry = createTestDatasetRegistry(); registry.reserve('A', 'first'); registry.reserve('A', 'second');
  const remove = vi.fn().mockRejectedValueOnce(new Error('drop failed')).mockResolvedValue(undefined);
  await expect(registry.drain('A', remove)).rejects.toBeInstanceOf(AggregateError);
  expect(remove).toHaveBeenCalledTimes(2); expect(registry.has('A')).toBe(true);
  await registry.drain('A', remove);
  expect(remove).toHaveBeenLastCalledWith({ name: 'first' }); expect(remove).toHaveBeenCalledTimes(3);
});

function harness(status: TestInfo['status'] = 'passed') {
  let hook!: Parameters<Parameters<typeof testDatasetTeardown>[0]['afterEach']>[0];
  const teardown = testDatasetTeardown({ afterEach: callback => { hook = callback; } });
  const request = { dispose: vi.fn() } as unknown as APIRequestContext;
  const playwright = { request: { newContext: vi.fn(async () => request) } };
  const use = { baseURL: 'https://runner.invalid:8181', storageState: '/tmp/project-admin-state.json',
    ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } };
  const info = { testId: 'A', timeout: 1_000, setTimeout: vi.fn(), status, expectedStatus: 'passed',
    errors: status === 'passed' ? [] : [{ message: 'original body failure', stack: 'body stack' }], project: { use } } as unknown as TestInfo;
  vi.mocked(listRegisteredTestArtifacts).mockReturnValue([{ kind: 'dataset', name: 'owned_a', serverId: 17,
    status: 'confirmed' }] as ReturnType<typeof listRegisteredTestArtifacts>);
  vi.mocked(requireConfirmedTestArtifact).mockReturnValue({ serverId: 17 } as ReturnType<typeof requireConfirmedTestArtifact>);
  vi.mocked(readDatasetTableUIDFromRequest).mockResolvedValue(17);
  return { teardown, request, playwright, info, use, run: () => hook({ playwright, baseURL: use.baseURL }, info) };
}

test.each(['passed', 'failed', 'timedOut'] as const)('own budget and fresh project session survive body status %s', async status => {
  const h = harness(status), restore = vi.fn(), finish = vi.fn();
  h.teardown.plan('A', [{ name: 'Home restore', run: restore }], [finish]);
  h.teardown.datasets.reserve('A', 'owned_a'); h.teardown.recordCreated('A', 'owned_a');
  await h.run();
  expect(h.info.setTimeout).toHaveBeenCalledWith(91_000);
  expect(h.playwright.request.newContext).toHaveBeenCalledExactlyOnceWith(h.use);
  expect(restore).toHaveBeenCalledExactlyOnceWith(h.request);
  expect(cleanupDatasetViaRequest).toHaveBeenCalledExactlyOnceWith(h.request, 'owned_a');
  expect(finish).toHaveBeenCalledOnce(); expect(h.request.dispose).toHaveBeenCalledOnce();
  await h.run(); expect(h.playwright.request.newContext).toHaveBeenCalledOnce();
});

test('half-completed creation recovers its confirmed durable identity', async () => {
  const h = harness('timedOut'); h.teardown.datasets.reserve('A', 'owned_a');
  await h.run();
  expect(requireConfirmedTestArtifact).toHaveBeenCalledWith('dataset', 'owned_a', 17);
  expect(cleanupDatasetViaRequest).toHaveBeenCalledWith(h.request, 'owned_a');
});

test('an absent dataset is a no-op, including after creation compensated and unregistered it', async () => {
  const h = harness(); h.teardown.datasets.reserve('A', 'owned_a');
  vi.mocked(listRegisteredTestArtifacts).mockReturnValue([]);
  vi.mocked(readDatasetTableUIDFromRequest).mockResolvedValue(null);
  await h.run();
  expect(cleanupDatasetViaRequest).not.toHaveBeenCalled(); expect(unregisterTestArtifact).not.toHaveBeenCalled();
});

test('an ambiguous planned creation cannot authorize deleting a live dataset', async () => {
  const h = harness(); h.teardown.datasets.reserve('A', 'owned_a');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.mocked(requireConfirmedTestArtifact).mockImplementation(() => { throw new Error('not confirmed'); });
  await expect(h.run()).rejects.toThrow('Body/teardown failed');
  expect(cleanupDatasetViaRequest).not.toHaveBeenCalled(); expect(h.request.dispose).toHaveBeenCalledOnce();
});

test.each(['failed', 'timedOut'] as const)('aggregate retains body and all step stacks; expected %s cannot hide cleanup failure', async expected => {
  const h = harness(expected); h.info.expectedStatus = expected;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const restoreError = new Error('restore failed'), dropError = new Error('drop failed');
  h.teardown.plan('A', [{ name: 'Home restore', run: async () => { throw restoreError; } }]);
  h.teardown.datasets.reserve('A', 'owned_a');
  vi.mocked(cleanupDatasetViaRequest).mockRejectedValue(dropError);
  let failure: AggregateError | undefined;
  try { await h.run(); } catch (error) { failure = error as AggregateError; }
  expect(failure).toBeInstanceOf(AggregateError); expect(failure!.errors).toHaveLength(3);
  expect(failure!.errors[0].stack).toBe('body stack');
  expect(log.mock.calls.flat().join('\n')).toContain(restoreError.stack);
  expect(log.mock.calls.flat().join('\n')).toContain(dropError.stack);
  expect(h.info.expectedStatus).toBe('passed'); expect(h.request.dispose).toHaveBeenCalledOnce();
});

test('fresh-context failure still finalizes resources and reports the error', async () => {
  const h = harness('timedOut'), finish = vi.fn();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.teardown.plan('A', [], [finish]);
  h.playwright.request.newContext.mockRejectedValue(new Error('context unavailable'));
  await expect(h.run()).rejects.toThrow('Body/teardown failed');
  expect(finish).toHaveBeenCalledOnce(); expect(h.request.dispose).not.toHaveBeenCalled();
});

test('fresh request uses the configured admin storage path and project request options', async () => {
  const h = harness(); await freshAdminRequest(h.playwright, h.info);
  expect(h.playwright.request.newContext).toHaveBeenCalledExactlyOnceWith(h.use);
});
