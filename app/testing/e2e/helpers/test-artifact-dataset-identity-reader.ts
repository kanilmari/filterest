/**
 * test-artifact-dataset-identity-reader.ts
 * Resolves stable table_uid identities for E2E-created datasets.
 * Bridges authenticated Playwright page/request contexts and server inventories.
 * Exists so cleanup authorization never relies on a dataset name alone.
 */

import type { APIRequestContext, Page } from '@playwright/test';
import {
  safeTestArtifactError, requestTestArtifactResponse, readTestArtifactText,
  readTestArtifactJson, safeTestArtifactFailure, testArtifactFailure,
} from './test-artifact-diagnostics';

type DatasetTreeNode = {
  id?: unknown;
  name?: unknown;
  table_uid?: unknown;
  is_view?: unknown;
};

type DatasetTreeResponse = {
  nodes?: unknown;
};

function parseTableUID(value: unknown): number {
  return typeof value === 'number' ? value
    : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
}

// GetTreeDataHandler in backend/reusable_components/vanilla_tree/vanilla_tree.go
// emits registered datasets (including registered SQL views) as t_ nodes.
// Its f_ folders, synthetic Views root and v_ view nodes are structural. Use
// that discriminator before reading UIDs, never UID presence as the node kind.
function isDatasetTreeNode(node: DatasetTreeNode): boolean {
  if (typeof node.id === 'string') {
    if (node.id.startsWith('t_')) return true;
    if (node.id.startsWith('v_') && node.is_view === true) return false;
    if ((/^f_\d+$/.test(node.id) || node.id === 'views_root') && node.table_uid == null) return false;
  }
  throw safeTestArtifactError('Malformed /api/tree_data node kind while resolving E2E dataset identity.');
}

function assertRecordedIdentityNotRenamed(
  name: string, uid: unknown, datasetName: string, recordedServerId: number,
): void {
  const tableUID = parseTableUID(uid);
  if (!Number.isSafeInteger(tableUID) || tableUID <= 0) {
    throw safeTestArtifactError('Malformed inventory: stable table_uid required to prove recorded server-id absence');
  }
  if (tableUID === recordedServerId && name !== datasetName) {
    throw safeTestArtifactError(`recorded dataset ${JSON.stringify(datasetName)} serverId=${recordedServerId}`
      + ` survives as dataset ${JSON.stringify(name)} serverId=${tableUID}; refusing renamed identity`);
  }
}

function parseDatasetTableUID(treeResponseBody: string, datasetName: string, recordedServerId?: number): number | null {
  let parsed: DatasetTreeResponse;
  try {
    parsed = JSON.parse(treeResponseBody) as DatasetTreeResponse;
  } catch {
    throw safeTestArtifactError('Failed to parse /api/tree_data while resolving E2E dataset identity.');
  }
  if (!Array.isArray(parsed?.nodes)) {
    throw safeTestArtifactError('Malformed /api/tree_data response while resolving E2E dataset identity.');
  }
  if (parsed.nodes.some((node) => !node || typeof node !== 'object'
    || typeof node.name !== 'string' || node.name.trim() === '')) {
    throw safeTestArtifactError('Malformed /api/tree_data node while resolving E2E dataset identity.');
  }
  const datasetNodes = (parsed.nodes as DatasetTreeNode[]).filter(isDatasetTreeNode);
  if (recordedServerId !== undefined) {
    for (const node of datasetNodes) {
      assertRecordedIdentityNotRenamed(node.name as string, node.table_uid, datasetName, recordedServerId);
    }
  }

  const matches = datasetNodes.filter((node) => node.name === datasetName);
  if (matches.length === 0) {
    return null;
  }
  const tableUIDs = new Set(matches.map((node) => {
    const tableUID = parseTableUID(node.table_uid);
    if (!Number.isSafeInteger(tableUID) || tableUID <= 0) {
      throw safeTestArtifactError(`Dataset "${datasetName}" has no valid table_uid in /api/tree_data.`);
    }
    return tableUID;
  }));
  if (tableUIDs.size !== 1) {
    throw safeTestArtifactError(`Dataset "${datasetName}" has conflicting table_uid identities.`);
  }
  return Array.from(tableUIDs)[0];
}

function datasetListContainsName(
  datasetResponseBody: string,
  datasetName: string,
  recordedServerId?: number,
): boolean {
  let parsed: { datasets?: unknown };
  try {
    parsed = JSON.parse(datasetResponseBody) as { datasets?: unknown };
  } catch {
    throw safeTestArtifactError('Failed to parse /api/datasets while resolving E2E dataset identity.');
  }
  if (!Array.isArray(parsed?.datasets)) {
    throw safeTestArtifactError('Malformed /api/datasets response while resolving E2E dataset identity.');
  }
  if (parsed.datasets.some((dataset) => !dataset || typeof dataset !== 'object'
    || typeof dataset.dataset_name !== 'string' || dataset.dataset_name.trim() === '')) {
    throw safeTestArtifactError('Malformed /api/datasets entry while resolving E2E dataset identity.');
  }
  if (recordedServerId !== undefined) {
    for (const dataset of parsed.datasets) {
      assertRecordedIdentityNotRenamed(dataset.dataset_name, dataset.table_uid, datasetName, recordedServerId);
    }
    // Report the recorded id's renamed survivor before a replacement at the old name.
    const replacement = parsed.datasets.find(dataset => dataset.dataset_name === datasetName
      && parseTableUID(dataset.table_uid) !== recordedServerId);
    if (replacement) {
      throw safeTestArtifactError(`server-id mismatch: recorded=${recordedServerId}, current=${parseTableUID(replacement.table_uid)}`);
    }
  }
  return parsed.datasets.some((dataset) => dataset.dataset_name === datasetName);
}

