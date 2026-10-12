/**
 * test-artifact-run-target.test.ts
 * Proves installation binding without contacting an application or database.
 * Bridges fake administrator API payloads and persisted run target validation.
 * Protects identity completeness, mismatch refusals and secret-free diagnostics.
 */
// @vitest-environment node
import type { APIRequestContext } from '@playwright/test';
import { expect, test, vi } from 'vitest';
import { assertArtifactRunTarget, readArtifactRunTarget, validateArtifactRunTarget } from './test-artifact-run-target';

const TARGET = { baseURL: 'https://original.invalid', databaseId: 'a'.repeat(32) };
function fakeRequest(payload: unknown = { data: [{ singleton_key: true, database_id: TARGET.databaseId }], row_count: 1 },
  status = 200, adminStatus = 200) {
  const get = vi.fn(async (url: string) => {
    const code = url === '/api/admin/version-info' ? adminStatus : status;
    return { ok: () => code === 200, status: () => code, json: async () => payload,
      text: async () => 'private-password-and-session-token' };
  });
  return { request: { get } as unknown as APIRequestContext, get };
}

test('records only the normalized URL and persistent singleton identity, never software versions or other row data', async () => {
  const { request, get } = fakeRequest({ row_count: 1,
    data: [{ singleton_key: true, database_id: TARGET.databaseId, notes: 'private-notes' }] });
  await expect(readArtifactRunTarget(request, `${TARGET.baseURL}/`)).resolves.toEqual(TARGET);
  expect(get).toHaveBeenCalledWith('/api/admin/version-info');
  expect(get).toHaveBeenCalledWith('/api/get-results', { params: { dataset: 'system_database_identity', offset: 0 } });
});

test.each([
  {}, { data: [], row_count: 0 }, { data: [{ database_id: TARGET.databaseId }], row_count: 1 },
  { data: [{ singleton_key: true, database_id: 'invalid' }], row_count: 1 },
  { data: [{ singleton_key: true, database_id: TARGET.databaseId }], row_count: 2 },
  { data: [{ singleton_key: true, database_id: TARGET.databaseId }] },
])('missing, partial or malformed installation identity refuses: %j', async (payload) => {
  const { request } = fakeRequest(payload);
  await expect(readArtifactRunTarget(request, TARGET.baseURL)).rejects.toThrow(/identity/);
});

test.each([[403, 200], [200, 403], [503, 200]])('API refusal %s/%s never logs response contents', async (status, adminStatus) => {
  const { request } = fakeRequest(undefined, status, adminStatus);
  await expect(readArtifactRunTarget(request, TARGET.baseURL)).rejects.toThrow(/HTTP request failed/);
  await expect(readArtifactRunTarget(request, TARGET.baseURL)).rejects.not.toThrow(/private-password/);
});

test('missing legacy target evidence refuses before API access', async () => {
  const { request, get } = fakeRequest();
  await expect(assertArtifactRunTarget(request, TARGET.baseURL, undefined)).rejects.toThrow(/target identity/);
  expect(get).not.toHaveBeenCalled();
});

test('the original target accepts the same persistent id after software version changes', async () => {
  const { request } = fakeRequest();
  await expect(assertArtifactRunTarget(request, `${TARGET.baseURL}/`, TARGET)).resolves.toBeUndefined();
});

test('embedded credentials never enter the run descriptor or diagnostics', () => {
  expect(() => validateArtifactRunTarget({ ...TARGET, baseURL: 'https://private-user:private-password@original.invalid' }))
    .toThrow('E2E baseURL must be an HTTP(S) origin without embedded credentials.');
});

test('malformed installation JSON never exposes a parser error containing response contents', async () => {
  const { request, get } = fakeRequest();
  get.mockImplementation(async () => ({ ok: () => true, status: () => 200,
    json: async () => { throw new Error('Unexpected private-password-and-session-token'); },
    text: async () => 'private-password-and-session-token' }));
  const failure = await readArtifactRunTarget(request, TARGET.baseURL).catch(error => error);
  expect(failure.message).toBe('operation=GET /api/get-results serverId=unknown status=200 reason=Malformed JSON response');
  expect(failure.cause).toBeUndefined();
});
