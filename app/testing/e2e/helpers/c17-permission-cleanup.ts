// c17-permission-cleanup.ts
// Removes C17's owned permission identities and detects leftover reader groups without writes.
// Connects the browser spec's authenticated API adapter with socket-free lifecycle tests.
// Keeps verification failures visible without stranding grants owned by this test.
import assert from 'node:assert/strict';
import type { APIRequestContext } from '@playwright/test';
import { fetchCsrfTokenForRequest } from './test-artifact-csrf-reader';

export const C17_READER_GROUP_PREFIX = 'e2e_c17_card_reader_';
export const READER_VIEW_ROUTES = [
  { name: 'ui.view.card', endpoint: '/ui/view/card' },
  { name: 'ui.view.article_view', endpoint: '/ui/view/article_view' },
] as const;
export type AccessRow = { id: number } & Record<string, unknown>;
export type ReaderAccess = {
  groupName: string;
  groupId: number | null;
  groupCreated: boolean;
  viewGrants: Array<{ functionId: number; grantId: number | null }>;
  userId: number | null;
  membershipId: number | null;
};
export type GuestGrant = { functionId: number; before: AccessRow[]; ownedId: number | null; marker: string };
export type AccessAPI = {
  readRows(dataset: string, fields: Record<string, string | number>): Promise<AccessRow[]>;
  deleteRows(dataset: string, ids: number[]): Promise<void>;
};
export type PermissionCleanupStep = { name: string; run(request: APIRequestContext): Promise<unknown> };
const GROUPS = 'system_user_groups';
const RIGHTS = 'system_group_table_func_rights';
const MEMBERS = 'system_user_group_memberships';

async function attempt(errors: unknown[], action: () => Promise<void>): Promise<void> {
  try { await action(); } catch (error) { errors.push(error); }
}

function report(errors: unknown[], message: string): void {
  if (errors.length) throw new AggregateError(errors, message);
}

/** Exhaust pagination so diagnostics and identity checks cannot miss later rows. */
async function readAllRows(request: APIRequestContext, dataset: string, bounds: Record<string, string>): Promise<AccessRow[]> {
  const query = new URLSearchParams({ dataset, view_key: 'table', sort_column: 'id', sort_order: 'asc', ...bounds });
  const rows: AccessRow[] = [];
  for (;;) {
    query.set('offset', String(rows.length));
    const response = await request.get(`/api/get-results?${query}`);
    assert(response.ok(), await response.text());
    const { data } = await response.json() as { data: AccessRow[] };
    assert(Array.isArray(data), `C17: invalid ${dataset} inventory`);
    if (!data.length) return rows;
    for (const row of data) {
      assert(Number.isSafeInteger(row.id) && row.id > 0, `C17: invalid ${dataset} row identity`);
      assert(row.id > (rows.at(-1)?.id ?? 0), `C17: unordered/repeated ${dataset} inventory; refusing incomplete ownership proof`);
      rows.push(row);
    }
  }
}

/** Uses equal bounds for exact identities; no SQL or wildcard deletion is involved. */
export async function readC17AccessRows(request: APIRequestContext, dataset: string,
  fields: Record<string, string | number>): Promise<AccessRow[]> {
  const bounds: Record<string, string> = {};
  for (const [field, value] of Object.entries(fields)) {
    bounds[`${field}_from`] = bounds[`${field}_to`] = String(value);
  }
  const rows = await readAllRows(request, dataset, bounds);
  for (const row of rows) for (const [field, value] of Object.entries(fields)) assert.equal(row[field], value);
  return rows;
}

/** GET-only inventory shared by C17 and C26; a prefix never authorizes deletion. */
export async function readC17ReaderGroups(request: APIRequestContext): Promise<AccessRow[]> {
  const rows = await readAllRows(request, GROUPS, {
    name_from: C17_READER_GROUP_PREFIX, name_to: `${C17_READER_GROUP_PREFIX}\uffff`,
  });
  // The server's text collation can include adjacent names; never treat those as ours.
  return rows.filter(row => typeof row.name === 'string' && row.name.startsWith(C17_READER_GROUP_PREFIX)
    && row.name.length > C17_READER_GROUP_PREFIX.length);
}

/** Request-only CRUD: teardown never depends on a page that a timeout can close. */
export function c17AccessAPI(request: APIRequestContext): AccessAPI {
  return {
    readRows: (dataset, fields) => readC17AccessRows(request, dataset, fields),
    async deleteRows(dataset, ids) {
      const response = await request.post(`/api/delete-rows?dataset=${dataset}`, {
        headers: { 'X-CSRF-Token': await fetchCsrfTokenForRequest(request) }, data: { ids },
      });
      assert(response.ok(), await response.text());
    },
  };
}

/** Arm immediately after create, before any grant/membership verification. */
export function registerReaderAccessCleanup(steps: PermissionCleanupStep[], access: ReaderAccess): void {
  steps.push({ name: `Remove owned C17 reader group ${access.groupName}`,
    run: request => removeReaderArticleAccess(c17AccessAPI(request), access) });
}

