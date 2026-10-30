// c17-permission-cleanup.test.ts
// Proves C17 cleanup, detect-only startup checks and complete GET inventories without a server.
// Connects fake API rows to the same cleanup functions used by the browser spec.
// Prevents failed verification from leaving the reserved reader's temporary rights behind.
// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import type { APIRequestContext, TestInfo } from '@playwright/test';
import { testDatasetTeardown } from './test-dataset-teardown';
import {
  C17_READER_GROUP_PREFIX, READER_VIEW_ROUTES, readC17AccessRows, readC17ReaderGroups,
  removeReaderArticleAccess, restoreGuestUIGrants, detectReaderGroups, assertP7ReaderPrecondition,
  assertNoLeftoverC17ReaderGroups, registerReaderAccessCleanup, registerGuestGrantCleanup,
  type PermissionCleanupStep,
  type AccessAPI, type AccessRow, type ReaderAccess, type GuestGrant,
} from './c17-permission-cleanup';

vi.mock('./test-artifact-csrf-reader', () => ({ fetchCsrfTokenForRequest: vi.fn(async () => 'test-csrf') }));

const GROUPS = 'system_user_groups';
const RIGHTS = 'system_group_table_func_rights';
const MEMBERS = 'system_user_group_memberships';
const groupName = `${C17_READER_GROUP_PREFIX}recorded_run`;
const right = (id: number, functionId: number, groupId = 40): AccessRow => ({
  id, function_id: functionId, user_group_id: groupId, target_schema_name: 'public', target_table_uid: null,
});
function fixture(withMember = true) {
  const tables: Record<string, AccessRow[]> = {
    [GROUPS]: [{ id: 40, name: groupName }],
    [RIGHTS]: [right(50, 10), right(51, 11)],
    [MEMBERS]: withMember ? [{ id: 60, group_id: 40, user_id: 7 }] : [],
    system_functions: READER_VIEW_ROUTES.map((route, index) => ({ id: 10 + index,
      name: route.name, url_route_endpoint: route.endpoint, disabled: false, specific_table_related: false })),
  };
  const readRows = vi.fn<AccessAPI['readRows']>(async (dataset, fields) => structuredClone(
    tables[dataset].filter(row => Object.entries(fields).every(([key, value]) => row[key] === value)),
  ));
  const deleteRows = vi.fn<AccessAPI['deleteRows']>(async (dataset, ids) => {
    tables[dataset] = tables[dataset].filter(row => !ids.includes(row.id));
    if (dataset === GROUPS) {
      tables[RIGHTS] = tables[RIGHTS].filter(row => !ids.includes(row.user_group_id as number));
      tables[MEMBERS] = tables[MEMBERS].filter(row => !ids.includes(row.group_id as number));
    }
  });
  const access: ReaderAccess = { groupName, groupId: 40, groupCreated: true, userId: 7,
    viewGrants: [{ functionId: 10, grantId: 50 }, { functionId: 11, grantId: 51 }], membershipId: withMember ? 60 : null };
  return { tables, api: { readRows, deleteRows }, access };
}
async function errorsFrom(action: Promise<void>): Promise<unknown[]> {
  try { await action; } catch (error) {
    expect(error).toBeInstanceOf(AggregateError);
    return (error as AggregateError).errors;
  }
  throw new Error('Expected cleanup to report its verification failures');
}

