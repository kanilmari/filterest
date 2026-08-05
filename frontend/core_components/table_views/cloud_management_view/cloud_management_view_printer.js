// cloud_management_view_printer.js
// Renders the management-Easelect cloud operations view.
// Bridges Easelect dataset view selection and protected cloud-management routes.
// Exists to move instance-panel growth into an Easelect presentation without losing rescue-panel independence.

import { endpoint_router } from '../../endpoints/endpoint_router.js';
import { registerEndpointRoute } from '../../pipeline/api_pipeline.js';
import { getLanguageWithBrowserFallback } from '../../state_stores/lang_preference_reader.js';
import {
    CLOUD_MANAGEMENT_ENDPOINTS,
    buildCloudActionPayload,
    buildStatusQuery,
    cloudTargetRequiresProdConfirmation,
    formatTopology,
    healthTone,
    resolveCloudActionNode,
    rollbackArtifactPromptOptions,
    rollbackArtifactsForNode,
    selectedRollbackArtifactId,
    summarizeCloudPayload,
    visibleActions,
} from './cloud_management_view_helpers.js';
import { renderSchedulerPlan } from './cloud_management_scheduler_printer.js';

const ACTION_METHODS = new Set(['smoke', 'preflight', 'start', 'stop', 'restart', 'backup', 'rebuild', 'rollback']);

const TEXT = Object.freeze({
    en: {
        refresh: 'Refresh',
        services: 'Services',
        clusters: 'Clusters',
        nodes: 'Nodes',
        agents: 'Agents',
        warnings: 'Warnings',
        rollingLocked: 'Rolling locked',
        search: 'Search',
        environment: 'Environment',
        health: 'Health',
        topology: 'Topology',
        all: 'All',
        service: 'Service',
        live: 'Live',
        lbDrain: 'LB / drain',
        versions: 'Versions',
        update: 'Update',
        actions: 'Actions',
        scheduler: 'Scheduler',
        loadScheduler: 'Load scheduler plan',
        orchestrator: 'Orchestrator',
        loadOrchestrator: 'Load next action',
        claimNext: 'Claim safe item',
        claiming: 'Claiming...',
        workerIDPrompt: 'Worker id for this guarded claim:',
        executeClaimed: 'Execute claimed item',
        executing: 'Executing...',
        executeReasonPrompt: 'Reason for executing this claimed work item:',
        executeReasonDefault: 'operator approved cloud-management execute',
        confirmExecute: 'Execute the claimed work item through the guarded orchestrator path?',
        planFallback: 'Plan fallback',
        planningFallback: 'Planning...',
        fallbackPlan: 'Fallback plan',
        fallbackOptions: 'Fallback options',
        actionKind: 'Action',
        actionPath: 'Path',
        workItem: 'Work item',
        gates: 'Gates',
        rollout: 'Rollout',
        state: 'State',
        recommended: 'Recommended',
        ready: 'Ready',
        activeLeases: 'Active leases',
        operatorReview: 'Operator review',
        failedBlocked: 'Failed / blocked',
        nextApiCalls: 'Next API calls',
        rescueActions: 'Operator rescue',
        diagnostics: 'Diagnostics',
        audit: 'Audit',
        logs: 'Logs',
        loading: 'Loading cloud status...',
        empty: 'No cloud services match the current filters.',
        failed: 'Cloud status failed',
        confirmProd: 'Confirm prod action for',
        confirmRebuild: 'Rebuild creates a backup first and may run migrations. Continue?',
        rollbackPrompt: 'Rollback restores the selected SQL backup and first creates a new backup of the current state. Enter the backup number or artifact id to restore:',
        rollbackInvalid: 'Rollback cancelled: unknown backup selection.',
    },
    fi: {
        refresh: 'Päivitä',
        services: 'Palvelut',
        clusters: 'Klusterit',
        nodes: 'Nodet',
        agents: 'Agentit',
        warnings: 'Huomiot',
        rollingLocked: 'Rolling lukittu',
        search: 'Haku',
        environment: 'Ympäristö',
        health: 'Health',
        topology: 'Topologia',
        all: 'Kaikki',
        service: 'Palvelu',
        live: 'Live',
        lbDrain: 'LB / drain',
        versions: 'Versiot',
        update: 'Päivitys',
        actions: 'Actionit',
        scheduler: 'Scheduler',
        loadScheduler: 'Lataa scheduler-plan',
        orchestrator: 'Orchestrator',
        loadOrchestrator: 'Lataa seuraava askel',
        claimNext: 'Claim safe item',
        claiming: 'Claimataan...',
        workerIDPrompt: 'Worker-id tälle guardatulle claimille:',
        executeClaimed: 'Execute claimed item',
        executing: 'Suoritetaan...',
        executeReasonPrompt: 'Syy tämän claimatun work itemin suorittamiselle:',
        executeReasonDefault: 'operator approved cloud-management execute',
        confirmExecute: 'Suoritetaanko claimattu work item guardatun orchestrator-polun kautta?',
        planFallback: 'Plan fallback',
        planningFallback: 'Suunnitellaan...',
        fallbackPlan: 'Fallback-plan',
        fallbackOptions: 'Fallback-vaihtoehdot',
        actionKind: 'Action',
        actionPath: 'Polku',
        workItem: 'Work item',
        gates: 'Portit',
        rollout: 'Rollout',
        state: 'Tila',
        recommended: 'Suositus',
        ready: 'Valmiit',
        activeLeases: 'Aktiiviset leaset',
        operatorReview: 'Operator review',
        failedBlocked: 'Failed / blocked',
        nextApiCalls: 'Seuraavat API-kutsut',
        rescueActions: 'Operator rescue',
        diagnostics: 'Diagnostiikka',
        audit: 'Audit',
        logs: 'Lokit',
        loading: 'Ladataan cloud-tilaa...',
        empty: 'Nykyisillä suodattimilla ei löydy cloud-palveluita.',
        failed: 'Cloud-tilan lataus epäonnistui',
        confirmProd: 'Vahvista prod-toiminto kohteelle',
        confirmRebuild: 'Rebuild ottaa ensin varmuuskopion ja voi käynnistää migraatioita. Jatketaanko?',
        rollbackPrompt: 'Rollback palauttaa valitun SQL-varmuuskopion ja tekee ensin uuden backupin nykytilasta. Kirjoita palautettavan backupin numero tai artifact-id:',
        rollbackInvalid: 'Rollback peruttu: tuntematon backup-valinta.',
    },
});

