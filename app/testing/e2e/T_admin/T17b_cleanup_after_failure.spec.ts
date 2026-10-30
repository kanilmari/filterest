// T17b_cleanup_after_failure.spec.ts
// Manual, off-8082 proof of T17's exact registry/teardown after failure and timeout.
// Creates disposable datasets only; Home settings are read and NEVER restored/written.
// The Stylist selects an agreed native target through playwright.failure-proof.config.ts.
import { expect, test, type APIRequestContext } from '@playwright/test';
import { resolveLocalFilterestBaseUrl } from '../../../server_tools/scripts/local_filterest_target.cjs';
import { buildTempDatasetName, createTempDataset } from '../helpers/temp-dataset';
import { readDatasetTableUIDFromRequest } from '../helpers/test-artifact-dataset-identity-reader';
import { freshAdminRequest, testDatasetTeardown } from '../helpers/test-dataset-teardown';
import { snapshotHomeSettings, type HomeSettingsSnapshot } from '../helpers/home-settings';
import { waitForAppReady } from '../helpers/navigation';

const target = process.env.FILTEREST_E2E_FAILURE_PROOF_TARGET;
const resolvedBaseURL = resolveLocalFilterestBaseUrl({ applicationRoot: `${__dirname}/../../..` });
function guard(baseURL: string | undefined) {
  if (baseURL && new URL(baseURL).port === '8082') {
    throw new Error('T17b refuses port 8082: deliberate failures must never run against the owner’s instance.');
  }
  if (!target || target !== baseURL) {
    throw new Error('T17b requires FILTEREST_E2E_FAILURE_PROOF_TARGET to equal the resolved baseURL exactly.');
  }
}
// Collection-time refusal precedes even global setup. Unset means all cases skip.
if (target) guard(resolvedBaseURL);
test.skip(!target, 'Manual only: set FILTEREST_E2E_FAILURE_PROOF_TARGET to the agreed off-8082 baseURL.');
test.describe.configure({ mode: 'serial', retries: 0 });
const teardown = testDatasetTeardown(test);
const created: Array<{ name: string; serverId: number }> = [];
let originalHome: HomeSettingsSnapshot | undefined;

test.beforeAll(async ({ playwright, baseURL }, info) => {
  guard(baseURL); // Also refuse a project's baseURL override before any request.
  expect(info.project.name).toBe('desktop-card');
  const request = await freshAdminRequest(playwright, info, baseURL);
  try { originalHome = await snapshotHomeSettings(request, 'T17b read-only parity proof'); }
  finally { await request.dispose(); }
});
test.afterAll(() => { originalHome?.releaseWriter(); });

async function read(request: APIRequestContext, url: string) {
  const response = await request.get(url);
  expect(response.ok(), `T17b snapshot read failed: ${url}`).toBe(true);
  return response.json();
}

for (const kind of ['throw', 'timeout'] as const) {
  test(`cleanup survives a deliberate body ${kind}`, async ({ page }, info) => {
    await page.goto('/system_config', { waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    const name = buildTempDatasetName(`e2e_t17b_${kind}`);
    teardown.datasets.reserve(info.testId, name);
    await createTempDataset(page, { datasetName: name, columns: { id: 'SERIAL' } });
    teardown.recordCreated(info.testId, name);
    const serverId = await readDatasetTableUIDFromRequest(page.request, name);
    expect(serverId).not.toBeNull();
    created.push({ name, serverId: serverId! });
    // Mark only AFTER setup succeeds: setup/creation errors must fail the proof.
    test.fail();
    if (kind === 'throw') throw new Error('T17b deliberate body failure after confirmed creation');
    // Playwright distinguishes timedOut from failed. Expect the real timeout so
    // the serial final proof runs; teardown errors reset this expectation to pass.
    info.expectedStatus = 'timedOut';
    test.setTimeout(1_000);
    await new Promise<void>(() => {}); // No surviving timer/process after interruption.
  });
}

test('neither dataset survives and the complete Home snapshot is unchanged', async ({ playwright, baseURL }, info) => {
  guard(baseURL);
  expect(created).toHaveLength(2);
  expect(originalHome).toBeDefined();
  const request = await freshAdminRequest(playwright, info, baseURL);
  try {
    for (const { name, serverId } of created) expect(await readDatasetTableUIDFromRequest(request, name, serverId)).toBeNull();
    // READ ONLY, including original absence and revisions. No compensating Home writes.
    expect(await read(request, '/api/admin/front-page')).toEqual(originalHome!.home);
    expect(await read(request, '/api/admin/front-page/article-buttons')).toEqual(originalHome!.articles);
    await originalHome!.verify(request);
  } finally { await request.dispose(); }
});
