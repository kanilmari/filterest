// workline_observatory_view_printer.test.js
// Verifies the board renders selected goal, exact NOW tracks, detail, and scoped chat controls.
// Bridges normalized state with the private management-view DOM contract.
// Exists so V1 remains browsable without depending on a live backend in unit tests.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

const { createGoalMock, fetchBoardMock, fetchHistoryMock, goalActionMock, languageMock, saveContractMock, startConversationMock, statusActionMock } = vi.hoisted(() => ({
    createGoalMock: vi.fn(),
    fetchBoardMock: vi.fn(),
    fetchHistoryMock: vi.fn(),
    goalActionMock: vi.fn(),
    languageMock: vi.fn(),
    saveContractMock: vi.fn(),
    startConversationMock: vi.fn(),
    statusActionMock: vi.fn(),
}));

vi.mock('../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: languageMock,
}));
vi.mock('./workline_observatory_api_adapter.js', () => ({
    applyWorklineStatusAction: statusActionMock,
    applyWorklineReleaseGoalAction: goalActionMock,
    createWorklineReleaseGoal: createGoalMock,
    fetchWorklineObservatoryBoard: fetchBoardMock,
    fetchWorklineObservatoryReportHistory: fetchHistoryMock,
    saveWorklineReleaseContract: saveContractMock,
}));
vi.mock('./workline_observatory_chat_adapter.js', () => ({
    startWorklineConversation: startConversationMock,
}));

import { buildWorklineObservatoryState } from './workline_observatory_state_builder.js';
import { generate_workline_observatory_view, renderWorklineObservatory } from './workline_observatory_view_printer.js';

beforeEach(() => {
    document.body.innerHTML = '<main id="view"></main>';
    window.localStorage.clear();
    vi.clearAllMocks();
    languageMock.mockReturnValue('en');
    fetchHistoryMock.mockResolvedValue([]);
    window.confirm = vi.fn(() => true);
});

