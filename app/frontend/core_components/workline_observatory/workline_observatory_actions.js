// workline_observatory_actions.js
// Applies confirmed lifecycle decisions and independent priority revisions to exact visible rows.
// Connects shared row/bulk action definitions with the authenticated atomic API adapters.
// Prevents row menus from inheriting bulk selection and keeps immutable reports untouched.

import { applyWorklineStatusAction, applyWorklinePriorityAction } from './workline_observatory_api_adapter.js';

export function formatCopy(template, values) {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        String(template || ''),
    );
}

export function getStatusActions(copy) {
    return [
        { status: 'active', label: copy.activate, stateLabel: copy.activeState },
        { status: 'paused', label: copy.pause, stateLabel: copy.pausedState },
        { status: 'closed', label: copy.markDone, stateLabel: copy.closedState },
        { status: 'archived', label: copy.discard, stateLabel: copy.archivedState },
    ];
}

export function buildStatusActionGuidance(action, selected, copy) {
    if (selected.length === 0) {
        return formatCopy(copy.chooseTarget, { state: action.stateLabel });
    }
    const affected = selected.filter((workline) => workline.status !== action.status);
    if (affected.length === 0) {
        const template = selected.length === 1 ? copy.alreadyTargetOne : copy.alreadyTarget;
        return formatCopy(template, { title: selected[0].title, state: action.stateLabel });
    }
    if (selected.length === 1) {
        return formatCopy(copy.moveOne, { title: selected[0].title, state: action.stateLabel });
    }
    if (affected.length === selected.length) {
        return formatCopy(copy.moveMany, {
            count: selected.length,
            changeCount: affected.length,
            state: action.stateLabel,
        });
    }
    return formatCopy(copy.moveMixed, {
        changeCount: affected.length,
        count: selected.length,
        sameCount: selected.length - affected.length,
        state: action.stateLabel,
    });
}

export function buildStatusActionConfirmation(action, selected, affected, copy) {
    if (selected.length === 1) {
        return formatCopy(copy.confirmOne, { title: selected[0].title, state: action.stateLabel });
    }
    const template = affected.length === selected.length ? copy.confirmMany : copy.confirmMixed;
    return formatCopy(template, {
        changeCount: affected.length,
        count: selected.length,
        sameCount: selected.length - affected.length,
        state: action.stateLabel,
    });
}

export function describeWorklineStatus(status, copy) {
    return getStatusActions(copy).find((action) => action.status === status)?.stateLabel || status || '—';
}

export function describeStatusChange(change, copy) {
    if (!change) return '—';
    const sources = {
        observatory_ui: copy.sourceObservatory,
        agent_tools_api: copy.sourceAgentTools,
        report_sync: copy.sourceReport,
        creation: copy.sourceCreation,
        legacy: copy.sourceLegacy,
    };
    const actor = change.changed_by_username || copy.unknownActor;
    const source = sources[change.source] || change.source || '—';
    const parsed = new Date(change.changed_at);
    const changedAt = Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
    return `${actor} · ${source} · ${changedAt}`;
}


// Resolves identities from the current snapshot at invocation, never a hidden selection.
export function createWorklineObservatoryActions({ getState, copy, refresh, redraw, setMessage }) {
    let busy = false;
    let destroyed = false;
    const errorMessage = async (error) => {
        if (Number(error?.status || error?.statusCode || error?.response?.status) === 409) {
            try { await refresh(); } catch (_refreshError) { /* Keep actionable conflict guidance. */ }
            return copy.conflict;
        }
        return error?.message || String(error);
    };
    const run = async (operation, success) => {
        if (busy || destroyed) return;
        busy = true;
        setMessage('');
        redraw();
        try {
            const result = await operation();
            if (destroyed) return;
            await refresh();
            if (!destroyed) setMessage(success(result));
        } catch (error) {
            if (destroyed) return;
            const message = await errorMessage(error);
            if (!destroyed) setMessage(message);
        } finally {
            busy = false;
            if (!destroyed) redraw();
        }
    };
    return {
        get busy() { return busy; },
        async mutate(operation) { await run(operation, () => ''); },
        destroy() { destroyed = true; },
        async status(action, rowIds = null) {
            if (busy || destroyed) return;
            const state = getState();
            const selectedIds = new Set(rowIds ?? state.selectedWorklineIds ?? []);
            const selected = state.worklines.filter((workline) => selectedIds.has(workline.id));
            const affected = selected.filter((workline) => workline.status !== action.status);
            if (!affected.length) {
                setMessage(buildStatusActionGuidance(action, selected, copy));
                redraw();
                return;
            }
            if (!window.confirm(buildStatusActionConfirmation(action, selected, affected, copy))) return;
            await run(() => applyWorklineStatusAction(selected.map((workline) => ({
                id: workline.id, expected_revision: workline.status_revision || 0,
            })), action.status), (result) => formatCopy(copy.changed, {
                count: result?.changed_count ?? affected.length, state: action.stateLabel,
            }));
        },
        async priority(worklineId, targetPriority) {
            if (busy || destroyed || !['low', 'normal', 'high', 'critical'].includes(targetPriority)) return;
            const workline = getState().worklines.find((candidate) => candidate.id === worklineId);
            if (!workline || workline.priority === targetPriority) return;
            await run(() => applyWorklinePriorityAction([{
                id: workline.id, expected_revision: workline.priority_revision || 0,
            }], targetPriority), () => formatCopy(copy.priorityChanged, { priority: copy[targetPriority] }));
        },
    };
}

export function buildWorklinePriorityEditor(workline, copy, actions) {
    const select = document.createElement('select');
    select.className = 'workline-observatory__priority-editor';
    select.setAttribute('aria-label', `${copy.priority}: ${workline.title}`);
    select.dataset.priorityWorklineId = String(workline.id);
    for (const priority of ['low', 'normal', 'high', 'critical']) {
        const option = document.createElement('option');
        option.value = priority;
        option.textContent = copy[priority];
        select.append(option);
    }
    select.value = workline.priority || 'normal';
    select.disabled = actions.busy;
    select.addEventListener('change', async () => {
        const targetPriority = select.value;
        select.disabled = true;
        try { await actions.priority(workline.id, targetPriority); }
        finally {
            if (select.isConnected) {
                select.value = workline.priority || 'normal';
                select.disabled = actions.busy;
            }
        }
    });
    return select;
}
