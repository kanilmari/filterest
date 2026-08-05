/**
 * test-artifact-dataset-identity-reader.ts
 * Resolves stable table_uid identities for E2E-created datasets.
 * Bridges authenticated Playwright page/request contexts and server inventories.
 * Exists so cleanup authorization never relies on a dataset name alone.
 */

import type { APIRequestContext, Page } from '@playwright/test';

type DatasetTreeNode = {
  name?: unknown;
  table_uid?: unknown;
};

type DatasetTreeResponse = {
  nodes?: unknown;
};

function parseDatasetTableUID(treeResponseBody: string, datasetName: string): number | null {
  let parsed: DatasetTreeResponse;
  try {
    parsed = JSON.parse(treeResponseBody) as DatasetTreeResponse;
  } catch (error) {
    throw new Error('Failed to parse /api/tree_data while resolving E2E dataset identity.', {
      cause: error,
    });
  }
  if (!Array.isArray(parsed?.nodes)) {
    throw new Error('Malformed /api/tree_data response while resolving E2E dataset identity.');
  }

  const matches = (parsed.nodes as DatasetTreeNode[]).filter((node) => node?.name === datasetName);
  if (matches.length === 0) {
    return null;
  }
  const tableUIDs = new Set(matches.map((node) => {
    const tableUID = typeof node.table_uid === 'number'
      ? node.table_uid
      : typeof node.table_uid === 'string' && /^\d+$/.test(node.table_uid)
        ? Number(node.table_uid)
        : Number.NaN;
    if (!Number.isSafeInteger(tableUID) || tableUID <= 0) {
      throw new Error(`Dataset "${datasetName}" has no valid table_uid in /api/tree_data.`);
    }
    return tableUID;
  }));
  if (tableUIDs.size !== 1) {
    throw new Error(`Dataset "${datasetName}" has conflicting table_uid identities.`);
  }
  return Array.from(tableUIDs)[0];
}

function assertMissingDatasetIsAbsentFromDatasetList(
  datasetResponseBody: string,
  datasetName: string,
): void {
  let parsed: { datasets?: unknown };
  try {
    parsed = JSON.parse(datasetResponseBody) as { datasets?: unknown };
  } catch (error) {
    throw new Error('Failed to parse /api/datasets while resolving E2E dataset identity.', {
      cause: error,
    });
  }
  if (!Array.isArray(parsed?.datasets)) {
    throw new Error('Malformed /api/datasets response while resolving E2E dataset identity.');
  }
  if (parsed.datasets.some((dataset) =>
    dataset && typeof dataset === 'object'
    && (dataset as { dataset_name?: unknown }).dataset_name === datasetName)) {
    throw new Error(
      `Dataset "${datasetName}" exists but /api/tree_data did not expose its stable table_uid.`,
    );
  }
}

/**
 * Resolves one dataset's stable table_uid through the authenticated browser session.
 * Returns null only when both authoritative inventories agree that the name is absent.
 */
export async function readDatasetTableUIDFromPage(
  page: Page,
  datasetName: string,
): Promise<number | null> {
  const treeResponse = await page.evaluate(async () => {
    const response = await fetch('/api/tree_data', { credentials: 'include' });
    return { status: response.status, ok: response.ok, body: await response.text() };
  });
  if (!treeResponse.ok) {
    throw new Error(
      `Failed to read /api/tree_data for E2E dataset identity: `
      + `${treeResponse.status} ${treeResponse.body}`,
    );
  }
  const tableUID = parseDatasetTableUID(treeResponse.body, datasetName);
  if (tableUID !== null) {
    return tableUID;
  }

  const datasetResponse = await page.evaluate(async () => {
    const response = await fetch('/api/datasets', { credentials: 'include' });
    return { status: response.status, ok: response.ok, body: await response.text() };
  });
  if (!datasetResponse.ok) {
    throw new Error(
      `Failed to verify missing E2E dataset identity: `
      + `${datasetResponse.status} ${datasetResponse.body}`,
    );
  }
  assertMissingDatasetIsAbsentFromDatasetList(datasetResponse.body, datasetName);
  return null;
}

/** Resolves table_uid through an authenticated request fixture for teardown-safe cleanup. */
export async function readDatasetTableUIDFromRequest(
  request: APIRequestContext,
  datasetName: string,
): Promise<number | null> {
  const treeResponse = await request.get('/api/tree_data');
  const treeBody = await treeResponse.text();
  if (!treeResponse.ok()) {
    throw new Error(
      `Failed to read /api/tree_data for request-scoped E2E dataset identity: `
      + `${treeResponse.status()} ${treeBody}`,
    );
  }
  const tableUID = parseDatasetTableUID(treeBody, datasetName);
  if (tableUID !== null) {
    return tableUID;
  }

  const datasetResponse = await request.get('/api/datasets');
  const datasetBody = await datasetResponse.text();
  if (!datasetResponse.ok()) {
    throw new Error(
      `Failed to verify missing request-scoped E2E dataset identity: `
      + `${datasetResponse.status()} ${datasetBody}`,
    );
  }
  assertMissingDatasetIsAbsentFromDatasetList(datasetBody, datasetName);
  return null;
}
