/**
 * temp-dataset.ts
 *
 * Creates, seeds, opens, and removes throwaway datasets for E2E tests.
 * Bridges Playwright request/page fixtures and the app's dataset CRUD APIs.
 * Exists so browser tests can verify no-skip workflows without mutating shared datasets.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { navigateToDataset, waitForAppReady, waitForDataLoaded } from './navigation';
import {
  confirmTestArtifact,
  registerTestArtifact,
  requireConfirmedTestArtifact,
  unregisterTestArtifact,
} from './test-artifact-run-registry';
import {
  readDatasetTableUIDFromPage,
  readDatasetTableUIDFromRequest,
} from './test-artifact-dataset-identity-reader';
import { hydrateAuthenticatedTreeDataCache } from './tree-data-cache';

type TempDatasetForeignKey = {
  referencing_column: string;
  referenced_dataset: string;
  referenced_column: string;
};

export type TempDatasetConfig = {
  datasetName: string;
  columns: Record<string, string>;
  foreignKeys?: TempDatasetForeignKey[];
  seedRows?: Array<Record<string, unknown>>;
  preventDeletion?: boolean;
};

export type TempDatasetViewMode = 'table' | 'card' | 'tree' | 'transposed' | 'ticket';

const TEMP_DATASET_LOAD_TIMEOUT_MS = 15000;

type DatasetListItem = {
  dataset_name?: string;
  folder_id?: number | null;
  is_in_current_project?: boolean;
  is_top_level_in_current_project?: boolean;
};

function resolvePreferredCurrentProjectFolderId(datasets: DatasetListItem[]): number | null {
  const topLevelDataset = datasets.find((dataset) =>
    dataset?.is_top_level_in_current_project === true &&
    typeof dataset.folder_id === 'number' &&
    dataset.folder_id > 0,
  );
  if (topLevelDataset && typeof topLevelDataset.folder_id === 'number') {
    return topLevelDataset.folder_id;
  }

  const fallbackDataset = datasets.find((dataset) =>
    dataset?.is_in_current_project === true &&
    typeof dataset.folder_id === 'number' &&
    dataset.folder_id > 0,
  );
  return fallbackDataset && typeof fallbackDataset.folder_id === 'number'
    ? fallbackDataset.folder_id
    : null;
}

function normalizeDatasetPrefix(prefix: string): string {
  const normalized = prefix
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'e2e_temp_dataset';
}

async function fetchCsrfToken(page: Page): Promise<string> {
  const csrfResponse = await page.evaluate(async () => {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include',
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  });
  expect(csrfResponse.ok, `Failed to fetch CSRF token for temp dataset helper: ${csrfResponse.body}`).toBe(true);

  const csrfData = JSON.parse(csrfResponse.body);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for temp dataset helper.');
  }

  return csrfToken;
}

/**
 * Reads the current session's CSRF token through Playwright's request fixture.
 * Bridges request-scoped E2E cleanup helpers and the app's authenticated API.
 * Exists so dataset cleanup can still work after browser-side failures.
 */
export async function fetchCsrfTokenForRequest(request: APIRequestContext): Promise<string> {
  const csrfResponse = await request.get('/api/csrf-token');
  const csrfBody = await csrfResponse.text();
  expect(
    csrfResponse.ok(),
    `Failed to fetch CSRF token for request-scoped temp dataset cleanup: ${csrfBody}`,
  ).toBe(true);

  const csrfData = JSON.parse(csrfBody);
  const csrfToken = csrfData?.csrf_token;
  if (typeof csrfToken !== 'string' || csrfToken.trim() === '') {
    throw new Error('Missing csrf_token in /api/csrf-token response for request-scoped temp dataset cleanup.');
  }

  return csrfToken;
}

async function postJsonWithCsrf(
  page: Page,
  url: string,
  payload: Record<string, unknown>,
) {
  const csrfToken = await fetchCsrfToken(page);
  return page.evaluate(
    async ({ csrfToken, payload, url }) => {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        body: JSON.stringify(payload),
      });
      return {
        status: response.status,
        ok: response.ok,
        body: await response.text(),
      };
    },
    { csrfToken, payload, url },
  );
}

