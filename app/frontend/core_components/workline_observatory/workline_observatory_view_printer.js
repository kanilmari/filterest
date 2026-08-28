// workline_observatory_view_printer.js
// Renders workline phase rows, per-row release targets, selected detail, and scoped AI controls.
// Bridges the normalized observatory snapshot with the private management-view shell.
// Exists so the owner can compare current progress and the locked release boundary at a glance.

import { getLanguageWithBrowserFallback } from '../state_stores/lang_preference_reader.js';
import {
    applyWorklineStatusAction,
    applyWorklineReleaseGoalAction,
    createWorklineReleaseGoal,
    fetchWorklineObservatoryBoard,
    saveWorklineReleaseContract,
} from './workline_observatory_api_adapter.js';
import { startWorklineConversation } from './workline_observatory_chat_adapter.js';
import { showViewportContextMenu } from '../../reusable_components/context_menu/viewport_context_menu_positioner.js';
import {
    persistWorklineSelection,
    readPersistedWorklineSelection,
} from './workline_observatory_selection_storage.js';
import {
    buildWorklineObservatoryState,
    getSelectedObservatoryWorklines,
    getSelectedObservatoryWorkline,
    replaceObservatoryWorklineSelection,
    selectObservatoryWorkline,
    toggleObservatoryWorklineSelection,
} from './workline_observatory_state_builder.js';
const COPY = {
    en: { title: 'Workline observatory', subtitle: 'Select one or more worklines to change their state.', refresh: 'Refresh', now: 'NOW', noGoal: 'No release goal selected', goal: 'Selected release goal', releaseTarget: 'Release target', noReport: 'No canonical report yet.', context: 'Context', plain: 'Plain language', technical: 'Technical', next: 'Next step', git: 'Scoped Git snapshot', tickets: 'Tickets', contract: 'Release contract', unclassified: 'Unclassified', save: 'Save classification', ask: 'Discuss this workline with AI', send: 'Start scoped conversation', phase: 'Phase', loading: 'Loading…', unavailable: 'Observatory unavailable.', locked: 'Locked', draft: 'Draft', newGoal: 'Start next release goal', goalKey: 'Release identity', goalRevision: 'Goal revision', goalTitle: 'Release name', goalOutcome: 'Target outcome', createGoal: 'Create and select goal', lockGoal: 'Lock release goal', mustComplete: 'Must complete', mustRemainIncomplete: 'Must remain incomplete', mustBeInPhase: 'Must be in phase', mustNotStart: 'Must not start', outsideRelease: 'Outside release' },
    fi: { title: 'Työlinjojen tilannekuva', subtitle: 'Valitse yksi tai useampi työlinja muuttaaksesi niiden tilaa.', refresh: 'Päivitä', now: 'NYT', noGoal: 'Julkaisutavoitetta ei ole valittu', goal: 'Valittu julkaisutavoite', releaseTarget: 'Julkaisutavoite', noReport: 'Kanonista raporttia ei vielä ole.', context: 'Konteksti', plain: 'Selkokielellä', technical: 'Teknisesti', next: 'Seuraava askel', git: 'Rajattu Git-tilanne', tickets: 'Tiketit', contract: 'Julkaisusopimus', unclassified: 'Luokittelematon', save: 'Tallenna luokitus', ask: 'Keskustele tästä työlinjasta AI:n kanssa', send: 'Aloita rajattu keskustelu', phase: 'Vaihe', loading: 'Ladataan…', unavailable: 'Tilannekuvaa ei saatu ladattua.', locked: 'Lukittu', draft: 'Luonnos', newGoal: 'Aloita seuraava julkaisutavoite', goalKey: 'Julkaisun tunniste', goalRevision: 'Tavoitteen versio', goalTitle: 'Julkaisun nimi', goalOutcome: 'Tavoiteltu lopputulos', createGoal: 'Luo ja valitse tavoite', lockGoal: 'Lukitse julkaisutavoite', mustComplete: 'Valmistuttava', mustRemainIncomplete: 'Jätettävä keskeneräiseksi', mustBeInPhase: 'Oltava vaiheessa', mustNotStart: 'Ei aloiteta', outsideRelease: 'Julkaisun ulkopuolella' },
    ch: { title: '工作线总览', subtitle: '选择一条或多条工作线以更改状态。', refresh: '刷新', now: '现在', noGoal: '未选择发布目标', goal: '所选发布目标', releaseTarget: '发布目标', noReport: '尚无规范报告。', context: '背景', plain: '简明说明', technical: '技术说明', next: '下一步', git: '限定 Git 快照', tickets: '工单', contract: '发布契约', unclassified: '未分类', save: '保存分类', ask: '与 AI 讨论此工作线', send: '开始限定对话', phase: '阶段', loading: '正在加载…', unavailable: '无法加载总览。', locked: '已锁定', draft: '草稿', newGoal: '开始下一个发布目标', goalKey: '发布标识', goalRevision: '目标修订', goalTitle: '发布名称', goalOutcome: '目标结果', createGoal: '创建并选择目标', lockGoal: '锁定发布目标', mustComplete: '必须完成', mustRemainIncomplete: '必须保持未完成', mustBeInPhase: '必须处于阶段', mustNotStart: '不得开始', outsideRelease: '发布范围外' },
    yue: { title: '工作線總覽', subtitle: '揀一條或多條工作線去更改狀態。', refresh: '重新整理', now: '而家', noGoal: '未揀發佈目標', goal: '已選發佈目標', releaseTarget: '發佈目標', noReport: '未有正式報告。', context: '背景', plain: '簡單說明', technical: '技術說明', next: '下一步', git: '限定 Git 快照', tickets: '工作單', contract: '發佈契約', unclassified: '未分類', save: '儲存分類', ask: '同 AI 討論呢條工作線', send: '開始限定對話', phase: '階段', loading: '載入中…', unavailable: '未能載入總覽。', locked: '已鎖定', draft: '草稿', newGoal: '開始下一個發佈目標', goalKey: '發佈識別', goalRevision: '目標修訂', goalTitle: '發佈名稱', goalOutcome: '目標結果', createGoal: '建立並揀選目標', lockGoal: '鎖定發佈目標', mustComplete: '必須完成', mustRemainIncomplete: '必須保持未完成', mustBeInPhase: '必須處於階段', mustNotStart: '唔可以開始', outsideRelease: '發佈範圍外' },
};

