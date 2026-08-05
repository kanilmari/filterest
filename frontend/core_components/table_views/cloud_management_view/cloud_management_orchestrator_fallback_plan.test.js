// cloud_management_orchestrator_fallback_plan.test.js
// Verifies non-mutating orchestrator fallback planning in the cloud view.
// Bridges orchestrator-next recovery guidance and the fallback-plan route.
// Exists so operator-review planning does not regress into hidden or mutating UI.

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

describe('cloud management orchestrator fallback planning', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        endpointRouterMock.mockReset();
        registerEndpointRouteMock.mockReset();
        vi.restoreAllMocks();
    });

    it('opens fallback-plan guidance for server-selected recovery without executing fallback', async () => {
        endpointRouterMock
            .mockResolvedValueOnce(statusWithRecoveryNext())
            .mockResolvedValueOnce({
                ok: true,
                rollout: { rollout_id: 'rollout-recovery' },
                work_item: { id: 42, service_key: 'filterest.com', work_status: 'failed' },
                fallback_plan: {
                    work_item_id: 42,
                    recommended_option: 'retry_failed_step',
                    non_mutating_planning_only: true,
                    mutates_lifecycle_or_traffic: false,
                },
                options: [{
                    key: 'retry_failed_step',
                    available: true,
                    mutating: true,
                    next_api_calls: [
                        'POST /api/instances/rollouts/rollout-recovery/work-items/fallback-execute',
                    ],
                }],
            });

        const { create_cloud_management_view } = await import('./cloud_management_view_printer.js');
        const element = await create_cloud_management_view('app_cloud_services');
        document.body.appendChild(element);
        element.querySelector('.cloud-orchestrator-fallback-plan-button')?.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(registerEndpointRouteMock).toHaveBeenCalledWith('cloudManagementFallbackPlan', '/api/instances/rollouts/');
        expect(endpointRouterMock).toHaveBeenCalledWith('cloudManagementFallbackPlan', expect.objectContaining({
            method: 'POST',
            url_params: 'rollout-recovery/work-items/fallback-plan',
            body_data: { work_item_id: 42 },
            suppressAuthRedirect: true,
        }));
        expect(endpointRouterMock).not.toHaveBeenCalledWith('cloudManagementOrchestratorExecute', expect.anything());
        expect(element.querySelector('.cloud-orchestrator-fallback-plan')?.textContent)
            .toContain('retry_failed_step');
        expect(element.querySelector('.cloud-orchestrator-fallback-plan')?.textContent)
            .toContain('/work-items/fallback-execute');
    });
});

function statusWithRecoveryNext() {
    return {
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
            live_health: 'attention',
            update_status: 'recovery',
            current_rollout: { rollout_id: 'rollout-recovery' },
            orchestrator_next: {
                rollout: { rollout_id: 'rollout-recovery' },
                orchestration: {
                    state: 'recovery_required',
                    recommended_action: 'recover_work_items',
                },
                action: {
                    kind: 'plan_recovery',
                    recommended_action: 'recover_work_items',
                    method: 'POST',
                    path: '/api/instances/rollouts/rollout-recovery/work-items/fallback-plan',
                    work_item_id: 42,
                    service_key: 'filterest.com',
                    current_step: 'backup',
                    work_status: 'failed',
                    requires_mutation: false,
                    operator_required: true,
                    automation_paused: true,
                    request_template: { work_item_id: 42 },
                },
            },
            actions: [],
            nodes: [],
            diagnostics: [],
            recent_audit: [],
        }],
    };
}
