// checkbox_table_draft.js
// Owns opt-in version-2 recovery and verified baseline adoption.
// Keeps exact context/revision checks and late-response guards separate from legacy saves.
import { deepClone, toRowIdentifier } from './checkbox_table_values.js';

const equal = (left, right) => canonical(left) === canonical(right);
function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return JSON.stringify(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
    return JSON.stringify(value);
}
function withoutRevisions(value) {
    const context = deepClone(value || {});
    delete context.revisions;
    return context;
}
function failure(code, committed = false) {
    return Object.assign(new Error(code), { code, committed });
}

export function createCheckboxTableDraft(options, state, features) {
    const enabled = options.draftContext !== undefined;
    const verified = options.baselinePolicy === 'verified-result';
    const rowIdKey = options.rowIdKey || 'id';
    const id = row => toRowIdentifier(row, rowIdKey);
    let context = withoutRevisions(options.draftContext);
    let revisions = deepClone(options.draftContext?.revisions ?? options.draftRevisions ?? {});
    let baseMetadata = deepClone(options.draftMetadata ?? null);
    let metadata = deepClone(baseMetadata);
    let tracksMetadata = enabled || verified || options.draftMetadata !== undefined;
    let generation = 0;
    let disposed = false;
    let verificationBlocked = false;
    let pending = null;
    let recovery = { status: 'none' };
    const frozenControls = new Map();
    const frozen = () => Boolean(pending) || (verified && state.saving);
    const changeSet = () => ({ rows: deepClone(state.rows), changedCells: state.changed(),
        order: state.rows.map(id), context: deepClone(context), revisions: deepClone(revisions), metadata: deepClone(metadata) });
    const notify = status => {
        recovery = { status, ...(pending ? { draft: deepClone(pending) } : {}) };
        options.onDraftRecovery?.(deepClone(recovery));
    };

    function validate(saved) {
        if (saved?.version !== 2 || !Array.isArray(saved.order) || !Array.isArray(saved.changedCells) ||
            !Object.hasOwn(saved, 'metadata') || !Object.hasOwn(saved, 'revisions')) return 'invalid-draft';
        if (!equal(saved.context, context)) return 'context-mismatch';
        const ids = state.base.map(id);
        if (ids.some(value => !value) || new Set(ids).size !== ids.length ||
            saved.order.length !== ids.length || new Set(saved.order).size !== ids.length ||
            saved.order.some(value => !ids.includes(value))) return 'invalid-identities';
        // Reject cross-group movement and fixed-row movement before replaying anything.
        if (options.reorder) {
            const byId = new Map(state.base.map(row => [id(row), row]));
            if (saved.order.some((value, index) => {
                const row = byId.get(value), original = state.base[index];
                return row[options.rowGroupKey] !== original[options.rowGroupKey] ||
                    (row[options.rowGroupKey] !== options.reorder.group && id(original) !== value);
            })) return 'invalid-order';
        } else if (!equal(saved.order, ids)) return 'invalid-order';
        const seen = new Set();
        for (const cell of saved.changedCells) {
            if (!cell || !Object.hasOwn(cell, 'previousValue') || !Object.hasOwn(cell, 'nextValue')) return 'invalid-cells';
            const row = state.base.find(item => id(item) === cell.rowId);
            const column = state.columns.find(item => item.key === cell.columnKey);
            const key = JSON.stringify([cell.rowId, cell.columnKey]);
            if (!row || !column || column.rowToggle || !column.editable || !features.supported(row, column) || seen.has(key)) {
                return 'invalid-cells';
            }
            seen.add(key);
        }
        return equal(saved.revisions, revisions) ? null : 'revision-conflict';
    }
    function replay(saved) {
        const byId = new Map(state.base.map(row => [id(row), deepClone(row)]));
        saved.changedCells.forEach(cell => { byId.get(cell.rowId)[cell.columnKey] = deepClone(cell.nextValue); });
        state.rows = saved.order.map(value => byId.get(value));
        metadata = deepClone(saved.metadata);
        pending = null;
        notify('recovered');
    }
    function freezeControls() {
        // Leaving standalone recovery must also restore the captured disabled states.
        if (!verified && !pending && !frozenControls.size) return;
        const controls = options.containerElement.querySelectorAll('input, select, textarea, button');
        if (frozen()) {
            controls.forEach(control => {
                if (!frozenControls.has(control)) frozenControls.set(control, control.disabled);
                if (control.classList.contains('vct-move')) control.setAttribute('aria-disabled', 'true');
                else control.disabled = true;
            });
        } else {
            frozenControls.forEach((disabled, control) => { control.disabled = disabled; });
            frozenControls.clear();
            features.finishBody();
            features.refreshToggles();
        }
    }
    function adopt(result, submitted) {
        if (!result || !Array.isArray(result.rows) || !Object.hasOwn(result, 'context') ||
            !result.revisions || typeof result.revisions !== 'object' || !Object.hasOwn(result, 'metadata')) {
            throw failure('verified-result-required', true);
        }
        if (!equal(Object.keys(result.revisions).sort(), Object.keys(revisions).sort())) {
            throw failure('verified-result-mismatch', true);
        }
        if (!equal(withoutRevisions(result.context), context) || !equal(result.metadata, submitted.metadata) ||
            !equal(result.rows.map(id), submitted.order)) throw failure('verified-result-mismatch', true);
        const ids = result.rows.map(id);
        if (new Set(ids).size !== ids.length || ids.some(value => !value)) throw failure('verified-result-mismatch', true);
        for (let index = 0; index < result.rows.length; index++) {
            if (options.rowGroupKey && result.rows[index][options.rowGroupKey] !== submitted.rows[index][options.rowGroupKey]) {
                throw failure('verified-result-mismatch', true);
            }
            for (const column of state.columns.filter(item => !item.rowToggle)) {
                if ((features.supported(result.rows[index], column) && !Object.hasOwn(result.rows[index], column.key)) ||
                    !equal(result.rows[index][column.key], submitted.rows[index][column.key]) ||
                    features.supported(result.rows[index], column) !== features.supported(submitted.rows[index], column)) {
                    throw failure('verified-result-mismatch', true);
                }
            }
        }
        state.base = deepClone(result.rows);
        state.rows = deepClone(result.rows);
        revisions = deepClone(result.revisions);
        metadata = deepClone(result.metadata);
        baseMetadata = deepClone(metadata);
        verificationBlocked = false;
        notify('none');
    }
    return {
        enabled, verified, changeSet, frozen, freezeControls, adopt,
        generation: () => generation,
        current: value => !disposed && value === generation,
        blocked: () => verificationBlocked || Boolean(pending),
        preserve: () => Boolean(pending),
        metadataChanged: () => tracksMetadata && !equal(metadata, baseMetadata),
        acceptMetadata() { baseMetadata = deepClone(metadata); },
        setMetadata(value) {
            if (frozen()) return;
            tracksMetadata = true;
            metadata = deepClone(value);
            state.recompute();
        },
        payload: () => ({ version: 2, editMode: state.editing, context: deepClone(context),
            revisions: deepClone(revisions), changedCells: state.changed(), order: state.rows.map(id), metadata: deepClone(metadata) }),
        restore(raw) {
            if (!raw) return;
            let saved;
            try {
                const parsed = JSON.parse(raw);
                saved = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { unrecognized: parsed };
            } catch { saved = {}; }
            const reason = validate(saved);
            if (reason) { pending = saved; notify(reason); return; }
            replay(saved);
            state.editing = Boolean(saved.editMode);
        },
        recoveryState: () => deepClone(recovery),
        reconcile({ discard = false } = {}) {
            if (!pending) return false;
            if (discard) {
                pending = null;
                options.storageKey && localStorage.removeItem(options.storageKey);
                notify('discarded');
            } else {
                const reason = validate(pending);
                if (reason && reason !== 'revision-conflict') throw failure(reason);
                replay(pending);
            }
            state.recompute();
            state.render();
            return true;
        },
        saveFailed(error) {
            if (!verified) return;
            if (error?.committed) verificationBlocked = true;
            options.onSaveError?.({ code: error?.code || 'save-failed', committed: Boolean(error?.committed), error });
        },
        cancel() {
            if (verified && state.saving) return;
            pending = null;
            metadata = deepClone(baseMetadata);
            notify('none');
        },
        fresh(snapshot) {
            generation++;
            if (snapshot.context !== undefined) context = withoutRevisions(snapshot.context);
            if (snapshot.revisions !== undefined) revisions = deepClone(snapshot.revisions);
            if (snapshot.metadata !== undefined) baseMetadata = deepClone(snapshot.metadata);
            metadata = deepClone(baseMetadata);
            verificationBlocked = false;
            pending = null;
            notify('none');
        },
        dispose() { disposed = true; generation++; },
    };
}
