// cloud_management_view_helpers.js
// Pure helpers for the management-Easelect cloud view.
// Bridges backend cloud/live payloads and compact table presentation without DOM coupling.
// Exists so filtering, counters, and action visibility stay testable outside browser rendering.

export const CLOUD_MANAGEMENT_ENDPOINTS = Object.freeze({
    status: '/api/instances/status',
    action: '/api/app/cloud-management/action',
    logsPrefix: '/api/app/cloud-management/logs/',
    schedulerPlanPrefix: '/api/instances/rollouts/',
    orchestratorNextPrefix: '/api/instances/rollouts/',
    orchestratorClaimPrefix: '/api/instances/rollouts/',
    orchestratorExecutePrefix: '/api/instances/rollouts/',
    fallbackPlanPrefix: '/api/instances/rollouts/',
});

export const CLOUD_LIVE_FILTER_KEYS = Object.freeze([
    'q',
    'environment',
    'topology',
    'update_status',
    'live_health',
    'agent_id',
]);

const CLOUD_NODE_ACTIONS = new Set(['start', 'stop', 'restart', 'backup', 'rebuild', 'rollback']);
const SCHEDULER_READY_FALLBACK_SUPPRESSED_STATES = new Set([
    'recovery_required',
    'operator_review_required',
    'mixed_state_review',
    'terminal',
]);

export function summarizeCloudPayload(payload = {}) {
    const summary = payload.summary || {};
    const services = Array.isArray(payload.services) ? payload.services : [];
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    return {
        services: numberOrFallback(summary.services, services.length),
        clusters: numberOrFallback(summary.clusters, services.filter((service) => service.topology === 'cluster').length),
        nodes: numberOrFallback(summary.nodes, services.reduce((total, service) => (
            total + (Array.isArray(service.nodes) ? service.nodes.length : 0)
        ), 0)),
        liveOK: numberOrFallback(summary.live_ok, services.filter((service) => service.live_health === 'ok').length),
        warnings: numberOrFallback(summary.warnings, warnings.length),
        agentOK: numberOrFallback(summary.agent_ok, 0),
        agentTotal: numberOrFallback(summary.agent_total, Array.isArray(payload.agent_status) ? payload.agent_status.length : 0),
        rollingLocked: numberOrFallback(summary.rolling_locked, services.length),
    };
}

export function visibleActions(actions = []) {
    return actions.filter((action) => action && action.visible !== false);
}

export function healthTone(health) {
    switch (String(health || '').toLowerCase()) {
    case 'ok':
        return 'ok';
    case 'attention':
    case 'warning':
    case 'blocked':
        return 'warning';
    case 'failed':
    case 'error':
        return 'error';
    default:
        return 'neutral';
    }
}

export function formatTopology(service = {}) {
    const topology = service.topology === 'cluster' ? 'cluster' : 'single';
    const nodeCount = Array.isArray(service.nodes) ? service.nodes.length : 0;
    return topology === 'cluster' ? `cluster / ${nodeCount}` : 'single';
}

export function buildStatusQuery(filters = {}) {
    const params = new URLSearchParams();
    for (const key of CLOUD_LIVE_FILTER_KEYS) {
        const value = String(filters[key] || '').trim();
        if (value) {
            params.set(key, value);
        }
    }
    const query = params.toString();
    return query ? `?${query}` : '';
}

export function buildCloudActionPayload(actionKey, service = {}, node = null, options = {}) {
    const targetNode = resolveCloudActionNode(actionKey, service, node);
    const targetID = targetNode ? targetNode.id : service.id;
    const targetKey = targetNode ? targetNode.node_key : service.service_key;
    const payload = {
        target_type: targetNode ? 'node' : 'service',
        target_id: Number(targetID || 0),
        target_key: String(targetKey || ''),
        action: String(actionKey || ''),
        confirm_prod: Boolean(options.confirmProd),
        artifact: String(options.artifact || ''),
    };
    return payload;
}

export function cloudTargetRequiresProdConfirmation(service = {}, node = null) {
    return targetEnvironment(service, node) === 'PROD';
}

export function resolveCloudActionNode(actionKey, service = {}, node = null) {
    if (node) {
        return node;
    }
    if (!CLOUD_NODE_ACTIONS.has(String(actionKey || ''))) {
        return null;
    }
    const nodes = Array.isArray(service.nodes) ? service.nodes : [];
    return nodes.length === 1 ? nodes[0] : null;
}