describe('owned reader group cleanup', () => {
  test('a recorded identity without this run’s creation proof authorizes no deletion', async () => {
    const { api, access } = fixture(); access.groupCreated = false;
    await expect(removeReaderArticleAccess(api, access)).rejects.toThrow('no creation proof');
    expect(api.deleteRows).not.toHaveBeenCalled();
  });
  test('grant and membership mismatches are both reported after owned-group deletion and cascade proof', async () => {
    const { tables, api, access } = fixture();
    tables[RIGHTS][0].id = 99;
    tables[MEMBERS][0].user_id = 8;
    const errors = await errorsFrom(removeReaderArticleAccess(api, access));
    expect(errors.map(String)).toEqual([expect.stringContaining('Changed reader view grant'), expect.stringContaining('Changed reader')]);
    expect(api.deleteRows).toHaveBeenCalledExactlyOnceWith(GROUPS, [40]);
    expect([tables[GROUPS], tables[RIGHTS], tables[MEMBERS]]).toEqual([[], [], []]);
    expect(api.readRows).toHaveBeenCalledWith(RIGHTS, { user_group_id: 40 });
    expect(api.readRows).toHaveBeenCalledWith(MEMBERS, { group_id: 40 });
  });
  test.each([GROUPS, RIGHTS, MEMBERS])('a failed %s verification GET still reaches the independent finally deletion', async failedDataset => {
    const { api, access } = fixture();
    const read = api.readRows.getMockImplementation()!;
    let fail = true;
    api.readRows.mockImplementation(async (dataset, fields) => {
      if (dataset === failedDataset && fail) { fail = false; throw new Error('verification readback failed'); }
      return read(dataset, fields);
    });
    expect((await errorsFrom(removeReaderArticleAccess(api, access))).map(String)).toContain('Error: verification readback failed');
    expect(api.deleteRows).toHaveBeenCalledExactlyOnceWith(GROUPS, [40]);
  });
  test.each(['different id', 'different name', 'changed before deletion'])('identity mismatch (%s) deletes nothing', async mismatch => {
    const { api, access, tables } = fixture();
    if (mismatch === 'different id') tables[GROUPS][0].id = 41;
    if (mismatch === 'different name') tables[GROUPS][0].name = `${groupName}_replacement`;
    if (mismatch === 'changed before deletion') {
      const read = api.readRows.getMockImplementation()!;
      api.readRows.mockImplementation(async (dataset, fields) => {
        if (dataset === MEMBERS) tables[GROUPS][0].name = 'another_owner';
        return read(dataset, fields);
      });
      expect((await errorsFrom(removeReaderArticleAccess(api, access))).map(String).join('\n')).toContain('Refusing to delete a replacement');
    } else expect((await errorsFrom(removeReaderArticleAccess(api, access))).map(String).join('\n')).toContain('Refusing to delete a replacement');
    expect(api.deleteRows).not.toHaveBeenCalled();
  });
  test('partial setup recovers the previously absent exact name and deletes only that id', async () => {
    const { api, access, tables } = fixture(false);
    access.groupId = null;
    access.viewGrants = [];
    tables[RIGHTS] = [];
    await removeReaderArticleAccess(api, access);
    expect(api.deleteRows).toHaveBeenCalledExactlyOnceWith(GROUPS, [40]);
  });
  test('failed delete and both surviving cascade targets are all reported', async () => {
    const { api, access } = fixture();
    api.deleteRows.mockRejectedValue(new Error('delete refused'));
    const errors = (await errorsFrom(removeReaderArticleAccess(api, access))).map(String).join('\n');
    for (const message of ['delete refused', 'group id remains', 'group name remains', 'rights remain', 'membership remains']) expect(errors).toContain(message);
  });
});

