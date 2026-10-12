/**
 * test-artifact-recovery-setup.test.ts
 * Verifies fresh-login recovery wiring in Playwright global setup with fakes.
 * Bridges setup, shared auth files and the exclusive registry recovery entrypoint.
 * Prevents failed or rejected recovery from clearing another run's session.
 */
// @vitest-environment node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  root: '', mode: 'normal', events: [] as string[],
  request: { administratorSession: 'fresh' },
  close: vi.fn(), newContext: vi.fn(), recover: vi.fn(), finish: vi.fn(), target: vi.fn(),
  initializedTarget: null as unknown,
}));

vi.mock('./test-runtime-paths', () => ({ resolveFilterestTestRuntimePaths: () => ({
  authDirectory: fake.root, authStorageState: `${fake.root}/user.json`,
}) }));
vi.mock('./auth_identity', () => ({
  initializeTestIdentityKey: vi.fn(), clearVerifiedTestIdentities: vi.fn(), writeVerifiedTestIdentity: vi.fn(),
}));
vi.mock('./auth', () => ({
  loadCredentials: () => ({ username: 'private_test_login', password: 'fake_password' }),
  loadOtpCode: vi.fn(), openLoginEntry: vi.fn(), readSessionInfo: async () => ({ user_id: 4, username: 'public_test_admin' }),
  submitCredentialsAndWaitForOtp: async () => false, waitForAuthenticatedApp: async () => 4,
}));
vi.mock('@playwright/test', () => ({ chromium: { launch: async () => {
  fake.events.push('login');
  return { newContext: fake.newContext, close: fake.close };
} } }));
vi.mock('./tree-data-cache', () => ({ hydrateAuthenticatedTreeDataCache: vi.fn() }));
vi.mock('./test-artifact-cleanup', () => ({ readSyntheticArtifactBaselineWithStorageState: async () => {
  fake.events.push('baseline');
  return { runId: 'run-setup-new' };
} }));
vi.mock('./test-artifact-run-target', () => ({ readArtifactRunTarget: fake.target }));
vi.mock('./test-artifact-run-registry', () => ({ finishArtifactRunRegistry: fake.finish }));
vi.mock('./test-artifact-stale-run-recovery', () => ({
  initializeArtifactRunRegistryWithRecovery: async (_options: unknown, recover: (...args: unknown[]) => Promise<void>,
    readTarget?: () => Promise<unknown>) => {
    if (fake.mode === 'refuse') throw new Error('parallel Playwright runs are not allowed');
    fake.initializedTarget = await readTarget?.();
    if (['stale', 'failure', 'target-mismatch'].includes(fake.mode)) {
      await recover({ runId: 'run-setup-dead' }, [{ name: 'e2e_recorded' }], () => {});
    }
    fake.events.push('initialize');
    return { runId: 'run-setup-new' };
  },
  recoverStaleRunDatasets: fake.recover,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  fake.root = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-recovery-setup-'));
  fake.mode = 'normal';
  fake.events = [];
  fake.initializedTarget = null;
  fake.close.mockReset();
  fake.target.mockImplementation(async () => {
    fake.events.push('target');
    return { baseURL: 'https://fake.invalid', databaseId: 'a'.repeat(32) };
  });
  fs.writeFileSync(path.join(fake.root, 'user.json'), '{"old_session":true}');
  fs.writeFileSync(path.join(fake.root, 'artifact-baseline.json'), '{"old_baseline":true}');
  fake.newContext.mockResolvedValue({
    request: fake.request,
    storageState: async () => ({ cookies: [], origins: [] }),
    newPage: async () => ({ locator: () => ({ fill: async () => {}, isChecked: async () => true }) }),
  });
  fake.recover.mockImplementation(async () => {
    fake.events.push('recover');
    expect(fs.readFileSync(path.join(fake.root, 'user.json'), 'utf8')).toBe('{"old_session":true}');
    expect(fs.readFileSync(path.join(fake.root, 'artifact-baseline.json'), 'utf8')).toBe('{"old_baseline":true}');
    if (fake.mode === 'target-mismatch') throw new Error('E2E artifact run installation identity mismatch');
    if (fake.mode === 'failure') throw new Error('dataset e2e_recorded: drop failed');
  });
});
afterEach(() => fs.rmSync(fake.root, { recursive: true, force: true }));

async function setup() {
  const { default: globalSetup } = await import('../global-setup');
  await globalSetup({ projects: [{ use: { baseURL: 'https://fake.invalid' } }] } as unknown as FullConfig);
}

test('stale setup logs in once with a fresh administrator request, recovers, initializes and captures baseline', async () => {
  fake.mode = 'stale';
  await setup();
  expect(fake.events).toEqual(['login', 'target', 'recover', 'initialize', 'baseline']);
  expect(fake.recover).toHaveBeenCalledWith(fake.request,
    { userId: 4, username: 'public_test_admin', baseURL: 'https://fake.invalid' }, { runId: 'run-setup-dead' },
    [{ name: 'e2e_recorded' }], expect.any(Function));
  expect(fake.newContext).toHaveBeenCalledWith(expect.objectContaining({ baseURL: 'https://fake.invalid' }));
  expect(fake.close).toHaveBeenCalledOnce();
  expect(JSON.parse(fs.readFileSync(path.join(fake.root, 'artifact-baseline.json'), 'utf8')))
    .toEqual({ runId: 'run-setup-new' });
});

test('normal setup binds its descriptor before publishing and reuses a single login', async () => {
  await setup();
  expect(fake.events).toEqual(['login', 'target', 'initialize', 'baseline']);
  expect(fake.recover).not.toHaveBeenCalled();
  expect(fake.initializedTarget).toEqual({ baseURL: 'https://fake.invalid', databaseId: 'a'.repeat(32) });
  expect(fake.target).toHaveBeenCalledWith(fake.request, 'https://fake.invalid');
  expect(fake.close).toHaveBeenCalledOnce();
});

test.each(['failure', 'target-mismatch'])('refused recovery preserves auth and baseline files: %s', async (mode) => {
  fake.mode = mode;
  await expect(setup()).rejects.toThrow(mode === 'failure' ? /e2e_recorded: drop failed/ : /installation identity mismatch/);
  expect(fake.events).toEqual(['login', 'target', 'recover']);
  expect(fake.close).toHaveBeenCalledOnce();
  expect(fake.finish).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(fake.root, 'user.json'), 'utf8')).toBe('{"old_session":true}');
  expect(fs.readFileSync(path.join(fake.root, 'artifact-baseline.json'), 'utf8')).toBe('{"old_baseline":true}');
});