export function rollbackArtifactsForNode(node = {}) {
    const artifacts = Array.isArray(node?.live?.rollback_artifacts) ? node.live.rollback_artifacts : [];
    return artifacts
        .filter((artifact) => artifact && String(artifact.id || '').trim())
        .map((artifact) => ({
            ...artifact,
            id: String(artifact.id),
        }));
}

export function rollbackArtifactPromptOptions(artifacts = []) {
    return artifacts.map((artifact, index) => {
        const name = artifact.name || artifact.id;
        const details = [artifact.size, artifact.modified].filter(Boolean).join(', ');
        return `${index + 1}. ${name}${details ? ` (${details})` : ''}`;
    }).join('\n');
}

export function selectedRollbackArtifactId(artifacts = [], answer = '') {
    const trimmed = String(answer || '').trim();
    if (!trimmed) {
        return '';
    }
    const selectedIndex = Number.parseInt(trimmed, 10);
    if (Number.isInteger(selectedIndex) && selectedIndex >= 1 && selectedIndex <= artifacts.length) {
        return artifacts[selectedIndex - 1].id;
    }
    const directMatch = artifacts.find((artifact) => artifact.id === trimmed);
    return directMatch ? directMatch.id : '';
}

export function schedulerPlanForService(service = {}) {
    const candidates = [
        service.scheduler_plan,
        service.rollout_scheduler_plan,
        service.current_rollout?.scheduler_plan,
        service.active_rollout?.scheduler_plan,
        service.rollout?.scheduler_plan,
        service.rollout?.work_item_scheduler_plan,
    ];
    return candidates.find((candidate) => isObject(candidate) && (
        isObject(candidate.summary)
        || isObject(candidate.orchestration)
        || isObject(candidate.traffic_promotion)
        || Array.isArray(candidate.work_items)
    )) || null;
}

export function orchestratorNextForService(service = {}) {
    const candidates = [
        service.orchestrator_next,
        service.rollout_orchestrator_next,
        service.current_rollout?.orchestrator_next,
        service.active_rollout?.orchestrator_next,
        service.rollout?.orchestrator_next,
    ];
    return candidates.find((candidate) => isObject(candidate) && (
        isObject(candidate.action)
        || isObject(candidate.orchestration)
    )) || null;
}

export function orchestratorClaimForService(service = {}) {
    const candidates = [
        service.orchestrator_claim,
        service.rollout_orchestrator_claim,
        service.current_rollout?.orchestrator_claim,
        service.active_rollout?.orchestrator_claim,
        service.rollout?.orchestrator_claim,
    ];
    return candidates.find((candidate) => isObject(candidate) && (
        isObject(candidate.lease)
        || isObject(candidate.claimed_action)
    )) || null;
}

export function rolloutIDForService(service = {}) {
    const plan = schedulerPlanForService(service);
    const orchestratorNext = orchestratorNextForService(service);
    return firstTextValue(
        service.rollout_id,
        service.current_rollout?.rollout_id,
        service.active_rollout?.rollout_id,
        service.rollout?.rollout_id,
        plan?.rollout?.rollout_id,
        plan?.rollout_id,
        orchestratorNext?.rollout?.rollout_id,
        orchestratorNext?.rollout_id
    );
}

export function schedulerPlanURLParams(rolloutID) {
    const id = String(rolloutID || '').trim();
    return id ? `${encodeURIComponent(id)}/work-items/scheduler-plan` : '';
}

export function orchestratorNextURLParams(rolloutID) {
    const id = String(rolloutID || '').trim();
    return id ? `${encodeURIComponent(id)}/work-items/orchestrator-next` : '';
}

export function orchestratorClaimURLParams(rolloutID) {
    const id = String(rolloutID || '').trim();
    return id ? `${encodeURIComponent(id)}/work-items/orchestrator-claim` : '';
}

export function orchestratorExecuteURLParams(rolloutID) {
    const id = String(rolloutID || '').trim();
    return id ? `${encodeURIComponent(id)}/work-items/orchestrator-execute` : '';
}

export function orchestratorFallbackPlanURLParams(rolloutID) {
    const id = String(rolloutID || '').trim();
    return id ? `${encodeURIComponent(id)}/work-items/fallback-plan` : '';
}

export function canClaimOrchestratorNext(next = {}) {
    const action = isObject(next.action) ? next.action : {};
    const kind = firstTextValue(action.kind);
    return (kind === 'claim_work_item' || kind === 'reclaim_expired_work_item')
        && Boolean(action.requires_mutation)
        && Boolean(action.requires_worker_id)
        && !action.requires_lease_token
        && !action.operator_required
        && !action.automation_paused
        && Number(action.work_item_id) > 0
        && Boolean(firstTextValue(action.service_key));
}

