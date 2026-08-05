// cloud_management_view_helpers.test.js
// Verifies pure cloud-management view helpers.
// Bridges backend payload shape and frontend status/filter presentation.
// Exists so cloud/live filtering and action visibility stay stable without browser route setup.

import { describe, expect, it } from 'vitest';
import {
    buildOrchestratorClaimPayload,
    buildOrchestratorExecutePayload,
    buildOrchestratorFallbackPlanPayload,
    buildCloudActionPayload,
    buildStatusQuery,
    canClaimOrchestratorNext,
    canExecuteClaimedOrchestratorNext,
    canPlanOrchestratorFallback,
    cloudTargetRequiresProdConfirmation,
    formatTopology,
    healthTone,
    orchestratorClaimForService,
    orchestratorNextForService,
    orchestratorClaimURLParams,
    orchestratorExecuteURLParams,
    orchestratorFallbackPlanURLParams,
    orchestratorNextURLParams,
    rollbackArtifactPromptOptions,
    rollbackArtifactsForNode,
    rolloutIDForService,
    schedulerPlanForService,
    schedulerPlanURLParams,
    selectedRollbackArtifactId,
    summarizeCloudPayload,
    summarizeOrchestratorNext,
    summarizeSchedulerPlan,
    visibleActions,
} from './cloud_management_view_helpers.js';