const ACTION_COPY = {
    en: { selected: '{count} selected', selectAll: 'Select all', deselectAll: 'Deselect all', selectRows: 'Select one or more worklines to change their state.', activate: 'Activate', pause: 'Pause', markDone: 'Mark done', discard: 'Discard', activeState: 'Active', pausedState: 'Paused', closedState: 'Done', archivedState: 'Discarded', chooseTarget: 'Select one or more worklines to move them to {state}.', alreadyTarget: 'All selected worklines are already {state}.', moveOne: 'Move “{title}” to {state}.', moveMany: 'Move all {count} selected worklines to {state}.', moveMixed: 'Move all {count} selected worklines to {state}; {sameCount} already have that state.', confirmOne: 'Change “{title}” to {state}?', confirmMany: 'Change all {count} selected worklines to {state}?', confirmMixed: 'Change all {count} selected worklines to {state}? {sameCount} already have that state.', changed: 'Changed {count} workline(s) to {state}.', status: 'Lifecycle state', lastStatus: 'Latest state decision', reconciliation: 'Waiting for AI synchronization', sourceObservatory: 'Owner in Observatory', sourceAgentTools: 'Agent/API', sourceReport: 'Canonical report synchronization', sourceCreation: 'Workline creation', sourceLegacy: 'Earlier state', unknownActor: 'Unknown user', selectionLabel: 'Select {title}' },
    fi: { selected: '{count} valittu', selectAll: 'Valitse kaikki', deselectAll: 'Poista kaikki valinnat', selectRows: 'Valitse yksi tai useampi työlinja muuttaaksesi niiden tilaa.', activate: 'Aktivoi', pause: 'Tauota', markDone: 'Merkitse valmiiksi', discard: 'Hylkää', activeState: 'Aktiivinen', pausedState: 'Tauolla', closedState: 'Valmis', archivedState: 'Hylätty', chooseTarget: 'Valitse yksi tai useampi työlinja siirtääksesi ne tilaan {state}.', alreadyTarget: 'Kaikki valitut työlinjat ovat jo tilassa {state}.', moveOne: 'Siirrä “{title}” tilaan {state}.', moveMany: 'Siirrä kaikki {count} valittua työlinjaa tilaan {state}.', moveMixed: 'Siirrä kaikki {count} valittua työlinjaa tilaan {state}; {sameCount} on jo siinä tilassa.', confirmOne: 'Muutetaanko “{title}” tilaan {state}?', confirmMany: 'Muutetaanko kaikki {count} valittua työlinjaa tilaan {state}?', confirmMixed: 'Muutetaanko kaikki {count} valittua työlinjaa tilaan {state}? {sameCount} on jo siinä tilassa.', changed: 'Muutettiin {count} työlinjan tilaksi {state}.', status: 'Työlinjan tila', lastStatus: 'Viimeisin tilapäätös', reconciliation: 'Odottaa AI-synkronointia', sourceObservatory: 'Omistaja Observatoryssa', sourceAgentTools: 'Agentti/API', sourceReport: 'Kanonisen raportin synkronointi', sourceCreation: 'Työlinjan luonti', sourceLegacy: 'Aiempi tila', unknownActor: 'Tuntematon käyttäjä', selectionLabel: 'Valitse {title}' },
    ch: { selected: '已选择 {count} 项', selectAll: '全选', deselectAll: '取消全选', selectRows: '选择一条或多条工作线以更改状态。', activate: '激活', pause: '暂停', markDone: '标记完成', discard: '放弃', activeState: '活动', pausedState: '已暂停', closedState: '已完成', archivedState: '已放弃', chooseTarget: '选择一条或多条工作线以移至“{state}”。', alreadyTarget: '所有所选工作线已处于“{state}”。', moveOne: '将“{title}”移至“{state}”。', moveMany: '将 {changeCount} 条工作线移至“{state}”。', moveMixed: '将所选 {count} 条中的 {changeCount} 条移至“{state}”；另有 {sameCount} 条已处于该状态。', confirmOne: '将“{title}”更改为“{state}”吗？', confirmMany: '将 {changeCount} 条工作线更改为“{state}”吗？', confirmMixed: '将所选 {count} 条中的 {changeCount} 条更改为“{state}”吗？', changed: '已将 {count} 条工作线更改为“{state}”。', status: '工作线状态', lastStatus: '最近状态决定', reconciliation: '等待 AI 同步', sourceObservatory: '所有者在总览中操作', sourceAgentTools: '代理/API', sourceReport: '规范报告同步', sourceCreation: '创建工作线', sourceLegacy: '较早状态', unknownActor: '未知用户', selectionLabel: '选择 {title}' },
    yue: { selected: '已揀 {count} 項', selectAll: '全揀', deselectAll: '取消全揀', selectRows: '揀一條或多條工作線去更改狀態。', activate: '啟用', pause: '暫停', markDone: '標記完成', discard: '放棄', activeState: '進行中', pausedState: '已暫停', closedState: '已完成', archivedState: '已放棄', chooseTarget: '揀一條或多條工作線移去「{state}」。', alreadyTarget: '所有已揀工作線已經係「{state}」。', moveOne: '將「{title}」移去「{state}」。', moveMany: '將 {changeCount} 條工作線移去「{state}」。', moveMixed: '將已揀 {count} 條入面嘅 {changeCount} 條移去「{state}」；另外 {sameCount} 條已經係呢個狀態。', confirmOne: '將「{title}」改做「{state}」？', confirmMany: '將 {changeCount} 條工作線改做「{state}」？', confirmMixed: '將已揀 {count} 條入面嘅 {changeCount} 條改做「{state}」？', changed: '已將 {count} 條工作線改做「{state}」。', status: '工作線狀態', lastStatus: '最近狀態決定', reconciliation: '等緊 AI 同步', sourceObservatory: '擁有人喺總覽操作', sourceAgentTools: '代理/API', sourceReport: '正式報告同步', sourceCreation: '建立工作線', sourceLegacy: '較早狀態', unknownActor: '未知用戶', selectionLabel: '揀 {title}' },
};