function guestFixture() {
  const result = fixture(false);
  result.tables[RIGHTS] = [right(50, 10, 1)];
  const grants: GuestGrant[] = [{ functionId: 10, before: [], ownedId: 50, marker: 'owned-guest-view' }];
  return { ...result, grants };
}
describe('owned guest grant restoration', () => {
  test('failed readback still deletes the independently identified owned row, then reports the failure', async () => {
    const { api, grants, tables } = guestFixture();
    api.readRows.mockRejectedValueOnce(new Error('guest readback failed'));
    expect((await errorsFrom(restoreGuestUIGrants(api, 1, grants))).map(String)).toContain('Error: guest readback failed');
    expect(api.deleteRows).toHaveBeenCalledExactlyOnceWith(RIGHTS, [50]);
    expect(tables[RIGHTS]).toEqual([]);
    expect(grants).toEqual([]);
  });
  test('an unexpected additional grant does not strand the recorded row and remains untouched', async () => {
    const { api, grants, tables } = guestFixture();
    tables[RIGHTS].push(right(51, 10, 1));
    await errorsFrom(restoreGuestUIGrants(api, 1, grants));
    expect(api.deleteRows).toHaveBeenCalledExactlyOnceWith(RIGHTS, [50]);
    expect(tables[RIGHTS].map(row => row.id)).toEqual([51]);
  });
  test.each(['id', 'user_group_id', 'function_id', 'target_schema_name', 'target_table_uid'])
  ('replacement guest identity (%s) deletes nothing', async field => {
    const { api, grants, tables } = guestFixture();
    tables[RIGHTS][0][field] = field === 'target_schema_name' ? 'other' : 999;
    await errorsFrom(restoreGuestUIGrants(api, 1, grants));
    expect(api.deleteRows).not.toHaveBeenCalled();
  });
  test('partial setup adopts only a single new exact-scope row and keeps the original scoped row', async () => {
    const { api, grants, tables } = guestFixture();
    const original = { ...right(49, 10, 1), target_table_uid: 123 };
    tables[RIGHTS].unshift(original);
    grants[0].before = [structuredClone(original)];
    grants[0].ownedId = null;
    await restoreGuestUIGrants(api, 1, grants);
    expect(api.deleteRows).toHaveBeenCalledExactlyOnceWith(RIGHTS, [50]);
    expect(tables[RIGHTS]).toEqual([original]);
  });
  test('a failure restoring one grant cannot skip the other owned grant', async () => {
    const { api, grants, tables } = guestFixture();
    tables[RIGHTS].push(right(51, 11, 1));
    grants.push({ functionId: 11, before: [], ownedId: 51, marker: 'second-guest-view' });
    api.readRows.mockRejectedValueOnce(new Error('first restore failed'));
    await errorsFrom(restoreGuestUIGrants(api, 1, grants));
    expect(api.deleteRows.mock.calls).toEqual([[RIGHTS, [51]], [RIGHTS, [50]]]);
    expect(tables[RIGHTS]).toEqual([]);
  });
});

describe('detect-only C17 startup check', () => {
  test.each(['exact', 'partial rights', 'extra rights', 'other member too'])
  ('reserved reader membership fails clearly regardless of grant shape (%s); deletes NOTHING', async shape => {
    const { api, tables } = fixture();
    if (shape === 'partial rights') tables[RIGHTS].pop();
    if (shape === 'extra rights') tables[RIGHTS].push(right(52, 10));
    if (shape === 'other member too') tables[MEMBERS].push({ id: 61, group_id: 40, user_id: 8 });
    const messages = await detectReaderGroups(api, structuredClone(tables[GROUPS]), 7);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`8082 state: leftover C17 group 40 ${groupName} gives the reserved reader`);
    expect(messages[0]).toContain('ui.view.card (/ui/view/card, public/site-wide)');
    expect(messages[0]).toContain('restoring it is an owner decision');
    if (shape !== 'partial rights') expect(messages[0]).toContain('ui.view.article_view (/ui/view/article_view');
    expect(api.deleteRows).not.toHaveBeenCalled();
    expect(tables[GROUPS]).toHaveLength(1);
  });
  test.each([false, true])('no reserved reader member (other member=%s) only logs, including incomplete grants', async otherMember => {
    const { api, tables } = fixture(false), log = vi.fn();
    tables[RIGHTS] = [];
    if (otherMember) tables[MEMBERS].push({ id: 60, group_id: 40, user_id: 8 });
    expect(await detectReaderGroups(api, structuredClone(tables[GROUPS]), 7, log)).toEqual([]);
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(otherMember ? 'no reserved reader member' : 'no members'));
    expect(api.deleteRows).not.toHaveBeenCalled();
  });
  test.each(['e2e_c17_card_readers_foreign', C17_READER_GROUP_PREFIX, 'other_group'])
  ('a neighbouring or empty-suffix name is never treated as C17: %s', async name => {
    const { api, tables } = fixture();
    tables[GROUPS][0].name = name;
    expect(await detectReaderGroups(api, tables[GROUPS], 7)).toEqual([]);
    expect(api.readRows).not.toHaveBeenCalled();
    expect(api.deleteRows).not.toHaveBeenCalled();
  });
});

