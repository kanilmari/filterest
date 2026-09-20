// workline_observatory_detail_modal.js
// Presents immutable report history and release decisions in the shared modal.
// Connects a current visible workline identity with existing goal and report APIs.
// Keeps lifecycle status separate from the latest reported phase and rejects stale history loads.

import { createModal, showModal, hideModal } from '../../reusable_components/modal/modal_builder.js';
import { applyWorklineReleaseGoalAction, createWorklineReleaseGoal, fetchWorklineObservatoryReportHistory, saveWorklineReleaseContract } from './workline_observatory_api_adapter.js';
import { buildWorklinePriorityEditor, describeWorklineStatus, describeStatusChange } from './workline_observatory_actions.js';

// The shared modal owns focus trapping, Escape, overlay close and focus restoration.
export function createWorklineObservatoryDetailModal({ getState, copy, actions, getMessage = () => '', restoreFocus = () => {} }) {
    let state = getState();
    let activeWorklineId = null;
    let modalContent = null;
    let reportSurface = null;
    let modalOpen = false;
    let session = 0;
    let renderedState = null;
    let renderedLanguage = '';
    const reportHistoryByWorklineID = new Map();
    const reportHistoryStatusByWorklineID = new Map();
    const selectedReportIDByWorklineID = new Map();
    const renderReport = (workline) => {
        if (!reportSurface) return;
        reportSurface.replaceChildren();
        const historyStatus = reportHistoryStatusByWorklineID.get(workline.id);
        const reportHistory = reportHistoryByWorklineID.get(workline.id) || [];
        const selectedReportID = selectedReportIDByWorklineID.get(workline.id);
        const report = reportHistory.find((candidate) => candidate.id === selectedReportID)
            || reportHistory[0]
            || workline.latest_report;
        reportSurface.append(buildReportHistoryControl(workline, reportHistory, historyStatus, report));
        if (!report) {
            const empty = document.createElement('p'); empty.textContent = copy.noReport; reportSurface.append(empty);
        } else {
            reportSurface.append(
                detailLine(copy.context, report.context),
                detailLine(copy.plain, report.plain_language),
                detailLine(copy.technical, report.technical),
                detailLine(copy.next, report.next_step),
                detailLine(copy.git, `${report.git_worktree_state || '—'} · ${report.git_head_commit || '—'} · ${(report.git_workline_changed_paths || []).join(', ') || '—'}`),
            );
        }
    };
    const buildDetail = () => {
        const detail = document.createElement('aside');
        detail.className = 'workline-observatory__detail';
        const guidance = document.createElement('output');
        guidance.className = 'workline-observatory__modal-guidance';
        guidance.setAttribute('aria-live', 'polite');
        guidance.textContent = getMessage();
        const goalPanel = buildGoalPanel();
        detail.append(guidance);
        const workline = state.worklines.find((candidate) => candidate.id === activeWorklineId);
        if (!workline) { detail.append(goalPanel); return detail; }
        detail.classList.add('workline-observatory__detail--with-workline');
        const body = document.createElement('section');
        body.className = 'workline-observatory__selected-workline';
        const heading = document.createElement('h3');
        heading.textContent = `#${workline.id} ${workline.title} · ${copy.reportedPhase} ${workline.reported_current_phase}`;
        body.append(
            heading,
            buildWorklinePriorityEditor(workline, copy, actions),
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
        reportSurface = document.createElement('section');
        reportSurface.className = 'workline-observatory__report';
        body.append(reportSurface);
        renderReport(workline);
        body.append(buildContractEditor(workline));
        // DOM and keyboard order put the requested workline before release administration.
        detail.append(body, goalPanel);
        return detail;
    };

    const buildReportHistoryControl = (workline, reports, status, selectedReport) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'workline-observatory__report-history';
        if (status === 'loading' || !status) {
            const loading = document.createElement('p'); loading.textContent = copy.reportHistoryLoading;
            wrapper.append(loading);
            return wrapper;
        }
        if (status === 'error') {
            const unavailable = document.createElement('p'); unavailable.textContent = copy.reportHistoryUnavailable;
            wrapper.append(unavailable);
            return wrapper;
        }
        if (reports.length === 0) return wrapper;

        const label = document.createElement('label');
        const labelText = document.createElement('span'); labelText.textContent = copy.reportHistory;
        const select = document.createElement('select');
        select.setAttribute('aria-label', copy.reportHistory);
        reports.forEach((report) => {
            const option = document.createElement('option');
            option.value = String(report.id);
            option.textContent = formatReportHistoryOption(report, copy);
            select.append(option);
        });
        select.value = String(selectedReport?.id || reports[0].id);
        select.addEventListener('change', () => {
            selectedReportIDByWorklineID.set(workline.id, Number(select.value));
            renderReport(workline);
        });
        label.append(labelText, select);
        wrapper.append(label);
        return wrapper;
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
        button.type = 'button'; button.className = 'button'; button.textContent = copy.lockGoal; button.disabled = actions.busy;
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await actions.mutate(() => applyWorklineReleaseGoalAction(goal.id, 'lock'));
                button.disabled = false;
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
        submit.type = 'submit'; submit.className = 'button'; submit.textContent = copy.createGoal; submit.disabled = actions.busy;
        form.append(heading, identity.wrapper, version.wrapper, title.wrapper, outcome.wrapper, submit, status);
        form.addEventListener('submit', async (event) => {
            event.preventDefault(); submit.disabled = true;
            try {
                await actions.mutate(() => createWorklineReleaseGoal({ identity_key: identity.input.value, version: Number(version.input.value), title: title.input.value, outcome: outcome.input.value, selected: true }));
                submit.disabled = false;
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
        select.setAttribute('aria-label', copy.contract);
        const phase = document.createElement('input');
        phase.setAttribute('aria-label', copy.phase);
        phase.type = 'number'; phase.min = '0'; phase.max = '6';
        phase.value = workline.release_contract?.target_phase ?? ''; phase.disabled = select.disabled;
        const status = document.createElement('p'); status.className = 'fw-text-muted';
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'button'; save.textContent = copy.save; save.disabled = select.disabled || actions.busy;
        save.addEventListener('click', async () => {
            save.disabled = true;
            try {
                await actions.mutate(() => saveWorklineReleaseContract({ release_goal_id: goal.id, workline_id: workline.id, completion_rule: select.value, target_phase: phase.value === '' ? null : Number(phase.value) }));
                save.disabled = false;
            } catch (error) {
                status.textContent = error?.message || String(error);
                save.disabled = false;
            }
        });
        panel.append(select, phase, save, status);
        return panel;
    };

    const loadHistory = async (worklineId, currentSession) => {
        if (worklineId === null || reportHistoryStatusByWorklineID.has(worklineId)) return;
        reportHistoryStatusByWorklineID.set(worklineId, 'loading');
        try {
            const reports = await fetchWorklineObservatoryReportHistory(worklineId);
            if (!modalOpen || currentSession !== session || activeWorklineId !== worklineId) return;
            reportHistoryByWorklineID.set(worklineId, reports);
            reportHistoryStatusByWorklineID.set(worklineId, 'ready');
            const latestId = getState().worklines.find((workline) => workline.id === worklineId)?.latest_report?.id;
            selectedReportIDByWorklineID.set(worklineId,
                reports.some((report) => report.id === latestId) ? latestId : reports[0]?.id);
        } catch (_error) {
            if (!modalOpen || currentSession !== session || activeWorklineId !== worklineId) return;
            reportHistoryStatusByWorklineID.set(worklineId, 'error');
        }
        const workline = getState().worklines.find((candidate) => candidate.id === worklineId);
        if (workline) renderReport(workline);
    };
    const synchronizeEditorAvailability = () => {
        modalContent.querySelectorAll('.workline-observatory__goal button, .workline-observatory__goal input, .workline-observatory__priority-editor')
            .forEach((element) => { element.disabled = actions.busy; });
        modalContent.querySelectorAll('.workline-observatory__contract button, .workline-observatory__contract input, .workline-observatory__contract select')
            .forEach((element) => { element.disabled = actions.busy || state.releaseGoal?.decision_state === 'locked'; });
    };
    const update = () => {
        if (!modalOpen) return;
        state = getState();
        if (activeWorklineId !== null && !state.worklines.some((workline) => workline.id === activeWorklineId)) {
            hideModal({ immediate: true });
            return;
        }
        if (state === renderedState && renderedLanguage === copy.priority) {
            modalContent.querySelector('.workline-observatory__modal-guidance').textContent = getMessage();
            synchronizeEditorAvailability();
            return;
        }
        const previousReport = renderedState?.worklines.find((row) => row.id === activeWorklineId)?.latest_report?.id;
        const currentReport = state.worklines.find((row) => row.id === activeWorklineId)?.latest_report?.id;
        if (previousReport !== currentReport) {
            reportHistoryByWorklineID.clear();
            reportHistoryStatusByWorklineID.clear();
            selectedReportIDByWorklineID.clear();
            session += 1;
        }
        modalContent.replaceChildren(buildDetail());
        renderedState = state;
        renderedLanguage = copy.priority;
        synchronizeEditorAvailability();
        if (previousReport !== currentReport) void loadHistory(activeWorklineId, session);
    };
    return {
        open(worklineId = null) {
            const workline = getState().worklines.find((candidate) => candidate.id === worklineId);
            if (worklineId !== null && !workline) return;
            activeWorklineId = worklineId;
            state = getState();
            modalContent = document.createElement('div');
            modalContent.className = 'workline-observatory__modal-content';
            modalContent.replaceChildren(buildDetail());
            renderedState = state;
            renderedLanguage = copy.priority;
            createModal({
                titlePlainText: workline?.title || copy.goal,
                contentElements: [modalContent], width: 'min(1100px, 96vw)', maxWidth: '96vw', maxHeight: '94dvh',
                cleanupCallback: () => {
                    modalOpen = false;
                    session += 1;
                    reportHistoryByWorklineID.clear();
                    reportHistoryStatusByWorklineID.clear();
                    selectedReportIDByWorklineID.clear();
                    queueMicrotask(() => {
                        if (!modalOpen && document.getElementById('custom_modal_overlay')?.getAttribute('aria-hidden') === 'true') restoreFocus(worklineId);
                    });
                },
            });
            modalOpen = true;
            const currentSession = ++session;
            showModal();
            void loadHistory(worklineId, currentSession);
        },
        update,
        destroy() { if (modalOpen) hideModal({ immediate: true }); },
    };
}

function formatReportHistoryOption(report, copy) {
    const phase = report.phase_gate || (report.current_phase ?? '—');
    const parsed = new Date(report.created_at);
    const createdAt = Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString();
    return `${copy.phase} ${phase} · ${createdAt} · ${report.title || `#${report.id}`}`;
}

function detailLine(labelText, valueText) {
    const row = document.createElement('div'); row.className = 'workline-observatory__detail-line';
    if (labelText) {
        const label = document.createElement('strong'); label.textContent = labelText; row.append(label);
    }
    const value = document.createElement('p'); value.textContent = String(valueText || '—'); row.append(value);
    return row;
}

export function describeReleaseContract(contract, copy) {
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
