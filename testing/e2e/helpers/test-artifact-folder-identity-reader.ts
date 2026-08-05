/**
 * test-artifact-folder-identity-reader.ts
 * Resolves exact folder identities from two authenticated application inventories.
 * Bridges the navigation tree and system_table_folders row API for fail-closed E2E ownership.
 * Exists so an ambiguous create response cannot discard planned cleanup evidence by name alone.
 */

import type { APIRequestContext, APIResponse } from '@playwright/test';
import { unregisterTestArtifact } from './test-artifact-run-registry';

type FolderTreeResponse = {
  nodes?: unknown;
};

type FolderRowsResponse = {
  data?: unknown;
  row_count?: unknown;
};

function parsePositiveInteger(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readSuccessfulJson(response: APIResponse, inventoryName: string): Promise<unknown> {
  const body = await response.text();
  if (!response.ok()) {
    throw new Error(
      `Failed to read ${inventoryName} for E2E folder identity: ${response.status()} ${body}`,
    );
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (error) {
    throw new Error(`Failed to parse ${inventoryName} for E2E folder identity.`, {
      cause: error,
    });
  }
}

function parseTreeFolderIds(payload: unknown, folderName: string): number[] {
  const candidate = payload as FolderTreeResponse | null;
  if (!candidate || !Array.isArray(candidate.nodes)) {
    throw new Error('Malformed /api/tree_data response while resolving E2E folder identity.');
  }

  const folderIds = candidate.nodes
    .filter((node) => {
      if (!node || typeof node !== 'object') return false;
      const typedNode = node as { id?: unknown; name?: unknown };
      return typedNode.name === folderName
        && typeof typedNode.id === 'string'
        && typedNode.id.startsWith('f_');
    })
    .map((node) => parsePositiveInteger((node as { db_id?: unknown }).db_id));
  if (folderIds.some((folderId) => folderId === null)) {
    throw new Error(`Folder "${folderName}" has no valid db_id in /api/tree_data.`);
  }
  return Array.from(new Set(folderIds as number[])).sort((left, right) => left - right);
}

function parseSystemFolderIds(payload: unknown, folderName: string): number[] {
  const candidate = payload as FolderRowsResponse | null;
  if (!candidate || !Array.isArray(candidate.data)) {
    throw new Error(
      'Malformed system_table_folders row response while resolving E2E folder identity.',
    );
  }
  if (
    candidate.row_count !== undefined
    && (!Number.isSafeInteger(candidate.row_count) || Number(candidate.row_count) < 0)
  ) {
    throw new Error('Malformed row_count in system_table_folders E2E folder inventory.');
  }
  if (
    typeof candidate.row_count === 'number'
    && candidate.row_count > candidate.data.length
  ) {
    throw new Error(
      `Incomplete system_table_folders inventory for "${folderName}": `
      + `${candidate.data.length} of ${candidate.row_count} rows were returned.`,
    );
  }

  const folderIds = candidate.data
    .filter((row) =>
      row
      && typeof row === 'object'
      && (row as { folder_name?: unknown }).folder_name === folderName)
    .map((row) => parsePositiveInteger((row as { id?: unknown }).id));
  if (folderIds.some((folderId) => folderId === null)) {
    throw new Error(`Folder "${folderName}" has no valid id in system_table_folders.`);
  }
  return Array.from(new Set(folderIds as number[])).sort((left, right) => left - right);
}

/**
 * Reads one exact folder identity from both server inventories.
 * Returns null only when both complete inventories agree that the random name is absent.
 */
export async function readFolderServerIdFromRequest(
  request: APIRequestContext,
  folderName: string,
): Promise<number | null> {
  const [treeResponse, rowsResponse] = await Promise.all([
    request.get('/api/tree_data'),
    request.get('/api/get-results', {
      params: {
        dataset: 'system_table_folders',
        folder_name: folderName,
        offset: '0',
      },
    }),
  ]);
  const [treePayload, rowsPayload] = await Promise.all([
    readSuccessfulJson(treeResponse, '/api/tree_data'),
    readSuccessfulJson(rowsResponse, 'system_table_folders rows'),
  ]);
  const treeIds = parseTreeFolderIds(treePayload, folderName);
  const systemIds = parseSystemFolderIds(rowsPayload, folderName);

  if (treeIds.length === 0 && systemIds.length === 0) {
    return null;
  }
  if (
    treeIds.length !== 1
    || systemIds.length !== 1
    || treeIds[0] !== systemIds[0]
  ) {
    throw new Error(
      `E2E folder inventories disagree for "${folderName}": `
      + `tree_data=${treeIds.join(',') || 'absent'}, `
      + `system_table_folders=${systemIds.join(',') || 'absent'}.`,
    );
  }
  return treeIds[0];
}

/** Releases a planned folder only after both authenticated inventories prove exact absence. */
export async function releasePlannedFolderIfAbsent(
  request: APIRequestContext,
  folderName: string,
): Promise<void> {
  const liveFolderId = await readFolderServerIdFromRequest(request, folderName);
  if (liveFolderId !== null) {
    throw new Error(
      `Folder "${folderName}" has ambiguous planned ownership and live id=${liveFolderId}; `
      + 'retaining its registry evidence for inspection.',
    );
  }
  unregisterTestArtifact('folder', folderName);
}
