/**
 * test-artifact-dataset-columns.test.ts
 * Proves column records require confirmed identity and survive per-test cleanup.
 * Connects disposable run history and authenticated metadata to exact columns.
 * Keeps corrupt, unowned and replaced identities from authorizing retention.
 */
// @vitest-environment node
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { confirmTestArtifact, initializeArtifactRunRegistry, registerTestArtifact,
  unregisterTestArtifact, listRegisteredTestArtifacts } from './test-artifact-run-registry';
import { readCompletedDatasetNames } from './test-artifact-dataset-history';
import { readRecordedDatasetColumns } from './test-artifact-dataset-columns';
import { recordTestDatasetColumns, recordTestDatasetColumnsFromRequest } from './test-artifact-dataset-column-recorder';
import type { APIRequestContext } from '@playwright/test';

let root: string;
let directory: string;
const name = 'e2e_column_owner_123_assets';
const runId = 'run-column-history';
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'filterest-column-history-'));
  directory = path.join(root, runId);
  initializeArtifactRunRegistry({ rootDirectory: root, runId });
  registerTestArtifact('dataset', name);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

test('confirmation records exact columns and idempotent additions survive unregister', () => {
  expect(() => recordTestDatasetColumns(name, ['id'])).toThrow(/planned/);
  confirmTestArtifact('dataset', name, 17, ['id', 'e2e_column_owner_123_id']);
  confirmTestArtifact('dataset', name, 17, ['id', 'new_column']);
  unregisterTestArtifact('dataset', name);
  expect(listRegisteredTestArtifacts()).toEqual([]);
  const names = readCompletedDatasetNames(directory, runId);
  expect(names).toEqual([name]);
  expect(readRecordedDatasetColumns(directory, runId, names).get(name)?.sort())
    .toEqual(['e2e_column_owner_123_id', 'id', 'new_column']);
});

test('column records alone cannot authorize an unowned dataset or another run', () => {
  confirmTestArtifact('dataset', name, 17, ['id']);
  expect(() => readRecordedDatasetColumns(directory, runId, [])).toThrow(/Invalid/);
  expect(() => readRecordedDatasetColumns(directory, 'run-other', [name])).toThrow(/Invalid/);
});

test.each(['name', 'runId', 'serverId', 'column'])('corrupt column evidence fails closed: %s', field => {
  confirmTestArtifact('dataset', name, 17, ['id']);
  const files = path.join(directory, 'dataset-columns');
  const file = path.join(files, fs.readdirSync(files)[0]);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  record[field] = field === 'serverId' ? 0 : 'other';
  fs.writeFileSync(file, JSON.stringify(record));
  expect(() => readRecordedDatasetColumns(directory, runId, [name])).toThrow(/Invalid/);
});

test('a managed child records actual metadata only after matching its current UID', async () => {
  confirmTestArtifact('dataset', name, 17);
  let uid = 18;
  const request = { get: async () => ({ ok: () => true, status: () => 200,
    json: async () => ({ table_name: name, dataset_appearance: { dataset_uid: uid },
      columns: [{ column_name: 'e2e_column_owner_123_id' }, { column_name: 'id' }] }) }) } as unknown as APIRequestContext;
  await expect(recordTestDatasetColumnsFromRequest(request, name)).rejects.toThrow(/Invalid/);
  expect(readRecordedDatasetColumns(directory, runId, [name]).size).toBe(0);
  uid = 17;
  await recordTestDatasetColumnsFromRequest(request, name);
  expect(readRecordedDatasetColumns(directory, runId, [name]).get(name)?.sort())
    .toEqual(['e2e_column_owner_123_id', 'id']);
});
