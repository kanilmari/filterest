// cloud_management_scheduler_printer.js
// Renders rollout scheduler and orchestrator-next details for cloud management.
// Bridges cloud-management DOM rows and stable /api/instances rollout routes.
// Exists to keep the main cloud-management view below file-length limits.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import {
    buildOrchestratorClaimPayload,
    buildOrchestratorExecutePayload,
    buildOrchestratorFallbackPlanPayload,
    canClaimOrchestratorNext,
    canExecuteClaimedOrchestratorNext,
    canPlanOrchestratorFallback,
    orchestratorClaimForService,
    orchestratorNextForService,
    orchestratorClaimURLParams,
    orchestratorExecuteURLParams,
    orchestratorFallbackPlanURLParams,
    orchestratorNextURLParams,
    rolloutIDForService,
    schedulerPlanForService,
    schedulerPlanURLParams,
    summarizeOrchestratorNext,
    summarizeSchedulerPlan,
} from './cloud_management_view_helpers.js';

export function renderSchedulerPlan(service, translate) {
    const text = typeof translate === 'function' ? translate : (key) => key;
    const plan = schedulerPlanForService(service);
    const orchestratorNext = orchestratorNextForService(service);
    const orchestratorClaim = orchestratorClaimForService(service);
    const rolloutID = rolloutIDForService(service);
    if (!plan && !rolloutID) {
        return document.createDocumentFragment();
    }

    const details = document.createElement('details');
    details.className = 'cloud-row-scheduler';
    details.open = Boolean(plan);
    const summary = document.createElement('summary');
    summary.textContent = rolloutID ? `${text('scheduler')} · ${rolloutID}` : text('scheduler');
    details.appendChild(summary);

    if (plan) {
        details.appendChild(renderSchedulerPlanBody(plan, text));
    } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cloud-action-button cloud-scheduler-load-button';
        button.textContent = text('loadScheduler');
        button.addEventListener('click', () => loadSchedulerPlan(details, service, rolloutID, text));
        details.appendChild(button);
    }
    if (orchestratorNext) {
        details.appendChild(renderOrchestratorNextBody(orchestratorNext, orchestratorClaim, text));
    } else if (rolloutID) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cloud-action-button cloud-orchestrator-load-button';
        button.textContent = text('loadOrchestrator');
        button.addEventListener('click', () => loadOrchestratorNext(details, service, rolloutID, text));
        details.appendChild(button);
    }

    return details;
}

function renderSchedulerPlanBody(plan, text) {
    const summary = summarizeSchedulerPlan(plan);
    const body = document.createElement('div');
    body.className = 'cloud-scheduler-body';
    body.append(
        schedulerMetric(text('rollout'), summary.rolloutID || '—'),
        schedulerMetric(text('state'), summary.state || '—'),
        schedulerMetric(text('recommended'), summary.recommendedAction || '—'),
        schedulerMetric(text('ready'), summary.readyItems),
        schedulerMetric(text('activeLeases'), summary.activeLeases),
        schedulerMetric(text('operatorReview'), summary.operatorReviewItems),
        schedulerMetric(text('failedBlocked'), `${summary.failedItems} / ${summary.blockedItems}`)
    );
    if (summary.nextAPICalls.length > 0) {
        body.appendChild(renderSchedulerAPICalls(summary.nextAPICalls, text));
    }
    if (summary.rescueActions.length > 0) {
        body.appendChild(renderSchedulerRescueActions(summary.rescueActions, text));
    }
    for (const line of [...summary.warnings, ...summary.blockers].slice(0, 6)) {
        body.appendChild(schedulerNote(line));
    }
    return body;
}

function renderSchedulerAPICalls(callsList, text) {
    const calls = document.createElement('ul');
    calls.className = 'cloud-scheduler-calls';
    const heading = document.createElement('li');
    heading.className = 'cloud-scheduler-calls-heading';
    heading.textContent = text('nextApiCalls');
    calls.appendChild(heading);
    for (const call of callsList.slice(0, 6)) {
        const item = document.createElement('li');
        item.textContent = call;
        calls.appendChild(item);
    }
    return calls;
}

function renderSchedulerRescueActions(actions, text) {
    const list = document.createElement('ul');
    list.className = 'cloud-scheduler-rescue-actions';
    const heading = document.createElement('li');
    heading.className = 'cloud-scheduler-calls-heading';
    heading.textContent = text('rescueActions');
    list.appendChild(heading);
    for (const action of actions.slice(0, 6)) {
        const item = document.createElement('li');
        const parts = [
            action.serviceKey || `#${action.workItemID}`,
            action.recommendedAction,
            action.currentStep,
            [action.serviceRolloutStatus, action.workStatus].filter(Boolean).join(' / '),
        ].filter(Boolean);
        const calls = action.nextAPICalls.length > 0 ? ` · ${action.nextAPICalls.join(' · ')}` : '';
        const blockers = action.blockers.length > 0 ? ` · ${action.blockers.join(' · ')}` : '';
        item.textContent = `${parts.join(' · ')}${calls}${blockers}`;
        list.appendChild(item);
    }
    return list;
}

