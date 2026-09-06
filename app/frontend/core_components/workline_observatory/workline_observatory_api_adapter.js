// workline_observatory_api_adapter.js
// Routes workline-observatory reads and bounded release decisions through the API pipeline.
// Bridges the isolated frontend module with its private backend endpoints.
// Exists so observatory code never bypasses shared authentication and error handling.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { registerEndpointRoute } from '../pipeline/api_pipeline.js';

const ROUTES = Object.freeze({
    board: 'worklineObservatoryBoard',
    statusActions: 'worklineObservatoryStatusActions',
    goals: 'worklineObservatoryReleaseGoals',
    contracts: 'worklineObservatoryContracts',
});

registerEndpointRoute(ROUTES.board, '/api/app/workline-observatory/board');
registerEndpointRoute(ROUTES.statusActions, '/api/app/workline-observatory/status-actions');
registerEndpointRoute(ROUTES.goals, '/api/app/workline-observatory/release-goals');
registerEndpointRoute(ROUTES.contracts, '/api/app/workline-observatory/contracts');

export function fetchWorklineObservatoryBoard() {
    return endpoint_router(ROUTES.board, { suppressAuthRedirect: true });
}

export async function fetchWorklineObservatoryReportHistory(worklineId) {
    const response = await endpoint_router(ROUTES.board, {
        url_params: `?workline_id=${encodeURIComponent(worklineId)}`,
        suppressAuthRedirect: true,
    });
    return Array.isArray(response?.reports) ? response.reports : [];
}

export function applyWorklineStatusAction(worklines, targetStatus) {
    return endpoint_router(ROUTES.statusActions, {
        method: 'POST',
        body_data: { worklines, target_status: targetStatus },
        suppressAuthRedirect: true,
    });
}

export function createWorklineReleaseGoal(goal) {
    return endpoint_router(ROUTES.goals, {
        method: 'POST', body_data: goal, suppressAuthRedirect: true,
    });
}

export function applyWorklineReleaseGoalAction(id, action) {
    return endpoint_router(ROUTES.goals, {
        method: 'PATCH', body_data: { id, action }, suppressAuthRedirect: true,
    });
}

export function saveWorklineReleaseContract(contract) {
    return endpoint_router(ROUTES.contracts, {
        method: 'PUT', body_data: contract, suppressAuthRedirect: true,
    });
}
