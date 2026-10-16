/**
 * test-artifact-dataset-column-recorder.ts
 * Captures managed children's actual columns before cleanup removes their metadata.
 * Binds the authenticated metadata response to the registry's confirmed stable identity.
 * Transport, identity and persistence failures propagate without authorizing key retention.
 */
import type { APIRequestContext } from '@playwright/test';
import * as path from 'node:path';
import { requireConfirmedTestArtifact, resolveArtifactRegistryRoot } from './test-artifact-run-registry';
import { rememberConfirmedDatasetColumns } from './test-artifact-dataset-columns';
import { readTestArtifactJson, requestTestArtifactResponse, safeTestArtifactError } from './test-artifact-diagnostics';

export function recordTestDatasetColumns(datasetName: string, columns: readonly string[]): void {
  const artifact = requireConfirmedTestArtifact('dataset', datasetName);
  rememberConfirmedDatasetColumns(path.join(resolveArtifactRegistryRoot(), artifact.runId), artifact, columns);
}

/** Capture server-generated columns before dropping a managed child, checking its current UID. */
export async function recordTestDatasetColumnsFromRequest(
  request: APIRequestContext, datasetName: string,
): Promise<void> {
  const artifact = requireConfirmedTestArtifact('dataset', datasetName);
  const operation = 'GET /api/card-visibility (E2E dataset column ownership)';
  const response = await requestTestArtifactResponse(operation,
    () => request.get(`/api/card-visibility/${encodeURIComponent(datasetName)}`));
  const metadata = await readTestArtifactJson<{ table_name?: unknown; columns?: Array<{ column_name?: unknown }>;
    dataset_appearance?: { dataset_uid?: unknown } }>(response, operation);
  if (metadata?.table_name !== datasetName || metadata.dataset_appearance?.dataset_uid !== artifact.serverId
    || !Array.isArray(metadata.columns) || metadata.columns.some(column => !column || typeof column.column_name !== 'string')) {
    throw safeTestArtifactError('Invalid E2E dataset column ownership evidence');
  }
  recordTestDatasetColumns(datasetName, metadata.columns.map(column => column.column_name as string));
}