test('live-run rejection performs no login, recovery, shared-file removal or finish', async () => {
  fake.mode = 'refuse';
  await expect(setup()).rejects.toThrow(/parallel Playwright/);
  expect(fake.events).toEqual([]);
  expect(fake.recover).not.toHaveBeenCalled();
  expect(fake.finish).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(fake.root, 'user.json'), 'utf8')).toBe('{"old_session":true}');
});

test('browser-close transport failure after refused recovery cannot expose secrets', async () => {
  fake.mode = 'failure';
  const marker = 'SYNTHETIC_COOKIE_CSRF_PRIVATE_CLOSE_929';
  fake.close.mockRejectedValueOnce(new Error(marker, { cause: new Error(marker) }));
  const failure = await setup().catch(error => error);
  expect(failure.message).toBe('dataset e2e_recorded: drop failed');
  expect(failure.cause).toBeUndefined();
  expect(failure.stack + JSON.stringify(failure)).not.toContain(marker);
  expect(fake.finish).not.toHaveBeenCalled();
  expect(fs.readFileSync(path.join(fake.root, 'user.json'), 'utf8')).toBe('{"old_session":true}');
  expect(fs.readFileSync(path.join(fake.root, 'artifact-baseline.json'), 'utf8')).toBe('{"old_baseline":true}');
});

test('browser-close transport failure after successful setup uses a fixed diagnostic', async () => {
  const marker = 'SYNTHETIC_COOKIE_CSRF_PRIVATE_CLOSE_929';
  fake.close.mockRejectedValueOnce(new Error(marker, { cause: new Error(marker) }));
  const failure = await setup().catch(error => error);
  expect(failure.message).toBe('operation=close E2E setup browser serverId=unknown reason=operation failed');
  expect(failure.cause).toBeUndefined();
  expect(failure.stack + JSON.stringify(failure)).not.toContain(marker);
});
