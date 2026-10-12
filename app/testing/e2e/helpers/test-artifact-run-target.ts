/**
 * test-artifact-run-target.ts
 * Binds artifact runs to their original HTTP target and persistent database identity.
 * Bridges protected run descriptors and existing administrator/dataset read APIs.
 * Refuses foreign or unprovable targets without logging response bodies or secrets.
 */
import type { APIRequestContext } from '@playwright/test';
import {
  requestTestArtifactResponse, readTestArtifactJson, testArtifactFailure, safeTestArtifactFailure,
} from './test-artifact-diagnostics';

export type ArtifactRunTarget = { baseURL: string; databaseId: string };

export function normalizeE2EBaseURL(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch {
    throw testArtifactFailure('normalize E2E baseURL', 'E2E baseURL must be a valid HTTP(S) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw testArtifactFailure('normalize E2E baseURL', 'E2E baseURL must be an HTTP(S) origin without embedded credentials.');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return parsed.toString().replace(/\/$/, '');
}

/** Validates persisted evidence; legacy runs without a target cannot authorize recovery. */
export function validateArtifactRunTarget(value: unknown): ArtifactRunTarget {
  const target = value as Partial<ArtifactRunTarget> | null;
  if (!target || typeof target.baseURL !== 'string'
    || typeof target.databaseId !== 'string' || !/^[a-f0-9]{32}$/.test(target.databaseId)) {
    throw testArtifactFailure('verify artifact run target', 'Missing or invalid E2E artifact run target identity');
  }
  return { baseURL: normalizeE2EBaseURL(target.baseURL), databaseId: target.databaseId };
}

/** Only the singleton installation id is retained, never version-check history or row contents. */
export async function readArtifactRunTarget(
  request: APIRequestContext, baseURL: string,
): Promise<ArtifactRunTarget> {
  const normalizedURL = normalizeE2EBaseURL(baseURL);
  // This existing administrator-only route proves the inventory reader is an
  // administrator. Software versions alone cannot distinguish installations.
  await requestTestArtifactResponse('GET /api/admin/version-info', () => request.get('/api/admin/version-info'));
  const response = await requestTestArtifactResponse('GET /api/get-results', () => request.get('/api/get-results', {
    params: { dataset: 'system_database_identity', offset: 0 },
  }));
  const payload = await readTestArtifactJson<{ data?: unknown; row_count?: unknown }>(response, 'GET /api/get-results');
  if (!Array.isArray(payload?.data) || payload.data.length !== 1 || payload.row_count !== 1) {
    throw testArtifactFailure('GET /api/get-results',
      'Unprovable E2E installation identity: expected one complete singleton row', {}, response.status());
  }
  const row = payload.data[0] as { singleton_key?: unknown; database_id?: unknown } | null;
  if (row?.singleton_key !== true) {
    throw testArtifactFailure('GET /api/get-results', 'Unprovable E2E installation identity: missing singleton', {}, response.status());
  }
  try {
    return validateArtifactRunTarget({ baseURL: normalizedURL, databaseId: row.database_id });
  } catch (error) {
    throw safeTestArtifactFailure(error, 'GET /api/get-results', {}, response.status());
  }
}

/** Rechecks both target dimensions before inventory recovery and each name-only drop. */
export async function assertArtifactRunTarget(
  request: APIRequestContext, baseURL: string, recorded: unknown,
): Promise<void> {
  const expected = validateArtifactRunTarget(recorded);
  if (expected.baseURL !== normalizeE2EBaseURL(baseURL)) {
    throw testArtifactFailure('verify artifact run target', 'E2E artifact run target URL mismatch; no cleanup request was sent');
  }
  const current = await readArtifactRunTarget(request, baseURL);
  if (current.databaseId !== expected.databaseId) {
    throw testArtifactFailure('verify artifact run target', 'E2E artifact run installation identity mismatch; no cleanup request was sent');
  }
}
