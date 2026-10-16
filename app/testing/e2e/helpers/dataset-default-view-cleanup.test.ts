// dataset-default-view-cleanup.test.ts
// Exercises E18's actual teardown after interrupted setup and a crashed page.
// Replaces Playwright's runner and transport with account-scoped request doubles.
// Protects exact theme restoration, registered dataset/grant cleanup and failure isolation.
// @vitest-environment node
import { beforeEach, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  bodies: [] as Array<(fixtures: unknown, info: unknown) => Promise<void>>,
  teardown: undefined as ((fixtures: unknown) => Promise<void>) | undefined,
  setTimeout: vi.fn(), create: vi.fn(), open: vi.fn(), drop: vi.fn(), artifacts: vi.fn(),
}));
vi.mock('@playwright/test', () => ({
  expect: (value: unknown) => expect(value),
  test: Object.assign((_title: string, body: (fixtures: unknown, info: unknown) => Promise<void>) => fake.bodies.push(body), {
    describe: { configure: vi.fn() },
    afterEach: (hook: (fixtures: unknown) => Promise<void>) => { fake.teardown = hook; },
    setTimeout: fake.setTimeout,
  }),
}));
vi.mock('./auth', () => ({
  login: vi.fn(), loadCredentials: vi.fn(), loadUserCredentials: vi.fn(),
  readSessionInfo: async (page: { id: number }) => ({ user_id: page.id }),
}));
vi.mock('./navigation', () => ({ waitForAppReady: vi.fn() }));
vi.mock('./filterbar', () => ({ revealActiveFilterbarSection: vi.fn() }));
vi.mock('./temp-dataset', () => ({
  buildTempDatasetName: () => 'owned_default_proof', createTempDataset: fake.create,
  openTempDataset: fake.open, cleanupDatasetViaRequest: fake.drop,
  fetchCsrfTokenForRequest: async () => 'test-csrf',
}));
vi.mock('./test-artifact-run-registry', () => ({ listRegisteredTestArtifacts: fake.artifacts }));
import '../E_search_filter/E18_dataset_default_view.spec';

const savedDefault = { default_view_id: 3, default_view_name: 'table' };
const interrupted = new Error('test timed out or page crashed');
const response = (value: unknown) => ({ ok: () => true, text: async () => '', json: async () => value });

function fixture() {
  let crashed = false;
  const accounts = [
    { theme_mode: 'dark', configured: true, revision: 12 },
    { theme_mode: 'system', configured: false, revision: 0 },
  ].map(original => ({
    get: vi.fn(async (path: string) => response(path.includes('dataset-default-view') ? savedDefault : original)),
    post: vi.fn(async () => response(savedDefault)),
    patch: vi.fn(async (_path: string, options: { data: { theme_mode: string } }) =>
      response({ theme_mode: options.data.theme_mode, configured: true, revision: 99 })),
    delete: vi.fn(async () => response({ theme_mode: 'system', configured: false, revision: 0 })),
    dispose: vi.fn(),
  }));
  const pages = accounts.map((account, index) => ({
    id: index + 42,
    get request() { if (crashed) throw new Error('page request disposed'); return account; },
    url: () => { if (crashed) throw new Error('chrome-error:'); return 'https://proof.invalid/'; },
    context: () => ({ storageState: async () => ({ cookies: [], origins: [] }) }),
    viewportSize: () => ({ width: 375, height: 667 }), emulateMedia: vi.fn(),
    isClosed: () => false, close: vi.fn(),
  }));
  const secondContext = { newPage: async () => pages[1], close: vi.fn() };
  const newContext = vi.fn().mockResolvedValueOnce(accounts[0]).mockResolvedValueOnce(accounts[1]);
  return {
    accounts, pages, secondContext, newContext,
    crash: () => { crashed = true; },
    fixtures: { page: pages[0], browser: { newContext: async () => secondContext }, playwright: { request: { newContext } } },
    info: { project: { use: { baseURL: 'https://proof.invalid', extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } } } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.create.mockResolvedValue(undefined);
  fake.open.mockRejectedValue(interrupted);
  fake.drop.mockResolvedValue(undefined);
  fake.artifacts.mockReturnValue([{ kind: 'dataset', name: 'owned_default_proof', status: 'confirmed' }]);
});

for (const phase of ['after default snapshot', 'during registered dataset creation']) {
  test(`afterEach restores both accounts and drops the registered dataset when interrupted ${phase}`, async () => {
    const proof = fixture();
    if (phase === 'during registered dataset creation') fake.create.mockRejectedValueOnce(interrupted);
    await expect(fake.bodies[0](proof.fixtures, proof.info)).rejects.toBe(interrupted);
    proof.crash();
    await fake.teardown!({ page: proof.pages[0] });

    expect(fake.setTimeout).toHaveBeenCalledWith(180_000);
    expect(proof.newContext).toHaveBeenCalledTimes(2);
    for (const [options] of proof.newContext.mock.calls) {
      expect(options.baseURL).toBe('https://proof.invalid');
      expect(options.extraHTTPHeaders).toEqual({ 'X-Bypass-Ratelimit': 'test-mode' });
    }
    expect(proof.accounts[0].patch).toHaveBeenLastCalledWith('/api/user-visual-preference', {
      headers: { 'X-CSRF-Token': 'test-csrf' }, data: { theme_mode: 'dark' },
    });
    expect(proof.accounts[1].delete).toHaveBeenCalledWith('/api/user-visual-preference', {
      headers: { 'X-CSRF-Token': 'test-csrf' },
    });
    if (phase === 'after default snapshot') {
      expect(proof.accounts[0].post).toHaveBeenCalledWith('/api/admin/dataset-default-view', {
        headers: { 'X-CSRF-Token': 'test-csrf' }, data: { dataset: 'owned_default_proof', view_key: 'table' },
      });
    } else expect(proof.accounts[0].post).not.toHaveBeenCalled();
    expect(fake.drop).toHaveBeenCalledWith(proof.accounts[0], 'owned_default_proof');
    for (const account of proof.accounts) expect(account.dispose).toHaveBeenCalledOnce();
    expect(proof.secondContext.close).toHaveBeenCalledOnce();
  });
}

test('a failed default restore still restores both themes, drops the dataset/grants and disposes contexts', async () => {
  const proof = fixture();
  await expect(fake.bodies[0](proof.fixtures, proof.info)).rejects.toBe(interrupted);
  proof.crash();
  proof.accounts[0].post.mockRejectedValueOnce(new Error('restore failed'));
  await expect(fake.teardown!({ page: proof.pages[0] })).rejects.toThrow('Default-view proof cleanup failed');
  expect(proof.accounts[0].patch).toHaveBeenCalledTimes(2);
  expect(proof.accounts[1].delete).toHaveBeenCalledOnce();
  expect(fake.drop).toHaveBeenCalledWith(proof.accounts[0], 'owned_default_proof');
  for (const account of proof.accounts) expect(account.dispose).toHaveBeenCalledOnce();
});

test('already compensated creation does not authorize another drop', async () => {
  const proof = fixture();
  fake.create.mockRejectedValueOnce(interrupted);
  await expect(fake.bodies[0](proof.fixtures, proof.info)).rejects.toBe(interrupted);
  fake.artifacts.mockReturnValue([]);
  proof.crash();
  await fake.teardown!({ page: proof.pages[0] });
  expect(fake.drop).not.toHaveBeenCalled();
  expect(proof.accounts[1].delete).toHaveBeenCalledOnce();
});
