/** Proves retained dataset keys require exact run ownership and complete source evidence. */
import { expect, test } from 'vitest';
import { attributeLangKeyDrift } from './lang-key-drift-attribution';

const dataset = 'e2e_article_toolbar_child_run123';
const ownKey = `add_row_${dataset}`;
const translations = {
  source_type: 'foreign_key',
  source_high: 'public.system_lang_key_translations.lang_key_id',
  source_low: 'lang_key_id',
};

test('own-run generated keys are accepted after their dataset sources disappear', () => {
  const added = [dataset, ownKey, `search_for_${dataset}`, `${dataset}_front_page`];
  const sources = new Map(added.map(key => [key, key === ownKey ? [translations] : []]));
  expect(attributeLangKeyDrift(added, [], [dataset], sources)).toEqual({
    retainedOwnRun: added, unexplainedAdded: [], removed: [],
  });
});

test('own dataset sources and non-counting bookkeeping may remain', () => {
  const sources = [translations,
    { source_type: 'table', source_high: dataset, source_low: dataset },
    { source_type: 'column', source_high: dataset, source_low: 'title' },
    { source_type: 'dataset_header', source_high: `${dataset}:title`, source_low: '' },
    { source_type: 'column_value', source_high: `${dataset}.title`, source_low: 'value' },
    { source_type: 'foreign_key', source_high: `public.${dataset}.label_id`, source_low: 'label_id' },
    { source_type: 'orphan', source_high: 'consistency_scan', source_low: '' },
    { source_type: 'manual_crud', source_high: 'admin_ui', source_low: '' },
  ];
  expect(attributeLangKeyDrift([ownKey], [], [dataset], new Map([[ownKey, sources]])))
    .toEqual({ retainedOwnRun: [ownKey], unexplainedAdded: [], removed: [] });
});

test.each(['unrelated_added_key', 'add_row_e2e_another_run', `${ownKey}_other`, `x${ownKey}`])(
  'negative control: unrelated or similar-name addition still fails: %s', key => {
    expect(attributeLangKeyDrift([key], [], [dataset], new Map([[key, []]])))
      .toEqual({ retainedOwnRun: [], unexplainedAdded: [key], removed: [] });
  },
);

test('every removed baseline key still fails, even an own-run-looking name', () => {
  expect(attributeLangKeyDrift([ownKey], ['existing_key', dataset], [dataset], new Map([[ownKey, []]])))
    .toEqual({ retainedOwnRun: [ownKey], unexplainedAdded: [], removed: ['existing_key', dataset] });
});

test.each([
  ['table', `${dataset}_other`], ['column_value', `${dataset}_other.title`],
  ['foreign_key', 'public.other_dataset.label_id'], ['foreign_key', 'public.system_lang_key_translations.other'],
  ['code', dataset], ['future_source', dataset], ['folder', dataset],
])('negative control: own-looking key with another counting source fails: %s/%s', (type, high) => {
  const sources = [translations, { source_type: type, source_high: high, source_low: '' }];
  expect(attributeLangKeyDrift([ownKey], [], [dataset], new Map([[ownKey, sources]])))
    .toEqual({ retainedOwnRun: [], unexplainedAdded: [ownKey], removed: [] });
});

test('missing source evidence cannot be mistaken for a verified empty inventory', () => {
  expect(attributeLangKeyDrift([ownKey], [], [dataset], new Map()))
    .toEqual({ retainedOwnRun: [], unexplainedAdded: [ownKey], removed: [] });
});