const DEFAULT_COPY = { ...COPY.en, ...ACTION_COPY.en };
const toolbarCleanupByContainer = new WeakMap();

function resolveCopy() {
    const language = String(getLanguageWithBrowserFallback() || 'en').toLowerCase();
    if (language.startsWith('fi')) return { ...COPY.fi, ...ACTION_COPY.fi };
    if (language === 'yue' || language === 'zh-tw' || language === 'zh-hk') return { ...COPY.yue, ...ACTION_COPY.yue };
    if (language === 'ch' || language.startsWith('zh')) return { ...COPY.ch, ...ACTION_COPY.ch };
    return DEFAULT_COPY;
}

export async function generate_workline_observatory_view(container) {
    if (!container) return;
    const copy = resolveCopy();
    container.classList.add('workline-observatory-view');
    container.textContent = copy.loading;
    try {
        const snapshot = await fetchWorklineObservatoryBoard();
        renderWorklineObservatory(container, buildWorklineObservatoryState(snapshot), copy);
    } catch (error) {
        container.textContent = `${copy.unavailable} ${error?.message || ''}`.trim();
    }
}

export function renderWorklineObservatory(container, initialState, copy = DEFAULT_COPY) {
    toolbarCleanupByContainer.get(container)?.();
    const restoredSelection = readPersistedWorklineSelection();
    let state = restoredSelection
        ? replaceObservatoryWorklineSelection(
            initialState,
            restoredSelection.selectedWorklineIds,
            restoredSelection.selectedWorklineId,
        )
        : initialState;
    let actionBusy = false;
    let actionMessage = '';
    let contextMenu = null;
    let activeContextMenuElement = null;
    let removeContextMenuListeners = () => {};
    let toolbarCompact = false;
    const redraw = () => {
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
    };

    const isSelected = (worklineId) => (state.selectedWorklineIds || []).includes(worklineId);

    const toggleWorkline = (worklineId) => {
        contextMenu = null;
        state = toggleObservatoryWorklineSelection(state, worklineId);
        persistWorklineSelection(state);
        redraw();
    };

    const openContextMenu = (event, worklineId) => {
        event.preventDefault();
        if (!isSelected(worklineId)) {
            state = replaceObservatoryWorklineSelection(state, [worklineId], worklineId);
        } else {
            state = selectObservatoryWorkline(state, worklineId);
        }
        persistWorklineSelection(state);
        contextMenu = {
            clientX: event.clientX,
            clientY: event.clientY,
        };
        redraw();
        queueMicrotask(() => document.querySelector('.workline-observatory__context-menu button:not(:disabled)')?.focus());
    };

    const bindSelectionSurface = (element, workline, { nativeButton = false } = {}) => {
        element.dataset.worklineId = String(workline.id);
        element.dataset.selected = String(isSelected(workline.id));
        element.dataset.reconciliationNeeded = String(Boolean(workline.status_reconciliation_needed));
        element.addEventListener('contextmenu', (event) => openContextMenu(event, workline.id));
        if (!nativeButton) {
            element.tabIndex = 0;
            element.setAttribute('role', 'button');
            element.addEventListener('keydown', (event) => {
                if (event.target !== element || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                toggleWorkline(workline.id);
            });
        }
    };

    const refreshState = async (selectedIDs = state.selectedWorklineIds || [], focusedID = state.selectedWorklineId) => {
        const snapshot = await fetchWorklineObservatoryBoard();
        state = replaceObservatoryWorklineSelection(
            buildWorklineObservatoryState(snapshot),
            selectedIDs,
            focusedID,
        );
        persistWorklineSelection(state);
    };

    const performStatusAction = async (action) => {
        const selected = getSelectedObservatoryWorklines(state);
        const affected = selected.filter((workline) => workline.status !== action.status);
        if (actionBusy) return;
        if (selected.length === 0 || affected.length === 0) {
            actionMessage = buildStatusActionGuidance(action, selected, copy);
            redraw();
            return;
        }
        const confirmation = buildStatusActionConfirmation(action, selected, affected, copy);
        if (!window.confirm(confirmation)) return;

        actionBusy = true;
        actionMessage = '';
        contextMenu = null;
        redraw();
        try {
            const result = await applyWorklineStatusAction(
                selected.map((workline) => ({
                    id: workline.id,
                    expected_revision: workline.status_revision || 0,
                })),
                action.status,
            );
            await refreshState(selected.map((workline) => workline.id), state.selectedWorklineId);
            actionMessage = formatCopy(copy.changed, {
                count: result?.changed_count ?? affected.length,
                state: action.stateLabel,
            });
        } catch (error) {
            actionMessage = error?.message || String(error);
        } finally {
            actionBusy = false;
            redraw();
        }
    };

    const buildView = () => {
        const shell = document.createElement('section');
        shell.className = 'workline-observatory';
        const header = document.createElement('header');
        header.className = 'workline-observatory__header';
        const heading = document.createElement('div');
        const title = document.createElement('h2'); title.textContent = copy.title;
        const subtitle = document.createElement('p'); subtitle.textContent = copy.subtitle;
        heading.append(title, subtitle);
        const refresh = document.createElement('button');
        refresh.type = 'button'; refresh.className = 'button'; refresh.textContent = copy.refresh;
        refresh.addEventListener('click', async () => {
            refresh.disabled = true;
            try {
                await refreshState();
                actionMessage = '';
                contextMenu = null;
            } catch (error) {
                actionMessage = error?.message || String(error);
            } finally {
                redraw();
            }
        });
        header.append(heading, refresh);

        const stickySentinel = document.createElement('span');
        stickySentinel.className = 'workline-observatory__toolbar-sentinel';
        stickySentinel.setAttribute('aria-hidden', 'true');
        shell.append(header, stickySentinel, buildStatusActionToolbar(), buildBoard(), buildDetail());
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
        selectionToggle.title = allSelected ? copy.deselectAll : copy.selectAll;
        selectionToggle.setAttribute('aria-label', selectionToggle.title);
        selectionToggle.disabled = actionBusy || state.worklines.length === 0;
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
            button.disabled = actionBusy || disabled;
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
                label: copy.selectAll,
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
        selectionControls.append(selectionCount, selectionToggle, selectionLinks);
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

    const buildStatusActionButton = (action, selected, guidance, context = false) => {
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
        button.disabled = actionBusy;
        button.setAttribute('aria-disabled', String(selected.length === 0 || !hasAffectedWorkline));
        button.addEventListener('mouseenter', () => {
            if (guidance) guidance.textContent = actionGuidance;
        });
        button.addEventListener('focus', () => {
            if (guidance) guidance.textContent = actionGuidance;
        });
        button.addEventListener('click', () => void performStatusAction(action));
        return button;
    };

    const buildContextMenu = () => {
        const menu = document.createElement('div');
        menu.className = 'workline-observatory__context-menu';
        menu.setAttribute('role', 'menu');
        const guidance = document.createElement('output');
        guidance.className = 'workline-observatory__context-guidance';
        guidance.textContent = copy.selectRows;
        const selected = getSelectedObservatoryWorklines(state);
        getStatusActions(copy).forEach((action) => {
            const button = buildStatusActionButton(action, selected, guidance, true);
            button.setAttribute('role', 'menuitem');
            menu.append(button);
        });
        menu.append(guidance);
        menu.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            contextMenu = null;
            redraw();
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
        const target = document.createElement('strong');
        target.className = 'workline-observatory__targets-heading';
        target.textContent = state.releaseGoal
            ? `${copy.releaseTarget}: ${state.releaseGoal.title}`
            : copy.releaseTarget;
        heading.append(titleSpacer, now, target);
        board.append(heading);
        state.worklines.forEach((workline) => board.append(buildWorklineRow(workline)));
        return board;
    };

    const buildWorklineRow = (workline) => {
        const row = document.createElement('div');
        row.className = 'workline-observatory__workline-row';
        row.dataset.lifecycleStatus = workline.status || '';
        row.dataset.currentPhase = String(workline.current_phase);
        bindSelectionSurface(row, workline, { nativeButton: true });

        const label = document.createElement('div');
        label.className = 'workline-observatory__workline-button';
        label.dataset.worklineId = String(workline.id);
        label.dataset.selected = String(isSelected(workline.id));
        const title = document.createElement('button');
        title.type = 'button';
        title.className = 'workline-observatory__workline-title';
        title.textContent = workline.title;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'workline-observatory__workline-checkbox';
        checkbox.checked = isSelected(workline.id);
        checkbox.setAttribute('aria-label', formatCopy(copy.selectionLabel, { title: workline.title }));
        checkbox.addEventListener('change', () => toggleWorkline(workline.id));
        label.append(title, checkbox);

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

        row.addEventListener('click', (event) => {
            if (event.target === checkbox) return;
            toggleWorkline(workline.id);
        });
        row.append(label, track, target);
        return row;
    };

    const buildDetail = () => {
        const detail = document.createElement('aside');
        detail.className = 'workline-observatory__detail';
        detail.append(buildGoalPanel());
        const workline = getSelectedObservatoryWorkline(state);
        if (!workline) return detail;
        const body = document.createElement('section');
        body.className = 'workline-observatory__selected-workline';
        const heading = document.createElement('h3');
        heading.textContent = `${workline.title} · ${copy.phase} ${workline.current_phase}`;
        body.append(
            heading,
            detailLine(copy.status, describeWorklineStatus(workline.status, copy)),
            detailLine(copy.tickets, (workline.task_ids || []).map((id) => `#${id}`).join(', ') || '—'),
            detailLine(copy.lastStatus, describeStatusChange(workline.latest_status_change, copy)),
        );
        if (workline.status_reconciliation_needed) {
            const notice = document.createElement('p');
            notice.className = 'workline-observatory__reconciliation-notice';
            notice.textContent = copy.reconciliation;
            body.append(notice);
        }
        const report = workline.latest_report;
        if (!report) {
            const empty = document.createElement('p'); empty.textContent = copy.noReport; body.append(empty);
        } else {
            body.append(
                detailLine(copy.context, report.context),
                detailLine(copy.plain, report.plain_language),
                detailLine(copy.technical, report.technical),
                detailLine(copy.next, report.next_step),
                detailLine(copy.git, `${report.git_worktree_state || '—'} · ${report.git_head_commit || '—'} · ${(report.git_workline_changed_paths || []).join(', ') || '—'}`),
            );
        }
        body.append(buildContractEditor(workline), buildChatPanel(workline));
        detail.append(body);
        return detail;
    };

    const buildGoalPanel = () => {
        const panel = document.createElement('section'); panel.className = 'workline-observatory__goal';
        const title = document.createElement('h3'); title.textContent = copy.goal; panel.append(title);
        const goal = state.releaseGoal;
        if (!goal) {
            const empty = document.createElement('p'); empty.textContent = copy.noGoal;
            panel.append(empty, buildGoalCreator());
            return panel;
        }
        panel.append(
            detailLine(`${goal.identity_key} v${goal.version}`, `${goal.title} · ${goal.decision_state === 'locked' ? copy.locked : copy.draft}`),
            detailLine('', goal.outcome),
        );
        if (goal.decision_state === 'draft') panel.append(buildGoalLockButton(goal));
        if (goal.decision_state === 'locked') panel.append(buildGoalCreator());
        return panel;
    };

    const buildGoalLockButton = (goal) => {
        const wrapper = document.createElement('div');
        const status = document.createElement('p'); status.className = 'fw-text-muted';
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'button'; button.textContent = copy.lockGoal;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await applyWorklineReleaseGoalAction(goal.id, 'lock');
                await generate_workline_observatory_view(container);
            } catch (error) {
                status.textContent = error?.message || String(error);
                button.disabled = false;
            }
        });
        wrapper.append(button, status);
        return wrapper;
    };

    const buildGoalCreator = () => {
        const form = document.createElement('form');
        form.className = 'workline-observatory__goal-creator';
        const heading = document.createElement('h4'); heading.textContent = copy.newGoal;
        const identity = labeledInput(copy.goalKey, 'text', 'release-');
        const version = labeledInput(copy.goalRevision, 'number', '1'); version.input.min = '1';
        const title = labeledInput(copy.goalTitle, 'text', '');
        const outcome = labeledInput(copy.goalOutcome, 'text', '');
        const status = document.createElement('p'); status.className = 'fw-text-muted';
        const submit = document.createElement('button');
        submit.type = 'submit'; submit.className = 'button'; submit.textContent = copy.createGoal;
        form.append(heading, identity.wrapper, version.wrapper, title.wrapper, outcome.wrapper, submit, status);
        form.addEventListener('submit', async (event) => {
            event.preventDefault(); submit.disabled = true;
            try {
                await createWorklineReleaseGoal({ identity_key: identity.input.value, version: Number(version.input.value), title: title.input.value, outcome: outcome.input.value, selected: true });
                await generate_workline_observatory_view(container);
            } catch (error) {
                status.textContent = error?.message || String(error);
                submit.disabled = false;
            }
        });
        return form;
    };

    const buildContractEditor = (workline) => {
        const panel = document.createElement('section'); panel.className = 'workline-observatory__contract';
        const heading = document.createElement('h4'); heading.textContent = copy.contract; panel.append(heading);
        const goal = state.releaseGoal;
        if (!goal) { panel.append(document.createTextNode(copy.unclassified)); return panel; }
        const select = document.createElement('select');
        const rules = ['outside_release', 'must_complete', 'must_remain_incomplete', 'must_be_in_phase', 'must_not_start'];
        rules.forEach((rule) => {
            const option = document.createElement('option');
            option.value = rule; option.textContent = describeReleaseContract({ completion_rule: rule }, copy);
            select.append(option);
        });
        select.value = workline.release_contract?.completion_rule || 'outside_release';
        select.disabled = goal.decision_state === 'locked';
        const phase = document.createElement('input');
        phase.type = 'number'; phase.min = '0'; phase.max = '6';
        phase.value = workline.release_contract?.target_phase ?? ''; phase.disabled = select.disabled;
        const status = document.createElement('p'); status.className = 'fw-text-muted';
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'button'; save.textContent = copy.save; save.disabled = select.disabled;
        save.addEventListener('click', async () => {
            save.disabled = true;
            try {
                await saveWorklineReleaseContract({ release_goal_id: goal.id, workline_id: workline.id, completion_rule: select.value, target_phase: phase.value === '' ? null : Number(phase.value) });
                await generate_workline_observatory_view(container);
            } catch (error) {
                status.textContent = error?.message || String(error);
                save.disabled = false;
            }
        });
        panel.append(select, phase, save, status);
        return panel;
    };

    const buildChatPanel = (workline) => {
        const panel = document.createElement('section'); panel.className = 'workline-observatory__chat';
        const heading = document.createElement('h4'); heading.textContent = copy.ask;
        const input = document.createElement('textarea'); input.rows = 3;
        const status = document.createElement('p'); status.className = 'fw-text-muted';
        const send = document.createElement('button'); send.type = 'button'; send.className = 'button'; send.textContent = copy.send;
        send.addEventListener('click', async () => {
            send.disabled = true;
            try {
                const response = await startWorklineConversation(workline, state.releaseGoal, input.value);
                const session = response?.session || response;
                status.textContent = `Queen: ${session?.id || session?.status || 'started'}`;
            } catch (error) {
                status.textContent = error?.message || String(error);
            } finally {
                send.disabled = false;
            }
        });
        panel.append(heading, input, send, status);
        return panel;
    };

    redraw();
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