/** Real request adapter over in-memory rows: every inventory call is GET-only. */
function requestFor(api: AccessAPI) {
  const get = vi.fn(async (url: string) => {
    const query = new URL(url, 'https://runner.invalid').searchParams;
    const fields: Record<string, string | number> = {};
    for (const [key, value] of query) if (key.endsWith('_from')) {
      const field = key.slice(0, -5);
      // Prefix inventory uses unequal bounds; let the real prefix filter inspect neighbours.
      if (value !== query.get(`${field}_to`)) continue;
      fields[field] = field === 'id' || field.endsWith('_id') ? Number(value) : value;
    }
    const data = (await api.readRows(query.get('dataset')!, fields)).slice(Number(query.get('offset') ?? 0));
    return { ok: () => true, text: async () => '', json: async () => ({ data }) };
  });
  const post = vi.fn(async (url: string, options: { data: { ids: number[] } }) => {
    await api.deleteRows(new URL(url, 'https://runner.invalid').searchParams.get('dataset')!, options.data.ids);
    return { ok: () => true, text: async () => '' };
  });
  const request = { get, post, dispose: vi.fn() } as unknown as APIRequestContext;
  return { request, get, post };
}

describe('C17 and P7 read-only preconditions', () => {
  test('startup fails on a reader member, with both actual rights named and no writes', async () => {
    const { api } = fixture(), { request, post } = requestFor(api);
    await expect(assertNoLeftoverC17ReaderGroups(request, 7)).rejects.toThrow(`leftover C17 group 40 ${groupName}`);
    expect(post).not.toHaveBeenCalled();
    expect(api.deleteRows).not.toHaveBeenCalled();
  });
  test('P7 fails before denial checks, naming a leftover C17 group; no cleanup is attempted', async () => {
    const { api } = fixture(), { request, post } = requestFor(api);
    let message = '';
    try { await assertP7ReaderPrecondition(request, 7, ['/ui/view/article_view']); }
    catch (error) { message = (error as Error).message; }
    expect(message).toContain("8082 state: the reserved reader holds /ui/view/article_view (leaked grant?); P7's denial cannot be proven");
    expect(message).toContain(`leftover C17 group 40 ${groupName}`);
    expect(post).not.toHaveBeenCalled(); expect(api.deleteRows).not.toHaveBeenCalled();
  });
  test('P7 also refuses a leaked grant without a C17 group', async () => {
    const { api, tables } = fixture(); tables[GROUPS] = [];
    await expect(assertP7ReaderPrecondition(requestFor(api).request, 7, ['/ui/view/article_view']))
      .rejects.toThrow("P7's denial cannot be proven");
    expect(api.deleteRows).not.toHaveBeenCalled();
  });
  test('P7 names a memberless C17 group without attributing the reader grant to it', async () => {
    const { api } = fixture(false), log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(assertP7ReaderPrecondition(requestFor(api).request, 7, ['/ui/view/article_view']))
        .rejects.toThrow(`C17 groups present without reserved reader membership: 40 ${groupName}; left untouched`);
      expect(api.deleteRows).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  test('diagnostic GET failure cannot hide P7 contamination', async () => {
    const { api } = fixture(); api.readRows.mockRejectedValue(new Error('inventory refused'));
    await expect(assertP7ReaderPrecondition(requestFor(api).request, 7, ['/ui/view/article_view']))
      .rejects.toThrow("P7's denial cannot be proven\ninventory refused");
  });
  test('a clean P7 reader proceeds without any diagnostic API call', async () => {
    const { api } = fixture(), { request, get, post } = requestFor(api);
    await assertP7ReaderPrecondition(request, 7, ['/ui/view/card']);
    expect(get).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
  });
});

test.each([false, true])('registered group and guest grant survive timeout with closed page; readback failure=%s', async failReadback => {
  const { api, tables, access } = fixture();
  tables[RIGHTS].push(right(52, 10, 1));
  const grants: GuestGrant[] = [{ functionId: 10, before: [], ownedId: 52, marker: 'timeout-guest' }];
  const { request } = requestFor(api);
  const closedPage = { evaluate: vi.fn(async () => { throw new Error('Target page has been closed'); }) };
  await expect(closedPage.evaluate()).rejects.toThrow('Target page has been closed');
  closedPage.evaluate.mockClear();
  let hook!: Parameters<Parameters<typeof testDatasetTeardown>[0]['afterEach']>[0];
  const registry = testDatasetTeardown({ afterEach: callback => { hook = callback; } });
  const steps: PermissionCleanupStep[] = [];
  registry.plan('timed-out-C17', steps);
  // The production spec appends these registrations as each owned fixture is created.
  registerReaderAccessCleanup(steps, access);
  registerGuestGrantCleanup(steps, 1, grants);
  if (failReadback) {
    const read = api.readRows.getMockImplementation()!;
    let fail = true;
    api.readRows.mockImplementation(async (dataset, fields) => {
      if (dataset === RIGHTS && fail) { fail = false; throw new Error('closed-page-era readback failed'); }
      return read(dataset, fields);
    });
  }
  const newContext = vi.fn(async () => request), setTimeout = vi.fn();
  const use = { baseURL: 'https://runner.invalid:8082', storageState: '/tmp/c17-admin-state.json',
    ignoreHTTPSErrors: true, extraHTTPHeaders: { 'X-Bypass-Ratelimit': 'test-mode' } };
  const info = { testId: 'timed-out-C17', timeout: 120_000, status: 'timedOut', expectedStatus: 'passed',
    errors: [{ message: 'body timed out with closed page' }], setTimeout, project: { use } } as unknown as TestInfo;
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const result = hook({ playwright: { request: { newContext } }, baseURL: use.baseURL }, info);
    if (failReadback) await expect(result).rejects.toThrow('Body/teardown failed');
    else await result;
    expect(newContext).toHaveBeenCalledExactlyOnceWith(use);
    expect(setTimeout).toHaveBeenCalledWith(210_000);
    expect(api.deleteRows.mock.calls).toEqual([[GROUPS, [40]], [RIGHTS, [52]]]);
    expect([tables[GROUPS], tables[RIGHTS], tables[MEMBERS]]).toEqual([[], [], []]);
    expect(request.dispose).toHaveBeenCalledOnce();
    expect(closedPage.evaluate).not.toHaveBeenCalled();
    if (failReadback) expect(log.mock.calls.flat().join(' ')).toContain('closed-page-era readback failed');
  } finally { log.mockRestore(); }
});

describe('GET-only complete access inventories', () => {
  function requestWithPages(pages: AccessRow[][]) {
    const get = vi.fn(async () => ({ ok: () => true, text: async () => '', json: async () => ({ data: pages.shift() ?? [] }) }));
    return { get, request: { get } as unknown as APIRequestContext };
  }
  test('prefix inventory reads every page and ignores neighbouring collation matches', async () => {
    const { request, get } = requestWithPages([[{ id: 40, name: groupName }],
      [{ id: 41, name: 'e2e_c17_card_readers_foreign' }], [{ id: 42, name: `${groupName}_second` }], []]);
    expect((await readC17ReaderGroups(request)).map(row => row.id)).toEqual([40, 42]);
    expect(get.mock.calls.map(call => new URL(call[0] as string, 'https://example.invalid').searchParams.get('offset'))).toEqual(['0', '1', '2', '3']);
  });
  test('rights inventory includes an extra right on a subsequent page', async () => {
    const { request } = requestWithPages([[right(50, 10)], [right(51, 11)], [right(52, 12)], []]);
    expect(await readC17AccessRows(request, RIGHTS, { user_group_id: 40 })).toHaveLength(3);
  });
  test('an API ignoring pagination fails closed instead of accepting a truncated inventory', async () => {
    const { request } = requestWithPages([[right(50, 10)], [right(50, 10)]]);
    await expect(readC17AccessRows(request, RIGHTS, { user_group_id: 40 })).rejects.toThrow('unordered/repeated');
  });
});
