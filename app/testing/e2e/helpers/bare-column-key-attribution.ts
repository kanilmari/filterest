/**
 * bare-column-key-attribution.ts
 * Attributes unprefixed column labels using complete evidence saved before drops.
 * Extends dataset-specific attribution with recorded columns shared within one run.
 * Never treats an empty post-drop inventory as proof of a bare key's ownership.
 */
import { attributeLangKeyDrift, type DatasetColumns, type LangKeyOwnership,
  type LangKeySource } from './lang-key-drift-attribution';

/** Exact columnInterfaceLabels shapes in backend/core_components/lang/dataset_interface_label_creator.go. */
export const generatedColumnKeys = (column: string): string[] =>
  [column, `${column}_asc`, `${column}_desc`, `search_for_${column}`];

/** Prefixes only distinguish existing dataset-qualified attribution; records still prove ownership. */
export function isBareColumn(column: string, datasetNames: readonly string[]): boolean {
  return column !== '' && !datasetNames.some(name => name !== '' && column.startsWith(`${name}_`));
}

/** A shared column may have several owned datasets; arbitrary suffixes never match. */
export function bareColumnForKey(
  key: string, datasetNames: readonly string[], columnsByDataset: DatasetColumns,
): string | undefined {
  const columns = new Set(datasetNames.flatMap(name => columnsByDataset.get(name) ?? []));
  const matches = [...columns].filter(column => isBareColumn(column, datasetNames)
    && generatedColumnKeys(column).includes(key));
  return matches.length === 1 ? matches[0] : undefined;
}

function isBookkeeping(source: LangKeySource): boolean {
  return ['orphan', 'manual_crud'].includes(source.source_type)
    || (source.source_type === 'foreign_key'
      && source.source_high === 'public.system_lang_key_translations.lang_key_id'
      && source.source_low === 'lang_key_id');
}

/** Every counting source must identify the exact recorded column in an owned dataset. */
export function bareColumnKeyEvidence(
  key: string, datasetNames: readonly string[], columnsByDataset: DatasetColumns,
  preDropSources: ReadonlyMap<string, readonly LangKeySource[]>,
) {
  const column = bareColumnForKey(key, datasetNames, columnsByDataset);
  const sources = preDropSources.get(key);
  const counting = sources?.filter(source => !isBookkeeping(source));
  if (!column || !counting?.length || counting.some(source => source.source_type !== 'column'
    || source.source_low !== column || !datasetNames.includes(source.source_high)
    || !columnsByDataset.get(source.source_high)?.includes(column))) return undefined;
  return { key, datasets: [...new Set(counting.map(source => source.source_high))].sort(), column,
    ownership: 'confirmed-pre-drop-column-records', countingSources: 'verified-pre-drop-column-sources',
    columnSources: counting };
}

/** Teardown's strict entry point: only added drift reaches it; baseline keys are never accepted. */
export function attributeRecordedLangKeyDrift(
  added: string[], removed: string[], datasetNames: readonly string[],
  sourcesByKey: ReadonlyMap<string, readonly LangKeySource[]>, ownership: LangKeyOwnership,
  preDropSources: ReadonlyMap<string, readonly LangKeySource[]>,
) {
  // Preserve the existing dataset-qualified policy and its regression contracts.
  // Bare columns always take the pre-drop path, even with a unique recorded owner.
  const qualifiedColumns = new Map([...ownership.columnsByDataset].map(([name, columns]) =>
    [name, columns.filter(column => !isBareColumn(column, datasetNames))] as const));
  const qualified = attributeLangKeyDrift(added, removed, datasetNames, sourcesByKey,
    { ...ownership, columnsByDataset: qualifiedColumns });
  const accepted = new Set(qualified.retainedOwnRun);
  const bareKeys = new Set(datasetNames.flatMap(name => ownership.columnsByDataset.get(name) ?? [])
    .filter(column => isBareColumn(column, datasetNames)).flatMap(generatedColumnKeys));
  for (const key of added) {
    if (!bareKeys.has(key)) continue;
    accepted.delete(key);
    const current = sourcesByKey.get(key);
    if (bareColumnKeyEvidence(key, datasetNames, ownership.columnsByDataset, preDropSources)
      && current !== undefined && (current.every(isBookkeeping)
        || bareColumnKeyEvidence(key, datasetNames, ownership.columnsByDataset, new Map([[key, current]])))) {
      accepted.add(key);
    }
  }
  return { retainedOwnRun: added.filter(key => accepted.has(key)),
    unexplainedAdded: added.filter(key => !accepted.has(key)), removed: [...removed] };
}