function formatCopy(template, values) {
    return Object.entries(values).reduce(
        (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
        String(template || ''),
    );
}

function getStatusActions(copy) {
    return [
        { status: 'active', label: copy.activate, stateLabel: copy.activeState },
        { status: 'paused', label: copy.pause, stateLabel: copy.pausedState },
        { status: 'closed', label: copy.markDone, stateLabel: copy.closedState },
        { status: 'archived', label: copy.discard, stateLabel: copy.archivedState },
    ];
}

function buildStatusActionGuidance(action, selected, copy) {
    if (selected.length === 0) {
        return formatCopy(copy.chooseTarget, { state: action.stateLabel });
    }
    const affected = selected.filter((workline) => workline.status !== action.status);
    if (affected.length === 0) {
        return formatCopy(copy.alreadyTarget, { state: action.stateLabel });
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

function buildStatusActionConfirmation(action, selected, affected, copy) {
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

function describeWorklineStatus(status, copy) {
    return getStatusActions(copy).find((action) => action.status === status)?.stateLabel || status || '—';
}

function describeStatusChange(change, copy) {
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

function detailLine(labelText, valueText) {
    const row = document.createElement('div'); row.className = 'workline-observatory__detail-line';
    if (labelText) {
        const label = document.createElement('strong'); label.textContent = labelText; row.append(label);
    }
    const value = document.createElement('p'); value.textContent = String(valueText || '—'); row.append(value);
    return row;
}

function describeReleaseContract(contract, copy) {
    if (!contract) return copy.unclassified;
    const labels = {
        must_complete: copy.mustComplete,
        must_remain_incomplete: copy.mustRemainIncomplete,
        must_be_in_phase: copy.mustBeInPhase,
        must_not_start: copy.mustNotStart,
        outside_release: copy.outsideRelease,
    };
    const label = labels[contract.completion_rule] || copy.unclassified;
    return contract.target_phase === null || contract.target_phase === undefined
        ? label
        : `${label} · ${copy.phase} ${contract.target_phase}`;
}

function labeledInput(labelText, type, value) {
    const wrapper = document.createElement('label');
    const label = document.createElement('span'); label.textContent = labelText;
    const input = document.createElement('input');
    input.type = type; input.value = value; input.required = true;
    wrapper.append(label, input);
    return { wrapper, input };
}