export function canExecuteClaimedOrchestratorNext(next = {}, claim = {}) {
    const action = isObject(next.action) ? next.action : {};
    const workItem = claimedLeaseWorkItem(claim);
    return firstTextValue(action.kind) === 'execute_active_lease'
        && Boolean(action.requires_mutation)
        && Boolean(action.requires_worker_id)
        && Boolean(action.requires_lease_token)
        && Boolean(action.requires_idempotency_key)
        && !action.operator_required
        && !action.automation_paused
        && Number(action.work_item_id) > 0
        && Number(workItem.id) === Number(action.work_item_id)
        && firstTextValue(workItem.service_key) === firstTextValue(action.service_key)
        && firstTextValue(workItem.current_step) === firstTextValue(action.current_step)
        && firstTextValue(workItem.work_status) === 'leased'
        && Boolean(firstTextValue(workItem.lease_owner))
        && Boolean(firstTextValue(workItem.lease_token));
}

export function canPlanOrchestratorFallback(next = {}) {
    const action = isObject(next.action) ? next.action : {};
    const kind = firstTextValue(action.kind);
    return (kind === 'plan_recovery' || kind === 'plan_operator_fallback')
        && firstTextValue(action.method) === 'POST'
        && firstTextValue(action.path).endsWith('/work-items/fallback-plan')
        && !action.requires_mutation
        && Number(action.work_item_id) > 0;
}

export function buildOrchestratorClaimPayload(next = {}, workerID = '') {
    const action = isObject(next.action) ? next.action : {};
    return {
        worker_id: String(workerID || '').trim(),
        lease_seconds: Number(action.request_template?.lease_seconds) || 0,
        expected_work_item_id: Number(action.work_item_id) || 0,
        expected_service_key: firstTextValue(action.service_key),
    };
}

export function buildOrchestratorFallbackPlanPayload(next = {}) {
    const action = isObject(next.action) ? next.action : {};
    return {
        work_item_id: Number(action.request_template?.work_item_id || action.work_item_id) || 0,
    };
}

export function buildOrchestratorExecutePayload(next = {}, claim = {}, options = {}) {
    const action = isObject(next.action) ? next.action : {};
    const workItem = claimedLeaseWorkItem(claim);
    return {
        work_item_id: Number(action.work_item_id) || 0,
        worker_id: firstTextValue(workItem.lease_owner),
        lease_token: firstTextValue(workItem.lease_token),
        step: firstTextValue(action.current_step),
        reason: String(options.reason || '').trim(),
        confirm_prod: Boolean(options.confirmProd),
        idempotency_key: String(options.idempotencyKey || '').trim(),
        lease_seconds: Number(action.request_template?.lease_seconds) || 3600,
        expected_work_item_id: Number(action.work_item_id) || 0,
        expected_service_key: firstTextValue(action.service_key),
        expected_current_step: firstTextValue(action.current_step),
    };
}

export function summarizeSchedulerPlan(plan = {}) {
    const summary = isObject(plan.summary) ? plan.summary : {};
    const orchestration = isObject(plan.orchestration) ? plan.orchestration : {};
    const traffic = isObject(plan.traffic_promotion) ? plan.traffic_promotion : {};
    const state = firstTextValue(orchestration.state, traffic.state);
    return {
        rolloutID: firstTextValue(plan.rollout?.rollout_id, plan.rollout_id),
        scope: firstTextValue(orchestration.scope, plan.rollout?.scope),
        state,
        recommendedAction: firstTextValue(
            orchestration.recommended_action,
            traffic.recommended_action,
            summary.recommended_action
        ),
        readyItems: schedulerReadyItemCount(orchestration, summary, traffic, state),
        activeLeases: arrayLengthOrNumber(orchestration.active_lease_work_item_ids, summary.active_leases),
        operatorReviewItems: arrayLengthOrNumber(orchestration.operator_review_work_item_ids),
        failedItems: arrayLengthOrNumber(orchestration.failed_work_item_ids, summary.failed_items, traffic.failed_items),
        blockedItems: arrayLengthOrNumber(orchestration.blocked_work_item_ids, summary.blocked_items, traffic.blocked_items),
        rescueActions: schedulerRescueActions(orchestration, traffic),
        nextAPICalls: arrayOfText(orchestration.next_api_calls).length > 0
            ? arrayOfText(orchestration.next_api_calls)
            : arrayOfText(traffic.next_api_calls),
        warnings: [
            ...arrayOfText(orchestration.warnings),
            ...arrayOfText(traffic.warnings),
            ...arrayOfText(plan.warnings),
        ],
        blockers: [
            ...arrayOfText(orchestration.blockers),
            ...arrayOfText(traffic.blockers),
            ...arrayOfText(plan.blockers),
        ],
    };
}

