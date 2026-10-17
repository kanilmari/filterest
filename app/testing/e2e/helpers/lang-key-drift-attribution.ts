/**
 * Attributes retained E2E keys using exact run dataset names and current source evidence.
 * Connects teardown's inventory diff to registry ownership without retiring any keys.
 * Recorded columns and completed ownership explain dropped dataset sources.
 * Missing inventories, unrelated additions and every removal remain failures.
 */
export type LangKeySource = { source_type: string; source_high: string; source_low: string | null };
export type LangKeyDriftAttribution = {
  retainedOwnRun: string[];
  unexplainedAdded: string[];
  removed: string[];
};

export type DatasetColumns = ReadonlyMap<string, readonly string[]>;
export type LangKeyOwnership = {
  columnsByDataset: DatasetColumns;
  completedDatasetNames: ReadonlySet<string>;
};

/** Mirrors dataset_interface_label_creator.go, not arbitrary prefix/suffix combinations. */
export function ownRunDatasetForKey(
  key: string, datasetNames: readonly string[], columnsByDataset: DatasetColumns = new Map(),
): string | undefined {
  const matches = [...new Set(datasetNames)].filter(name => name !== '' && (
    [name, `add_row_${name}`, `search_for_${name}`, `search_slogan_${name}`, `${name}_front_page`].includes(key)
    || (columnsByDataset.get(name) ?? []).some(column => column !== ''
      && [column, `search_for_${column}`, `${column}_asc`, `${column}_desc`].includes(key))
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

export function isOwnRunDatasetKey(
  key: string, datasetNames: readonly string[], columnsByDataset?: DatasetColumns,
): boolean {
  return ownRunDatasetForKey(key, datasetNames, columnsByDataset) !== undefined;
}

export function sourceBelongsToRun(source: LangKeySource, datasetNames: readonly string[]): boolean {
  // Keep the lifecycle's counting rule: only these two types are bookkeeping.
  if (['orphan', 'manual_crud'].includes(source.source_type)) return true;
  if (source.source_type === 'foreign_key'
    && source.source_high === 'public.system_lang_key_translations.lang_key_id'
    && source.source_low === 'lang_key_id') return true;
  return datasetNames.some(name => {
    switch (source.source_type) {
      case 'table':
      case 'column': return source.source_high === name;
      case 'dataset_header':
        return source.source_high === name || source.source_high.startsWith(name + ':');
      case 'column_value': return source.source_high.startsWith(name + '.') && source.source_high.length > name.length + 1;
      case 'foreign_key':
        return source.source_high.startsWith(`public.${name}.`)
          && source.source_high.length > name.length + 8;
      default: return false; // Unknown source types still count and fail closed.
    }
  });
}

/** An explicit empty inventory after DROP needs completed ownership; absent inventories fail. */
export function attributeLangKeyDrift(
  added: string[], removed: string[], datasetNames: readonly string[],
  sourcesByKey: ReadonlyMap<string, readonly LangKeySource[]>,
  ownership?: LangKeyOwnership,
): LangKeyDriftAttribution {
  const retainedOwnRun: string[] = [];
  const unexplainedAdded: string[] = [];
  for (const key of added) {
    const sources = sourcesByKey.get(key);
    const owner = ownRunDatasetForKey(key, datasetNames, ownership?.columnsByDataset);
    const hasDatasetSource = sources?.some(source => !['orphan', 'manual_crud'].includes(source.source_type)
      && !(source.source_type === 'foreign_key'
        && source.source_high === 'public.system_lang_key_translations.lang_key_id'
        && source.source_low === 'lang_key_id'));
    const own = owner !== undefined && sources !== undefined
      && sources.every(source => sourceBelongsToRun(source, [owner]))
      && (hasDatasetSource || !ownership || ownership.completedDatasetNames.has(owner));
    (own ? retainedOwnRun : unexplainedAdded).push(key);
  }
  return { retainedOwnRun, unexplainedAdded, removed: [...removed] };
}