function t(key) {
    const lang = getLanguageWithBrowserFallback();
    return (TEXT[lang] || TEXT.en)[key] || TEXT.en[key] || key;
}

export async function create_cloud_management_view(tableName) {
    registerCloudRoutes();

    const root = document.createElement('section');
    root.className = 'cloud-management-view';
    root.dataset.tableName = tableName;

    const state = {
        filters: {},
        payload: null,
        tableName,
    };

    const toolbar = buildToolbar(state, () => refresh(root, state));
    const statusbar = document.createElement('div');
    statusbar.className = 'cloud-statusbar';
    const diagnostics = document.createElement('div');
    diagnostics.className = 'cloud-diagnostics-shell';
    const tableShell = document.createElement('div');
    tableShell.className = 'cloud-service-table-shell';
    const message = document.createElement('div');
    message.className = 'cloud-view-message';
    message.textContent = t('loading');

    root.append(toolbar, statusbar, diagnostics, message, tableShell);
    await refresh(root, state);
    return root;
}

function registerCloudRoutes() {
    registerEndpointRoute('cloudManagementStatus', CLOUD_MANAGEMENT_ENDPOINTS.status);
    registerEndpointRoute('cloudManagementAction', CLOUD_MANAGEMENT_ENDPOINTS.action);
    registerEndpointRoute('cloudManagementLogs', CLOUD_MANAGEMENT_ENDPOINTS.logsPrefix);
    registerEndpointRoute('cloudManagementSchedulerPlan', CLOUD_MANAGEMENT_ENDPOINTS.schedulerPlanPrefix);
    registerEndpointRoute('cloudManagementOrchestratorNext', CLOUD_MANAGEMENT_ENDPOINTS.orchestratorNextPrefix);
    registerEndpointRoute('cloudManagementOrchestratorClaim', CLOUD_MANAGEMENT_ENDPOINTS.orchestratorClaimPrefix);
    registerEndpointRoute('cloudManagementOrchestratorExecute', CLOUD_MANAGEMENT_ENDPOINTS.orchestratorExecutePrefix);
    registerEndpointRoute('cloudManagementFallbackPlan', CLOUD_MANAGEMENT_ENDPOINTS.fallbackPlanPrefix);
}