/** Arm before POST as well: the response/readback may be interrupted after commit. */
export function registerGuestGrantCleanup(steps: PermissionCleanupStep[], groupId: number, grants: GuestGrant[]): void {
  steps.push({ name: 'Restore owned C17 guest grants',
    run: request => restoreGuestUIGrants(c17AccessAPI(request), groupId, grants) });
}

async function assertGroupIdentity(api: AccessAPI, id: number, name: string): Promise<void> {
  const byId = await api.readRows(GROUPS, { id });
  const byName = await api.readRows(GROUPS, { name });
  const refusal = `Refusing to delete a replacement C17 reader group ${JSON.stringify(name)} (recorded id ${id})`;
  assert.equal(byId.length, 1, refusal);
  assert.equal(byName.length, 1, refusal);
  assert.equal(byId[0].name, name, refusal);
  assert.equal(byId[0].id, id, refusal);
  assert.equal(byName[0].id, id, refusal);
  assert.equal(byName[0].name, name, refusal);
}

async function proveGroupCascade(api: AccessAPI, id: number, name: string, errors: unknown[]): Promise<void> {
  await attempt(errors, async () => assert.deepEqual(await api.readRows(GROUPS, { id }), [], 'C17 group id remains'));
  await attempt(errors, async () => assert.deepEqual(await api.readRows(GROUPS, { name }), [], 'C17 group name remains'));
  await attempt(errors, async () => assert.deepEqual(await api.readRows(RIGHTS, { user_group_id: id }), [], 'C17 rights remain after cascade'));
  await attempt(errors, async () => assert.deepEqual(await api.readRows(MEMBERS, { group_id: id }), [], 'C17 membership remains after cascade'));
}

/** Only group identity can refuse deletion; child drift is reported after cascade. */
export async function removeReaderArticleAccess(api: AccessAPI, access: ReaderAccess): Promise<void> {
  if (!access.groupCreated) {
    assert.equal(access.groupId, null, 'C17 reader cleanup has no creation proof for the recorded group');
    return;
  }
  if (access.groupId === null && access.groupCreated) {
    // The create API returns no id. Recover only the exact name proved absent before creation.
    const groups = await api.readRows(GROUPS, { name: access.groupName });
    assert(groups.length <= 1, `C17: ambiguous created group ${access.groupName}`);
    if (groups[0]) access.groupId = groups[0].id;
  }
  if (access.groupId === null) return;
  const id = access.groupId;
  const errors: unknown[] = [];
  try {
    await attempt(errors, () => assertGroupIdentity(api, id, access.groupName));
    await attempt(errors, async () => {
      const grants = await api.readRows(RIGHTS, { user_group_id: id });
      for (const grant of grants) {
        assert(access.viewGrants.some(view => view.functionId === grant.function_id), 'Unexpected grant inside the owned C17 group');
      }
      for (const view of access.viewGrants) {
        const matches = grants.filter(grant => grant.function_id === view.functionId);
        assert(matches.length <= 1, 'Duplicate grant inside the owned C17 group');
        if (matches[0]) {
          assert.equal(matches[0].target_schema_name, 'public');
          assert.equal(matches[0].target_table_uid, null);
          if (view.grantId !== null) assert.equal(matches[0].id, view.grantId, 'Changed reader view grant inside the owned C17 group');
        } else assert.equal(view.grantId, null, 'Recorded reader view grant is missing');
      }
    });
    await attempt(errors, async () => {
      const members = await api.readRows(MEMBERS, { group_id: id });
      assert(members.length <= 1, 'Unexpected memberships inside the owned C17 group');
      if (members[0]) {
        assert.equal(members[0].user_id, access.userId, 'Changed reader inside the owned C17 group');
        if (access.membershipId !== null) assert.equal(members[0].id, access.membershipId, 'Changed membership inside the owned C17 group');
      } else assert.equal(access.membershipId, null, 'Recorded reader membership is missing');
    });
  } finally {
    await attempt(errors, async () => {
      await assertGroupIdentity(api, id, access.groupName);
      // The migration-owned foreign keys cascade both rights and memberships.
      await api.deleteRows(GROUPS, [id]);
    });
    await proveGroupCascade(api, id, access.groupName, errors);
  }
  report(errors, `C17 reader-access cleanup failed for ${access.groupName} (id ${id})`);
}

function assertGuestIdentity(row: AccessRow, groupId: number, grant: GuestGrant): void {
  const refusal = `Refusing to delete a replacement guest grant (${grant.marker}, recorded id ${grant.ownedId})`;
  assert.equal(row.id, grant.ownedId, refusal);
  assert.equal(row.user_group_id, groupId, refusal);
  assert.equal(row.function_id, grant.functionId, refusal);
  assert.equal(row.target_schema_name, 'public', refusal);
  assert.equal(row.target_table_uid, null, refusal);
}