function assertMissingDatasetIsAbsentFromDatasetList(body: string, datasetName: string, recordedServerId?: number): void {
  if (datasetListContainsName(body, datasetName, recordedServerId)) {
    throw safeTestArtifactError(
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
    throw safeTestArtifactError(
      `Failed to read /api/tree_data for E2E dataset identity: `
      + `${treeResponse.status}`,
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
    throw safeTestArtifactError(
      `Failed to verify missing E2E dataset identity: `
      + `${datasetResponse.status}`,
    );
  }
  assertMissingDatasetIsAbsentFromDatasetList(datasetResponse.body, datasetName);
  return null;
}

/** Resolves table_uid through an authenticated request fixture for teardown-safe cleanup. */
export async function readDatasetTableUIDFromRequest(
  request: APIRequestContext,
  datasetName: string,
  recordedServerId?: number,
): Promise<number | null> {
  const context = { name: datasetName, serverId: recordedServerId };
  const treeResponse = await requestTestArtifactResponse('GET /api/tree_data', () => request.get('/api/tree_data'), context);
  const treeBody = await readTestArtifactText(treeResponse, 'GET /api/tree_data', context);
  let tableUID: number | null;
  try {
    tableUID = parseDatasetTableUID(treeBody, datasetName, recordedServerId);
  } catch (error) {
    throw safeTestArtifactFailure(error, 'GET /api/tree_data', context, treeResponse.status());
  }
  if (tableUID !== null) {
    return tableUID;
  }

  const datasetResponse = await requestTestArtifactResponse('GET /api/datasets', () => request.get('/api/datasets'), context);
  const datasetBody = await readTestArtifactText(datasetResponse, 'GET /api/datasets', context);
  try {
    assertMissingDatasetIsAbsentFromDatasetList(datasetBody, datasetName, recordedServerId);
  } catch (error) {
    throw safeTestArtifactFailure(error, 'GET /api/datasets', context, datasetResponse.status());
  }
  return null;
}

/**
 * Proves absence through administrator inventories before reading named metadata.
 * Deleted datasets lose metadata permissions; their 403 is never absence evidence.
 * Confirmed absence checks every dataset's UID as well as the recorded exact name.
 * Existing datasets still require agreement on their exact public name and UID.
 */
export async function readDatasetIdentityFromRequest(
  request: APIRequestContext,
  datasetName: string,
  recordedServerId?: number,
): Promise<{ tableUID: number } | null> {
  const context = { name: datasetName, serverId: recordedServerId };
  const tableUID = await readDatasetTableUIDFromRequest(request, datasetName, recordedServerId);
  if (tableUID === null) return null;
  const inventory = await requestTestArtifactResponse('GET /api/datasets', () => request.get('/api/datasets'), context);
  const inventoryBody = await readTestArtifactText(inventory, 'GET /api/datasets', context);
  try {
    if (!datasetListContainsName(inventoryBody, datasetName, recordedServerId)) {
      throw safeTestArtifactError('Dataset tree and administrator dataset inventories disagree');
    }
  } catch (error) {
    throw safeTestArtifactFailure(error, 'GET /api/datasets', context, inventory.status());
  }
  const response = await requestTestArtifactResponse('GET /api/get-metadata',
    () => request.get('/api/get-metadata', { params: { dataset: datasetName } }), context);
  const payload = await readTestArtifactJson<{ data?: unknown }>(response, 'GET /api/get-metadata', context);
  if (!Array.isArray(payload?.data)) {
    throw testArtifactFailure('GET /api/get-metadata', 'Malformed dataset metadata: data must be an array', context, response.status());
  }
  if (payload.data.length !== 1) {
    throw testArtifactFailure('GET /api/get-metadata', 'Dataset metadata and live inventories disagree or are ambiguous', context, response.status());
  }
  const row = payload.data[0] as { table_name?: unknown; table_uid?: unknown; schema_name?: unknown };
  const metadataUID = typeof row?.table_uid === 'number' ? row.table_uid
    : typeof row?.table_uid === 'string' && /^\d+$/.test(row.table_uid) ? Number(row.table_uid) : NaN;
  if (row?.table_name !== datasetName || row.schema_name !== 'public' || metadataUID !== tableUID) {
    throw testArtifactFailure('GET /api/get-metadata', 'Dataset metadata does not match the exact public name and stable table_uid', context, response.status());
  }
  return { tableUID };
}
