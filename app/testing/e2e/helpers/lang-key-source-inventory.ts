/**
 * Reads complete current source evidence through existing authenticated row APIs.
 * Teardown uses this after dataset cleanup; an unavailable or partial inventory fails closed.
 * No language-key mutation or alternate authentication path belongs here.
 */
import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import type { LangKeySource } from './lang-key-drift-attribution';
import { readTestArtifactJson, requestTestArtifactResponse, testArtifactFailure } from './test-artifact-diagnostics';

type Row = Record<string, unknown> & { id: number };
const OPERATION = 'GET /api/get-results (language-key attribution)';
const invalid = () => testArtifactFailure(OPERATION, 'Incomplete or malformed language-key source inventory');

async function readExactRows(
  request: APIRequestContext, dataset: string, column: string, value: string | number,
): Promise<Row[]> {
  const rows: Row[] = [];
  let total: number | undefined;
  let lastID = 0;
  do {
    const response = await requestTestArtifactResponse(OPERATION, () => request.get('/api/get-results', {
      params: { dataset, view_key: 'table', [`${column}_from`]: value, [`${column}_to`]: value,
        offset: rows.length, sort_column: 'id', sort_order: 'ASC' },
    }));
    const payload = await readTestArtifactJson<{ data?: unknown; row_count?: unknown }>(response, OPERATION);
    if (!payload || !Array.isArray(payload.data) || !Number.isSafeInteger(payload.row_count)
      || Number(payload.row_count) < 0 || (total !== undefined && total !== payload.row_count)) throw invalid();
    total = Number(payload.row_count);
    for (const row of payload.data) {
      if (!row || typeof row !== 'object' || !Number.isSafeInteger(row.id) || row.id <= lastID
        || row[column] !== value) throw invalid();
      lastID = row.id;
      rows.push(row);
    }
    if (rows.length > total || (payload.data.length === 0 && rows.length < total)) throw invalid();
  } while (rows.length < total);
  return rows;
}

export async function readLangKeySources(
  request: APIRequestContext, keys: readonly string[],
): Promise<Map<string, LangKeySource[]>> {
  const sourcesByKey = new Map<string, LangKeySource[]>();
  if (!keys.length) return sourcesByKey;
  // An ordinary reader's filtered inventory cannot establish absence of other uses.
  await requestTestArtifactResponse('GET /api/admin/version-info', () => request.get('/api/admin/version-info'));
  for (const key of keys) {
    const matches = await readExactRows(request, 'system_lang_keys', 'lang_key', key);
    if (matches.length !== 1) throw invalid();
    const sources = await readExactRows(request, 'system_lang_key_sources', 'lang_key_id', matches[0].id);
    sourcesByKey.set(key, sources.map(row => {
      if (typeof row.source_type !== 'string' || !row.source_type
        || typeof row.source_high !== 'string'
        || (row.source_low !== null && typeof row.source_low !== 'string')) throw invalid();
      return { source_type: row.source_type, source_high: row.source_high, source_low: row.source_low };
    }));
  }
  return sourcesByKey;
}

export async function readLangKeySourcesWithStorageState(
  baseURL: string, storageState: string, keys: readonly string[],
): Promise<Map<string, LangKeySource[]>> {
  if (!keys.length) return new Map();
  const request = await playwrightRequest.newContext({ baseURL, storageState,
    ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } });
  try { return await readLangKeySources(request, keys); } finally { await request.dispose(); }
}
