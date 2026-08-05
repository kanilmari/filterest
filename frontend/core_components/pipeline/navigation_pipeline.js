// navigation_pipeline.js
// Declarative navigation pipeline with dirtyCheck, permissionCheck, urlUpdate, and viewRender stages.
// Between the frontend pipeline runner, route permissions, and view rendering.
// Exists to mirror the backend Pipeline Mediator pattern for client-side navigation.

import { createPipeline, createStage } from './frontend_pipeline.js';
import { updateURL } from '../navigation/nav_engine/query_params.js';
import { withLoadingIndicator } from '../../reusable_components/loading/loading_indicator_printer.js';
import { hasRoutePermission, hasDatasetPermission } from '../route_permission_checker.js';
import { showAccessDeniedToast } from '../../reusable_components/notifications/toast_notification_printer.js';
import { custom_views } from '../navigation/admin_and_user_tools/custom_view_reader.js';
import {
    canReadDatasetFromRegistry,
    hasDatasetAccessSnapshot,
} from '../navigation/nav_engine/dataset_access_registry.js';

// ==========================================
// Stage Implementations
// ==========================================

/**
 * dirtyCheckStage — aborts navigation if the user has unsaved changes.
 * Checks the global window.check_manage_permissions_dirty() hook.
 * This runs BEFORE any URL or DOM changes to prevent partial navigation.
 *
 * @param {Object} ctx - Navigation context
 * @returns {{ abort: true, reason: string } | undefined}
 */
async function dirtyCheckStage(_ctx) {
    if (typeof window.check_manage_permissions_dirty !== 'function') return;
    const isClean = await window.check_manage_permissions_dirty();
    if (!isClean) {
        return { abort: true, reason: 'dirty_check_failed' };
    }
}

/**
 * permissionCheckStage — aborts navigation if the current user lacks access
 * to the target route.
 *
 * Three types of routes are handled:
 * 1. API-style routes (ctx.name starting with '/') — checked against cached
 *    user permissions from sessionStorage (populated at login).
 * 2. View-name routes (e.g. 'permissions', 'database_consistency') — checked
 *    via the `requiredPermission` field from the custom_views registry.
 * 3. Dataset-name routes (anything else, e.g. 'system_users') — checked via
 *    async /api/check-table-right call (function × table permission).
 *    Results are cached in datasetPermissionCache (route_permission_checker.js).
 *
 * Non-enforced: stage errors do not abort navigation (required=false),
 * but explicit permission denial returns { abort: true }.
 *
 * @param {Object} ctx - Navigation context with ctx.name as the route/view name
 * @returns {{ abort: true, reason: 'permission_denied' } | undefined}
 */
async function permissionCheckStage(ctx) {
    if (!ctx.name) return;

    // API-style routes (e.g. /api/..., /ui/...) — check directly
    if (ctx.name.startsWith('/')) {
        if (!hasRoutePermission(ctx.name)) {
            showAccessDeniedToast();
            return { abort: true, reason: 'permission_denied' };
        }
        return;
    }

    // View-name routes — look up requiredPermission from custom_views registry
    const viewDef = custom_views.find(v => v.name === ctx.name);
    if (viewDef && viewDef.requiredPermission) {
        if (!hasRoutePermission(viewDef.requiredPermission)) {
            showAccessDeniedToast();
            return { abort: true, reason: 'permission_denied' };
        }
        return;
    }

    // Dataset-name routes (not a custom view, not a /-prefixed route) —
    // check table-level permission via /api/check-table-right.
    // Uses the cached hasDatasetPermission() helper from route_permission_checker.js.
    if (!viewDef) {
        const registryAllowed = canReadDatasetFromRegistry(ctx.name);
        if (registryAllowed === true) {
            return;
        }
        if (registryAllowed === false && hasDatasetAccessSnapshot()) {
            showAccessDeniedToast();
            return { abort: true, reason: 'permission_denied' };
        }
        const allowed = await hasDatasetPermission('/api/get-results', ctx.name);
        if (!allowed) {
            showAccessDeniedToast();
            return { abort: true, reason: 'permission_denied' };
        }
    }
}

/**
 * urlUpdateStage — pushes the new URL to the browser history.
 * Skippable via context.skip: ['urlUpdate'] (used by back/forward navigation).
 *
 * @param {Object} ctx - Navigation context with name, params, prefix
 */
async function urlUpdateStage(ctx) {
    updateURL(ctx.name, ctx.params, ctx.prefix);
}

/**
 * viewRenderStage — performs the actual DOM navigation:
 * button highlighting, container switching, lazy loading, and side-effects.
 * Shows a loading spinner in the target container for the duration of rendering.
 * Delegates navigation logic to ctx._performNavigationCore() injected by navigate.js.
 *
 * @param {Object} ctx - Navigation context with all navigation data
 */
async function viewRenderStage(ctx) {
    await withLoadingIndicator(ctx.containerId, () =>
        ctx._performNavigationCore(
            ctx.name,
            ctx.containerId,
            ctx.loadFunction,
            ctx.groupName,
            ctx.isCustomView
        )
    );
}

// ==========================================
// Pipeline Configuration
// ==========================================

const navigationStages = [
    createStage('dirtyCheck',       dirtyCheckStage,      false),
    createStage('permissionCheck',  permissionCheckStage, false),
    createStage('urlUpdate',        urlUpdateStage,       false),
    createStage('viewRender',       viewRenderStage,      true),
];

/**
 * runNavigationPipeline — runs all navigation stages against the provided context.
 * Import this in navigate.js and call it from handle_all_navigation().
 *
 * @type {(context: Object) => Promise<Object>}
 */
export const runNavigationPipeline = createPipeline(navigationStages);

/**
 * describeNavigationPipeline — returns the pipeline structure for introspection.
 * Mirrors the backend's /api/pipeline-info endpoint for frontend debugging.
 *
 * Usage:
 *   import { describeNavigationPipeline } from './navigation_pipeline.js';
 *   console.table(describeNavigationPipeline());
 *
 * @returns {Array<{ name: string, alwaysEnforced: boolean }>}
 */
export function describeNavigationPipeline() {
    return navigationStages.map(stage => ({
        name: stage.name,
        alwaysEnforced: stage.alwaysEnforced,
    }));
}
