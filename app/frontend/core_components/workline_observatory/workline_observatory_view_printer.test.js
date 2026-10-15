// workline_observatory_view_printer.test.js
// Verifies the board renders selected goal, exact NOW tracks and workline detail controls.
// Bridges normalized state with the private management-view DOM contract.
// Exists so V1 remains browsable without depending on a live backend in unit tests.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { translationMock, savePublicationMock, createGoalMock, fetchBoardMock, fetchHistoryMock, goalActionMock, languageMock, priorityActionMock, saveContractMock, statusActionMock } = vi.hoisted(() => ({
    translationMock: vi.fn(),
    savePublicationMock: vi.fn(),
    createGoalMock: vi.fn(),
    fetchBoardMock: vi.fn(),
    fetchHistoryMock: vi.fn(),
    goalActionMock: vi.fn(),
    languageMock: vi.fn(),
    priorityActionMock: vi.fn(),
    saveContractMock: vi.fn(),
    statusActionMock: vi.fn(),
}));

vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: translationMock }));

vi.mock('../../icons/icon_loader.js', () => ({ setElementSvgContent: vi.fn() }));

vi.mock('../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: languageMock,
}));
vi.mock('./workline_observatory_api_adapter.js', () => ({
    applyWorklineStatusAction: statusActionMock,
    applyWorklinePriorityAction: priorityActionMock,
    applyWorklineReleaseGoalAction: goalActionMock,
    createWorklineReleaseGoal: createGoalMock,
    saveWorklinePublication: savePublicationMock,
    fetchWorklineObservatoryBoard: fetchBoardMock,
    fetchWorklineObservatoryReportHistory: fetchHistoryMock,
    saveWorklineReleaseContract: saveContractMock,
}));
import { hideModal } from '../../reusable_components/modal/modal_builder.js';
import { buildWorklineObservatoryState } from './workline_observatory_state_builder.js';
import { generate_workline_observatory_view, renderWorklineObservatory } from './workline_observatory_view_printer.js';

beforeEach(() => {
    document.body.innerHTML = '<main id="view"></main>';
    window.localStorage.clear();
    vi.clearAllMocks();
    languageMock.mockReturnValue('en');
    translationMock.mockImplementation((key, options) => options?.fallback ?? (key === 'request_failed_notice' ? 'The request could not be completed.' : undefined));
    fetchHistoryMock.mockResolvedValue([]);
    window.confirm = vi.fn(() => true);
});