export function summarizeOrchestratorNext(next = {}) {
    const action = isObject(next.action) ? next.action : {};
    const orchestration = isObject(next.orchestration) ? next.orchestration : {};
    return {
        rolloutID: firstTextValue(next.rollout?.rollout_id, next.rollout_id),
        state: firstTextValue(orchestration.state),
        kind: firstTextValue(action.kind),
        recommendedAction: firstTextValue(action.recommended_action, orchestration.recommended_action),
        method: firstTextValue(action.method),
        path: firstTextValue(action.path),
        workItemID: Number(action.work_item_id) || 0,
        serviceKey: firstTextValue(action.service_key),
        currentStep: firstTextValue(action.current_step),
        workStatus: firstTextValue(action.work_status),
        gates: orchestratorNextGates(action),
        warnings: [
            ...arrayOfText(action.warnings),
            ...arrayOfText(orchestration.warnings),
            ...arrayOfText(next.warnings),
        ],
        blockers: [
            ...arrayOfText(action.blockers),
            ...arrayOfText(orchestration.blockers),
            ...arrayOfText(next.blockers),
        ],
    };
}

function orchestratorNextGates(action = {}) {
    const gates = [];
    if (action.requires_mutation) gates.push('mutation');
    if (action.requires_worker_id) gates.push('worker_id');
    if (action.requires_lease_token) gates.push('lease_token');
    if (action.requires_idempotency_key) gates.push('idempotency_key');
    if (action.requires_confirm_prod) gates.push('confirm_prod');
    if (action.operator_required) gates.push('operator_required');
    if (action.automation_paused) gates.push('automation_paused');
    return gates;
}

function schedulerReadyItemCount(orchestration = {}, summary = {}, traffic = {}, state = '') {
    if (Array.isArray(orchestration.ready_work_item_ids)) {
        return orchestration.ready_work_item_ids.length;
    }
    if (schedulerStateSuppressesSummaryReadyFallback(state)) {
        return 0;
    }
    return arrayLengthOrNumber(undefined, summary.claimable_items, traffic.ready_items);
}

function schedulerRescueActions(orchestration = {}, traffic = {}) {
    const actions = Array.isArray(orchestration.rescue_actions)
        ? orchestration.rescue_actions
        : traffic.rescue_actions;
    if (!Array.isArray(actions)) {
        return [];
    }
    return actions
        .filter(isObject)
        .map((action) => ({
            workItemID: Number(action.work_item_id) || 0,
            serviceKey: firstTextValue(action.service_key),
            currentStep: firstTextValue(action.current_step),
            serviceRolloutStatus: firstTextValue(action.service_rollout_status),
            workStatus: firstTextValue(action.work_status),
            recommendedAction: firstTextValue(action.recommended_action),
            nextAPICalls: arrayOfText(action.next_api_calls),
            blockers: arrayOfText(action.blockers),
            mutating: Boolean(action.mutating),
            terminal: Boolean(action.terminal),
        }))
        .filter((action) => action.serviceKey || action.recommendedAction || action.workItemID);
}

function schedulerStateSuppressesSummaryReadyFallback(state) {
    return SCHEDULER_READY_FALLBACK_SUPPRESSED_STATES.has(String(state || '').trim());
}

function targetEnvironment(service = {}, node = null) {
    return String(
        node?.live?.environment
        || node?.environment
        || service.environment
        || ''
    ).trim().toUpperCase();
}

function claimedLeaseWorkItem(claim = {}) {
    if (!isObject(claim)) {
        return {};
    }
    return isObject(claim.lease?.work_item) ? claim.lease.work_item : {};
}

function numberOrFallback(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function firstTextValue(...values) {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) return text;
    }
    return '';
}

function arrayLengthOrNumber(arrayValue, ...numberValues) {
    if (Array.isArray(arrayValue)) {
        return arrayValue.length;
    }
    for (const value of numberValues) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
    }
    return 0;
}

function arrayOfText(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}