describe('cloud_management_view_helpers', () => {
    it('summarizes backend payloads with fallbacks', () => {
        const payload = {
            services: [
                { topology: 'single', live_health: 'ok', nodes: [{ id: 1 }] },
                { topology: 'cluster', live_health: 'attention', nodes: [{ id: 2 }, { id: 3 }] },
            ],
            agent_status: [{ ok: true }, { ok: false }],
            warnings: ['agent offline'],
        };

        expect(summarizeCloudPayload(payload)).toMatchObject({
            services: 2,
            clusters: 1,
            nodes: 3,
            liveOK: 1,
            warnings: 1,
            agentTotal: 2,
        });
    });

    it('keeps disabled actions visible only when backend says so', () => {
        const actions = [
            { key: 'restart', visible: true, enabled: true },
            { key: 'rollback', visible: false, enabled: false },
        ];

        expect(visibleActions(actions).map((action) => action.key)).toEqual(['restart']);
    });

    it('formats live query filters for the cloud status adapter', () => {
        expect(buildStatusQuery({
            q: 'serlog',
            environment: 'DEV',
            live_health: 'ok',
            ignored: 'x',
        })).toBe('?q=serlog&environment=DEV&live_health=ok');
    });

    it('formats topology and health tones', () => {
        expect(formatTopology({ topology: 'cluster', nodes: [{}, {}] })).toBe('cluster / 2');
        expect(formatTopology({ topology: 'single', nodes: [{}] })).toBe('single');
        expect(healthTone('ok')).toBe('ok');
        expect(healthTone('attention')).toBe('warning');
        expect(healthTone('unknown')).toBe('neutral');
    });

    it('builds lifecycle action payloads against a concrete single-node service target', () => {
        const service = {
            id: 4,
            service_key: 'serlog.com',
            nodes: [{ id: 8, node_key: 'local:serlog' }],
        };

        expect(buildCloudActionPayload('restart', service, null, { confirmProd: true })).toEqual({
            target_type: 'node',
            target_id: 8,
            target_key: 'local:serlog',
            action: 'restart',
            confirm_prod: true,
            artifact: '',
        });
        expect(buildCloudActionPayload('smoke', service)).toMatchObject({
            target_type: 'service',
            target_id: 4,
            target_key: 'serlog.com',
            action: 'smoke',
        });
    });

    it('detects production targets and resolves rollback selections', () => {
        const node = {
            live: {
                environment: 'PROD',
                rollback_artifacts: [
                    { id: 'backup_1.sql', name: 'First backup', size: '4 KB', modified: '2026-05-27' },
                    { id: 'backup_2.sql', name: 'Second backup' },
                ],
            },
        };
        const artifacts = rollbackArtifactsForNode(node);

        expect(cloudTargetRequiresProdConfirmation({ environment: 'DEV' }, node)).toBe(true);
        expect(rollbackArtifactPromptOptions(artifacts)).toContain('1. First backup (4 KB, 2026-05-27)');
        expect(selectedRollbackArtifactId(artifacts, '2')).toBe('backup_2.sql');
        expect(selectedRollbackArtifactId(artifacts, 'backup_1.sql')).toBe('backup_1.sql');
        expect(selectedRollbackArtifactId(artifacts, 'nope')).toBe('');
    });

    it('summarizes rollout scheduler plans from current service contracts', () => {
        const plan = {
            rollout: { rollout_id: 'rollout-123', scope: 'all' },
            summary: {
                claimable_items: 2,
                active_leases: 1,
                failed_items: 0,
                blocked_items: 1,
                recommended_action: 'claim_next_work_item',
            },
            orchestration: {
                scope: 'selected_all',
                state: 'waiting_for_siblings',
                recommended_action: 'execute_or_renew_pre_traffic_sibling',
                ready_work_item_ids: [4],
                active_lease_work_item_ids: [5],
                operator_review_work_item_ids: [6, 7],
                next_api_calls: [
                    'POST /api/instances/rollouts/rollout-123/lease/execute',
                    'POST /api/instances/rollouts/rollout-123/lease/renew',
                ],
            },
            traffic_promotion: {
                state: 'waiting_for_siblings',
                recommended_action: 'wait_for_siblings',
            },
        };

        const service = { current_rollout: { rollout_id: 'rollout-123', scheduler_plan: plan } };
        expect(schedulerPlanForService(service)).toBe(plan);
        expect(rolloutIDForService(service)).toBe('rollout-123');
        expect(schedulerPlanURLParams('rollout-123')).toBe('rollout-123/work-items/scheduler-plan');
        expect(summarizeSchedulerPlan(plan)).toMatchObject({
            rolloutID: 'rollout-123',
            scope: 'selected_all',
            state: 'waiting_for_siblings',
            recommendedAction: 'execute_or_renew_pre_traffic_sibling',
            readyItems: 1,
            activeLeases: 1,
            operatorReviewItems: 2,
            failedItems: 0,
            blockedItems: 1,
        });
    });

    it('summarizes rollout orchestrator-next execute actions from current service contracts', () => {
        const orchestratorNext = {
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
                work_item_id: 5,
                service_key: 'serlog.com',
                current_step: 'backup',
                work_status: 'leased',
                requires_mutation: true,
                requires_worker_id: true,
                requires_lease_token: true,
                requires_idempotency_key: true,
                requires_confirm_prod: true,
            },
        };

        const service = { current_rollout: { orchestrator_next: orchestratorNext } };
        expect(orchestratorNextForService(service)).toBe(orchestratorNext);
        expect(rolloutIDForService(service)).toBe('rollout-123');
        expect(orchestratorNextURLParams('rollout-123')).toBe('rollout-123/work-items/orchestrator-next');
        expect(summarizeOrchestratorNext(orchestratorNext)).toMatchObject({
            rolloutID: 'rollout-123',
            state: 'waiting_for_siblings',
            kind: 'execute_active_lease',
            recommendedAction: 'execute_or_renew_pre_traffic_sibling',
            method: 'POST',
            path: '/api/instances/rollouts/rollout-123/work-items/orchestrator-execute',
            workItemID: 5,
            serviceKey: 'serlog.com',
            currentStep: 'backup',
            workStatus: 'leased',
            gates: ['mutation', 'worker_id', 'lease_token', 'idempotency_key', 'confirm_prod'],
        });
    });

    it('builds guarded orchestrator claim payloads from server-selected actions', () => {
        const orchestratorNext = {
            action: {
                kind: 'claim_work_item',
                work_item_id: 9,
                service_key: 'filterest.com',
                requires_mutation: true,
                requires_worker_id: true,
                request_template: {
                    lease_seconds: 900,
                },
            },
        };

        expect(orchestratorClaimURLParams('rollout-claim')).toBe('rollout-claim/work-items/orchestrator-claim');
        expect(canClaimOrchestratorNext(orchestratorNext)).toBe(true);
        expect(buildOrchestratorClaimPayload(orchestratorNext, ' operator-ui ')).toEqual({
            worker_id: 'operator-ui',
            lease_seconds: 900,
            expected_work_item_id: 9,
            expected_service_key: 'filterest.com',
        });
    });

    it('builds guarded orchestrator execute payloads only from claimed leases', () => {
        const orchestratorNext = {
            action: {
                kind: 'execute_active_lease',
                work_item_id: 9,
                service_key: 'filterest.com',
                current_step: 'backup',
                requires_mutation: true,
                requires_worker_id: true,
                requires_lease_token: true,
                requires_idempotency_key: true,
                requires_confirm_prod: true,
            },
        };
        const claim = {
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
        };

        expect(orchestratorClaimForService({ orchestrator_claim: claim })).toBe(claim);
        expect(orchestratorExecuteURLParams('rollout-execute')).toBe('rollout-execute/work-items/orchestrator-execute');
        expect(canExecuteClaimedOrchestratorNext(orchestratorNext, {})).toBe(false);
        expect(canExecuteClaimedOrchestratorNext(orchestratorNext, claim)).toBe(true);
        expect(buildOrchestratorExecutePayload(orchestratorNext, claim, {
            reason: ' operator approved ',
            confirmProd: true,
            idempotencyKey: 'execute-key',
        })).toEqual({
            work_item_id: 9,
            worker_id: 'operator-ui',
            lease_token: 'lease-token',
            step: 'backup',
            reason: 'operator approved',
            confirm_prod: true,
            idempotency_key: 'execute-key',
            lease_seconds: 3600,
            expected_work_item_id: 9,
            expected_service_key: 'filterest.com',
            expected_current_step: 'backup',
        });
    });

    it('builds non-mutating orchestrator fallback-plan payloads from server-selected actions', () => {
        const orchestratorNext = {
            action: {
                kind: 'plan_recovery',
                method: 'POST',
                path: '/api/instances/rollouts/rollout-123/work-items/fallback-plan',
                work_item_id: 42,
                requires_mutation: false,
                operator_required: true,
                automation_paused: true,
                request_template: { work_item_id: 42 },
            },
        };

        expect(orchestratorFallbackPlanURLParams('rollout-123')).toBe('rollout-123/work-items/fallback-plan');
        expect(canPlanOrchestratorFallback(orchestratorNext)).toBe(true);
        expect(buildOrchestratorFallbackPlanPayload(orchestratorNext)).toEqual({ work_item_id: 42 });
        expect(canPlanOrchestratorFallback({
            action: { ...orchestratorNext.action, requires_mutation: true },
        })).toBe(false);
    });

    it('summarizes mixed-state rescue actions from traffic promotion plans', () => {
        const plan = {
            rollout: { rollout_id: 'rollout-mixed', scope: 'all' },
            orchestration: {
                state: 'operator_review_required',
                recommended_action: 'review_mixed_traffic_state',
            },
            traffic_promotion: {
                state: 'mixed_state_review',
                recommended_action: 'plan_operator_rescue',
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
        };

        const summary = summarizeSchedulerPlan(plan);
        expect(summary.readyItems).toBe(0);
        expect(summary.recommendedAction).toBe('review_mixed_traffic_state');
        expect(summary.rescueActions).toHaveLength(1);
        expect(summary.rescueActions[0]).toMatchObject({
            workItemID: 2,
            serviceKey: 'serlog.com',
            currentStep: 'drain_source',
            serviceRolloutStatus: 'promoted',
            workStatus: 'queued',
            recommendedAction: 'plan_rollback_before_completion',
        });
        expect(summary.rescueActions[0].nextAPICalls).toContain('POST /api/instances/rollouts/rollout-mixed/work-items/fallback-plan');
    });

    it('prefers orchestration rescue actions for update-all scheduler summaries', () => {
        const plan = {
            rollout: { rollout_id: 'rollout-mixed', scope: 'all' },
            orchestration: {
                state: 'operator_review_required',
                recommended_action: 'review_mixed_traffic_state',
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
                }],
            },
            traffic_promotion: {
                state: 'mixed_state_review',
                recommended_action: 'plan_operator_rescue',
                rescue_actions: [{
                    work_item_id: 1,
                    service_key: 'filterest.com',
                    recommended_action: 'inspect_terminal_evidence',
                    terminal: true,
                }],
            },
        };

        const summary = summarizeSchedulerPlan(plan);
        expect(summary.rescueActions).toHaveLength(1);
        expect(summary.rescueActions[0]).toMatchObject({
            workItemID: 2,
            serviceKey: 'serlog.com',
            recommendedAction: 'plan_rollback_before_completion',
        });
    });

    it('summarizes recovery-required scheduler plans without deriving lease execution', () => {
        const plan = {
            rollout: { rollout_id: 'rollout-recovery', scope: 'selected' },
            summary: {
                claimable_items: 1,
                failed_items: 1,
                blocked_items: 1,
            },
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
        };

        const summary = summarizeSchedulerPlan(plan);
        expect(summary).toMatchObject({
            rolloutID: 'rollout-recovery',
            scope: 'selected_all',
            state: 'recovery_required',
            recommendedAction: 'recover_work_items',
            readyItems: 0,
            failedItems: 1,
            blockedItems: 1,
        });
        expect(summary.nextAPICalls).toContain('POST /api/instances/rollouts/rollout-recovery/work-items/fallback-execute');
        expect(summary.nextAPICalls).not.toContain('POST /api/instances/rollouts/rollout-recovery/lease/execute');
    });
});
