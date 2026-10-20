// article_presentations_state.test.js
// Proves per-target preservation and complete authoritative readback requirements.
// Connects mixed display intents to site, group and personal contract fixtures.
import { expect, test } from 'vitest';
import { ARTICLE_KEYS, ARTICLE_BLOCKS, cloneArticleState, projectArticleRows,
    buildArticleWrite, validateArticleSnapshot, verifyArticleWrite, articleOrdersDiffer } from './article_presentations_state.js';

import { articleFixture } from "./article_presentations_test_fixture.js";
const copy = Object.fromEntries(ARTICLE_BLOCKS.map(key => [key,key]));
export function articleChange(snapshot, metadata = {}) {
    const rows = projectArticleRows(snapshot,copy);
    return { rows, order: rows.map(row => row.id), changedCells: [], metadata };
}
test.each(['site','group','personal'])('complete %s snapshots validate and unchanged widths/priorities/orders survive', scope => {
    const baseline = articleFixture(scope), before = cloneArticleState(baseline);
    expect(validateArticleSnapshot(baseline, { dataset: baseline.dataset, targets: baseline.targets })).toBe(baseline);
    const write = buildArticleWrite(baseline,articleChange(baseline));
    expect(write.targets).toEqual(baseline.targets);
    expect(write.blocks).toEqual(scope === 'site' ? baseline.blocks : undefined);
    expect(baseline).toEqual(before);
    expect(write).not.toHaveProperty('fields');
});
test('only explicit real cells and an explicit move change mixed targets', () => {
    const baseline = articleFixture('group'), change = articleChange(baseline);
    expect(articleOrdersDiffer(baseline)).toBe(true);
    change.changedCells = [{ rowId: 'field:1', columnKey: ARTICLE_KEYS[0], nextValue: false },
        { rowId: 'field:1', columnKey: 'all', nextValue: true },
        { rowId: 'field:2', columnKey: ARTICLE_KEYS[1], nextValue: 'ambiguous' },
        { rowId: 'block:images', columnKey: ARTICLE_KEYS[1], nextValue: true }];
    const write = buildArticleWrite(baseline,change);
    expect(write.targets[1].members.map(member => member.column_uid)).toEqual([2,1]);
    write.targets.forEach((target,index) => {
        expect(target.members.find(member => member.column_uid === 1).values.article_view.visible).toBe(false);
        expect(target.members.find(member => member.column_uid === 2)).toEqual(baseline.targets[index].members.find(member => member.column_uid === 2));
        expect(target.assignments).toEqual(baseline.targets[index].assignments);
    });
    change.metadata.orderIntent = true;
    expect(buildArticleWrite(baseline,change).targets[1].members.map(member => member.column_uid)).toEqual([1,2]);
});
test('zero visible fields and explicit supported blocks are preserved', () => {
    const baseline = articleFixture(), change = articleChange(baseline);
    for (const row of change.rows.filter(row => row.kind === 'fields')) for (const key of ARTICLE_KEYS) change.changedCells.push({ rowId:row.id, columnKey:key,nextValue:false });
    change.changedCells.push({ rowId:'block:images',columnKey:'article_view',nextValue:false });
    const write = buildArticleWrite(baseline,change);
    expect(write.targets.every(target => target.members.every(member => Object.values(member.values).every(cell => !cell.visible)))).toBe(true);
    expect(write.blocks.article_view.images).toBe(false);
    expect(write.blocks.image_first_view).toEqual({details:true});
});
test('metadata-only save retains untouched target priorities and labels', () => {
    const baseline = articleFixture('group');
    const write = buildArticleWrite(baseline,articleChange(baseline,{name:'Reviewed'}));
    expect(write.targets.map(target => target.assignments[0].priority)).toEqual([3,4]);
    expect(write.targets.map(target => target.assignments[0].name)).toEqual(['Reviewed [g8]','Reviewed [g9]']);
});
test.each(['width','order','priority','blocks','target','family','revisions','incomplete'])('wrong %s GET is never adopted', mutation => {
    const baseline = articleFixture(), expected = buildArticleWrite(baseline,articleChange(baseline)), committed = cloneArticleState(baseline), actual = cloneArticleState(baseline);
    if (mutation === 'width') actual.targets[0].members[0].values.article_view.width_px = 5;
    if (mutation === 'order') actual.targets[0].members.reverse();
    if (mutation === 'priority') actual.targets[0].assignments[0].priority++;
    if (mutation === 'blocks') actual.blocks.article_view.images = false;
    if (mutation === 'target') actual.targets[0].scope = 'group';
    if (mutation === 'family') actual.family = 'card';
    if (mutation === 'revisions') delete actual.revisions.blocks;
    if (mutation === 'incomplete') delete actual.targets[0].members[0].values.image_first_page_view;
    expect(() => verifyArticleWrite(expected,committed,actual,baseline)).toThrow();
});
test('the exact GET equals the complete intended write', () => {
    const baseline = articleFixture('group'), expected = buildArticleWrite(baseline,articleChange(baseline));
    expect(verifyArticleWrite(expected,baseline,baseline,baseline)).toEqual(baseline);
});
test.each(['site', 'group', 'personal'])('sparse %s bundles preserve complete target membership', scope => {
    const baseline = articleFixture(scope);
    baseline.fields.push({ column_uid: 6, name: 'restricted', editable: false });
    baseline.targets[0].members = baseline.targets[0].members.slice(0, 1);
    const before = cloneArticleState(baseline);
    expect(validateArticleSnapshot(baseline, { dataset: baseline.dataset, targets: baseline.targets })).toBe(baseline);
    const change = articleChange(baseline);
    const write = buildArticleWrite(baseline, change);
    expect(write.targets).toEqual(before.targets);
    expect(verifyArticleWrite(write, baseline, baseline, baseline)).toEqual(before);
    expect(baseline).toEqual(before);
    if (scope === 'group') {
        expect(change.rows.filter(row => row.kind === 'fields').map(row => row.uid)).toEqual([1, 2]);
        change.changedCells = [{ rowId: 'field:2', columnKey: 'article_view', nextValue: true }];
        change.metadata.orderIntent = true;
        change.order = ['field:2', 'field:1', ...change.order.filter(id => id.startsWith('block:'))];
        const edited = buildArticleWrite(baseline, change);
        expect(edited.targets[0]).toEqual(before.targets[0]);
        expect(edited.targets[1].members.map(member => member.column_uid)).toEqual([2, 1]);
        expect(edited.targets[1].members[0].values.article_view.visible).toBe(true);
        expect(edited.targets[1].assignments).toEqual(before.targets[1].assignments);
    }
});
test.each(['missing', 'other-bundle', 'foreign', 'duplicate'])('a %s member in matching POST/GET readback is refused', kind => {
    const baseline = articleFixture(), expected = buildArticleWrite(baseline, articleChange(baseline));
    baseline.fields.push({ column_uid: 3, name: 'outside_bundle', editable: true });
    const actual = cloneArticleState(baseline);
    if (kind === 'missing') actual.targets[0].members.pop();
    if (kind === 'other-bundle') actual.targets[0].members[1].column_uid = 3;
    if (kind === 'foreign') actual.targets[0].members[1].column_uid = 99;
    if (kind === 'duplicate') actual.targets[0].members[1].column_uid = 1;
    expect(() => verifyArticleWrite(expected, actual, actual, baseline)).toThrow();
});