function renderOrchestratorNextBody(next, claim, text) {
    const summary = summarizeOrchestratorNext(next);
    const body = document.createElement('div');
    body.className = 'cloud-orchestrator-next';
    const heading = document.createElement('div');
    heading.className = 'cloud-orchestrator-heading';
    heading.textContent = text('orchestrator');
    body.append(
        heading,
        schedulerMetric(text('state'), summary.state || '—'),
        schedulerMetric(text('actionKind'), summary.kind || '—'),
        schedulerMetric(text('recommended'), summary.recommendedAction || '—'),
        schedulerMetric(text('workItem'), orchestratorWorkItemLabel(summary)),
        schedulerMetric(text('gates'), summary.gates.length > 0 ? summary.gates.join(', ') : '—'),
        schedulerMetric(text('actionPath'), [summary.method, summary.path].filter(Boolean).join(' ') || '—')
    );
    for (const line of [...summary.warnings, ...summary.blockers].slice(0, 4)) {
        body.appendChild(schedulerNote(line));
    }
    if (canClaimOrchestratorNext(next)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cloud-action-button cloud-orchestrator-claim-button';
        button.textContent = text('claimNext');
        button.addEventListener('click', () => claimOrchestratorNext(body, next, text));
        body.appendChild(button);
    }
    if (canExecuteClaimedOrchestratorNext(next, claim)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cloud-action-button cloud-orchestrator-execute-button';
        button.textContent = text('executeClaimed');
        button.addEventListener('click', () => executeClaimedOrchestratorNext(body, next, claim, text));
        body.appendChild(button);
    }
    if (canPlanOrchestratorFallback(next)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cloud-action-button cloud-orchestrator-fallback-plan-button';
        button.textContent = text('planFallback');
        button.addEventListener('click', () => planOrchestratorFallbackNext(body, next, text));
        body.appendChild(button);
    }
    return body;
}

function orchestratorWorkItemLabel(summary) {
    const parts = [
        summary.workItemID ? `#${summary.workItemID}` : '',
        summary.serviceKey,
        summary.currentStep,
        summary.workStatus,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : '—';
}

function schedulerMetric(label, value) {
    const item = document.createElement('div');
    item.className = 'cloud-scheduler-metric';
    const valueElement = document.createElement('strong');
    valueElement.textContent = String(value);
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    item.append(valueElement, labelElement);
    return item;
}

function schedulerNote(line) {
    const item = document.createElement('p');
    item.className = 'cloud-scheduler-note';
    item.textContent = line;
    return item;
}

async function loadSchedulerPlan(details, service, rolloutID, text) {
    const button = details.querySelector('.cloud-scheduler-load-button');
    if (button) {
        button.disabled = true;
        button.textContent = text('loading');
    }
    try {
        service.scheduler_plan = await endpoint_router('cloudManagementSchedulerPlan', {
            method: 'GET',
            url_params: schedulerPlanURLParams(rolloutID),
            suppressAuthRedirect: true,
        });
        details.replaceWith(renderSchedulerPlan(service, text));
    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent = `${text('failed')}: ${error.message || error}`;
        }
    }
}

async function loadOrchestratorNext(details, service, rolloutID, text) {
    const button = details.querySelector('.cloud-orchestrator-load-button');
    if (button) {
        button.disabled = true;
        button.textContent = text('loading');
    }
    try {
        service.orchestrator_next = await endpoint_router('cloudManagementOrchestratorNext', {
            method: 'GET',
            url_params: orchestratorNextURLParams(rolloutID),
            suppressAuthRedirect: true,
        });
        details.replaceWith(renderSchedulerPlan(service, text));
    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent = `${text('failed')}: ${error.message || error}`;
        }
    }
}

async function claimOrchestratorNext(body, next, text) {
    const rolloutID = summarizeOrchestratorNext(next).rolloutID;
    const button = body.querySelector('.cloud-orchestrator-claim-button');
    const workerID = window.prompt(text('workerIDPrompt'), 'cloud-management-ui');
    if (!workerID) {
        return;
    }
    if (button) {
        button.disabled = true;
        button.textContent = text('claiming');
    }
    try {
        const claim = await endpoint_router('cloudManagementOrchestratorClaim', {
            method: 'POST',
            url_params: orchestratorClaimURLParams(rolloutID),
            body_data: buildOrchestratorClaimPayload(next, workerID),
            suppressAuthRedirect: true,
        });
        const service = await reloadRolloutGuidance(rolloutID, { orchestrator_claim: claim });
        const details = body.closest('.cloud-row-scheduler');
        if (details) {
            details.replaceWith(renderSchedulerPlan(service, text));
        }
    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent = `${text('failed')}: ${error.message || error}`;
        }
    }
}

