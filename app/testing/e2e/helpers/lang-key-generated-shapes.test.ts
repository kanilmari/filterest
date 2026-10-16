/**
 * lang-key-generated-shapes.test.ts
 * Reproduces the native attachment-column drift without contacting a service.
 * Connects backend generator shapes to exact dataset and column ownership.
 * Keeps foreign, ambiguous and unverified additions from being retained.
 */
import { expect, test } from 'vitest';
import { attributeLangKeyDrift, isOwnRunDatasetKey } from './lang-key-drift-attribution';

const dataset = 'e2e_article_toolbar_mvancqsh_ttlob3';
const sibling = `${dataset}_assets`;
const other = 'e2e_card_texts_fi_mvanh9o1_wa0n56';
const names = [dataset, sibling, other];
const columnsByDataset = new Map([[dataset, ['title']], [sibling, [`${dataset}_id`]], [other, ['id']]]);
const ownership = { columnsByDataset, completedDatasetNames: new Set(names) };
// These fourteen literal templates match the native finding, including the
// parent's FK column in the separately registered asset dataset (not the parent).
const fourteen = [dataset, `${dataset}_front_page`, `add_row_${dataset}`,
  `search_for_${dataset}`, `search_slogan_${dataset}`,
  `${dataset}_assets`, `${dataset}_assets_front_page`, `add_row_${dataset}_assets`,
  `search_for_${dataset}_assets`, `search_slogan_${dataset}_assets`,
  `${dataset}_id`, `${dataset}_id_asc`, `${dataset}_id_desc`, `search_for_${dataset}_id`];
const second = [other, `${other}_front_page`, `add_row_${other}`, `search_for_${other}`,
  `search_slogan_${other}`, 'id', 'id_asc', 'id_desc', 'search_for_id'];
const sources = (keys: string[]) => new Map(keys.map(key => [key, []]));

test('all EXACT fourteen native shapes plus a second dataset with column id are attributed', () => {
  const keys = [...fourteen, ...second];
  expect(fourteen).toHaveLength(14);
  expect(keys.filter(key => isOwnRunDatasetKey(key, names, columnsByDataset))).toEqual(keys);
  expect(attributeLangKeyDrift(keys, [], names, sources(keys), ownership)).toEqual({
    retainedOwnRun: keys, unexplainedAdded: [], removed: [],
  });
});

test.each(['e2e_not_in_this_run', `${dataset}_different_suffix`, `${dataset}_missing_column`,
  `${dataset}_missing_column_asc`, `search_for_${dataset}_missing_column`, `${dataset}_asc`])(
  'negative control: unowned dataset, suffix or column fails: %s', key => {
    expect(attributeLangKeyDrift([key], [], names, sources([key]), ownership)).toEqual({
      retainedOwnRun: [], unexplainedAdded: [key], removed: [],
    });
  },
);

test('a removed key still fails even alongside all accepted native additions', () => {
  expect(attributeLangKeyDrift(fourteen, [dataset], names, sources(fourteen), ownership)).toEqual({
    retainedOwnRun: fourteen, unexplainedAdded: [], removed: [dataset],
  });
});

test('a column name shared by two owned datasets is ambiguous and fails', () => {
  const columns = new Map([...columnsByDataset, [dataset, ['id']]]);
  expect(attributeLangKeyDrift(['id_asc'], [], names, sources(['id_asc']), {
    ...ownership, columnsByDataset: columns,
  }).unexplainedAdded).toEqual(['id_asc']);
});

test('another own dataset cannot supply counting evidence for the uniquely matched key', () => {
  const key = `${dataset}_id`;
  const evidence = new Map([[key, [{ source_type: 'column', source_high: dataset, source_low: key }]]]);
  expect(attributeLangKeyDrift([key], [], names, evidence, ownership).unexplainedAdded).toEqual([key]);
});

test('absent dataset sources need completed ownership; missing inventory is still a failure', () => {
  const key = `add_row_${dataset}`;
  expect(attributeLangKeyDrift([key], [], names, sources([key]), {
    ...ownership, completedDatasetNames: new Set<string>(),
  }).unexplainedAdded).toEqual([key]);
  expect(attributeLangKeyDrift([key], [], names, new Map(), ownership).unexplainedAdded).toEqual([key]);
});

test('remaining column evidence and translations-only evidence respect the matched owner and history', () => {
  const key = `${dataset}_id_asc`;
  const column = { source_type: 'column', source_high: sibling, source_low: `${dataset}_id` };
  const translation = { source_type: 'foreign_key', source_high: 'public.system_lang_key_translations.lang_key_id',
    source_low: 'lang_key_id' };
  const active = { ...ownership, completedDatasetNames: new Set<string>() };
  expect(attributeLangKeyDrift([key], [], names, new Map([[key, [column, translation]]]), active).retainedOwnRun)
    .toEqual([key]);
  expect(attributeLangKeyDrift([key], [], names, new Map([[key, [translation]]]), active).unexplainedAdded)
    .toEqual([key]);
  expect(attributeLangKeyDrift([key], [], names, new Map([[key, [translation]]]), ownership).retainedOwnRun)
    .toEqual([key]);
});