describe('workline observatory view', () => {
    test('renders worklines, six-slot NOW position, selected goal, and report context', () => {
        const state = buildWorklineObservatoryState({
            release_goal: {
                id: 7, identity_key: 'release-8.42', version: 1, title: '8.42',
                outcome: 'Ship the observatory.', decision_state: 'draft', contracts: [],
            },
            worklines: [{
                id: 869, title: 'Visual workline observatory', status: 'active', current_phase: 3,
                task_ids: [869],
                release_contract: { completion_rule: 'must_be_in_phase', target_phase: 5 },
                latest_report: {
                    phase_gate: '3-4', context: 'Release alignment needs a visual truth.',
                    plain_language: 'The owner can see the work.', technical: 'Latest final report only.',
                    next_step: 'Verify the board.', git_worktree_state: 'dirty', git_head_commit: 'abc1234',
                    git_workline_changed_paths: ['frontend/view.js'],
                },
            }],
        });
        const container = document.getElementById('view');
        renderWorklineObservatory(container, state);

        expect(container.textContent).toContain('release-8.42 v1');
        expect(container.textContent).toContain('Visual workline observatory · Phase 3');
        expect(container.textContent).toContain('Release alignment needs a visual truth.');
        expect(container.querySelectorAll('.workline-observatory__phase-node')).toHaveLength(6);
        expect([...container.querySelectorAll('.workline-observatory__phase-node')].map((node) => node.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(container.querySelector('.workline-observatory__now').textContent).toBe('NOW (1)');
        expect(container.querySelector('.workline-observatory__phase-node[data-current="true"]').textContent).toBe('3');
        expect(container.querySelector('.workline-observatory__target-row').textContent).toBe('Must be in phase · Phase 5');
        expect(container.querySelector('.workline-observatory__track').style.getPropertyValue('--history-links')).toBe('2');
        expect(container.querySelector('.workline-observatory__track').style.getPropertyValue('--future-links')).toBe('3');
        expect(container.querySelector('.workline-observatory__chat textarea')).not.toBeNull();
    });

    test('renders a goal creator when no release goal is selected', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({ worklines: [] }));

        expect(container.textContent).toContain('No release goal selected');
        expect(container.querySelector('.workline-observatory__goal-creator')).not.toBeNull();
        expect(container.querySelector('.workline-observatory__targets-heading').textContent).toBe('Release target');
    });

    test('renders representative Finnish and Chinese interface copy', async () => {
        fetchBoardMock.mockResolvedValue({ worklines: [] });
        const container = document.getElementById('view');

        languageMock.mockReturnValue('fi');
        await generate_workline_observatory_view(container);
        expect(container.querySelector('.workline-observatory__header p').textContent)
            .toBe('Valitse yksi tai useampi työlinja muuttaaksesi niiden tilaa.');

        languageMock.mockReturnValue('ch');
        await generate_workline_observatory_view(container);
        expect(container.querySelector('.workline-observatory__header p').textContent)
            .toBe('选择一条或多条工作线以更改状态。');
    });

    test('loads and browses earlier reports for the focused workline', async () => {
        fetchHistoryMock.mockResolvedValue([
            {
                id: 30, title: 'Current implementation', phase_gate: '4-5', current_phase: 4,
                context: 'Current context.', plain_language: 'Current plain explanation.',
                technical: 'Current technical explanation.', next_step: 'Current next step.',
                created_at: '2026-09-06T08:00:00Z', git_workline_changed_paths: [],
            },
            {
                id: 20, title: 'Earlier design', phase_gate: '2-3', current_phase: 2,
                context: 'Earlier context.', plain_language: 'Earlier plain explanation.',
                technical: 'Earlier technical explanation.', next_step: 'Earlier next step.',
                created_at: '2026-09-01T08:00:00Z', git_workline_changed_paths: [],
            },
        ]);
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({
            worklines: [{
                id: 34, title: 'Visual styles', status: 'active', current_phase: 4,
                latest_report: { id: 30, context: 'Current context.' },
            }],
        }));

        await vi.waitFor(() => expect(container.querySelector('.workline-observatory__report-history select')).not.toBeNull());
        expect(fetchHistoryMock).toHaveBeenCalledWith(34);
        expect(container.textContent).toContain('Current context.');
        const select = container.querySelector('.workline-observatory__report-history select');
        expect(select.options).toHaveLength(2);
        expect(select.options[1].textContent).toContain('Phase 2-3');

        select.value = '20';
        select.dispatchEvent(new Event('change'));

        expect(container.textContent).toContain('Earlier context.');
        expect(container.textContent).not.toContain('Current context.');
    });

    test('keeps status actions around NOW and makes the full title row selectable', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({
            worklines: [{ id: 1, title: 'Whole row', status: 'active', current_phase: 4 }],
        }));

        expect(container.querySelector('.workline-observatory__header p').textContent)
            .toBe('Select one or more worklines to change their state.');
        expect(container.querySelector('.workline-observatory__action-guidance').textContent).toBe('');
        expect([...container.querySelectorAll('.workline-observatory__status-action-group--before-now button')]
            .map((button) => button.textContent)).toEqual(['Activate', 'Pause']);
        expect([...container.querySelectorAll('.workline-observatory__status-action-group--after-now button')]
            .map((button) => button.textContent)).toEqual(['Mark done', 'Discard']);

        container.querySelector('.workline-observatory__workline-row').click();
        expect(container.querySelector('.workline-observatory__workline-checkbox').checked).toBe(true);
        expect(container.querySelector('.workline-observatory__selection-count').textContent).toBe('1 selected');

        const toolbar = container.querySelector('.workline-observatory__status-toolbar');
        const sentinel = container.querySelector('.workline-observatory__toolbar-sentinel');
        let sentinelBottom = 20;
        sentinel.getBoundingClientRect = () => ({ bottom: sentinelBottom });
        window.dispatchEvent(new Event('scroll'));
        expect(toolbar.dataset.compact).toBe('false');

        sentinelBottom = -2;
        window.dispatchEvent(new Event('scroll'));
        expect(toolbar.dataset.compact).toBe('true');
    });

    test('selects multiple rows and applies one confirmed atomic status action', async () => {
        const rows = [
            { id: 1, title: 'One', status: 'active', status_revision: 2, current_phase: 4 },
            { id: 2, title: 'Two', status: 'paused', status_revision: 5, current_phase: 2 },
            { id: 3, title: 'Three', status: 'active', status_revision: 1, current_phase: 5 },
        ];
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({ worklines: rows }));

        const checkboxes = container.querySelectorAll('.workline-observatory__workline-checkbox');
        checkboxes[0].click();
        container.querySelectorAll('.workline-observatory__workline-checkbox')[2].click();
        expect(container.querySelector('.workline-observatory__selection-count').textContent).toBe('2 selected');

        statusActionMock.mockResolvedValue({ changed_count: 2 });
        fetchBoardMock.mockResolvedValue({
            worklines: rows.map((row) => row.id === 2 ? row : {
                ...row,
                status: 'closed',
                status_revision: row.status_revision + 1,
                status_reconciliation_needed: true,
            }),
        });
        container.querySelector('[data-status-action="closed"]').click();

        await vi.waitFor(() => expect(statusActionMock).toHaveBeenCalledOnce());
        expect(window.confirm).toHaveBeenCalledWith('Change all 2 selected worklines to Done?');
        expect(statusActionMock).toHaveBeenCalledWith([
            { id: 1, expected_revision: 2 },
            { id: 3, expected_revision: 1 },
        ], 'closed');
        await vi.waitFor(() => expect(container.textContent).toContain('Changed 2 workline(s) to Done.'));
        expect(container.querySelectorAll('[data-reconciliation-needed="true"]')).not.toHaveLength(0);
    });

    test('selects and deselects every visible workline from the toolbar', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({
            worklines: [
                { id: 1, title: 'One', status: 'active', current_phase: 4 },
                { id: 2, title: 'Two', status: 'paused', current_phase: 2 },
                { id: 3, title: 'Three', status: 'active', current_phase: 3 },
            ],
        }));

        container.querySelector('.workline-observatory__workline-checkbox').click();
        expect(container.querySelector('.workline-observatory__selection-toggle').indeterminate).toBe(true);
        container.querySelector('.workline-observatory__selection-toggle').click();

        expect(container.querySelector('.workline-observatory__selection-count').textContent).toBe('3 selected');
        expect([...container.querySelectorAll('.workline-observatory__workline-checkbox')]
            .every((checkbox) => checkbox.checked)).toBe(true);
        expect(container.querySelector('.workline-observatory__selection-toggle').checked).toBe(true);

        container.querySelector('.workline-observatory__selection-toggle').click();

        expect(container.querySelector('.workline-observatory__selection-count').textContent).toBe('');
        expect([...container.querySelectorAll('.workline-observatory__workline-checkbox')]
            .every((checkbox) => !checkbox.checked)).toBe(true);
        expect(container.querySelector('.workline-observatory__selection-toggle').checked).toBe(false);

        container.querySelector('[data-selection-action="select-all"]').click();
        expect([...container.querySelectorAll('.workline-observatory__workline-checkbox')]
            .every((checkbox) => checkbox.checked)).toBe(true);
        container.querySelector('[data-selection-action="deselect-all"]').click();
        expect([...container.querySelectorAll('.workline-observatory__workline-checkbox')]
            .every((checkbox) => !checkbox.checked)).toBe(true);
    });

    test('keeps same-state actions pressable for their explanatory tooltip', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({
            worklines: [{ id: 1, title: 'Already active', status: 'active', current_phase: 4 }],
        }));
        container.querySelector('.workline-observatory__workline-row').click();

        const activate = container.querySelector('[data-status-action="active"]');
        expect(activate.disabled).toBe(false);
        expect(activate.getAttribute('aria-disabled')).toBe('true');
        expect(activate.title).toBe('All selected worklines are already Active.');
        activate.click();

        expect(statusActionMock).not.toHaveBeenCalled();
        expect(container.querySelector('.workline-observatory__action-guidance').textContent)
            .toBe('All selected worklines are already Active.');
    });

    test('opens the same actions at the pointer on right click and preserves an existing group', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({
            worklines: [
                { id: 1, title: 'One', status: 'active', current_phase: 4 },
                { id: 2, title: 'Two', status: 'paused', current_phase: 2 },
            ],
        }));
        container.querySelectorAll('.workline-observatory__workline-checkbox')[0].click();
        container.querySelectorAll('.workline-observatory__workline-checkbox')[1].click();

        container.querySelector('[data-workline-id="2"]').dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true,
            clientX: 300,
            clientY: 240,
        }));

        const menu = document.querySelector('.workline-observatory__context-menu');
        expect(menu).not.toBeNull();
        expect(menu.parentElement).toBe(document.body);
        expect(menu.style.position).toBe('fixed');
        expect(menu.style.left).toBe('300px');
        expect(menu.style.top).toBe('240px');
        expect(menu.querySelectorAll('[data-status-action]')).toHaveLength(4);
        expect(container.querySelector('.workline-observatory__selection-count').textContent).toBe('2 selected');
    });

    test('restores selected worklines after a fresh render', () => {
        const snapshot = { worklines: [
            { id: 1, title: 'One', status: 'active', current_phase: 4 },
            { id: 2, title: 'Two', status: 'paused', current_phase: 2 },
        ] };
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState(snapshot));
        container.querySelectorAll('.workline-observatory__workline-row')[1].click();

        renderWorklineObservatory(container, buildWorklineObservatoryState(snapshot));

        expect(container.querySelectorAll('.workline-observatory__workline-checkbox')[0].checked).toBe(false);
        expect(container.querySelectorAll('.workline-observatory__workline-checkbox')[1].checked).toBe(true);
        expect(container.querySelectorAll('.workline-observatory__workline-row')[1].dataset.selected).toBe('true');
    });

    test('renders a closed workline entirely behind NOW without a current phase', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({
            worklines: [{ id: 1, title: 'Owner closed', status: 'closed', current_phase: 5 }],
        }));

        const nodes = [...container.querySelectorAll('.workline-observatory__phase-node')];
        expect(nodes.map((node) => node.style.gridColumn)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(nodes.every((node) => node.dataset.state === 'completed')).toBe(true);
        expect(container.querySelector('.workline-observatory__phase-node[data-current="true"]')).toBeNull();
        expect(container.textContent).toContain('Owner closed · Phase 6');
    });
});
