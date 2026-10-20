// article_presentations_table.test.js
// Exercises five-column mapping, recovery, scope and failed-readback draft retention.
// Replaces the retired block panel coverage in the single external save workflow.
// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { articleFixture } from './article_presentations_test_fixture.js';
import { cloneArticleState, buildArticleWrite } from './article_presentations_state.js';
vi.mock('../endpoints/endpoint_router.js', () => ({ endpoint_router: vi.fn() }));
import { createArticlePresentationsTable } from './article_presentations_table.js';
import { getArticlePresentationsCopy } from './article_presentations_copy.js';
vi.mock('../lang/component_language_dictionary.js', () => ({ getTranslationForKey: (_key,{fallback}) => fallback }));
let host;
beforeEach(() => { document.body.replaceChildren(); localStorage.clear(); host=document.body.appendChild(document.createElement('div')); });
function mount(snapshot = articleFixture(), extra = {}) {
    return createArticlePresentationsTable({host,snapshot,copy:getArticlePresentationsCopy('en'),...extra});
}
const cell = (id,key) => host.querySelector(`[data-row-id="${id}"] input[data-column-key="${key}"]`);
test('one table has five columns and five fixed blocks with unsupported IFAV cells', () => {
    const adapter = mount();
    expect(host.querySelectorAll('table')).toHaveLength(1);
    expect(host.querySelectorAll('thead th')).toHaveLength(5);
    expect(host.querySelectorAll('.vct-row')).toHaveLength(7);
    expect(host.querySelectorAll('[aria-label="Not supported in this presentation"]')).toHaveLength(8);
    expect(adapter.table.moveRow('block:details',-1)).toBe(false);
    expect(host.querySelector('.vct-toolbar')).toBeNull();
});
test.each(['group','personal'])('%s block rows are dataset-wide read-only, including Select all', scope => {
    mount(articleFixture(scope));
    for (const input of host.querySelector('[data-row-id="block:details"]').querySelectorAll('input')) expect(input.disabled).toBe(true);
});
test('mixed cycles visible, hidden, unchanged; widths and priorities stay separate', () => {
    const adapter=mount(articleFixture('group'));
    const input = cell('field:1','article_view'); input.focus();
    const click = () => cell('field:1','article_view').click();
    expect(cell('field:1','article_view').indeterminate).toBe(true);
    click();expect(adapter.table.getRows({draft:true})[0].article_view).toBe(true);
    click();expect(adapter.table.getRows({draft:true})[0].article_view).toBe(false);
    click();expect(adapter.table.getChangeSet().changedCells).toEqual([]);
    expect(input.indeterminate).toBe(true); expect(input.checked).toBe(false); expect(document.activeElement).toBe(input);
});
test('an explicit move back to the initial display order retains the mixed-target order intent', () => {
    const adapter=mount(articleFixture('group'));
    adapter.table.moveRow('field:1',1);adapter.table.moveRow('field:1',-1);
    expect(adapter.table.getChangeSet().metadata.orderIntent).toBe(true);
    expect(adapter.table.isDirty()).toBe(true);
});
test('one atomic write is followed by exact GET and a new editable baseline', async () => {
    const baseline=articleFixture(), actual=cloneArticleState(baseline);
    actual.targets[0].members[0].values.article_view.visible=false;
    actual.blocks.article_view.images=false;
    actual.revisions.site='new';
    const write=vi.fn().mockResolvedValue(actual),read=vi.fn().mockResolvedValue(actual);
    const adapter=mount(baseline,{write,read});
    cell('field:1','article_view').click();cell('block:images','article_view').click();
    await adapter.save();
    expect(write).toHaveBeenCalledTimes(1);expect(read).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0].targets[0].members).toEqual(actual.targets[0].members);
    expect(adapter.baseline()).toEqual(actual);expect(adapter.table.isDirty()).toBe(false);expect(adapter.table.isEditMode()).toBe(true);
});
test('wrong or unavailable readback keeps the draft and blocks another write', async () => {
    const snapshot=articleFixture(),write=vi.fn().mockResolvedValue(snapshot),read=vi.fn().mockResolvedValue(snapshot);
    const adapter=mount(snapshot,{write,read});cell('field:1','article_view').click();
    await expect(adapter.save()).rejects.toMatchObject({committed:true});
    expect(adapter.table.isDirty()).toBe(true);expect(localStorage.length).toBe(1);
    expect(await adapter.save()).toBe(false);expect(write).toHaveBeenCalledTimes(1);
});
test('defaults are staged and Cancel clears them without any request', () => {
    const write=vi.fn(),adapter=mount(articleFixture('group'),{write});
    adapter.restoreDefaults();expect(adapter.table.isDirty()).toBe(true);expect(write).not.toHaveBeenCalled();
    adapter.cancel();expect(adapter.table.isDirty()).toBe(false);expect(localStorage.length).toBe(0);
});
test('reload recovers exact-context draft and stale revisions block movement and saving', () => {
    const snapshot=articleFixture('group'),first=mount(snapshot);
    first.table.moveRow('field:1',1);first.metadata({priority:17});first.destroy();
    const recovered=mount(snapshot);expect(recovered.table.getRecoveryState().status).toBe('recovered');
    expect(recovered.table.getChangeSet().metadata.priority).toBe(17);recovered.destroy();
    const stale=cloneArticleState(snapshot);stale.revisions['group:8']='changed';
    const next=mount(stale);expect(next.table.getRecoveryState().status).toBe('revision-conflict');
    expect(next.table.moveRow('field:1',1)).toBe(false);expect(next.isBlocked()).toBe(true);
    next.cancel();expect(localStorage.length).toBe(0);
});
test.each(['fi','en','zh','ch','yue'])('%s supplies complete translated names and outcomes', locale => {
    const copy=getArticlePresentationsCopy(locale);
    expect(copy.cell).toContain('{presentation}');expect(copy.position).toContain('{position}');expect(copy.verification).toBeTruthy();
});