/** A readback failure cannot bypass deletion of an independently identified owned row. */
export async function restoreGuestUIGrants(api: AccessAPI, groupId: number, grants: GuestGrant[]): Promise<void> {
  const errors: unknown[] = [];
  for (const grant of [...grants].reverse()) {
    const fields = { user_group_id: groupId, function_id: grant.functionId };
    try {
      await attempt(errors, async () => {
        const current = await api.readRows(RIGHTS, fields);
        const added = current.filter(row => !grant.before.some(original => original.id === row.id));
        assert(added.length <= 1, `Ambiguous guest grant readback (${grant.marker})`);
        if (grant.ownedId === null && added[0]) {
          // Partial setup: adopt only one new row with the exact expected scope.
          assert.equal(added[0].user_group_id, groupId);
          assert.equal(added[0].function_id, grant.functionId);
          assert.equal(added[0].target_schema_name, 'public');
          assert.equal(added[0].target_table_uid, null);
          grant.ownedId = added[0].id;
        }
        if (added[0]) assertGuestIdentity(added[0], groupId, grant);
        else assert.equal(grant.ownedId, null, 'Recorded guest grant is missing');
        assert.deepEqual(current.filter(row => row.id !== grant.ownedId), grant.before, 'Guest baseline changed');
      });
    } finally {
      await attempt(errors, async () => {
        if (grant.ownedId === null) return;
        const rows = await api.readRows(RIGHTS, { id: grant.ownedId });
        assert(rows.length <= 1, 'Ambiguous owned guest grant identity');
        if (!rows.length) return;
        assertGuestIdentity(rows[0], groupId, grant);
        await api.deleteRows(RIGHTS, [grant.ownedId]);
      });
      await attempt(errors, async () => {
        if (grant.ownedId !== null) assert.deepEqual(await api.readRows(RIGHTS, { id: grant.ownedId }), [], 'Owned guest grant remains');
        assert.deepEqual(await api.readRows(RIGHTS, fields), grant.before, 'Guest grants were not restored exactly');
        grants.splice(grants.indexOf(grant), 1);
      });
    }
  }
  report(errors, 'C17 guest-grant restoration failed');
}

/** DETECT ONLY. Even an exact C17 shape from another run belongs to the owner. */
export async function detectReaderGroups(api: Pick<AccessAPI, 'readRows'>, groups: AccessRow[], readerId: number,
  log: (line: string) => void = console.log): Promise<string[]> {
  assert(Number.isSafeInteger(readerId) && readerId > 1, 'C17 detection requires the reserved reader identity');
  const leftovers: string[] = [];
  for (const group of groups) {
    if (typeof group.name !== 'string' || !group.name.startsWith(C17_READER_GROUP_PREFIX)
      || group.name.length === C17_READER_GROUP_PREFIX.length) continue;
    const members = await api.readRows(MEMBERS, { group_id: group.id });
    if (!members.some(member => member.user_id === readerId)) {
      log(`[C17 detect-only] group ${group.id} ${group.name}: ${members.length ? 'no reserved reader member' : 'no members'}; left untouched`);
      continue;
    }
    const rights = await api.readRows(RIGHTS, { user_group_id: group.id });
    const names: string[] = [];
    for (const right of rights) {
      const functions = await api.readRows('system_functions', { id: Number(right.function_id) });
      const fn = functions[0];
      names.push(`${fn?.name ?? `function ${right.function_id}`} (${fn?.url_route_endpoint ?? 'unknown route'}, `
        + `${right.target_schema_name}/${right.target_table_uid ?? 'site-wide'})`);
    }
    leftovers.push(`8082 state: leftover C17 group ${group.id} ${group.name} gives the reserved reader ${names.join(', ') || 'no recorded rights'}; restoring it is an owner decision`);
  }
  return leftovers;
}

export async function assertNoLeftoverC17ReaderGroups(request: APIRequestContext, readerId: number): Promise<void> {
  const messages = await detectReaderGroups({ readRows: (dataset, fields) => readC17AccessRows(request, dataset, fields) },
    await readC17ReaderGroups(request), readerId);
  if (messages.length) throw new Error(messages.join('\n'));
}

/** Additional P7 precondition. Its original denial assertions remain separate. */
export async function assertP7ReaderPrecondition(request: APIRequestContext, readerId: number, endpoints: string[]): Promise<void> {
  assert(Array.isArray(endpoints), 'P7 requires the signed-in reader permission inventory');
  if (!endpoints.includes('/ui/view/article_view')) return;
  const message = "8082 state: the reserved reader holds /ui/view/article_view (leaked grant?); P7's denial cannot be proven";
  let detail = '';
  try {
    const groups = await readC17ReaderGroups(request);
    const leftovers = await detectReaderGroups({ readRows: (dataset, fields) => readC17AccessRows(request, dataset, fields) }, groups, readerId);
    detail = leftovers.join('\n') || (groups.length
      ? `C17 groups present without reserved reader membership: ${groups.map(group => `${group.id} ${group.name}`).join(', ')}; left untouched` : '');
  } catch (error) {
    throw new Error(`${message}\n${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  throw new Error(message + (detail ? `\n${detail}` : ''));
}