function buildToolbar(state, onRefresh) {
    const toolbar = document.createElement('div');
    toolbar.className = 'cloud-management-toolbar';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'cloud-filter-input';
    search.placeholder = t('search');
    search.addEventListener('input', () => {
        state.filters.q = search.value;
        debounceRefresh(toolbar, onRefresh);
    });

    const environment = buildSelect('environment', [
        ['', t('all')],
        ['LOCAL', 'LOCAL'],
        ['DEV', 'DEV'],
        ['STAGING', 'STAGING'],
        ['PROD', 'PROD'],
    ], state, onRefresh);
    const topology = buildSelect('topology', [
        ['', t('all')],
        ['single', 'single'],
        ['cluster', 'cluster'],
    ], state, onRefresh);
    const health = buildSelect('live_health', [
        ['', t('all')],
        ['ok', 'ok'],
        ['attention', 'attention'],
        ['unknown', 'unknown'],
        ['unmodeled', 'unmodeled'],
    ], state, onRefresh);

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'cloud-icon-button';
    refreshButton.title = t('refresh');
    refreshButton.setAttribute('aria-label', t('refresh'));
    refreshButton.textContent = '↻';
    refreshButton.addEventListener('click', onRefresh);

    toolbar.append(
        labeledControl(t('search'), search),
        labeledControl(t('environment'), environment),
        labeledControl(t('topology'), topology),
        labeledControl(t('health'), health),
        refreshButton
    );
    return toolbar;
}

function buildSelect(key, options, state, onRefresh) {
    const select = document.createElement('select');
    select.className = 'cloud-filter-select';
    for (const [value, label] of options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    }
    select.addEventListener('change', () => {
        state.filters[key] = select.value;
        onRefresh();
    });
    return select;
}

function labeledControl(labelText, control) {
    const label = document.createElement('label');
    label.className = 'cloud-filter-field';
    const caption = document.createElement('span');
    caption.textContent = labelText;
    label.append(caption, control);
    return label;
}

function debounceRefresh(toolbar, onRefresh) {
    clearTimeout(toolbar.__cloudRefreshTimer);
    toolbar.__cloudRefreshTimer = setTimeout(onRefresh, 250);
}

async function refresh(root, state) {
    const message = root.querySelector('.cloud-view-message');
    const tableShell = root.querySelector('.cloud-service-table-shell');
    const diagnostics = root.querySelector('.cloud-diagnostics-shell');
    if (message) {
        message.textContent = t('loading');
        message.hidden = false;
    }
    try {
        state.payload = await endpoint_router('cloudManagementStatus', {
            method: 'GET',
            url_params: buildStatusQuery(state.filters),
            suppressAuthRedirect: true,
        });
        renderStatusbar(root, state.payload);
        renderDiagnostics(diagnostics, state.payload);
        renderServiceTable(tableShell, state);
        if (message) {
            const services = Array.isArray(state.payload?.services) ? state.payload.services : [];
            message.textContent = services.length === 0 ? t('empty') : '';
            message.hidden = services.length > 0;
        }
    } catch (error) {
        console.warn('[cloud-management-view] status refresh failed', error);
        if (message) {
            message.textContent = `${t('failed')}: ${error.message || error}`;
            message.hidden = false;
        }
        if (tableShell) tableShell.replaceChildren();
        if (diagnostics) diagnostics.replaceChildren();
    }
}