test('a rejected write retains its draft and a stale conflict blocks silent retry', async () => {
    const write=vi.fn().mockRejectedValue(Object.assign(new Error('stale'),{status:409})),notice=vi.fn();
    const adapter=mount(articleFixture(),{write,onStatus:notice});cell('field:1','article_view').click();
    await expect(adapter.save()).rejects.toMatchObject({status:409});
    expect(adapter.table.isDirty()).toBe(true);expect(adapter.isBlocked()).toBe(true);
    expect(notice).toHaveBeenCalledWith(expect.stringContaining('Settings changed'));
    await expect(adapter.save()).rejects.toThrow();expect(write).toHaveBeenCalledTimes(1);
});
test('a late committed result after context disposal never becomes a new baseline', async () => {
    const snapshot=articleFixture();let finish;
    const write=vi.fn(()=>new Promise(resolve=>{finish=resolve;}));
    const actual=cloneArticleState(snapshot);actual.targets[0].members[0].values.article_view.visible=false;
    const adapter=mount(snapshot,{write,read:vi.fn().mockResolvedValue(actual)});
    cell('field:1','article_view').click();const pending=adapter.save();adapter.destroy();finish(actual);
    await expect(pending).rejects.toMatchObject({committed:true});expect(adapter.baseline()).toEqual(snapshot);
    expect(localStorage.length).toBe(1);
});

test('name, priority and common order are adopted only as observed in the GET', async () => {
    const snapshot=articleFixture('group');let actual;
    const write=vi.fn(async request=>{
        actual={...cloneArticleState(snapshot),targets:request.targets,revisions:{...snapshot.revisions,'group:8':'next8','group:9':'next9'}};
        return actual;
    });
    const adapter=mount(snapshot,{write,read:vi.fn(async()=>actual)});
    adapter.metadata({name:'Reviewed',priority:19});adapter.table.moveRow('field:1',1);
    const expected=buildArticleWrite(snapshot,adapter.table.getChangeSet());
    await adapter.save();
    expect(adapter.baseline().targets).toEqual(expected.targets);
    expect(adapter.table.getChangeSet().metadata).toEqual({});
    expect(adapter.baseline().targets[0].assignments[0]).toMatchObject({name:'Reviewed [g8]',priority:19});
    expect(adapter.table.isDirty()).toBe(false);
});

test('a clean visit leaves no draft to conflict with a later fresh revision', () => {
    const first=mount();expect(localStorage.length).toBe(0);first.destroy();
    const next=articleFixture();next.revisions.site='changed';
    const second=mount(next);expect(second.table.getRecoveryState().status).toBe('none');expect(localStorage.length).toBe(0);
});

test('sparse mixed bundles save a common display order without adding or losing members', async () => {
    const snapshot = articleFixture('group');
    snapshot.fields.push({ column_uid: 6, name: 'restricted', editable: false });
    snapshot.targets[0].members = snapshot.targets[0].members.slice(0, 1);
    let actual;
    const write = vi.fn(async request => {
        actual = { ...cloneArticleState(snapshot), targets: request.targets,
            revisions: { ...snapshot.revisions, 'group:8': 'next8', 'group:9': 'next9' } };
        return actual;
    });
    const adapter = mount(snapshot, { write, read: vi.fn(async () => actual) });
    expect(adapter.table.moveRow('field:1', 1)).toBe(true);
    cell('field:2', 'article_view').click();
    await adapter.save();
    const saved = write.mock.calls[0][0];
    expect(saved.targets[0]).toEqual(snapshot.targets[0]);
    expect(saved.targets[1].members.map(member => member.column_uid)).toEqual([2, 1]);
    expect(saved.targets[1].members[0].values.article_view.visible).toBe(true);
    expect(saved.targets[1].members[0].values.image_first_view).toEqual(snapshot.targets[1].members[0].values.image_first_view);
    expect(saved.targets[1].assignments).toEqual(snapshot.targets[1].assignments);
    expect(adapter.baseline().targets).toEqual(saved.targets);
    expect(adapter.table.isDirty()).toBe(false);
});
