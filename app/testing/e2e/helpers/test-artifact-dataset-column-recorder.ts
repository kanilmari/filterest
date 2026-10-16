/**
 * test-artifact-dataset-column-recorder.ts
 * Captures managed children's actual columns before cleanup removes their metadata.
 * Binds the authenticated metadata response to the registry's confirmed stable identity.
 * Transport, identity and persistence failures propagate without authorizing key retention.
 */
import type { APIRequestContext } from '@playwright/test';
import * as path from 'node:path';
import { confirmTestArtifact, registerTestArtifact, requireConfirmedTestArtifact,
  resolveArtifactRegistryRoot } from './test-artifact-run-registry';
import { rememberConfirmedDatasetColumns } from './test-artifact-dataset-columns';
import { readTestArtifactJson, requestTestArtifactResponse, safeTestArtifactError } from './test-artifact-diagnostics';

export function recordTestDatasetColumns(datasetName: string, columns: readonly string[]): void {
  const artifact = requireConfirmedTestArtifact('dataset', datasetName);
  rememberConfirmedDatasetColumns(path.join(resolveArtifactRegistryRoot(), artifact.runId), artifact, columns);
}

async function readDatasetColumns(
  request: APIRequestContext, datasetName: string, expectedServerId?: number,
): Promise<{ serverId: number; columns: string[] }> {
  const operation = 'GET /api/card-visibility (E2E dataset column ownership)';
  const response = await requestTestArtifactResponse(operation,
    () => request.get(`/api/card-visibility/${encodeURIComponent(datasetName)}`));
  const metadata = await readTestArtifactJson<{ table_name?: unknown; columns?: Array<{ column_name?: unknown }>;
    dataset_appearance?: { dataset_uid?: unknown } }>(response, operation);
  const serverId = metadata?.dataset_appearance?.dataset_uid;
  if (metadata?.table_name !== datasetName || !Number.isSafeInteger(serverId) || Number(serverId) <= 0
    || (expectedServerId !== undefined && serverId !== expectedServerId)
    || !Array.isArray(metadata.columns) || metadata.columns.some(column => !column || typeof column.column_name !== 'string')) {
    throw safeTestArtifactError('Invalid E2E dataset column ownership evidence');
  }
  return { serverId: serverId as number, columns: metadata.columns.map(column => column.column_name as string) };
}

/** Capture server-generated columns before dropping a managed child, checking its current UID. */
export async function recordTestDatasetColumnsFromRequest(
  request: APIRequestContext, datasetName: string,
): Promise<void> {
  const artifact = requireConfirmedTestArtifact('dataset', datasetName);
  const metadata = await readDatasetColumns(request, datasetName, artifact.serverId!);
  recordTestDatasetColumns(datasetName, metadata.columns);
}

/**
 * Prove server-created asset children before the parent's drop removes their metadata.
 * The existing status API binds the exact child to an owned, UID-checked parent;
 * confirmed registry/column records then use the ordinary immutable ownership path.
 * Leave children registered until cleanup proves absence, including after a failed drop.
 */
export async function recordTestDatasetOwnershipFromRequest(
  request: APIRequestContext, datasetName: string,
): Promise<void> {
  const parent = requireConfirmedTestArtifact('dataset', datasetName);
  await recordTestDatasetColumnsFromRequest(request, datasetName);
  const operation = 'GET /api/asset-linking/status (E2E asset child ownership)';
  const response = await requestTestArtifactResponse(operation,
    () => request.get(`/api/asset-linking/status?table=${encodeURIComponent(datasetName)}`));
  type Relation = { parent_table?: unknown; child_table?: unknown; relation_id?: unknown; foreign_key_column?: unknown };
  const metadata = await readTestArtifactJson<{ image_asset_linkings?: Relation[];
    attachment_asset_linkings?: Relation[] }>(response, operation);
  const invalid = () => safeTestArtifactError('Invalid E2E asset child ownership evidence');
  if (!Array.isArray(metadata?.image_asset_linkings) || !Array.isArray(metadata?.attachment_asset_linkings)) throw invalid();
  const relations = [...metadata.image_asset_linkings, ...metadata.attachment_asset_linkings];
  const childName = `${datasetName}_assets`;
  for (const relation of relations) {
    if (!relation || relation.parent_table !== datasetName || relation.child_table !== childName
      || !Number.isSafeInteger(relation.relation_id) || Number(relation.relation_id) <= 0
      || typeof relation.foreign_key_column !== 'string' || !relation.foreign_key_column.trim()
      || relation.relation_id !== relations[0].relation_id
      || relation.foreign_key_column !== relations[0].foreign_key_column) throw invalid();
  }
  if (relations.length === 0) return; // An existing name alone grants no ownership.
  const child = await readDatasetColumns(request, childName);
  if (child.serverId === parent.serverId || !child.columns.includes(relations[0].foreign_key_column as string)
    || child.columns.some(column => !column || column.trim() !== column || column.length > 512 || column.includes('\0'))) throw invalid();
  // Status names tables rather than UIDs. Refuse a parent replaced during these reads.
  await recordTestDatasetColumnsFromRequest(request, datasetName);
  registerTestArtifact('dataset', childName);
  confirmTestArtifact('dataset', childName, child.serverId, child.columns);
}
