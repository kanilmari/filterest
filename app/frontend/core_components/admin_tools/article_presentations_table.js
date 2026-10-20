// article_presentations_table.js
// Binds the shared five-column checkbox table to atomic article-family persistence.
// Connects immutable per-target GET snapshots, explicit intents and verified adoption.
// The host owns Save/Cancel; failed or incomplete readback retains the scoped draft.
import { createVanillaCheckboxTable } from '../../reusable_components/vanilla_checkbox_table/vanilla_checkbox_table.js';
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { ARTICLE_KEYS, articleSupports, articleTargetKey, articleEqual, cloneArticleState,
    validateArticleSnapshot, projectArticleRows, buildArticleWrite, verifyArticleWrite } from './article_presentations_state.js';
import { articleCopyFormat } from './article_presentations_copy.js';

export async function readArticlePresentations(dataset, targets) {
    return endpoint_router('articlePresentations', { url_params: `?${new URLSearchParams({ dataset,
        targets: targets.map(articleTargetKey).join(',') })}`, suppressErrorToast: true });
}
export async function writeArticlePresentations(body) {
    return endpoint_router('articlePresentations', { method: 'POST', body_data: body, suppressErrorToast: true });
}
export function articleDraftContext(snapshot) {
    return { actorID: snapshot.actor_id, datasetUID: snapshot.dataset_uid,
        target: snapshot.targets.map(articleTargetKey), family: 'article' };
}
export function createArticlePresentationsTable({ host, snapshot, copy, read = readArticlePresentations,
    write = writeArticlePresentations, onStatus = () => {}, onDirtyChange = () => {} }) {
    let baseline = cloneArticleState(validateArticleSnapshot(snapshot, { dataset: snapshot.dataset, targets: snapshot.targets }));
    let disposed = false, blocked = false, table;
    const initialRows = projectArticleRows(baseline, copy);
    const initialMixed = new Set(initialRows.flatMap(row => ARTICLE_KEYS.filter(key => row[key] === 'ambiguous').map(key => `${row.id}|${key}`)));
    const labels = { article_view: copy.article, image_first_view: copy.image, image_first_page_view: copy.page };
    const context = articleDraftContext(baseline);
    const canEdit = row => row.kind === 'fields' ? row.editable : baseline.targets[0].scope === 'site';
    async function writeThenVerify(change) {
        if (blocked || disposed) throw new Error('article-refresh-required');
        const intents = change.metadata || {};
        if (Object.keys(intents).some(key => !['name','priority','orderIntent'].includes(key))
            || Object.hasOwn(intents,'name') && (typeof intents.name !== 'string' || !intents.name || intents.name.length > 128)
            || Object.hasOwn(intents,'priority') && (!Number.isSafeInteger(intents.priority) || Math.abs(intents.priority) > 1000000)
            || Object.hasOwn(intents,'orderIntent') && intents.orderIntent !== true) {
            onStatus(copy.recovery); throw new Error('invalid-article-intents');
        }
        const expected = buildArticleWrite(baseline, change);
        let committed;
        try { committed = await write(expected); }
        catch (error) {
            if (error?.status === 409 || error?.response?.status === 409) { blocked = true; onStatus(copy.conflict); }
            else if (!Number.isInteger(error?.status) || error.status < 100) {
                blocked = true; onStatus(copy.verification);
                throw Object.assign(new Error('article-write-outcome-unknown', { cause:error }), { committed:true, code:'verification-failed' });
            } else onStatus(copy.failed);
            throw error;
        }
        try {
            const actual = verifyArticleWrite(expected, committed, await read(baseline.dataset, baseline.targets), baseline);
            if (disposed) throw new Error('article-context-disposed');
            const projected = new Map(projectArticleRows(actual, copy).map(row => [row.id, row]));
            const verifiedRows = change.order.map(id => projected.get(id));
            const realValues = rows => rows.map(row => row && [row.id,row.kind,row.identity,...ARTICLE_KEYS.map(key => row[key])]);
            if (!articleEqual(realValues(verifiedRows), realValues(change.rows))) throw new Error('article-display-readback-mismatch');
            const metadata = {};
            if (Object.hasOwn(intents,'priority')) metadata.priority = actual.targets[0].assignments[0].priority;
            if (Object.hasOwn(intents,'name')) {
                const target = actual.targets[0], suffix = target.scope === 'group' && actual.targets.length > 1 ? ` [g${target.group_id}]` : '';
                const name = target.assignments[0].name;
                metadata.name = suffix ? name.slice(0,-suffix.length) : name;
            }
            if (intents.orderIntent) metadata.orderIntent = actual.targets.every(target => articleEqual(
                target.members.map(member => `field:${member.column_uid}`), change.order.filter(id =>
                    target.members.some(member => id === `field:${member.column_uid}`))));
            if (!articleEqual(metadata,intents)) throw new Error('article-metadata-readback-mismatch');
            baseline = cloneArticleState(actual);
            initialMixed.clear();
            verifiedRows.forEach(row => ARTICLE_KEYS.forEach(key => {
                if (row[key] === 'ambiguous') initialMixed.add(`${row.id}|${key}`);
            }));
            onStatus(copy.saved);
            return { rows: verifiedRows, context, revisions: actual.revisions, metadata };
        } catch (cause) {
            blocked = true; onStatus(copy.verification);
            throw Object.assign(new Error('article-verification-failed', { cause }), { committed: true, code: 'verification-failed' });
        }
    }
    table = createVanillaCheckboxTable({ containerElement: host, rows: initialRows, rowIdKey: 'id',
        rowGroupKey: 'kind', rowGroups: [{ key: 'fields', label: copy.fields }, { key: 'blocks', label: copy.blocks }],
        rowHeaderKey: 'identity', toolbar: 'external', startInEditMode: true, baselinePolicy: 'verified-result',
        draftContext: { ...context, revisions: baseline.revisions }, draftMetadata: {},
        storageKey: `article-presentations-v2:${JSON.stringify(context)}`,
        reorder: { group: 'fields', inColumn: 'identity', labels: { up: copy.up, down: copy.down,
            filtered: copy.filtered, position: copy.position }, onChange: () => {
            table.setDraftMetadata({ ...table.getChangeSet().metadata, orderIntent: true });
        } },
        columns: [{ key: 'identity', label: copy.identity, type: 'static' }, ...ARTICLE_KEYS.map(key => ({ key, label: labels[key], type: 'checkbox',
            isCellDisabled: ({ row }) => !canEdit(row),
            renderEditableCell: ({ row, value, updateValue, isDisabled }) => {
                const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'vct-input-checkbox'; input.dataset.columnKey = key; input.checked = value === true;
                input.indeterminate = value === 'ambiguous'; input.disabled = isDisabled;
                if (value === 'ambiguous') { input.title = copy.unchanged; input.classList.add('vct-input-checkbox-ambiguous'); }
                input.addEventListener('change', () => {
                    const current = table.getRows({ draft: true }).find(item => item.id === row.id)[key];
                    updateValue(initialMixed.has(`${row.id}|${key}`) ? current === 'ambiguous' ? true : current === true ? false : 'ambiguous' : current !== true);
                    // The shared table retains this input (and its focus). Native
                    // checkboxes have two states; restore our third state explicitly.
                    const actual = table.getRows({ draft:true }).find(item => item.id === row.id)[key];
                    input.checked = actual === true; input.indeterminate = actual === 'ambiguous';
                    input.title = actual === 'ambiguous' ? copy.unchanged : '';
                    input.classList.toggle('vct-input-checkbox-ambiguous', actual === 'ambiguous');
                });
                return input;
            } })), { key: 'all', label: copy.select_all, rowToggle: { columns: ARTICLE_KEYS } }],
        isCellSupported: ({ row, column }) => articleSupports(row, column.key),
        renderUnsupportedCell: () => { const dash = document.createElement('span'); dash.textContent = copy.dash;
            dash.setAttribute('aria-label', copy.unsupported); dash.title = copy.unsupported; return dash; },
        cellAccessibleName: ({ row, column, groupLabel }) => articleCopyFormat(copy.cell, { group: groupLabel,
            name: row.identity, presentation: column.label, target: baseline.targets.map(target =>
                ({site:copy.target_site,group:copy.target_group,personal:copy.target_personal})[target.scope]
                + (target.group_id || target.user_id ? ` ${target.group_id || target.user_id}` : '')).join(', '), meaning: row.kind === 'blocks' ? copy.open : copy.visible }),
        onDirtyChange,
        onDraftRecovery: ({ status }) => {
            if (status === 'recovered') onStatus(copy.recovered);
            else if (status === 'revision-conflict') onStatus(copy.conflict);
            else if (!['none', 'discarded'].includes(status)) onStatus(copy.recovery);
        },
        onSave: writeThenVerify,
    });
    // This external editor is always in edit mode. A clean visit is not a draft
    // and must not turn a later revision change into a spurious recovery conflict.
    if (!table.isDirty() && ['none','recovered'].includes(table.getRecoveryState().status)) {
        table.clearPersistedDraft();
        if (table.getRecoveryState().status === 'recovered') onStatus('');
    }
    return { table, context, baseline: () => cloneArticleState(baseline),
        async save() {
            const saved = await table.saveChanges();
            if (saved && !disposed) {
                // A verified save starts a fresh intent set over the GET baseline.
                table.setRows(projectArticleRows(baseline,copy), { context, revisions:baseline.revisions, metadata:{} });
                table.enterEditMode(); table.clearPersistedDraft();
            }
            return saved;
        },
        cancel() { table.cancelChanges(); table.enterEditMode(); table.clearPersistedDraft(); onStatus(''); },
        metadata(value) {
            const metadata = { ...table.getChangeSet().metadata, ...value };
            if (Object.hasOwn(value,'name') && baseline.targets[0].scope === 'group' && baseline.targets.length > 1) metadata.name = metadata.name.slice(0,100);
            if (metadata.priority === null) delete metadata.priority;
            table.setDraftMetadata(metadata);
        },
        filter(term) { const query = term.trim().toLocaleLowerCase(); table.setRowFilter(query
            ? row => row.kind === 'blocks' || row.identity.toLocaleLowerCase().includes(query) : null); },
        restoreDefaults() {
            ARTICLE_KEYS.forEach(key => table.setColumnValues(key, true));
            // Delivery-restricted fields stay read-only and false. Blocks are
            // changed only when this is an actual site target.
        },
        destroy() { disposed = true; table.destroy(); },
        isBlocked: () => blocked || !['none', 'recovered', 'discarded'].includes(table.getRecoveryState().status),
    };
}

// Mixed family state is compared from one complete snapshot, including order.
// Selecting all groups normally means site; differing real values keep exact groups.
export function articleGroupsDiffer(snapshot) {
    const values = target => target.members.map(member => [member.column_uid, ...ARTICLE_KEYS.map(key => member.values[key].visible)]);
    return snapshot.targets.some(target => !articleEqual(values(target), values(snapshot.targets[0])));
}
