// workline_observatory_actions.test.js
// Verifies exact-row revisions, confirmation and duplicate/conflict safeguards.
// Connects lifecycle and priority decisions with mocked authenticated atomic endpoints.
// Prevents hidden selection or concurrent clicks from silently widening owner decisions.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';
const { priorityMock, statusMock } = vi.hoisted(() => ({ priorityMock: vi.fn(), statusMock: vi.fn() }));
vi.mock('./workline_observatory_api_adapter.js', () => ({ applyWorklinePriorityAction: priorityMock, applyWorklineStatusAction: statusMock }));
import { createWorklineObservatoryActions, getStatusActions } from './workline_observatory_actions.js';
import { DEFAULT_COPY } from './workline_observatory_copy.js';

beforeEach(() => { vi.clearAllMocks(); window.confirm = vi.fn(() => true); });

function setup() {
    const state = { worklines: [
        { id: 1, title: 'One', status: 'active', status_revision: 5, priority: 'normal', priority_revision: 2 },
        { id: 2, title: 'Two', status: 'paused', status_revision: 8, priority: 'low', priority_revision: 3 },
    ], selectedWorklineIds: [2, 999] };
    const refresh = vi.fn().mockResolvedValue(undefined);
    const setMessage = vi.fn();
    const actions = createWorklineObservatoryActions({ getState: () => state, copy: DEFAULT_COPY, refresh, redraw: vi.fn(), setMessage });
    return { actions, state, refresh, setMessage };
}

describe('atomic Observatory decisions', () => {
    test('explains a same-state row action by its own title without checkbox selection', async () => {
        const { actions, state, refresh, setMessage } = setup();
        state.selectedWorklineIds = [];
        await actions.status(getStatusActions(DEFAULT_COPY)[0], [1]);
        expect(setMessage).toHaveBeenLastCalledWith('“One” is already Active.');
        expect(state.selectedWorklineIds).toEqual([]);
        expect(statusMock).not.toHaveBeenCalled();
        expect(window.confirm).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    test('retains collective same-state guidance for an actual bulk selection', async () => {
        const { actions, state, setMessage } = setup();
        state.worklines[1].status = 'active';
        state.selectedWorklineIds = [1, 2];
        await actions.status(getStatusActions(DEFAULT_COPY)[0]);
        expect(setMessage).toHaveBeenLastCalledWith('All selected worklines are already Active.');
        expect(state.selectedWorklineIds).toEqual([1, 2]);
        expect(statusMock).not.toHaveBeenCalled();
    });

    test('resolves bulk selection against current visible identities and exact revisions', async () => {
        const { actions } = setup();
        await actions.status(getStatusActions(DEFAULT_COPY)[2]);
        expect(statusMock).toHaveBeenCalledWith([{ id: 2, expected_revision: 8 }], 'closed');
    });

    test('honors confirmation cancellation without writing or refreshing', async () => {
        const { actions, refresh } = setup();
        window.confirm.mockReturnValue(false);
        await actions.status(getStatusActions(DEFAULT_COPY)[3], [1]);
        expect(statusMock).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
    });

    test('shares the busy guard across priority and lifecycle decisions', async () => {
        const { actions } = setup();
        let release;
        priorityMock.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
        const pending = actions.priority(1, 'critical');
        await actions.status(getStatusActions(DEFAULT_COPY)[2], [2]);
        await actions.priority(2, 'high');
        expect(priorityMock).toHaveBeenCalledOnce();
        expect(priorityMock).toHaveBeenCalledWith([{ id: 1, expected_revision: 2 }], 'critical');
        expect(statusMock).not.toHaveBeenCalled();
        release({ changed_count: 1 });
        await pending;
        expect(actions.busy).toBe(false);
    });

    test('refreshes a conflicting priority decision and asks the owner to review it', async () => {
        const { actions, refresh, setMessage } = setup();
        priorityMock.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
        await actions.priority(1, 'high');
        expect(refresh).toHaveBeenCalledOnce();
        expect(setMessage).toHaveBeenLastCalledWith(DEFAULT_COPY.conflict);
    });

    test('does not refresh a destroyed list when an earlier request finishes', async () => {
        const { actions, refresh } = setup();
        let release;
        statusMock.mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
        const pending = actions.status(getStatusActions(DEFAULT_COPY)[2], [1]);
        actions.destroy();
        release({ changed_count: 1 });
        await pending;
        expect(refresh).not.toHaveBeenCalled();
    });
    test('does not refresh a destroyed list when an earlier request returns a conflict', async () => {
        const { actions, refresh } = setup();
        let reject;
        statusMock.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
        const pending = actions.status(getStatusActions(DEFAULT_COPY)[2], [1]);
        actions.destroy();
        reject(Object.assign(new Error('conflict'), { status: 409 }));
        await pending;
        expect(refresh).not.toHaveBeenCalled();
    });
});