async function executeClaimedOrchestratorNext(body, next, claim, text) {
    const rolloutID = summarizeOrchestratorNext(next).rolloutID;
    const button = body.querySelector('.cloud-orchestrator-execute-button');
    const reason = window.prompt(text('executeReasonPrompt'), text('executeReasonDefault'));
    if (!reason) {
        return;
    }
    if (next.action?.requires_confirm_prod && !window.confirm(text('confirmExecute'))) {
        return;
    }
    if (button) {
        button.disabled = true;
        button.textContent = text('executing');
    }
    try {
        await endpoint_router('cloudManagementOrchestratorExecute', {
            method: 'POST',
            url_params: orchestratorExecuteURLParams(rolloutID),
            body_data: buildOrchestratorExecutePayload(next, claim, {
                reason,
                confirmProd: true,
                idempotencyKey: newOrchestratorIdempotencyKey(),
            }),
            suppressAuthRedirect: true,
        });
        const service = await reloadRolloutGuidance(rolloutID);
        const details = body.closest('.cloud-row-scheduler');
        if (details) {
            details.replaceWith(renderSchedulerPlan(service, text));
        }
    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent = `${text('failed')}: ${error.message || error}`;
        }
    }
}

async function planOrchestratorFallbackNext(body, next, text) {
    const rolloutID = summarizeOrchestratorNext(next).rolloutID;
    const button = body.querySelector('.cloud-orchestrator-fallback-plan-button');
    if (button) {
        button.disabled = true;
        button.textContent = text('planningFallback');
    }
    try {
        const plan = await endpoint_router('cloudManagementFallbackPlan', {
            method: 'POST',
            url_params: orchestratorFallbackPlanURLParams(rolloutID),
            body_data: buildOrchestratorFallbackPlanPayload(next),
            suppressAuthRedirect: true,
        });
        body.querySelector('.cloud-orchestrator-fallback-plan')?.remove();
        body.appendChild(renderOrchestratorFallbackPlan(plan, text));
        if (button) {
            button.disabled = false;
            button.textContent = text('planFallback');
        }
    } catch (error) {
        if (button) {
            button.disabled = false;
            button.textContent = `${text('failed')}: ${error.message || error}`;
        }
    }
}

function renderOrchestratorFallbackPlan(plan, text) {
    const shell = document.createElement('div');
    shell.className = 'cloud-orchestrator-fallback-plan';
    const fallbackPlan = plan?.fallback_plan || {};
    shell.append(
        schedulerMetric(text('fallbackPlan'), fallbackPlan.recommended_option || '—'),
        schedulerMetric(text('workItem'), fallbackPlan.work_item_id || plan?.work_item?.id || '—')
    );
    const options = Array.isArray(plan?.options) ? plan.options : [];
    if (options.length > 0) {
        const list = document.createElement('ul');
        list.className = 'cloud-scheduler-calls';
        const heading = document.createElement('li');
        heading.className = 'cloud-scheduler-calls-heading';
        heading.textContent = text('fallbackOptions');
        list.appendChild(heading);
        for (const option of options.slice(0, 6)) {
            const item = document.createElement('li');
            const state = option.available === false ? 'blocked' : 'available';
            const calls = Array.isArray(option.next_api_calls) ? option.next_api_calls : [];
            item.textContent = [option.key, state, ...calls].filter(Boolean).join(' · ');
            list.appendChild(item);
        }
        shell.appendChild(list);
    }
    return shell;
}

async function reloadRolloutGuidance(rolloutID, extra = {}) {
    const [schedulerPlan, orchestratorNext] = await Promise.all([
        endpoint_router('cloudManagementSchedulerPlan', {
            method: 'GET',
            url_params: schedulerPlanURLParams(rolloutID),
            suppressAuthRedirect: true,
        }),
        endpoint_router('cloudManagementOrchestratorNext', {
            method: 'GET',
            url_params: orchestratorNextURLParams(rolloutID),
            suppressAuthRedirect: true,
        }),
    ]);
    return {
        rollout_id: rolloutID,
        scheduler_plan: schedulerPlan,
        orchestrator_next: orchestratorNext,
        ...extra,
    };
}

function newOrchestratorIdempotencyKey() {
    if (window.crypto?.randomUUID) {
        return `cloud-ui-${window.crypto.randomUUID()}`;
    }
    return `cloud-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
