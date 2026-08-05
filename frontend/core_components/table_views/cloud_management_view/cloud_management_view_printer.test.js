// cloud_management_view_printer.test.js
// Verifies the management-Easelect cloud view renders the first milestone shell.
// Bridges mocked protected route payloads and the DOM statusbar/table surface.
// Exists to keep the live-adapter presentation from regressing into an empty generic table.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const endpointRouterMock = vi.fn();
const registerEndpointRouteMock = vi.fn();

vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock('../../pipeline/api_pipeline.js', () => ({
    registerEndpointRoute: registerEndpointRouteMock,
}));

vi.mock('../../state_stores/lang_preference_reader.js', () => ({
    getLanguageWithBrowserFallback: () => 'en',
}));

describe('cloud_management_view_printer', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        endpointRouterMock.mockReset();
        registerEndpointRouteMock.mockReset();
        vi.restoreAllMocks();
    });

    it('renders status metrics, diagnostics, services, nodes, and disabled action reasons', async () => {
        endpointRouterMock.mockResolvedValueOnce({
            ok: true,
            summary: {
                services: 1,
                clusters: 1,
                nodes: 2,
                live_ok: 1,
                warnings: 0,
                agent_ok: 1,
                agent_total: 1,
                rolling_locked: 1,
            },
            agent_status: [{ id: 'local', name: 'Local', ok: true }],
            warnings: [],
            services: [{
                id: 4,
                service_key: 'serlog.com',
                display_name: 'Serlog',
                environment: 'DEV',
                topology: 'cluster',
                live_health: 'ok',
                node_summary: '2 nodes, 1 live',
                load_balancer_summary: '1 LB, 1 drain-capable, 0 drained/disabled nodes',
                current_version: '8.0.99',
                target_version: '8.0.99',
                update_status: 'idle',
                scheduler_plan: {
                    rollout: { rollout_id: 'rollout-123', scope: 'all' },
                    summary: {
                        claimable_items: 1,
                        active_leases: 1,
                        failed_items: 0,
                        blocked_items: 0,
                    },
                    orchestration: {
                        scope: 'selected_all',
                        state: 'waiting_for_siblings',
                        recommended_action: 'execute_or_renew_pre_traffic_sibling',
                        ready_work_item_ids: [2],
                        active_lease_work_item_ids: [3],
                        next_api_calls: [
                            'POST /api/instances/rollouts/rollout-123/lease/execute',
                            'POST /api/instances/rollouts/rollout-123/lease/renew',
                        ],
                    },
                    traffic_promotion: {
                        state: 'waiting_for_siblings',
                        recommended_action: 'wait_for_siblings',
                    },
                },
                orchestrator_next: {
                    rollout: { rollout_id: 'rollout-123' },
                    orchestration: {
                        state: 'waiting_for_siblings',
                        recommended_action: 'execute_or_renew_pre_traffic_sibling',
                    },
                    action: {
                        kind: 'execute_active_lease',
                        recommended_action: 'execute_or_renew_pre_traffic_sibling',
                        method: 'POST',
                        path: '/api/instances/rollouts/rollout-123/work-items/orchestrator-execute',
                        work_item_id: 3,
                        service_key: 'serlog.com',
                        current_step: 'backup',
                        work_status: 'leased',
                        requires_mutation: true,
                        requires_worker_id: true,
                        requires_lease_token: true,
                        requires_idempotency_key: true,
                        requires_confirm_prod: true,
                    },
                },
                actions: [
                    { key: 'restart', label: 'Restart', enabled: false, visible: true, reason: 'cluster lifecycle actions target nodes in this milestone' },
                ],
                nodes: [{
                    id: 8,
                    node_key: 'agent:local:serlog',
                    display_name: 'serlog-a',
                    node_role: 'app',
                    resolved_agent: 'local',
                    drain_state: 'active',
                    live: { health: 'ok' },
                    actions: [
                        { key: 'restart', label: 'Restart', enabled: true, visible: true },
                    ],
                }],
                diagnostics: [
                    { level: 'info', title: 'Rolling update modeled', message: 'Automation locked.' },
                ],
                recent_audit: [],
            }],
        });

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);

        expect(registerEndpointRouteMock).toHaveBeenCalledWith('cloudManagementStatus', '/api/instances/status');
        expect(registerEndpointRouteMock).toHaveBeenCalledWith('cloudManagementSchedulerPlan', '/api/instances/rollouts/');
        expect(registerEndpointRouteMock).toHaveBeenCalledWith('cloudManagementOrchestratorNext', '/api/instances/rollouts/');
        expect(registerEndpointRouteMock).toHaveBeenCalledWith('cloudManagementOrchestratorClaim', '/api/instances/rollouts/');
        expect(registerEndpointRouteMock).toHaveBeenCalledWith('cloudManagementOrchestratorExecute', '/api/instances/rollouts/');
        expect(registerEndpointRouteMock).toHaveBeenCalledWith('cloudManagementFallbackPlan', '/api/instances/rollouts/');
        expect(element.querySelector('.cloud-statusbar')?.textContent).toContain('Services');
        expect(element.querySelector('.cloud-statusbar')?.textContent).toContain('1');
        expect(element.querySelector('.cloud-service-table')?.textContent).toContain('Serlog');
        expect(element.querySelector('.cloud-service-table')?.textContent).toContain('cluster / 1');
        expect(element.querySelector('.cloud-row-scheduler')?.textContent).toContain('waiting_for_siblings');
        expect(element.querySelector('.cloud-row-scheduler')?.textContent).toContain('execute_or_renew_pre_traffic_sibling');
        expect(element.querySelector('.cloud-row-scheduler')?.textContent).toContain('/lease/execute');
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('execute_active_lease');
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('/work-items/orchestrator-execute');
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('lease_token');
        expect(element.querySelector('.cloud-action-button')?.title)
            .toBe('cluster lifecycle actions target nodes in this milestone');
    });

    it('loads a rollout scheduler plan through the native instances API when service status exposes a rollout id', async () => {
        endpointRouterMock
            .mockResolvedValueOnce({
                ok: true,
                summary: {
                    services: 1,
                    clusters: 0,
                    nodes: 1,
                    live_ok: 1,
                    warnings: 0,
                    agent_ok: 1,
                    agent_total: 1,
                    rolling_locked: 1,
                },
                agent_status: [{ id: 'local', name: 'Local', ok: true }],
                warnings: [],
                services: [{
                    id: 4,
                    service_key: 'filterest.com',
                    display_name: 'Filterest',
                    environment: 'DEV',
                    topology: 'single',
                    live_health: 'ok',
                    node_summary: '1 node, 1 live',
                    load_balancer_summary: 'none',
                    update_status: 'updating',
                    current_rollout: { rollout_id: 'rollout-456' },
                    actions: [],
                    nodes: [],
                    diagnostics: [],
                    recent_audit: [],
                }],
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-456', scope: 'all' },
                summary: { claimable_items: 1, active_leases: 0 },
                orchestration: {
                    scope: 'selected_all',
                    state: 'ready_to_claim',
                    recommended_action: 'claim_next_work_item',
                    ready_work_item_ids: [9],
                    next_api_calls: [
                        'POST /api/instances/rollouts/rollout-456/lease',
                        'POST /api/instances/rollouts/rollout-456/lease/execute',
                    ],
                },
            });

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);
        element.querySelector('.cloud-scheduler-load-button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementSchedulerPlan', expect.objectContaining({
            method: 'GET',
            url_params: 'rollout-456/work-items/scheduler-plan',
            suppressAuthRedirect: true,
        }));
        expect(element.querySelector('.cloud-row-scheduler')?.textContent).toContain('ready_to_claim');
        expect(element.querySelector('.cloud-row-scheduler')?.textContent).toContain('claim_next_work_item');
    });

    it('loads orchestrator-next guidance through the native instances API when a rollout id exists', async () => {
        endpointRouterMock
            .mockResolvedValueOnce({
                ok: true,
                summary: {
                    services: 1,
                    clusters: 0,
                    nodes: 1,
                    live_ok: 1,
                    warnings: 0,
                    agent_ok: 1,
                    agent_total: 1,
                    rolling_locked: 1,
                },
                agent_status: [{ id: 'local', name: 'Local', ok: true }],
                warnings: [],
                services: [{
                    id: 4,
                    service_key: 'filterest.com',
                    display_name: 'Filterest',
                    environment: 'DEV',
                    topology: 'single',
                    live_health: 'ok',
                    node_summary: '1 node, 1 live',
                    load_balancer_summary: 'none',
                    update_status: 'updating',
                    current_rollout: { rollout_id: 'rollout-789' },
                    actions: [],
                    nodes: [],
                    diagnostics: [],
                    recent_audit: [],
                }],
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-789' },
                orchestration: {
                    state: 'ready_to_claim',
                    recommended_action: 'claim_next_work_item',
                },
                action: {
                    kind: 'claim_work_item',
                    recommended_action: 'claim_next_work_item',
                    method: 'POST',
                    path: '/api/instances/rollouts/rollout-789/work-items/orchestrator-claim',
                    work_item_id: 9,
                    service_key: 'filterest.com',
                    current_step: 'backup',
                    work_status: 'queued',
                    requires_mutation: true,
                    requires_worker_id: true,
                },
            });

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);
        element.querySelector('.cloud-orchestrator-load-button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementOrchestratorNext', expect.objectContaining({
            method: 'GET',
            url_params: 'rollout-789/work-items/orchestrator-next',
            suppressAuthRedirect: true,
        }));
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('claim_work_item');
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('/work-items/orchestrator-claim');
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('worker_id');
    });

    it('claims and executes the server-selected orchestrator work item with expected guards', async () => {
        vi.spyOn(window, 'prompt')
            .mockReturnValueOnce('operator-ui')
            .mockReturnValueOnce('operator approved execute');
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        endpointRouterMock
            .mockResolvedValueOnce({
                ok: true,
                summary: {
                    services: 1,
                    clusters: 0,
                    nodes: 1,
                    live_ok: 1,
                    warnings: 0,
                    agent_ok: 1,
                    agent_total: 1,
                    rolling_locked: 1,
                },
                agent_status: [{ id: 'local', name: 'Local', ok: true }],
                warnings: [],
                services: [{
                    id: 4,
                    service_key: 'filterest.com',
                    display_name: 'Filterest',
                    environment: 'DEV',
                    topology: 'single',
                    live_health: 'ok',
                    orchestrator_next: {
                        rollout: { rollout_id: 'rollout-claim' },
                        orchestration: {
                            state: 'ready_to_claim',
                            recommended_action: 'claim_next_work_item',
                        },
                        action: {
                            kind: 'claim_work_item',
                            recommended_action: 'claim_next_work_item',
                            method: 'POST',
                            path: '/api/instances/rollouts/rollout-claim/work-items/orchestrator-claim',
                            work_item_id: 9,
                            service_key: 'filterest.com',
                            current_step: 'backup',
                            work_status: 'queued',
                            requires_mutation: true,
                            requires_worker_id: true,
                            request_template: {
                                lease_seconds: 900,
                                expected_work_item_id: 9,
                                expected_service_key: 'filterest.com',
                            },
                        },
                    },
                    actions: [],
                    nodes: [],
                    diagnostics: [],
                    recent_audit: [],
                }],
            })
            .mockResolvedValueOnce({
                ok: true,
                claimed_action: { kind: 'claim_work_item', work_item_id: 9 },
                lease: {
                    work_item: {
                        id: 9,
                        service_key: 'filterest.com',
                        current_step: 'backup',
                        work_status: 'leased',
                        lease_owner: 'operator-ui',
                        lease_token: 'lease-token',
                    },
                },
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-claim', scope: 'all' },
                summary: { claimable_items: 0, active_leases: 1 },
                orchestration: {
                    state: 'active_leases',
                    recommended_action: 'execute_active_lease',
                    active_lease_work_item_ids: [9],
                    next_api_calls: ['POST /api/instances/rollouts/rollout-claim/lease/execute'],
                },
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-claim' },
                orchestration: {
                    state: 'active_leases',
                    recommended_action: 'execute_active_lease',
                },
                action: {
                    kind: 'execute_active_lease',
                    recommended_action: 'execute_active_lease',
                    method: 'POST',
                    path: '/api/instances/rollouts/rollout-claim/work-items/orchestrator-execute',
                    work_item_id: 9,
                    service_key: 'filterest.com',
                    current_step: 'backup',
                    work_status: 'leased',
                    requires_mutation: true,
                    requires_worker_id: true,
                    requires_lease_token: true,
                    requires_idempotency_key: true,
                    requires_confirm_prod: true,
                },
            })
            .mockResolvedValueOnce({
                ok: true,
                executed_action: { kind: 'execute_active_lease', work_item_id: 9 },
                execution: { ok: true },
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-claim', scope: 'all' },
                summary: { claimable_items: 0, active_leases: 0 },
                orchestration: {
                    state: 'waiting_for_siblings',
                    recommended_action: 'wait_for_state_change',
                    ready_work_item_ids: [],
                },
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-claim' },
                orchestration: {
                    state: 'waiting_for_siblings',
                    recommended_action: 'wait_for_state_change',
                },
                action: {
                    kind: 'wait_for_state_change',
                    recommended_action: 'wait_for_state_change',
                    method: 'GET',
                    path: '/api/instances/rollouts/rollout-claim/work-items/scheduler-plan',
                    automation_paused: true,
                },
            });

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);
        element.querySelector('.cloud-orchestrator-claim-button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementOrchestratorClaim', expect.objectContaining({
            method: 'POST',
            url_params: 'rollout-claim/work-items/orchestrator-claim',
            body_data: {
                worker_id: 'operator-ui',
                lease_seconds: 900,
                expected_work_item_id: 9,
                expected_service_key: 'filterest.com',
            },
            suppressAuthRedirect: true,
        }));
        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementOrchestratorNext', expect.objectContaining({
            method: 'GET',
            url_params: 'rollout-claim/work-items/orchestrator-next',
            suppressAuthRedirect: true,
        }));
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('execute_active_lease');
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('lease_token');
        element.querySelector('.cloud-orchestrator-execute-button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementOrchestratorExecute', expect.objectContaining({
            method: 'POST',
            url_params: 'rollout-claim/work-items/orchestrator-execute',
            body_data: expect.objectContaining({
                work_item_id: 9,
                worker_id: 'operator-ui',
                lease_token: 'lease-token',
                step: 'backup',
                reason: 'operator approved execute',
                confirm_prod: true,
                expected_work_item_id: 9,
                expected_service_key: 'filterest.com',
                expected_current_step: 'backup',
            }),
            suppressAuthRedirect: true,
        }));
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).toContain('wait_for_state_change');
        expect(element.querySelector('.cloud-orchestrator-next')?.textContent).not.toContain('lease_token');
    });

    it('renders recovery-required scheduler plans from the native instances API without lease execution guidance', async () => {
        endpointRouterMock
            .mockResolvedValueOnce({
                ok: true,
                summary: {
                    services: 1,
                    clusters: 0,
                    nodes: 1,
                    live_ok: 1,
                    warnings: 0,
                    agent_ok: 1,
                    agent_total: 1,
                    rolling_locked: 1,
                },
                agent_status: [{ id: 'local', name: 'Local', ok: true }],
                warnings: [],
                services: [{
                    id: 4,
                    service_key: 'filterest.com',
                    display_name: 'Filterest',
                    environment: 'DEV',
                    topology: 'single',
                    live_health: 'ok',
                    node_summary: '1 node, 1 live',
                    load_balancer_summary: 'none',
                    update_status: 'updating',
                    current_rollout: { rollout_id: 'rollout-recovery' },
                    actions: [],
                    nodes: [],
                    diagnostics: [],
                    recent_audit: [],
                }],
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-recovery', scope: 'selected' },
                summary: { claimable_items: 1, failed_items: 1, blocked_items: 1 },
                orchestration: {
                    scope: 'selected_all',
                    state: 'recovery_required',
                    recommended_action: 'recover_work_items',
                    failed_work_item_ids: [11],
                    blocked_work_item_ids: [12],
                    next_api_calls: [
                        'POST /api/instances/rollouts/rollout-recovery/work-items/fallback-plan',
                        'POST /api/instances/rollouts/rollout-recovery/work-items/fallback-execute',
                        'POST /api/instances/rollouts/rollout-recovery/work-items/requeue',
                    ],
                },
            });

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);
        element.querySelector('.cloud-scheduler-load-button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const schedulerText = element.querySelector('.cloud-row-scheduler')?.textContent || '';
        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementSchedulerPlan', expect.objectContaining({
            method: 'GET',
            url_params: 'rollout-recovery/work-items/scheduler-plan',
            suppressAuthRedirect: true,
        }));
        expect(schedulerText).toContain('recovery_required');
        expect(schedulerText).toContain('recover_work_items');
        expect(schedulerText).toContain('Failed / blocked');
        expect(schedulerText).toContain('/work-items/fallback-execute');
        expect(schedulerText).toContain('/work-items/requeue');
        expect(schedulerText).not.toContain('/lease/execute');
    });

    it('renders mixed-state rescue actions from scheduler plans without lease execution guidance', async () => {
        endpointRouterMock
            .mockResolvedValueOnce({
                ok: true,
                summary: {
                    services: 1,
                    clusters: 0,
                    nodes: 1,
                    live_ok: 1,
                    warnings: 0,
                    agent_ok: 1,
                    agent_total: 1,
                    rolling_locked: 1,
                },
                agent_status: [{ id: 'local', name: 'Local', ok: true }],
                warnings: [],
                services: [{
                    id: 4,
                    service_key: 'filterest.com',
                    display_name: 'Filterest',
                    environment: 'DEV',
                    topology: 'single',
                    live_health: 'ok',
                    node_summary: '1 node, 1 live',
                    load_balancer_summary: 'none',
                    update_status: 'updating',
                    current_rollout: { rollout_id: 'rollout-mixed' },
                    actions: [],
                    nodes: [],
                    diagnostics: [],
                    recent_audit: [],
                }],
            })
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-mixed', scope: 'all' },
                summary: { claimable_items: 1 },
                orchestration: {
                    scope: 'selected_all',
                    state: 'operator_review_required',
                    recommended_action: 'review_mixed_traffic_state',
                    operator_review_work_item_ids: [2],
                    rescue_actions: [{
                        work_item_id: 2,
                        service_key: 'serlog.com',
                        current_step: 'drain_source',
                        service_rollout_status: 'promoted',
                        work_status: 'queued',
                        recommended_action: 'plan_rollback_before_completion',
                        next_api_calls: [
                            'POST /api/instances/rollouts/rollout-mixed/work-items/fallback-plan',
                        ],
                        blockers: [
                            'rollback-before-completion remains operator-gated in mixed selected/all traffic state',
                        ],
                    }],
                },
                traffic_promotion: {
                    state: 'mixed_state_review',
                    recommended_action: 'plan_operator_rescue',
                    next_api_calls: [
                        'POST /api/instances/rollouts/rollout-mixed/work-items/fallback-plan',
                    ],
                },
            });

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);
        element.querySelector('.cloud-scheduler-load-button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        const schedulerText = element.querySelector('.cloud-row-scheduler')?.textContent || '';
        expect(schedulerText).toContain('operator_review_required');
        expect(schedulerText).toContain('review_mixed_traffic_state');
        expect(schedulerText).toContain('Operator rescue');
        expect(schedulerText).toContain('serlog.com');
        expect(schedulerText).toContain('plan_rollback_before_completion');
        expect(schedulerText).toContain('/work-items/fallback-plan');
        expect(schedulerText).not.toContain('/lease/execute');
    });

    it('sends single-node lifecycle actions with prod confirmation to the agent-backed node target', async () => {
        const payload = {
            ok: true,
            summary: {
                services: 1,
                clusters: 0,
                nodes: 1,
                live_ok: 1,
                warnings: 0,
                agent_ok: 1,
                agent_total: 1,
                rolling_locked: 1,
            },
            agent_status: [{ id: 'local', name: 'Local', ok: true }],
            warnings: [],
            services: [{
                id: 4,
                service_key: 'local-native',
                display_name: 'Local native',
                environment: 'PROD',
                topology: 'single',
                live_health: 'ok',
                node_summary: '1 nodes, 1 live',
                load_balancer_summary: 'none',
                update_status: 'idle',
                actions: [
                    { key: 'restart', label: 'Restart', enabled: true, visible: true },
                ],
                nodes: [{
                    id: 8,
                    node_key: 'local:local-native',
                    display_name: 'local-native',
                    resolved_agent: 'local',
                    drain_state: 'active',
                    live: { environment: 'PROD', health: 'ok', can_restart: true },
                    actions: [
                        { key: 'restart', label: 'Restart', enabled: true, visible: true },
                    ],
                }],
                diagnostics: [],
                recent_audit: [],
            }],
        };
        endpointRouterMock
            .mockResolvedValueOnce(payload)
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce(payload);
        const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);
        element.querySelector('.cloud-action-button[data-action="restart"]')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementAction', expect.objectContaining({
            method: 'POST',
            body_data: {
                target_type: 'node',
                target_id: 8,
                target_key: 'local:local-native',
                action: 'restart',
                confirm_prod: true,
                artifact: '',
            },
            suppressAuthRedirect: true,
        }));
        confirmSpy.mockRestore();
    });
});
