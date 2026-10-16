/**
 * bare-column-key-attribution.test.ts
 * Proves bare-key ownership requires exact columns and positive pre-drop evidence.
 * Connects the strict teardown entry point to unique and shared column owners.
 * Keeps the existing dataset-qualified policy separate from bare-name proof.
 */
import { expect, test } from 'vitest';
import { attributeRecordedLangKeyDrift } from './bare-column-key-attribution';
import type { LangKeySource } from './lang-key-drift-attribution';

const dataset = 'e2e_child_run207';
const keys = ['parent_ref', 'parent_ref_asc', 'parent_ref_desc', 'search_for_parent_ref'];
const ownership = { columnsByDataset: new Map([[dataset, ['parent_ref']]]), completedDatasetNames: new Set([dataset]) };
const afterDrop = new Map(keys.map(key => [key, []]));
const column: LangKeySource = { source_type: 'column', source_high: dataset, source_low: 'parent_ref' };

test('one exact owner needs positive pre-drop column sources for every bare generator shape', () => {
  const beforeDrop = new Map(keys.map(key => [key, [column]]));
  expect(attributeRecordedLangKeyDrift(keys, [], [dataset], afterDrop, ownership, beforeDrop)).toEqual({
    retainedOwnRun: keys, unexplainedAdded: [], removed: [],
  });
});

test('one exact owner cannot fall back to empty sources after drop', () => {
  expect(attributeRecordedLangKeyDrift(keys, [], [dataset], afterDrop, ownership, new Map())).toEqual({
    retainedOwnRun: [], unexplainedAdded: keys, removed: [],
  });
});

test('missing current inventory still fails despite positive pre-drop evidence', () => {
  expect(attributeRecordedLangKeyDrift(keys, [], [dataset], new Map(), ownership,
    new Map(keys.map(key => [key, [column]]))).unexplainedAdded).toEqual(keys);
});

test('a recorded bare column alone cannot name a dataset outside confirmed run ownership', () => {
  const foreign = 'app_other_dataset';
  const evidence = new Map(keys.map(key => [key, [{ ...column, source_high: foreign }]]));
  expect(attributeRecordedLangKeyDrift(keys, [], [dataset], afterDrop,
    { ...ownership, columnsByDataset: new Map([[dataset, ['parent_ref']], [foreign, ['parent_ref']]]) },
    evidence).unexplainedAdded).toEqual(keys);
});

test('a key mapping to two different bare column names remains ambiguous', () => {
  const columnsByDataset = new Map([[dataset, ['parent_ref', 'parent_ref_asc']]]);
  const key = 'parent_ref_asc';
  expect(attributeRecordedLangKeyDrift([key], [], [dataset], afterDrop,
    { ...ownership, columnsByDataset }, new Map([[key, [column]]])).unexplainedAdded).toEqual([key]);
});

test('an ambiguous bare shape cannot fall back to matching a dataset label', () => {
  const key = 'parent_ref_asc';
  const columnsByDataset = new Map([[dataset, ['parent_ref', key]]]);
  expect(attributeRecordedLangKeyDrift([key], [], [dataset, key], afterDrop,
    { columnsByDataset, completedDatasetNames: new Set([dataset, key]) },
    new Map([[key, [column]]])).unexplainedAdded).toEqual([key]);
});
