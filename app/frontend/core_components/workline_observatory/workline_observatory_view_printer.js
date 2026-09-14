// workline_observatory_view_printer.js
// Renders phase rows, independent selection, row actions and shared modal entry points.
// Bridges the normalized observatory snapshot with the private management-view shell.
// Exists so the owner can compare current progress and the locked release boundary at a glance.

import { fetchWorklineObservatoryBoard } from './workline_observatory_api_adapter.js';
import { showViewportContextMenu } from '../../reusable_components/context_menu/viewport_context_menu_positioner.js';
import { persistWorklineSelection, readPersistedWorklineSelection } from './workline_observatory_selection_storage.js';
import { buildWorklineObservatoryState, getSelectedObservatoryWorklines, replaceObservatoryWorklineSelection, toggleObservatoryWorklineSelection } from './workline_observatory_state_builder.js';
import { resolveCopy } from './workline_observatory_copy.js';
import { buildStatusActionGuidance, buildWorklinePriorityEditor, createWorklineObservatoryActions, formatCopy, getStatusActions } from './workline_observatory_actions.js';
import { createWorklineObservatoryDetailModal, describeReleaseContract } from './workline_observatory_detail_modal.js';

const toolbarCleanupByContainer = new WeakMap();
const controllerCleanupByContainer = new WeakMap();

export async function generate_workline_observatory_view(container) {
    if (!container) return;
    const copy = resolveCopy();
    container.classList.add('workline-observatory-view');
    container.textContent = copy.loading;
    try {
        const snapshot = await fetchWorklineObservatoryBoard();
        return renderWorklineObservatory(container, buildWorklineObservatoryState(snapshot), copy);
    } catch (error) {
        container.textContent = `${copy.unavailable} ${error?.message || ''}`.trim();
    }
}