function renderStatusbar(root, payload) {
    const statusbar = root.querySelector('.cloud-statusbar');
    if (!statusbar) return;
    const summary = summarizeCloudPayload(payload);
    statusbar.replaceChildren(
        metric(t('services'), summary.services),
        metric(t('clusters'), summary.clusters),
        metric(t('nodes'), summary.nodes),
        metric(t('agents'), `${summary.agentOK}/${summary.agentTotal}`),
        metric(t('warnings'), summary.warnings, summary.warnings ? 'warning' : 'neutral'),
        metric(t('rollingLocked'), summary.rollingLocked, 'locked')
    );
}

function metric(label, value, tone = 'neutral') {
    const item = document.createElement('div');
    item.className = `cloud-status-metric cloud-status-metric--${tone}`;
    const valueElement = document.createElement('strong');
    valueElement.textContent = String(value);
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    item.append(valueElement, labelElement);
    return item;
}

function renderDiagnostics(container, payload = {}) {
    if (!container) return;
    container.replaceChildren();
    const agents = Array.isArray(payload.agent_status) ? payload.agent_status : [];
    const warnings = Array.isArray(payload.warnings) ? payload.warnings : [];
    container.append(
        disclosure(t('agents'), agents.map((agent) => `${agent.ok ? 'OK' : 'ERR'} ${agent.name || agent.id}${agent.error ? `: ${agent.error}` : ''}`)),
        disclosure(t('warnings'), warnings)
    );
}

function disclosure(title, lines) {
    const details = document.createElement('details');
    details.className = 'cloud-diagnostics';
    const summary = document.createElement('summary');
    summary.textContent = `${title} (${lines.length})`;
    details.appendChild(summary);
    const list = document.createElement('ul');
    list.className = 'cloud-diagnostics-list';
    if (lines.length === 0) {
        const item = document.createElement('li');
        item.textContent = 'OK';
        list.appendChild(item);
    } else {
        for (const line of lines) {
            const item = document.createElement('li');
            item.textContent = String(line);
            list.appendChild(item);
        }
    }
    details.appendChild(list);
    return details;
}

function renderServiceTable(container, state) {
    if (!container) return;
    container.replaceChildren();
    const services = Array.isArray(state.payload?.services) ? state.payload.services : [];
    if (services.length === 0) return;

    const table = document.createElement('table');
    table.className = 'cloud-service-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['', t('service'), t('topology'), t('environment'), t('live'), t('nodes'), t('lbDrain'), t('versions'), t('update'), t('actions')]
        .forEach((label) => {
            const th = document.createElement('th');
            th.textContent = label;
            headerRow.appendChild(th);
        });
    thead.appendChild(headerRow);
    const tbody = document.createElement('tbody');
    services.forEach((service) => appendServiceRows(tbody, service, state));
    table.append(thead, tbody);
    container.appendChild(table);
}

function appendServiceRows(tbody, service, state) {
    const row = document.createElement('tr');
    row.className = 'cloud-service-row';
    const detailsRow = document.createElement('tr');
    detailsRow.className = 'cloud-service-details-row';
    detailsRow.hidden = true;

    const toggleCell = document.createElement('td');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'cloud-row-toggle';
    toggle.textContent = '›';
    toggle.title = t('diagnostics');
    toggle.addEventListener('click', () => {
        detailsRow.hidden = !detailsRow.hidden;
        toggle.textContent = detailsRow.hidden ? '›' : '⌄';
    });
    toggleCell.appendChild(toggle);

    row.append(
        toggleCell,
        textCell(service.display_name || service.service_key, 'cloud-service-name'),
        textCell(formatTopology(service)),
        textCell(service.environment || ''),
        badgeCell(service.live_health || 'unknown', healthTone(service.live_health)),
        textCell(service.node_summary || ''),
        textCell(service.load_balancer_summary || ''),
        textCell(versionText(service)),
        badgeCell(service.update_status || 'idle', service.update_status === 'idle' ? 'neutral' : 'warning'),
        actionCell(service, null, state)
    );

    const detailCell = document.createElement('td');
    detailCell.colSpan = 10;
    detailCell.append(
        renderNodes(service, state),
        renderSchedulerPlan(service, t),
        renderServiceDiagnostics(service),
        renderAudit(service)
    );
    detailsRow.appendChild(detailCell);
    tbody.append(row, detailsRow);
}

