// frontend_pipeline.js
// Provides the generic asynchronous stage runner used by frontend pipelines.
// Bridges pipeline stage definitions and mutable runtime context execution.
// Exists to make client-side cross-cutting flows explicit, reusable, and skippable.

// ==========================================
// Core Pipeline Runner
// ==========================================

/**
 * Runs a sequence of pipeline stages against a shared mutable context.
 * Stages are skipped if context.skip[] contains the stage name AND
 * the stage is not marked alwaysEnforced.
 *
 * @param {Array<{name: string, fn: Function, alwaysEnforced: boolean}>} stages
 * @param {Object} context - Shared state passed through all stages. May include
 *                           a `skip` array of stage names to bypass.
 * @returns {Promise<Object>} The final context, or an abort result object
 *                            { abort: true, reason: string }
 */
export async function runPipeline(stages, context) {
    for (const stage of stages) {
        const isSkipRequested = Array.isArray(context.skip) && context.skip.includes(stage.name);
        if (isSkipRequested && !stage.alwaysEnforced) {
            continue;
        }
        const stageResult = await stage.fn(context);
        if (stageResult && stageResult.abort === true) {
            return stageResult;
        }
    }
    return context;
}

// ==========================================
// Factory Helpers
// ==========================================

/**
 * Creates a reusable pipeline runner pre-bound to a fixed set of stages.
 * Returns a function that accepts a context and runs the full pipeline.
 *
 * Usage:
 *   const runMyPipeline = createPipeline(myStages);
 *   await runMyPipeline({ ...contextData });
 *
 * @param {Array<{name: string, fn: Function, alwaysEnforced: boolean}>} stages
 * @returns {(context: Object) => Promise<Object>}
 */
export function createPipeline(stages) {
    return (context) => runPipeline(stages, context);
}

/**
 * Convenience helper for declaring a typed pipeline stage.
 * Ensures all stages have a consistent shape for inspection and debugging.
 *
 * @param {string} name           - Machine-readable stage name (used in skip lists)
 * @param {Function} fn           - Async or sync stage fn: (context) => void | { abort, reason }
 * @param {boolean} [alwaysEnforced=false] - If true, the stage runs even if listed in context.skip
 * @returns {{ name: string, fn: Function, alwaysEnforced: boolean }}
 */
export function createStage(name, fn, alwaysEnforced = false) {
    return { name, fn, alwaysEnforced };
}