// The shared query host can replace the raw board without remounting its list/controller.
export function renderWorklineObservatory(container, initialState, copy = resolveCopy(), options = {}) {
    controllerCleanupByContainer.get(container)?.();
    const followsLanguage = arguments[2] === undefined;
    copy = { ...resolveCopy(), ...copy };
    initialState = replaceObservatoryWorklineSelection(buildWorklineObservatoryState(initialState),
        initialState?.selectedWorklineIds || [], initialState?.selectedWorklineId);
    container.classList.add('workline-observatory-view');
    let destroyed = false;
    const restoredSelection = readPersistedWorklineSelection();
    let state = restoredSelection
        ? replaceObservatoryWorklineSelection(
            initialState,
            restoredSelection.selectedWorklineIds,
            restoredSelection.selectedWorklineId,
        )
        : initialState;
    let actionMessage = '';
    let contextMenu = null;
    let activeContextMenuElement = null;
    let removeContextMenuListeners = () => {};
    let toolbarCompact = false;
    const redraw = () => {
        if (destroyed) return;
        removeContextMenuListeners();
        removeContextMenuListeners = () => {};
        activeContextMenuElement?.remove();
        activeContextMenuElement = null;
        const currentToolbar = container.querySelector('.workline-observatory__status-toolbar');
        if (currentToolbar) toolbarCompact = currentToolbar.dataset.compact === 'true';
        toolbarCleanupByContainer.get(container)?.();
        const view = buildView();
        const nextToolbar = view.querySelector('.workline-observatory__status-toolbar');
        if (nextToolbar) nextToolbar.dataset.compact = String(toolbarCompact);
        container.replaceChildren(view);
        const nextContextMenu = view.querySelector('.workline-observatory__context-menu');
        if (nextContextMenu && contextMenu) {
            showViewportContextMenu(nextContextMenu, contextMenu);
            activeContextMenuElement = nextContextMenu;
            const dismissContextMenu = (event) => {
                if (nextContextMenu.contains(event.target)) return;
                container.querySelector(`[data-row-actions="${contextMenu?.worklineId}"]`)?.setAttribute('aria-expanded', 'false');
                contextMenu = null;
                nextContextMenu.remove();
                activeContextMenuElement = null;
            };
            document.addEventListener('pointerdown', dismissContextMenu);
            window.addEventListener('resize', dismissContextMenu);
            window.addEventListener('scroll', dismissContextMenu, true);
            removeContextMenuListeners = () => {
                document.removeEventListener('pointerdown', dismissContextMenu);
                window.removeEventListener('resize', dismissContextMenu);
                window.removeEventListener('scroll', dismissContextMenu, true);
            };
        }
        toolbarCleanupByContainer.set(container, installCompactToolbarObserver(view, (compact) => {
            toolbarCompact = compact;
        }));
        detailModal.update();
    };

    const isSelected = (worklineId) => (state.selectedWorklineIds || []).includes(worklineId);

    const toggleWorkline = (worklineId) => {
        if (actionController.busy) return;
        contextMenu = null;
        state = toggleObservatoryWorklineSelection(state, worklineId);
        persistWorklineSelection(state);
        redraw();
    };

    const openContextMenu = (event, worklineId) => {
        event.preventDefault();
        contextMenu = {
            worklineId,
            clientX: event.clientX,
            clientY: event.clientY,
        };
        redraw();
        queueMicrotask(() => document.querySelector('.workline-observatory__context-menu button:not(:disabled)')?.focus());
    };

    const updateSnapshot = (snapshot) => {
        if (destroyed || !snapshot) return;
        if (followsLanguage) Object.assign(copy, resolveCopy());
        state = replaceObservatoryWorklineSelection(buildWorklineObservatoryState(snapshot),
            state.selectedWorklineIds || [], state.selectedWorklineId);
        contextMenu = null;
        persistWorklineSelection(state);
        redraw();
    };
    const refreshState = async () => {
        const snapshot = await (options.onRefresh ? options.onRefresh() : fetchWorklineObservatoryBoard());
        updateSnapshot(snapshot);
    };
    const actionController = createWorklineObservatoryActions({
        getState: () => state, copy, refresh: refreshState, redraw,
        setMessage: (message) => { actionMessage = message; contextMenu = null; },
    });
    const detailModal = createWorklineObservatoryDetailModal({
        getState: () => state, copy, actions: actionController, getMessage: () => actionMessage,
        restoreFocus: (id) => {
            if (destroyed) return;
            const target = id === null ? '[data-release-goal-details]' : `[data-workline-title="${id}"]`;
            container.querySelector(target)?.focus();
        },
    });

    const buildView = () => {
        const shell = document.createElement('section');
        shell.className = 'workline-observatory';
        const stickySentinel = document.createElement('span');
        stickySentinel.className = 'workline-observatory__toolbar-sentinel';
        stickySentinel.setAttribute('aria-hidden', 'true');
        shell.append(stickySentinel, buildStatusActionToolbar(), buildBoard());
        if (contextMenu) shell.append(buildContextMenu());
        shell.addEventListener('click', (event) => {
            if (!contextMenu || event.target.closest('.workline-observatory__context-menu')) return;
            contextMenu = null;
            shell.querySelector('.workline-observatory__context-menu')?.remove();
        });
        return shell;
    };

    const buildStatusActionToolbar = () => {
        const toolbar = document.createElement('section');
        toolbar.className = 'workline-observatory__status-toolbar';
        toolbar.setAttribute('aria-label', copy.status);
        const selected = getSelectedObservatoryWorklines(state);
        const selectionControls = document.createElement('div');
        selectionControls.className = 'workline-observatory__selection-controls';
        const selectionCount = document.createElement('strong');
        selectionCount.className = 'workline-observatory__selection-count';
        selectionCount.textContent = selected.length
            ? formatCopy(copy.selected, { count: selected.length })
            : '';
        selectionCount.setAttribute('aria-live', 'polite');
        const allSelected = state.worklines.length > 0
            && selected.length === state.worklines.length;
        const selectionToggle = document.createElement('input');
        selectionToggle.type = 'checkbox';
        selectionToggle.className = 'workline-observatory__selection-toggle';
        selectionToggle.checked = allSelected;
        selectionToggle.indeterminate = selected.length > 0 && !allSelected;
        selectionToggle.title = allSelected ? copy.deselectAll : copy.selectAllVisible;
        selectionToggle.setAttribute('aria-label', selectionToggle.title);
        selectionToggle.disabled = actionController.busy || state.worklines.length === 0;
        selectionToggle.addEventListener('change', () => {
            state = replaceObservatoryWorklineSelection(
                state,
                selectionToggle.checked
                    ? state.worklines.map((workline) => workline.id)
                    : [],
                state.selectedWorklineId,
            );
            persistWorklineSelection(state);
            contextMenu = null;
            actionMessage = '';
            redraw();
        });
        const selectionLinks = document.createElement('div');
        selectionLinks.className = 'workline-observatory__selection-links';
        const buildSelectionLink = ({ label, action, disabled, worklineIds }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'workline-observatory__selection-link';
            button.dataset.selectionAction = action;
            button.textContent = label;
            button.disabled = actionController.busy || disabled;
            button.addEventListener('click', () => {
                state = replaceObservatoryWorklineSelection(
                    state,
                    worklineIds,
                    state.selectedWorklineId,
                );
                persistWorklineSelection(state);
                contextMenu = null;
                actionMessage = '';
                redraw();
            });
            return button;
        };
        selectionLinks.append(
            buildSelectionLink({
                label: copy.selectAllVisible,
                action: 'select-all',
                disabled: state.worklines.length === 0 || allSelected,
                worklineIds: state.worklines.map((workline) => workline.id),
            }),
            buildSelectionLink({
                label: copy.deselectAll,
                action: 'deselect-all',
                disabled: selected.length === 0,
                worklineIds: [],
            }),
        );
        const visibleCount = document.createElement('span');
        visibleCount.className = 'workline-observatory__visible-count';
        visibleCount.textContent = formatCopy(copy.visible, { count: state.worklines.length });
        const refresh = document.createElement('button');
        refresh.type = 'button'; refresh.className = 'workline-observatory__selection-link';
        refresh.textContent = copy.refresh; refresh.disabled = actionController.busy;
        refresh.addEventListener('click', () => void actionController.mutate(async () => {}));
        selectionLinks.append(refresh);
        selectionControls.append(selectionCount, selectionToggle, selectionLinks, visibleCount);
        const guidance = document.createElement('output');
        guidance.className = 'workline-observatory__action-guidance';
        guidance.textContent = actionMessage;
        guidance.setAttribute('aria-live', 'polite');
        const actions = document.createElement('div');
        actions.className = 'workline-observatory__status-actions';
        const beforeNow = document.createElement('div');
        beforeNow.className = 'workline-observatory__status-action-group workline-observatory__status-action-group--before-now';
        const afterNow = document.createElement('div');
        afterNow.className = 'workline-observatory__status-action-group workline-observatory__status-action-group--after-now';
        getStatusActions(copy).forEach((action, index) => {
            const group = index < 2 ? beforeNow : afterNow;
            group.append(buildStatusActionButton(action, selected));
        });
        actions.append(beforeNow, afterNow);
        toolbar.append(selectionControls, actions, guidance);
        return toolbar;
    };

    const buildStatusActionButton = (action, selected, guidance, context = false, rowIds = null) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = context
            ? 'button workline-observatory__context-action'
            : 'button workline-observatory__status-action';
        button.dataset.statusAction = action.status;
        button.textContent = action.label;
        const actionGuidance = buildStatusActionGuidance(action, selected, copy);
        button.title = actionGuidance;
        button.setAttribute('aria-label', actionGuidance);
        const hasAffectedWorkline = selected.some((workline) => workline.status !== action.status);
        button.disabled = actionController.busy;
        button.setAttribute('aria-disabled', String(selected.length === 0 || !hasAffectedWorkline));
        button.addEventListener('mouseenter', () => {
            if (guidance) guidance.textContent = actionGuidance;
        });
        button.addEventListener('focus', () => {
            if (guidance) guidance.textContent = actionGuidance;
        });
        button.addEventListener('click', () => void actionController.status(action, rowIds));
        return button;
    };

    const buildContextMenu = () => {
        const menu = document.createElement('div');
        menu.className = 'workline-observatory__context-menu';
        menu.setAttribute('role', 'menu');
        const guidance = document.createElement('output');
        guidance.className = 'workline-observatory__context-guidance';
        guidance.textContent = copy.selectRows;
        const selected = state.worklines.filter((workline) => workline.id === contextMenu.worklineId);
        getStatusActions(copy).forEach((action) => {
            const button = buildStatusActionButton(action, selected, guidance, true, selected.map((workline) => workline.id));
            button.setAttribute('role', 'menuitem');
            menu.append(button);
        });
        menu.append(guidance);
        menu.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            const worklineId = contextMenu.worklineId;
            contextMenu = null;
            redraw();
            container.querySelector(`[data-row-actions="${worklineId}"]`)?.focus();
        });
        return menu;
    };

    const buildBoard = () => {
        const board = document.createElement('section');
        board.className = 'workline-observatory__board';
        const heading = document.createElement('header');
        heading.className = 'workline-observatory__board-heading';
        const titleSpacer = document.createElement('span');
        titleSpacer.setAttribute('aria-hidden', 'true');
        const now = document.createElement('strong');
        now.className = 'workline-observatory__now';
        now.textContent = `${copy.now} (${state.openWorklineCount})`;
        const target = document.createElement('button');
        target.type = 'button';
        target.dataset.releaseGoalDetails = '';
        target.className = 'workline-observatory__targets-heading';
        target.addEventListener('click', () => detailModal.open());
        target.textContent = state.releaseGoal
            ? `${copy.releaseTarget}: ${state.releaseGoal.title}`
            : copy.releaseTarget;
        const priority = document.createElement('strong');
        priority.textContent = copy.priority;
        priority.className = 'workline-observatory__priority-heading';
        heading.append(titleSpacer, priority, now, target);
        board.append(heading);
        state.worklines.forEach((workline) => board.append(buildWorklineRow(workline)));
        return board;
    };

    const buildWorklineRow = (workline) => {
        const row = document.createElement('div');
        row.className = 'workline-observatory__workline-row';
        row.dataset.lifecycleStatus = workline.status || '';
        row.dataset.currentPhase = String(workline.current_phase);
        row.dataset.worklineId = String(workline.id);
        row.dataset.selected = String(isSelected(workline.id));
        row.dataset.reconciliationNeeded = String(Boolean(workline.status_reconciliation_needed));
        row.addEventListener('contextmenu', (event) => openContextMenu(event, workline.id));

        const label = document.createElement('div');
        label.className = 'workline-observatory__workline-button';
        label.dataset.worklineId = String(workline.id);
        label.dataset.selected = String(isSelected(workline.id));
        const title = document.createElement('button');
        title.type = 'button';
        title.className = 'workline-observatory__workline-title';
        title.textContent = `#${workline.id} ${workline.title}`;
        title.dataset.worklineTitle = String(workline.id);
        title.addEventListener('click', () => detailModal.open(workline.id));
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'workline-observatory__workline-checkbox';
        checkbox.checked = isSelected(workline.id);
        checkbox.disabled = actionController.busy;
        checkbox.setAttribute('aria-label', formatCopy(copy.selectionLabel, { title: title.textContent }));
        checkbox.addEventListener('change', () => toggleWorkline(workline.id));
        const selectionArea = document.createElement('label');
        selectionArea.className = 'workline-observatory__selection-area';
        selectionArea.title = formatCopy(copy.selectionLabel, { title: title.textContent });
        selectionArea.append(checkbox);
        const rowActions = document.createElement('button');
        rowActions.type = 'button'; rowActions.textContent = '⋮';
        rowActions.className = 'workline-observatory__row-actions';
        rowActions.dataset.rowActions = String(workline.id);
        rowActions.setAttribute('aria-label', formatCopy(copy.rowActions, { title: title.textContent }));
        rowActions.setAttribute('aria-haspopup', 'menu');
        rowActions.setAttribute('aria-expanded', String(contextMenu?.worklineId === workline.id));
        rowActions.disabled = actionController.busy;
        rowActions.addEventListener('click', (event) => {
            event.stopPropagation();
            const rect = rowActions.getBoundingClientRect();
            openContextMenu({ preventDefault() {}, clientX: rect.left, clientY: rect.bottom }, workline.id);
        });
        label.append(title, rowActions, selectionArea);

        const track = document.createElement('div');
        track.className = 'workline-observatory__track';
        track.dataset.worklineId = String(workline.id);
        track.dataset.selected = String(isSelected(workline.id));
        track.style.setProperty('--history-links', String(workline.history_link_count));
        track.style.setProperty('--future-links', String(workline.future_link_count));
        const nowAxis = document.createElement('span');
        nowAxis.className = 'workline-observatory__now-axis';
        nowAxis.setAttribute('aria-hidden', 'true');
        track.append(nowAxis);
        workline.phase_nodes.forEach((node) => {
            const marker = document.createElement('span');
            marker.className = 'workline-observatory__phase-node';
            marker.dataset.filled = String(node.filled);
            marker.dataset.state = node.state;
            marker.dataset.current = String(node.isNow);
            marker.style.gridColumn = String(node.slot);
            marker.textContent = String(node.phase);
            if (node.isNow) marker.setAttribute('aria-current', 'step');
            marker.setAttribute('aria-label', `${copy.phase} ${node.phase}${node.isNow ? `, ${copy.now}` : ''}`);
            track.append(marker);
        });

        const target = document.createElement('div');
        target.className = 'workline-observatory__target-row';
        target.dataset.worklineId = String(workline.id);
        target.dataset.selected = String(isSelected(workline.id));
        target.textContent = describeReleaseContract(workline.release_contract, copy);

        const priority = document.createElement('div');
        priority.className = 'workline-observatory__priority-row';
        priority.append(buildWorklinePriorityEditor(workline, copy, actionController));
        row.append(label, priority, track, target);
        return row;
    };

    const destroy = () => {
        destroyed = true;
        actionController.destroy();
        detailModal.destroy();
        removeContextMenuListeners();
        activeContextMenuElement?.remove();
        toolbarCleanupByContainer.get(container)?.();
        toolbarCleanupByContainer.delete(container);
        controllerCleanupByContainer.delete(container);
        container.replaceChildren();
    };
    controllerCleanupByContainer.set(container, destroy);
    redraw();
    return { updateSnapshot, destroy };
}

function installCompactToolbarObserver(view, onCompactChange = () => {}) {
    const toolbar = view.querySelector('.workline-observatory__status-toolbar');
    const sentinel = view.querySelector('.workline-observatory__toolbar-sentinel');
    if (!toolbar || !sentinel) return () => {};

    const update = () => {
        const scrollportTop = findVerticalScrollportTop(toolbar);
        const sentinelBottom = sentinel.getBoundingClientRect().bottom;
        const compact = sentinelBottom < scrollportTop - 0.5;
        toolbar.dataset.compact = String(compact);
        onCompactChange(compact);
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    queueMicrotask(update);
    return () => {
        window.removeEventListener('scroll', update, true);
        window.removeEventListener('resize', update);
    };
}

function findVerticalScrollportTop(element) {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        const style = window.getComputedStyle(parent);
        const canScroll = /(auto|scroll|overlay)/.test(`${style.overflow} ${style.overflowY}`);
        if (canScroll && parent.scrollHeight > parent.clientHeight) {
            return parent.getBoundingClientRect().top;
        }
    }
    return 0;
}