function renderNodes(service, state) {
    const section = document.createElement('div');
    section.className = 'cloud-node-section';
    const table = document.createElement('table');
    table.className = 'cloud-node-table';
    const thead = document.createElement('thead');
    const header = document.createElement('tr');
    ['node', 'role', 'agent', 'drain', 'live', t('actions')].forEach((label) => {
        const th = document.createElement('th');
        th.textContent = label;
        header.appendChild(th);
    });
    thead.appendChild(header);
    const tbody = document.createElement('tbody');
    const nodes = Array.isArray(service.nodes) ? service.nodes : [];
    for (const node of nodes) {
        const row = document.createElement('tr');
        row.append(
            textCell(node.display_name || node.node_key),
            textCell(node.node_role || ''),
            textCell(node.resolved_agent || node.agent_id || ''),
            badgeCell(node.drain_state || 'active', node.drain_state === 'active' ? 'neutral' : 'warning'),
            badgeCell(node.live?.health || node.live?.status || 'unknown', healthTone(node.live?.health || node.live?.status)),
            actionCell(service, node, state)
        );
        tbody.appendChild(row);
    }
    table.append(thead, tbody);
    section.appendChild(table);
    return section;
}

function renderServiceDiagnostics(service) {
    const details = document.createElement('details');
    details.className = 'cloud-row-diagnostics';
    const summary = document.createElement('summary');
    const diagnostics = Array.isArray(service.diagnostics) ? service.diagnostics : [];
    summary.textContent = `${t('diagnostics')} (${diagnostics.length})`;
    details.appendChild(summary);
    const list = document.createElement('ul');
    list.className = 'cloud-diagnostics-list';
    for (const diagnostic of diagnostics) {
        const item = document.createElement('li');
        item.textContent = `${diagnostic.level || 'info'}: ${diagnostic.title || ''} ${diagnostic.message || ''}`.trim();
        list.appendChild(item);
    }
    if (diagnostics.length === 0) {
        const item = document.createElement('li');
        item.textContent = 'OK';
        list.appendChild(item);
    }
    details.appendChild(list);
    return details;
}

function renderAudit(service) {
    const details = document.createElement('details');
    details.className = 'cloud-row-audit';
    const audit = Array.isArray(service.recent_audit) ? service.recent_audit : [];
    const summary = document.createElement('summary');
    summary.textContent = `${t('audit')} (${audit.length})`;
    details.appendChild(summary);
    const list = document.createElement('ul');
    list.className = 'cloud-audit-list';
    for (const entry of audit.slice(0, 20)) {
        const item = document.createElement('li');
        item.textContent = `${entry.created || ''} ${entry.action || ''} ${entry.status || ''} ${entry.reason || ''}`.trim();
        list.appendChild(item);
    }
    details.appendChild(list);
    return details;
}

function actionCell(service, node, state) {
    const cell = document.createElement('td');
    const actions = visibleActions(node ? node.actions : service.actions);
    const group = document.createElement('div');
    group.className = 'cloud-action-group';
    for (const action of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cloud-action-button';
        button.dataset.action = action.key;
        button.disabled = !action.enabled;
        button.title = action.enabled ? action.label : action.reason || action.label;
        button.textContent = actionLabel(action.key, action.label);
        if (action.enabled) {
            button.addEventListener('click', () => runAction(action.key, service, node, state));
        }
        group.appendChild(button);
    }
    cell.appendChild(group);
    return cell;
}

