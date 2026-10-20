// article_presentations_state.js
// Maps mixed display cells to explicit complete target-owned article bundles.
// Connects immutable GET baselines with intent-only edits and exact readback validation.
// Computed selection, unsupported cells and unchanged mixed values never become writes.
import { ARTICLE_PRESENTATION_CONTRACT } from '../../shared/article_presentations/contract_reader.js';
export const ARTICLE_KEYS = Object.keys(ARTICLE_PRESENTATION_CONTRACT.presentations);
export const ARTICLE_BLOCKS = ARTICLE_PRESENTATION_CONTRACT.blocks;
export const cloneArticleState = value => JSON.parse(JSON.stringify(value));
export const articleTargetKey = target => target.scope === 'site' ? 'site' : `${target.scope}:${target.group_id || target.user_id}`;
export function articleEqual(a, b) {
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
export const articleSupports = (row, key) => !ARTICLE_KEYS.includes(key) || row.kind === 'fields' || ARTICLE_PRESENTATION_CONTRACT.presentations[key].blocks.includes(row.section);
export function validateArticleSnapshot(snapshot, { dataset, targets }) {
    const fail = () => { throw new Error('invalid-article-readback'); };
    if (!snapshot || snapshot.dataset !== dataset || snapshot.family !== 'article' || !Number.isSafeInteger(snapshot.dataset_uid)
        || !Number.isSafeInteger(snapshot.actor_id) || !Array.isArray(snapshot.fields) || !snapshot.fields.length
        || !Array.isArray(snapshot.targets) || !articleEqual(snapshot.targets.map(articleTargetKey), targets.map(articleTargetKey))
        || !snapshot.blocks || !snapshot.revisions) fail();
    const ids = snapshot.fields.map(field => field.column_uid);
    if (new Set(ids).size !== ids.length || snapshot.fields.some(field => !Number.isSafeInteger(field.column_uid) || field.column_uid <= 0
        || typeof field.name !== 'string' || typeof field.editable !== 'boolean')) fail();
    if (!articleEqual(Object.keys(snapshot.revisions).sort(), ['blocks', 'fields', ...targets.map(articleTargetKey)].sort())
        || Object.values(snapshot.revisions).some(value => typeof value !== 'string' || !value)) fail();
    for (const key of ARTICLE_KEYS) {
        const blocks = ARTICLE_PRESENTATION_CONTRACT.presentations[key].blocks;
        if (!articleEqual(Object.keys(snapshot.blocks[key] || {}).sort(), [...blocks].sort())
            || Object.values(snapshot.blocks[key]).some(value => typeof value !== 'boolean')) fail();
    }
    if (!articleEqual(Object.keys(snapshot.blocks).sort(), [...ARTICLE_KEYS].sort())) fail();
    for (const target of snapshot.targets) {
        // The GET owns each bundle's complete membership. The catalogue can
        // contain additional fields absent from a materialized legacy bundle.
        if (!Array.isArray(target.members) || new Set(target.members.map(member => member.column_uid)).size !== target.members.length
            || target.members.some(member => !ids.includes(member.column_uid))) fail();
        for (const member of target.members) {
            if (!articleEqual(Object.keys(member.values || {}).sort(), [...ARTICLE_KEYS].sort())) fail();
            for (const cell of Object.values(member.values)) {
                if (!cell || !articleEqual(Object.keys(cell).sort(), ['visible', 'width_px']) || typeof cell.visible !== 'boolean'
                    || cell.width_px !== null && (!Number.isSafeInteger(cell.width_px) || cell.width_px < 0)) fail();
            }
        }
        if (!Array.isArray(target.assignments) || ![0, 3].includes(target.assignments.length)) fail();
        if (target.scope === 'site' && target.assignments.length !== 3) fail();
        if (target.assignments.length) {
            const first = target.assignments[0];
            if (!articleEqual(target.assignments.map(link => link.view_key).sort(), [...ARTICLE_KEYS].sort()) || !first.name
                || !Number.isSafeInteger(first.field_set_id) || first.field_set_id <= 0 || !Number.isSafeInteger(first.priority)
                || target.assignments.some(link => link.field_set_id !== first.field_set_id || link.name !== first.name || link.priority !== first.priority)) fail();
        }
    }
    return snapshot;
}
export function projectArticleRows(snapshot, copy) {
    const mixed = values => values.every(value => value === values[0]) ? values[0] : 'ambiguous';
    const fields = new Map(snapshot.fields.map(field => [field.column_uid, field]));
    const members = new Map(snapshot.targets.flatMap(target => target.members.map(member => [member.column_uid, member])));
    return [...members.values()].map(member => {
        const field = fields.get(member.column_uid);
        return { id: `field:${member.column_uid}`, kind: 'fields', uid: member.column_uid, identity: `${copy.fieldName?.(field.name) ?? field.name} · UID ${field.column_uid}`,
            editable: field.editable, ...Object.fromEntries(ARTICLE_KEYS.map(key => [key, mixed(snapshot.targets.flatMap(target => {
                const value = target.members.find(item => item.column_uid === member.column_uid);
                return value ? [value.values[key].visible] : [];
            }))])) };
    }).concat(ARTICLE_BLOCKS.map(section => ({ id: `block:${section}`, kind: 'blocks', section, identity: copy[section],
        ...Object.fromEntries(ARTICLE_KEYS.filter(key => articleSupports({ kind: 'blocks', section }, key)).map(key => [key, snapshot.blocks[key][section]])) })));
}
export function articleOrdersDiffer(snapshot) {
    return snapshot.targets.some(target => !articleEqual(target.members.map(member => member.column_uid), snapshot.targets[0].members.map(member => member.column_uid)));
}
export function buildArticleWrite(baseline, change) {
    const request = cloneArticleState(baseline);
    delete request.fields; delete request.actor_id;
    if (baseline.targets[0].scope !== 'site') delete request.blocks;
    const metadata = change.metadata || {};
    for (const target of request.targets) {
        if (metadata.orderIntent) {
            const members = new Map(target.members.map(member => [`field:${member.column_uid}`, member]));
            target.members = change.order.filter(id => members.has(id)).map(id => members.get(id));
        }
        if (!target.assignments.length) target.assignments = ARTICLE_KEYS.map(view_key => ({ view_key, field_set_id: 0,
            name: `${baseline.dataset} [${articleTargetKey(target)}]`, priority: 0 }));
        for (const link of target.assignments) {
            if (Object.hasOwn(metadata, 'name')) link.name = target.scope === 'group' && request.targets.length > 1
                ? `${metadata.name.slice(0,100)} [g${target.group_id}]` : metadata.name;
            if (Object.hasOwn(metadata, 'priority') && target.scope === 'group') link.priority = metadata.priority;
        }
    }
    for (const cell of change.changedCells) {
        if (!ARTICLE_KEYS.includes(cell.columnKey) || typeof cell.nextValue !== 'boolean') continue;
        const row = change.rows.find(item => item.id === cell.rowId);
        if (!row || !articleSupports(row, cell.columnKey)) continue;
        if (row.kind === 'fields' && row.editable) for (const target of request.targets) {
            const member = target.members.find(member => member.column_uid === row.uid);
            if (member) member.values[cell.columnKey].visible = cell.nextValue;
        }
        if (row.kind === 'blocks' && request.blocks) request.blocks[cell.columnKey][row.section] = cell.nextValue;
    }
    return request;
}
export function verifyArticleWrite(expected, committed, readback, baseline) {
    validateArticleSnapshot(readback, { dataset: baseline.dataset, targets: baseline.targets });
    validateArticleSnapshot(committed, { dataset: baseline.dataset, targets: baseline.targets });
    if (readback.dataset_uid !== baseline.dataset_uid || readback.actor_id !== baseline.actor_id
        || !articleEqual(readback, committed) || !articleEqual(readback.fields, baseline.fields)) throw new Error('article-verification-failed');
    for (let index = 0; index < expected.targets.length; index++) {
        const wanted = expected.targets[index], actual = readback.targets[index];
        if (!articleEqual(actual.members, wanted.members)) throw new Error('article-verification-failed');
        for (const link of wanted.assignments) {
            const saved = actual.assignments.find(item => item.view_key === link.view_key);
            if (!saved || saved.name !== link.name || saved.priority !== link.priority || link.field_set_id && saved.field_set_id !== link.field_set_id) throw new Error('article-verification-failed');
        }
    }
    if (!articleEqual(readback.blocks, expected.blocks || baseline.blocks)) throw new Error('article-verification-failed');
    return cloneArticleState(readback);
}