afterEach(() => hideModal({ immediate: true }));

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

        expect(container.querySelector('.workline-observatory__detail')).toBeNull();
        expect(container.querySelector('[data-workline-title]').textContent).toBe('#869 Visual workline observatory');
        container.querySelector('[data-workline-title]').click();
        expect(document.querySelector('#custom_modal').textContent).toContain('release-8.42 v1');
        expect(document.querySelector('#custom_modal').textContent).toContain('#869 Visual workline observatory · Latest reported phase 3');
        expect(document.querySelector('#custom_modal').textContent).toContain('Release alignment needs a visual truth.');
        expect(container.querySelectorAll('.workline-observatory__phase-node')).toHaveLength(6);
        expect([...container.querySelectorAll('.workline-observatory__phase-node')].map((node) => node.textContent)).toEqual(['1', '2', '3', '4', '5', '6']);
        expect(container.querySelector('.workline-observatory__now').textContent).toBe('NOW (1)');
        expect(container.querySelector('.workline-observatory__phase-node[data-current="true"]').textContent).toBe('3');
        expect(container.querySelector('.workline-observatory__target-row').textContent).toBe('Must be in phase · Phase 5');
        expect(container.querySelector('.workline-observatory__track').style.getPropertyValue('--history-links')).toBe('2');
        expect(container.querySelector('.workline-observatory__track').style.getPropertyValue('--future-links')).toBe('3');
        expect(document.querySelector('#custom_modal .workline-observatory__chat')).toBeNull();
    });

    test('selected workline precedes goal administration in mobile and keyboard DOM order', () => {
        const container = document.createElement('div'); document.body.append(container);
        renderWorklineObservatory(container, { worklines: [{ id: 28, title: 'Selected first', current_phase: 2 }] });
        container.querySelector('[data-workline-title="28"]').click();
        const detail = document.querySelector('#custom_modal .workline-observatory__detail');
        expect(detail.classList.contains('workline-observatory__detail--with-workline')).toBe(true);
        const sections = [...detail.children].filter((node) => node.tagName === 'SECTION');
        expect(sections[0].classList.contains('workline-observatory__selected-workline')).toBe(true);
        expect(sections[1].classList.contains('workline-observatory__goal')).toBe(true);
        expect(sections[1].querySelector('.workline-observatory__goal-creator')).toBeTruthy();
    });

    test('renders a goal creator when no release goal is selected', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({ worklines: [] }));

        container.querySelector('[data-release-goal-details]').click();
        expect(document.querySelector('#custom_modal').textContent).toContain('No publications yet');
        expect(document.querySelector('#custom_modal .workline-observatory__goal-creator')).not.toBeNull();
        expect(container.querySelector('.workline-observatory__targets-heading').textContent).toBe('Publications');
    });

    test('renders representative Finnish and Chinese interface copy', async () => {
        fetchBoardMock.mockResolvedValue({ worklines: [] });
        const container = document.getElementById('view');

        languageMock.mockReturnValue('fi');
        await generate_workline_observatory_view(container);
        expect(container.querySelector('.workline-observatory__priority-heading').textContent).toBe('Prioriteetti');

        languageMock.mockReturnValue('ch');
        await generate_workline_observatory_view(container);
        expect(container.querySelector('.workline-observatory__priority-heading').textContent).toBe('优先级');
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

        container.querySelector('[data-workline-title]').click();
        await vi.waitFor(() => expect(document.querySelector('#custom_modal .workline-observatory__report-history select')).not.toBeNull());
        expect(fetchHistoryMock).toHaveBeenCalledWith(34);
        expect(document.querySelector('#custom_modal').textContent).toContain('Current context.');
        const select = document.querySelector('#custom_modal .workline-observatory__report-history select');
        expect(select.options).toHaveLength(2);
        expect(select.options[1].textContent).toContain('Phase 2-3');

        select.value = '20';
        select.dispatchEvent(new Event('change'));

        expect(document.querySelector('#custom_modal').textContent).toContain('Earlier context.');
        expect(document.querySelector('#custom_modal').textContent).not.toContain('Current context.');
    });

    test('keeps status actions around NOW and selects only through the separate selection area', () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState({
            worklines: [{ id: 1, title: 'Whole row', status: 'active', current_phase: 4 }],
        }));

        expect(container.querySelector('.workline-observatory__visible-count').textContent).toBe('1 visible');
        expect(container.querySelector('.workline-observatory__action-guidance').textContent).toBe('');
        expect([...container.querySelectorAll('.workline-observatory__status-action-group--before-now button')]
            .map((button) => button.textContent)).toEqual(['Activate', 'Pause']);
        expect([...container.querySelectorAll('.workline-observatory__status-action-group--after-now button')]
            .map((button) => button.textContent)).toEqual(['Mark done', 'Discard']);

        container.querySelector('.workline-observatory__selection-area').click();
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

    test('measures the sticky stack after toolbar resizing and releases its observer', () => {
        let resized;
        const disconnect = vi.fn();
        const observe = vi.fn();
        vi.stubGlobal('ResizeObserver', class {
            constructor(callback) { resized = callback; }
            observe = observe;
            disconnect = disconnect;
        });
        const container = document.getElementById('view');
        const controller = renderWorklineObservatory(container, { worklines: [] });
        try {
            const toolbar = container.querySelector('.workline-observatory__status-toolbar');
            const shell = container.querySelector('.workline-observatory');
            expect(observe).toHaveBeenCalledWith(toolbar);
            toolbar.getBoundingClientRect = () => ({ height: 124 });
            resized();
            expect(shell.style.getPropertyValue('--workline-toolbar-height')).toBe('124px');
            toolbar.getBoundingClientRect = () => ({ height: 64 });
            resized();
            expect(shell.style.getPropertyValue('--workline-toolbar-height')).toBe('64px');
        } finally { controller.destroy(); vi.unstubAllGlobals(); }
        expect(disconnect).toHaveBeenCalledOnce();
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
        container.querySelector('.workline-observatory__selection-area').click();

        const activate = container.querySelector('[data-status-action="active"]');
        expect(activate.disabled).toBe(false);
        expect(activate.getAttribute('aria-disabled')).toBe('true');
        expect(activate.title).toBe('“Already active” is already Active.');
        activate.click();

        expect(statusActionMock).not.toHaveBeenCalled();
        expect(container.querySelector('.workline-observatory__action-guidance').textContent)
            .toBe('“Already active” is already Active.');
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

    test.each(['mouseenter', 'focus'])('keeps a bottom-edge row menu inside the viewport after longer help text on %s', async (eventName) => {
        languageMock.mockReturnValue('fi');
        const originalBounds = HTMLElement.prototype.getBoundingClientRect;
        // jsdom has no layout: model wrapped help growing after the guidance changes.
        const boundsMock = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
            if (!this.classList.contains('workline-observatory__context-menu')) return originalBounds.call(this);
            const guidance = this.querySelector('.workline-observatory__context-guidance').textContent;
            const height = guidance.length > 60 ? 240 : 140;
            return new DOMRect(Number.parseFloat(this.style.left) || 0, Number.parseFloat(this.style.top) || 0, 280, height);
        });
        const container = document.getElementById('view');
        const view = renderWorklineObservatory(container, {
            worklines: [{ id: 28, title: 'Työlinja', status: 'active', current_phase: 2 }],
        }, {
            alreadyTargetOne: 'Jo aktiivinen.',
            moveOne: 'Siirrä työlinja “{title}” tilaan {state}, jotta työn seuraava vaihe voidaan aloittaa.',
        });
        try {
            container.querySelector('[data-workline-id="28"]').dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, clientX: 300, clientY: window.innerHeight - 12,
            }));
            await Promise.resolve();
            const menu = document.querySelector('.workline-observatory__context-menu');
            const guidance = menu.querySelector('.workline-observatory__context-guidance');
            expect(guidance.textContent).toBe('Jo aktiivinen.');
            const initialBounds = menu.getBoundingClientRect();
            expect(initialBounds.bottom).toBeLessThanOrEqual(window.innerHeight - 8);

            const pause = menu.querySelector('[data-status-action="paused"]');
            if (eventName === 'focus') pause.focus();
            else pause.dispatchEvent(new MouseEvent('mouseenter'));

            expect(guidance.textContent).toBe(pause.title);
            const updatedBounds = menu.getBoundingClientRect();
            expect(updatedBounds.height).toBeGreaterThan(initialBounds.height);
            expect(updatedBounds.bottom).toBeLessThanOrEqual(window.innerHeight - 8);
            expect(updatedBounds.top).toBeLessThan(initialBounds.top);
        } finally {
            view.destroy();
            boundsMock.mockRestore();
        }
    });

    test('restores selected worklines after a fresh render', () => {
        const snapshot = { worklines: [
            { id: 1, title: 'One', status: 'active', current_phase: 4 },
            { id: 2, title: 'Two', status: 'paused', current_phase: 2 },
        ] };
        const container = document.getElementById('view');
        renderWorklineObservatory(container, buildWorklineObservatoryState(snapshot));
        container.querySelectorAll('.workline-observatory__selection-area')[1].click();

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
        container.querySelector('[data-workline-title]').click();
        expect(document.querySelector('#custom_modal').textContent).toContain('Owner closed · Latest reported phase 5');
    });
    test('opens title details without changing selection and restores focus when closed', async () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, { worklines: [{ id: 1, title: 'Details', status: 'active', current_phase: 2 }] });
        container.querySelector('[data-workline-title]').click();
        expect(container.querySelector('.workline-observatory__workline-checkbox').checked).toBe(false);
        expect(document.querySelector('#custom_modal').getAttribute('role')).toBe('dialog');
        expect(container.querySelector('.workline-observatory__detail')).toBeNull();
        document.querySelector('[data-testid="modal-close-button"]').click();
        await Promise.resolve();
        expect(document.querySelector('#custom_modal_overlay').getAttribute('aria-hidden')).toBe('true');
        expect(document.activeElement).toBe(container.querySelector('[data-workline-title]'));
    });

    test.each([
        ['en', '“Own row” is already Active.'],
        ['fi', '“Own row” on jo tilassa Aktiivinen.'],
        ['ch', '“Own row”已处于“活动”。'],
        ['yue', '「Own row」已經係「進行中」。'],
    ])('row menu guidance names its unselected row in %s', async (language, expected) => {
        languageMock.mockReturnValue(language);
        const container = document.getElementById('view');
        const view = renderWorklineObservatory(container, {
            worklines: [{ id: 28, title: 'Own row', status: 'active', current_phase: 2 }],
        });
        try {
            container.querySelector('[data-row-actions="28"]').click();
            await Promise.resolve();
            const menu = document.querySelector('.workline-observatory__context-menu');
            const activate = menu.querySelector('[data-status-action="active"]');
            expect(document.activeElement).toBe(activate);
            expect(menu.querySelector('.workline-observatory__context-guidance').textContent).toBe(expected);
            expect(activate.title).toBe(expected);
            expect(activate.getAttribute('aria-label')).toBe(expected);
            expect(activate.getAttribute('aria-disabled')).toBe('true');
            expect(container.querySelector('.workline-observatory__workline-checkbox').checked).toBe(false);
            expect(statusActionMock).not.toHaveBeenCalled();
            expect(window.confirm).not.toHaveBeenCalled();
        } finally {
            view.destroy();
        }
    });

    test('row dropdown changes only that row while retaining the reviewed bulk selection', async () => {
        const rows = [
            { id: 1, title: 'One', status: 'active', status_revision: 2 },
            { id: 2, title: 'Two', status: 'active', status_revision: 7 },
        ];
        const container = document.getElementById('view');
        const onRefresh = vi.fn().mockResolvedValue({ worklines: rows });
        renderWorklineObservatory(container, { worklines: rows }, undefined, { onRefresh });
        container.querySelectorAll('.workline-observatory__workline-checkbox')[1].click();
        container.querySelector('[data-row-actions="1"]').click();
        document.querySelector('.workline-observatory__context-menu [data-status-action="paused"]').click();
        await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
        expect(statusActionMock).toHaveBeenCalledWith([{ id: 1, expected_revision: 2 }], 'paused');
        expect(window.confirm).toHaveBeenCalledWith('Change “One” to Paused?');
        expect(container.querySelectorAll('.workline-observatory__workline-checkbox')[1].checked).toBe(true);
        expect(fetchBoardMock).not.toHaveBeenCalled();
    });

    test('priority editor uses its independent revision and refreshes through the current-query host', async () => {
        const row = { id: 9, title: 'Priority', status: 'active', status_revision: 12, priority: 'normal', priority_revision: 4 };
        const container = document.getElementById('view');
        const onRefresh = vi.fn().mockResolvedValue({ worklines: [{ ...row, priority: 'high', priority_revision: 5 }] });
        renderWorklineObservatory(container, { worklines: [row] }, undefined, { onRefresh });
        const priority = container.querySelector('[data-priority-workline-id="9"]');
        priority.value = 'high';
        priority.dispatchEvent(new Event('change'));
        await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
        expect(priorityActionMock).toHaveBeenCalledWith([{ id: 9, expected_revision: 4 }], 'high');
        expect(statusActionMock).not.toHaveBeenCalled();
        expect(container.querySelector('[data-priority-workline-id="9"]').value).toBe('high');
    });

    test('drops hidden selections and uses fresh revisions after a shared query update', async () => {
        const container = document.getElementById('view');
        const visible = { id: 2, title: 'Two', status: 'active', status_revision: 8 };
        const onRefresh = vi.fn().mockResolvedValue({ worklines: [visible] });
        const controller = renderWorklineObservatory(container, { worklines: [
            { id: 1, title: 'One', status: 'active', status_revision: 1 }, { ...visible, status_revision: 3 },
        ] }, undefined, { onRefresh });
        container.querySelector('[data-selection-action="select-all"]').click();
        controller.updateSnapshot({ total_count: 2, filtered_count: 1, worklines: [visible] });
        expect(container.querySelector('.workline-observatory__selection-count').textContent).toBe('1 selected');
        expect(container.querySelector('.workline-observatory__visible-count').textContent).toBe('1 visible');
        container.querySelector('[data-status-action="closed"]').click();
        await vi.waitFor(() => expect(statusActionMock).toHaveBeenCalledOnce());
        expect(statusActionMock).toHaveBeenCalledWith([{ id: 2, expected_revision: 8 }], 'closed');
        controller.destroy();
        controller.updateSnapshot({ worklines: [] });
        expect(container.querySelectorAll('.workline-observatory__workline-row')).toHaveLength(0);
    });

    test('relocalizes existing list and modal when the shared host reapplies its snapshot', () => {
        const container = document.getElementById('view');
        const snapshot = { worklines: [{ id: 1, title: 'Localize', current_phase: 0 }] };
        const controller = renderWorklineObservatory(container, snapshot);
        container.querySelector('[data-workline-title]').click();
        languageMock.mockReturnValue('fi');
        controller.updateSnapshot(snapshot);
        expect(container.querySelector('.workline-observatory__priority-heading').textContent).toBe('Prioriteetti');
        expect(document.querySelector('#custom_modal').textContent).toContain('Viimeisin raportoitu vaihe 0');
        languageMock.mockReturnValue('yue');
        controller.updateSnapshot(snapshot);
        expect(container.querySelector('.workline-observatory__priority-heading').textContent).toBe('優先次序');
    });

    test('ignores an earlier modal history response after opening another workline', async () => {
        let resolveFirst;
        fetchHistoryMock.mockImplementation((id) => id === 1
            ? new Promise((resolve) => { resolveFirst = resolve; })
            : Promise.resolve([{ id: 22, context: 'Second report' }]));
        const container = document.getElementById('view');
        renderWorklineObservatory(container, { worklines: [{ id: 1, title: 'One' }, { id: 2, title: 'Two' }] });
        container.querySelector('[data-workline-title="1"]').click();
        container.querySelector('[data-workline-title="2"]').click();
        await vi.waitFor(() => expect(document.querySelector('#custom_modal').textContent).toContain('Second report'));
        resolveFirst([{ id: 11, context: 'Stale first report' }]);
        await Promise.resolve();
        expect(document.querySelector('#custom_modal').textContent).not.toContain('Stale first report');
        expect(document.querySelector('#custom_modal').textContent).toContain('Second report');
    });

    test('creates and locks release goals through the host refresh while keeping goal details reachable', async () => {
        const container = document.getElementById('view');
        const goal = { id: 7, identity_key: 'release-demo', version: 1, title: 'Demo', outcome: 'Visible goal', decision_state: 'draft' };
        const onRefresh = vi.fn().mockResolvedValue({ worklines: [], release_goal: goal });
        renderWorklineObservatory(container, { worklines: [] }, undefined, { onRefresh });
        container.querySelector('[data-release-goal-details]').click();
        const form = document.querySelector('#custom_modal .workline-observatory__goal-creator');
        const values = { identity_key: 'release-demo', version: '1', title: 'Demo', outcome: 'Visible goal', publication_version: '9.4.0' };
        Object.entries(values).forEach(([name, value]) => { form.querySelector(`[name="${name}"]`).value = value; });
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
        expect(createGoalMock).toHaveBeenCalledWith({ identity_key: 'release-demo', version: 1, title: 'Demo', outcome: 'Visible goal', publication_version: '9.4.0', target_date: null, reader_description: '', published: false, published_at: null, selected: true });
        await vi.waitFor(() => expect(document.querySelector('#custom_modal').textContent).toContain('Lock publication contract'));
        [...document.querySelectorAll('#custom_modal button')].find((button) => button.textContent === 'Lock publication contract').click();
        await vi.waitFor(() => expect(goalActionMock).toHaveBeenCalledWith(7, 'lock'));
        expect(fetchBoardMock).not.toHaveBeenCalled();
    });

    test('keeps release contract editing attached to the modal workline', async () => {
        const container = document.getElementById('view');
        const row = { id: 9, title: 'Discarded design', status: 'archived', current_phase: 2, latest_report: { context: 'Immutable report' } };
        const snapshot = { worklines: [row], release_goal: { id: 7, title: 'Demo', decision_state: 'draft' } };
        const onRefresh = vi.fn().mockResolvedValue(snapshot);
        renderWorklineObservatory(container, snapshot, undefined, { onRefresh });
        container.querySelector('[data-workline-title]').click();
        const contract = document.querySelector('#custom_modal .workline-observatory__contract');
        contract.querySelector('select').value = 'must_be_in_phase';
        contract.querySelector('input').value = '3';
        contract.querySelector('button').click();
        await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
        expect(saveContractMock).toHaveBeenCalledWith({ release_goal_id: 7, workline_id: 9, completion_rule: 'must_be_in_phase', target_phase: 3 });
        expect(document.querySelector('#custom_modal .workline-observatory__report').querySelector('input,textarea')).toBeNull();
    });
    test('preserves a release-goal draft and shows a translated failure inside its modal', async () => {
        const container = document.getElementById('view');
        renderWorklineObservatory(container, { worklines: [] });
        container.querySelector('[data-release-goal-details]').click();
        const form = document.querySelector('#custom_modal .workline-observatory__goal-creator');
        form.querySelectorAll('input')[2].value = 'Keep this draft';
        createGoalMock.mockRejectedValueOnce(new Error('Goal could not be saved'));
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(document.querySelector('#custom_modal .workline-observatory__modal-guidance').textContent).toBe('The request could not be completed.'));
        expect(document.querySelector('#custom_modal .workline-observatory__goal-creator input:nth-of-type(1)')).not.toBeNull();
        expect(form.querySelectorAll('input')[2].value).toBe('Keep this draft');
        expect(form.isConnected).toBe(true);
        expect(form.querySelector('button').disabled).toBe(false);
    });
    test('opens Publications and highlights the newest unpublished plan with Finnish reader details', () => {
        languageMock.mockReturnValue('fi');
        const container = document.getElementById('view');
        const plan = { id: 7, title: 'Yhdistetty sivusto', decision_state: 'locked', publication_version: '9.4.0', target_date: '2026-12-01', reader_description: 'Desktop ja mobiili yhdessä.', published: false, publication_revision: 2, is_current_publication: true };
        renderWorklineObservatory(container, { worklines: [], release_goal: plan, publications: [plan] });
        container.querySelector('[data-release-goal-details]').click();
        expect(document.querySelector('#custom_modal').textContent).toContain('Julkaisut');
        expect(document.querySelector('[data-publication-current="true"]').textContent).toContain('Uusin julkaisematon');
        expect(document.querySelector('[name="target_date"]').value).toBe('2026-12-01');
        expect(document.querySelector('[name="reader_description"]').value).toBe('Desktop ja mobiili yhdessä.');
    });

    test('saves publication metadata after contract locking with its own revision and UTC time', async () => {
        const container = document.getElementById('view');
        const goal = { id: 7, title: 'Locked scope', decision_state: 'locked', publication_version: '9.4.0', publication_revision: 3, published: false };
        const snapshot = { worklines: [], release_goal: goal, publications: [goal] };
        const onRefresh = vi.fn().mockResolvedValue(snapshot);
        renderWorklineObservatory(container, snapshot, undefined, { onRefresh });
        container.querySelector('[data-release-goal-details]').click();
        const form = document.querySelector('.workline-observatory__publication-editor');
        form.querySelector('[name="target_date"]').value = '2027-01-14';
        form.querySelector('[name="reader_description"]').value = 'One public desktop and mobile site.';
        const flag = form.querySelector('[name="published"]');
        const time = form.querySelector('[name="published_at"]');
        expect(time.disabled).toBe(true);
        flag.checked = true; flag.dispatchEvent(new Event('change'));
        expect(time.disabled).toBe(false);
        time.value = '2027-01-14T13:30';
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(savePublicationMock).toHaveBeenCalledWith(7, 3, {
            publication_version: '9.4.0', target_date: '2027-01-14', reader_description: 'One public desktop and mobile site.',
            published: true, published_at: new Date('2027-01-14T13:30').toISOString(),
        }));
        await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
        expect(goalActionMock).not.toHaveBeenCalled();
    });

    test('browses older publications and clears the time when correcting published state', async () => {
        const current = { id: 8, title: 'Next plan', publication_revision: 0, published: false, is_current_publication: true };
        const old = { id: 7, title: 'Earlier release', publication_version: '9.3.0', publication_revision: 4, published: true, published_at: '2026-09-01T10:00:00Z' };
        const snapshot = { worklines: [], release_goal: current, publications: [current, old] };
        const onRefresh = vi.fn().mockResolvedValue(snapshot);
        const container = document.getElementById('view');
        renderWorklineObservatory(container, snapshot, undefined, { onRefresh });
        container.querySelector('[data-release-goal-details]').click();
        const picker = document.querySelector('[name="publication_id"]');
        expect(picker.value).toBe('8');
        picker.value = '7'; picker.dispatchEvent(new Event('change'));
        expect(document.querySelector('[data-publication-current]')).toBeNull();
        const form = document.querySelector('.workline-observatory__publication-editor');
        expect(form.querySelector('[name="published_at"]').value).not.toBe('');
        const flag = form.querySelector('[name="published"]');
        flag.checked = false; flag.dispatchEvent(new Event('change'));
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(savePublicationMock).toHaveBeenCalledWith(7, 4, {
            publication_version: '9.3.0', target_date: null, reader_description: '', published: false, published_at: null,
        }));
    });

    test('refreshes a stale publication edit and displays publication-specific conflict guidance', async () => {
        const goal = { id: 7, title: 'Plan', publication_version: '9.4.0', publication_revision: 1, published: false };
        const snapshot = { worklines: [], release_goal: goal, publications: [goal] };
        const onRefresh = vi.fn().mockResolvedValue({ ...snapshot, publications: [{ ...goal, publication_revision: 2 }] });
        savePublicationMock.mockRejectedValueOnce(Object.assign(new Error('publication_revision_conflict'), { status: 409 }));
        const container = document.getElementById('view');
        renderWorklineObservatory(container, snapshot, undefined, { onRefresh });
        container.querySelector('[data-release-goal-details]').click();
        document.querySelector('.workline-observatory__publication-editor').dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
        expect(document.querySelector('.workline-observatory__modal-guidance').textContent).toBe('This publication changed. Review the refreshed state and try again.');
    });

    test('preserves the exact published instant when its browser time control is unchanged', async () => {
        const goal = { id: 7, title: 'Published', publication_version: '9.4.0', publication_revision: 1, published: true, published_at: '2026-10-10T12:34:56.123456Z' };
        const snapshot = { worklines: [], release_goal: goal, publications: [goal] };
        const container = document.getElementById('view');
        renderWorklineObservatory(container, snapshot, undefined, { onRefresh: vi.fn().mockResolvedValue(snapshot) });
        container.querySelector('[data-release-goal-details]').click();
        document.querySelector('.workline-observatory__publication-editor').dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(savePublicationMock).toHaveBeenCalledWith(7, 1, expect.objectContaining({ published_at: goal.published_at })));
    });

    test.each([
        ['fi', 'Tarkista julkaisun versio ja kuvauksen pituus.', 'Pyyntöä ei voitu suorittaa.'],
        ['en', 'Check the publication version and description length.', 'The request could not be completed.'],
        ['ch', '请检查发布版本和说明长度。', '无法完成请求。'],
        ['yue', '請檢查發佈版本同說明長度。', '完成唔到呢個請求。'],
    ])('shows translated 400 publication failures and fallback in %s', async (language, reason, fallback) => {
        languageMock.mockReturnValue(language);
        translationMock.mockImplementation((key, options) => {
            if (key === 'invalid_publication_details') return reason;
            if (key === 'request_failed_notice') return fallback;
            return options?.fallback;
        });
        const goal = { id: 7, title: 'Plan', publication_version: '9.4.0', publication_revision: 1, published: false };
        const snapshot = { worklines: [], release_goal: goal, publications: [goal] };
        const onRefresh = vi.fn().mockResolvedValue(snapshot);
        const technical = 'Virhe pyynnössä (saveWorklinePublication): raw response and route';
        const error = Object.assign(new Error(technical), {
            status: 400, failureNotice: { langKey: 'invalid_publication_details', status: 400 },
        });
        savePublicationMock.mockRejectedValue(error);
        const container = document.getElementById('view');
        renderWorklineObservatory(container, snapshot, undefined, { onRefresh });
        container.querySelector('[data-release-goal-details]').click();
        const form = document.querySelector('.workline-observatory__publication-editor');
        form.dispatchEvent(new Event('submit', { cancelable: true }));
        const guidance = document.querySelector('.workline-observatory__modal-guidance');
        await vi.waitFor(() => expect(guidance.textContent).toBe(reason));
        expect(translationMock).toHaveBeenCalledWith('invalid_publication_details', expect.objectContaining({ fallback }));
        expect(document.querySelector('#custom_modal').textContent).not.toContain(technical);
        expect(onRefresh).not.toHaveBeenCalled();
        // A failure without a notice (or with an unknown key) still uses translated fallback.
        for (const notice of [undefined, { langKey: 'unknown_publication_reason' }]) {
            savePublicationMock.mockRejectedValue(Object.assign(new Error(technical), { status: 400, failureNotice: notice }));
            form.dispatchEvent(new Event('submit', { cancelable: true }));
            await vi.waitFor(() => expect(guidance.textContent).toBe(fallback));
            expect(guidance.textContent).not.toContain(technical);
        }
    });

});
