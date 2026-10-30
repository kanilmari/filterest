// test-dataset-teardown.ts
// Owns per-test dataset reservations and teardown after body failures/timeouts.
// Connects exact run ownership to fresh authenticated request contexts.
// Keeps API cleanup independent of page lifetime and reports every failed step.
import type { APIRequestContext, TestInfo } from '@playwright/test';
import { cleanupDatasetViaRequest } from './temp-dataset';
import { readDatasetTableUIDFromRequest } from './test-artifact-dataset-identity-reader';
import { listRegisteredTestArtifacts, requireConfirmedTestArtifact, unregisterTestArtifact } from './test-artifact-run-registry';
import { resolveFilterestTestRuntimePaths } from './test-runtime-paths';

type OwnedDataset = { name: string; serverId?: number };
type RequestProvider = Pick<typeof import('@playwright/test'), 'request'>;
type CleanupStep = { name: string; run: (request: APIRequestContext) => Promise<unknown> };

export function printCleanupError(step: string, error: unknown): void {
  console.error(`${step}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  if (error instanceof AggregateError) error.errors.forEach((inner, index) => printCleanupError(`${step} / ${index + 1}`, inner));
  else if (error instanceof Error && error.cause) printCleanupError(`${step} / cause`, error.cause);
}

/** Reservations survive failed/half-completed creates; drain never touches siblings. */
export function createTestDatasetRegistry() {
  const tests = new Map<string, Map<string, OwnedDataset>>();
  return {
    reserve(testId: string, name: string) {
      if ([...tests.values()].some(entries => entries.has(name))) throw new Error(`Dataset already reserved: ${name}`);
      const entries = tests.get(testId) ?? new Map<string, OwnedDataset>();
      entries.set(name, { name }); tests.set(testId, entries);
    },
    record(testId: string, name: string, serverId: number) {
      const entry = tests.get(testId)?.get(name);
      if (!entry || !Number.isSafeInteger(serverId) || serverId <= 0) throw new Error(`Invalid dataset ownership: ${testId} / ${name}`);
      if (entry.serverId !== undefined && entry.serverId !== serverId) throw new Error(`Dataset identity changed: ${name}`);
      entry.serverId = serverId;
    },
    has(testId: string) { return !!tests.get(testId)?.size; },
    async drain(testId: string, remove: (entry: OwnedDataset) => Promise<void>) {
      const entries = tests.get(testId);
      const failures: unknown[] = [];
      for (const [name, entry] of entries ?? []) {
        try { await remove({ ...entry }); entries!.delete(name); }
        catch (error) { failures.push(new Error(`Delete owned dataset ${name}`, { cause: error })); }
      }
      if (!entries?.size) tests.delete(testId);
      if (failures.length) throw new AggregateError(failures, `Dataset teardown failed for ${testId}`);
    },
  };
}

/** Uses the project's saved admin session PATH; never loads login credentials. */
export async function freshAdminRequest(playwright: RequestProvider, info: TestInfo, baseURL = info.project.use.baseURL) {
  return playwright.request.newContext({
    baseURL, storageState: info.project.use.storageState ?? resolveFilterestTestRuntimePaths().authStorageState,
    ignoreHTTPSErrors: info.project.use.ignoreHTTPSErrors,
    extraHTTPHeaders: info.project.use.extraHTTPHeaders,
  });
}

async function removeOwnedDataset(request: APIRequestContext, entry: OwnedDataset) {
  // createTempDataset confirms ownership before seeding/cache hydration. Recover
  // that identity if it threw before the caller could record its successful return.
  const registered = listRegisteredTestArtifacts().find(item => item.kind === 'dataset' && item.name === entry.name);
  const serverId = entry.serverId ?? registered?.serverId ?? undefined;
  if (await readDatasetTableUIDFromRequest(request, entry.name, serverId) === null) {
    if (registered) unregisterTestArtifact('dataset', entry.name);
    return; // Already removed by create compensation or a previous drain.
  }
  requireConfirmedTestArtifact('dataset', entry.name, serverId);
  await cleanupDatasetViaRequest(request, entry.name);
}

/** Shared by T17 and its manual failure proof; each hook gets a new transport. */
export function testDatasetTeardown(test: {
  afterEach: (hook: (fixtures: { playwright: RequestProvider; baseURL?: string }, info: TestInfo) => Promise<void>) => void;
}) {
  const datasets = createTestDatasetRegistry();
  const plans = new Map<string, { before: CleanupStep[]; finally: Array<() => Promise<unknown> | unknown> }>();
  test.afterEach(async ({ playwright, baseURL }, info) => {
    const plan = plans.get(info.testId);
    plans.delete(info.testId);
    if (!plan && !datasets.has(info.testId)) return;
    info.setTimeout(info.timeout + 90_000); // Independent afterEach slot, including after a timed-out body.
    const failures: unknown[] = [];
    const attempt = async (name: string, run: () => Promise<unknown> | unknown) => {
      try { await run(); }
      catch (error) { printCleanupError(name, error); failures.push(new Error(name, { cause: error })); }
    };
    let request: APIRequestContext | undefined;
    try {
      await attempt('Create fresh signed-in teardown context', async () => { request = await freshAdminRequest(playwright, info, baseURL); });
      if (request) {
        for (const step of plan?.before ?? []) await attempt(step.name, () => step.run(request!));
        await attempt('Drain this test’s datasets', () => datasets.drain(info.testId, entry => removeOwnedDataset(request!, entry)));
      }
    } finally {
      for (const finish of plan?.finally ?? []) await attempt('Finalize test resources', finish);
      if (request) await attempt('Dispose teardown request context', () => request!.dispose());
    }
    if (failures.length) {
      // An expected body failure must never turn a broken teardown into a pass.
      if (info.expectedStatus === 'failed' || info.expectedStatus === 'timedOut') info.expectedStatus = 'passed';
      const bodyErrors = info.errors.map(error => Object.assign(new Error(error.message ?? error.value), { stack: error.stack }));
      throw new AggregateError([...bodyErrors, ...failures], 'Body/teardown failed; original body errors are retained');
    }
  });
  return {
    datasets,
    recordCreated(testId: string, name: string) {
      datasets.record(testId, name, requireConfirmedTestArtifact('dataset', name).serverId!);
    },
    plan(testId: string, before: CleanupStep[], finish: Array<() => Promise<unknown> | unknown> = []) {
      if (plans.has(testId)) throw new Error(`Teardown already planned: ${testId}`);
      plans.set(testId, { before, finally: finish });
    },
  };
}