async function resolveCurrentProjectFolderId(page: Page): Promise<number> {
  const datasetResponse = await page.evaluate(async () => {
    const response = await fetch('/api/datasets', {
      credentials: 'include',
    });
    return {
      status: response.status,
      ok: response.ok,
      body: await response.text(),
    };
  });

  expect(
    datasetResponse.ok,
    `Failed to fetch datasets for temp dataset helper: ${datasetResponse.body}`,
  ).toBe(true);

  const parsedBody = JSON.parse(datasetResponse.body);
  const datasets = Array.isArray(parsedBody?.datasets)
    ? parsedBody.datasets as DatasetListItem[]
    : [];

  const folderId = resolvePreferredCurrentProjectFolderId(datasets);
  if (folderId === null) {
    throw new Error(
      'Temp dataset helper could not resolve a current-project folder_id from /api/datasets.',
    );
  }

  return folderId;
}

async function addTempDatasetRow(
  page: Page,
  datasetName: string,
  row: Record<string, unknown>,
): Promise<void> {
  const csrfToken = await fetchCsrfToken(page);
  const response = await page.evaluate(
    async ({ csrfToken, datasetName, row }) => {
      const formData = new FormData();
      formData.append('jsonPayload', JSON.stringify(row));

      const response = await fetch(`/api/add-row-multipart?dataset=${encodeURIComponent(datasetName)}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'X-CSRF-Token': csrfToken,
        },
        body: formData,
      });
      return {
        status: response.status,
        body: await response.text(),
      };
    },
    { csrfToken, datasetName, row },
  );
  expect(
    response.status,
    `Failed to seed temp dataset row for "${datasetName}": ${response.body}`,
  ).toBe(201);
}

export function buildTempDatasetName(prefix: string): string {
  const safePrefix = normalizeDatasetPrefix(prefix);
  const timestamp = Date.now().toString(36);
  const entropy = Math.random().toString(36).slice(2, 8);
  return `${safePrefix}_${timestamp}_${entropy}`.slice(0, 63);
}

function isRetryableCreateTempDatasetError(status: number, body: string): boolean {
  if (status < 500 || typeof body !== 'string') {
    return false;
  }
  return (
    body.includes('table created but folder assignment failed') ||
    body.includes('table created but metadata refresh failed') ||
    body.includes('current transaction is aborted')
  );
}

async function cleanupPartialTempDataset(page: Page, datasetName: string): Promise<void> {
  const registeredArtifact = requireConfirmedTestArtifact('dataset', datasetName);
  const currentTableUID = await readDatasetTableUIDFromPage(page, datasetName);
  if (currentTableUID === null) {
    unregisterTestArtifact('dataset', datasetName);
    return;
  }
  if (registeredArtifact.serverId !== currentTableUID) {
    throw new Error(
      `Refusing to compensate temp dataset "${datasetName}": registered table_uid=`
      + `${registeredArtifact.serverId}, current table_uid=${currentTableUID}.`,
    );
  }
  const response = await postJsonWithCsrf(page, '/api/drop-dataset', {
    dataset_name: datasetName,
  });
  if (!response.ok && !response.body.includes('does not exist')) {
    throw new Error(
      `Failed to compensate temp dataset "${datasetName}": ` +
      `${response.status} ${response.body}`,
    );
  }
  unregisterTestArtifact('dataset', datasetName);
}

async function releasePlannedTempDatasetIfAbsent(page: Page, datasetName: string): Promise<void> {
  const currentTableUID = await readDatasetTableUIDFromPage(page, datasetName);
  if (currentTableUID !== null) {
    throw new Error(
      `Temp dataset "${datasetName}" has ambiguous planned ownership and live table_uid=`
      + `${currentTableUID}; refusing automatic destructive cleanup.`,
    );
  }
  unregisterTestArtifact('dataset', datasetName);
}

export async function createTempDataset(
  page: Page,
  config: TempDatasetConfig,
): Promise<void> {
  let response: Awaited<ReturnType<typeof postJsonWithCsrf>> | null = null;
  let createAttempted = false;
  let confirmed = false;
  registerTestArtifact('dataset', config.datasetName);

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const currentProjectFolderId = await resolveCurrentProjectFolderId(page);
      createAttempted = true;
      response = await postJsonWithCsrf(page, '/api/create_dataset', {
        dataset_name: config.datasetName,
        columns: config.columns,
        foreign_keys: config.foreignKeys ?? [],
        grant_users_read: false,
        grant_guests_read: false,
        prevent_deletion: config.preventDeletion ?? false,
        folder_id: currentProjectFolderId,
      });

      if (response.status === 201) {
        const tableUID = await readDatasetTableUIDFromPage(page, config.datasetName);
        if (tableUID === null) {
          throw new Error(
            `Created temp dataset "${config.datasetName}" is missing its stable table_uid identity.`,
          );
        }
        confirmTestArtifact('dataset', config.datasetName, tableUID);
        confirmed = true;
        break;
      }

      if (attempt === 0 && isRetryableCreateTempDatasetError(response.status, response.body)) {
        await releasePlannedTempDatasetIfAbsent(page, config.datasetName);
        createAttempted = false;
        response = null;
        registerTestArtifact('dataset', config.datasetName);
        await page.waitForTimeout(250);
        continue;
      }

      // A rejected or ambiguous create never turns a planned name into delete
      // authority. Remove the planned entry only when both inventories prove
      // the dataset does not exist; otherwise preserve it for manual inspection.
      await releasePlannedTempDatasetIfAbsent(page, config.datasetName);
      break;
    }

    if (!response) {
      throw new Error(`Temp dataset helper did not receive a create_dataset response for "${config.datasetName}".`);
    }
    expect(
      response.status,
      `Failed to create temp dataset "${config.datasetName}": ${response.body}`,
    ).toBe(201);

    for (const row of config.seedRows ?? []) {
      await addTempDatasetRow(page, config.datasetName, row);
    }

    // API-created E2E tables bypass the normal table-creator UI, whose success
    // path refreshes these caches. Mirror that step so card editors can resolve
    // column metadata and row/form actions receive the new table's numeric UID.
    await hydrateAuthenticatedTreeDataCache(page, config.datasetName);
  } catch (primaryError) {
    if (confirmed) {
      try {
        await cleanupPartialTempDataset(page, config.datasetName);
      } catch (cleanupError) {
        throw new AggregateError(
          [primaryError, cleanupError],
          `Temp dataset "${config.datasetName}" failed after creation and compensation also failed.`,
        );
      }
    } else if (!createAttempted) {
      unregisterTestArtifact('dataset', config.datasetName);
    }
    throw primaryError;
  }
}

export async function dropTempDataset(
  page: Page,
  datasetName: string,
): Promise<void> {
  const registeredArtifact = requireConfirmedTestArtifact('dataset', datasetName);
  const currentTableUID = await readDatasetTableUIDFromPage(page, datasetName);
  if (currentTableUID === null) {
    unregisterTestArtifact('dataset', datasetName);
    return;
  }
  if (registeredArtifact.serverId !== currentTableUID) {
    throw new Error(
      `Refusing to drop temp dataset "${datasetName}": registered table_uid=`
      + `${registeredArtifact.serverId}, current table_uid=${currentTableUID}.`,
    );
  }
  const response = await postJsonWithCsrf(page, '/api/drop-dataset', {
    dataset_name: datasetName,
  });
  if (!response.ok && response.body.includes('does not exist')) {
    unregisterTestArtifact('dataset', datasetName);
    return;
  }
  expect(
    response.ok,
    `Failed to drop temp dataset "${datasetName}": ${response.body}`,
  ).toBe(true);
  unregisterTestArtifact('dataset', datasetName);
}

/**
 * Drops a dataset by name through the request fixture and tolerates already-missing tables.
 * Bridges test afterEach cleanup hooks and the app's drop-dataset API.
 * Exists so admin create/delete tests can always clean up server state even if the page breaks.
 */
export async function cleanupDatasetViaRequest(
  request: APIRequestContext,
  datasetName: string,
): Promise<void> {
  if (!datasetName || datasetName.trim() === '') {
    return;
  }

  const registeredArtifact = requireConfirmedTestArtifact('dataset', datasetName);
  const currentTableUID = await readDatasetTableUIDFromRequest(request, datasetName);
  if (currentTableUID === null) {
    unregisterTestArtifact('dataset', datasetName);
    return;
  }
  if (registeredArtifact.serverId !== currentTableUID) {
    throw new Error(
      `Refusing request-scoped cleanup for dataset "${datasetName}": registered table_uid=`
      + `${registeredArtifact.serverId}, current table_uid=${currentTableUID}.`,
    );
  }
  const csrfToken = await fetchCsrfTokenForRequest(request);
  const response = await request.post('/api/drop-dataset', {
    data: { dataset_name: datasetName },
    headers: {
      'X-CSRF-Token': csrfToken,
    },
  });
  const responseBody = await response.text();

  if (!response.ok() && !responseBody.includes('does not exist')) {
    throw new Error(`Failed to drop dataset "${datasetName}" during request-scoped cleanup: ${responseBody}`);
  }
  unregisterTestArtifact('dataset', datasetName);
}

function getDatasetSurfaceSelector(datasetName: string, viewMode: TempDatasetViewMode): string {
  if (viewMode === 'table') {
    return `#${datasetName}_table_view_container table[data-testid="dataset-view-table"]`;
  }
  if (viewMode === 'card') {
    return `#${datasetName}_card_view_container .card_view_wrapper`;
  }
  if (viewMode === 'tree') {
    return `#${datasetName}_tree_view_container .tree-container`;
  }
  if (viewMode === 'transposed') {
    return `#${datasetName}_transposed_view_container .table`;
  }
  if (viewMode === 'ticket') {
    return `#${datasetName}_ticket_view_container .ticket-container`;
  }
  throw new Error(`Unsupported temp dataset view mode "${viewMode}".`);
}

function getRequiredViewRoute(viewMode: TempDatasetViewMode): string | null {
  if (viewMode === 'card') {
    return '/ui/view/card';
  }
  if (viewMode === 'tree') {
    return '/ui/view/tree';
  }
  if (viewMode === 'transposed') {
    return '/ui/view/transposed';
  }
  if (viewMode === 'ticket') {
    return '/ui/view/ticket';
  }
  if (viewMode === 'table') {
    return '/ui/view/table';
  }
  return null;
}

async function waitForDatasetViewReady(
  page: Page,
  datasetName: string,
  viewMode: TempDatasetViewMode,
): Promise<void> {
  if (viewMode === 'card') {
    await page.waitForFunction(
      ({ datasetName }) => {
        const wrapper = document.querySelector(
          `#${datasetName}_card_view_container .card_view_wrapper`,
        );
        if (!(wrapper instanceof HTMLElement)) {
          return false;
        }
        const rect = wrapper.getBoundingClientRect();
        return getComputedStyle(wrapper).display !== 'none' && rect.width > 0 && rect.height > 0;
      },
      { datasetName },
      { timeout: TEMP_DATASET_LOAD_TIMEOUT_MS },
    );
    return;
  }

  if (viewMode === 'tree') {
    await page.waitForFunction(
      ({ datasetName }) => {
        const tree = document.querySelector(
          `#${datasetName}_tree_view_container .tree-container`,
        );
        if (!(tree instanceof HTMLElement)) {
          return false;
        }
        return getComputedStyle(tree).display !== 'none' && tree.querySelectorAll('.node').length > 0;
      },
      { datasetName },
      { timeout: TEMP_DATASET_LOAD_TIMEOUT_MS },
    );
    return;
  }

  if (viewMode === 'transposed') {
    await page.waitForFunction(
      ({ datasetName }) => {
        const table = document.querySelector(
          `#${datasetName}_transposed_view_container .table`,
        );
        if (!(table instanceof HTMLElement)) {
          return false;
        }
        const rect = table.getBoundingClientRect();
        return (
          getComputedStyle(table).display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0 &&
          table.querySelectorAll('.row').length > 0
        );
      },
      { datasetName },
      { timeout: TEMP_DATASET_LOAD_TIMEOUT_MS },
    );
    return;
  }

  if (viewMode === 'ticket') {
    await page.waitForFunction(
      ({ datasetName }) => {
        const container = document.querySelector(
          `#${datasetName}_ticket_view_container .ticket-container`,
        );
        if (!(container instanceof HTMLElement)) {
          return false;
        }
        return getComputedStyle(container).display !== 'none' && container.querySelectorAll('.ticket').length > 0;
      },
      { datasetName },
      { timeout: TEMP_DATASET_LOAD_TIMEOUT_MS },
    );
    return;
  }

  await page.waitForFunction(
    ({ datasetName }) => {
      const table = document.querySelector(
        `#${datasetName}_table_view_container table[data-testid="dataset-view-table"]`,
      );
      if (!(table instanceof HTMLElement)) {
        return false;
      }
      const rect = table.getBoundingClientRect();
      return getComputedStyle(table).display !== 'none' && rect.width > 0 && rect.height > 0;
    },
    { datasetName },
    { timeout: TEMP_DATASET_LOAD_TIMEOUT_MS },
  );
}

export async function openTempDataset(
  page: Page,
  datasetName: string,
  viewMode: TempDatasetViewMode = 'table',
): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  // UI permissions must come from the authenticated backend payload. Failing
  // here keeps startup registry/admin-grant regressions visible instead of
  // fabricating a route permission inside the test browser.
  const requiredRoute = getRequiredViewRoute(viewMode);
  const hasRequiredRoute = await page.evaluate(
    ({ datasetName, viewMode, requiredRoute }) => {
      localStorage.setItem(`${datasetName}_view`, viewMode);
      if (!requiredRoute) {
        return true;
      }

      try {
        const parsedPermissions: unknown = JSON.parse(
          sessionStorage.getItem('user_permissions') ?? '[]',
        );
        const permissions = Array.isArray(parsedPermissions)
          ? parsedPermissions
          : parsedPermissions &&
              typeof parsedPermissions === 'object' &&
              Array.isArray((parsedPermissions as { endpoints?: unknown }).endpoints)
            ? (parsedPermissions as { endpoints: unknown[] }).endpoints
            : [];
        return permissions.includes(requiredRoute);
      } catch {
        return false;
      }
    },
    { datasetName, viewMode, requiredRoute },
  );
  if (!hasRequiredRoute) {
    throw new Error(
      `Authenticated E2E account lacks required UI permission "${requiredRoute}" ` +
        `for ${viewMode} view. Verify startup UI-route reconciliation and admin grants.`,
    );
  }

  // Each Playwright page has its own storage context. Refresh metadata here so
  // datasets created in a beforeAll context are also available to test pages.
  await hydrateAuthenticatedTreeDataCache(page, datasetName);

  // API-created datasets may not have a database-tree DOM for this account,
  // but row/form actions still require the numeric UID cached before reload.
  await page.waitForFunction(
    (targetDatasetName) => {
      try {
        const tableSpecs = JSON.parse(localStorage.getItem('table_specs') ?? '{}');
        return /^\d+$/.test(String(tableSpecs?.[targetDatasetName]?.table_uid ?? ''));
      } catch {
        return false;
      }
    },
    datasetName,
    { timeout: TEMP_DATASET_LOAD_TIMEOUT_MS },
  );

  await navigateToDataset(page, datasetName);
  await page.waitForSelector(getDatasetSurfaceSelector(datasetName, viewMode), {
    state: 'attached',
    timeout: TEMP_DATASET_LOAD_TIMEOUT_MS,
  });
  await waitForDatasetViewReady(page, datasetName, viewMode);
  await waitForDataLoaded(page, datasetName);
}