async function runAction(actionKey, service, node, state) {
    if (actionKey === 'logs') {
        await openLogs(service, node);
        return;
    }
    if (!ACTION_METHODS.has(actionKey)) {
        return;
    }
    const targetNode = resolveCloudActionNode(actionKey, service, node);
    if (actionKey === 'rebuild' && !window.confirm(t('confirmRebuild'))) {
        return;
    }
    const artifact = actionKey === 'rollback' ? selectRollbackArtifact(targetNode) : '';
    if (actionKey === 'rollback' && !artifact) {
        return;
    }
    let confirmProd = false;
    if (cloudTargetRequiresProdConfirmation(service, targetNode)) {
        const targetName = targetNode?.display_name || service.display_name || service.service_key || '';
        confirmProd = window.confirm(`${t('confirmProd')} ${targetName}?`);
        if (!confirmProd) {
            return;
        }
    }
    const payload = buildCloudActionPayload(actionKey, service, targetNode, { artifact, confirmProd });
    await endpoint_router('cloudManagementAction', {
        method: 'POST',
        body_data: payload,
        suppressAuthRedirect: true,
    });
    const root = document.querySelector(`.cloud-management-view[data-table-name="${state.tableName}"]`);
    if (root) {
        await refresh(root, state);
    }
}

function selectRollbackArtifact(node) {
    const artifacts = rollbackArtifactsForNode(node);
    if (artifacts.length === 0) {
        window.alert(t('rollbackInvalid'));
        return '';
    }
    const answer = window.prompt(`${t('rollbackPrompt')}\n\n${rollbackArtifactPromptOptions(artifacts)}`);
    const artifact = selectedRollbackArtifactId(artifacts, answer);
    if (!artifact) {
        window.alert(t('rollbackInvalid'));
    }
    return artifact;
}

async function openLogs(service, node) {
    const target = node?.node_key || service?.nodes?.[0]?.node_key || '';
    if (!target) return;
    const encodedTarget = encodeURIComponent(target);
    const payload = await endpoint_router('cloudManagementLogs', {
        method: 'GET',
        url_params: `${encodedTarget}?lines=240`,
        suppressAuthRedirect: true,
    });
    renderLogDialog(target, payload);
}

function renderLogDialog(target, payload = {}) {
    const existing = document.querySelector('.cloud-log-dialog');
    if (existing) existing.remove();
    const dialog = document.createElement('dialog');
    dialog.className = 'cloud-log-dialog';
    const header = document.createElement('div');
    header.className = 'cloud-log-dialog-header';
    const title = document.createElement('strong');
    title.textContent = `${t('logs')} · ${target}`;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Close';
    close.addEventListener('click', () => dialog.close());
    header.append(title, close);
    const pre = document.createElement('pre');
    pre.textContent = Array.isArray(payload.lines)
        ? payload.lines.join('\n')
        : String(payload.logs || payload.output || payload.text || '');
    dialog.append(header, pre);
    document.body.appendChild(dialog);
    dialog.addEventListener('close', () => dialog.remove(), { once: true });
    dialog.showModal();
}

function textCell(value, className = '') {
    const cell = document.createElement('td');
    if (className) cell.classList.add(className);
    cell.textContent = String(value || '');
    return cell;
}

function badgeCell(value, tone) {
    const cell = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `cloud-badge cloud-badge--${tone}`;
    badge.textContent = String(value || '');
    cell.appendChild(badge);
    return cell;
}

function versionText(service) {
    const current = service.current_version || '';
    const target = service.target_version || '';
    if (current && target && current !== target) {
        return `${current} → ${target}`;
    }
    return current || target || '';
}

function actionLabel(key, fallback) {
    const labels = {
        logs: '≡',
        preflight: '✓',
        smoke: '◎',
        start: '▶',
        stop: '■',
        restart: '↻',
        backup: '⬇',
        rebuild: '⟳',
        rollback: '↶',
        rolling_update: '⇄',
    };
    return labels[key] || fallback || key;
}
