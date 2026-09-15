// row_article_task_todo_status.js
// Pure helpers for ticket todo checkbox status and progress math.
// Bridges dev_agent_task_todos row payloads and the article progress visual.
// Exists so checkbox toggles and the 10-light bar share one todo↔done contract.

export const TASK_TODO_DATASET = "dev_agent_task_todos";
export const TASK_TODO_OPEN_STATUS = "todo";
export const TASK_TODO_DONE_STATUS = "done";
export const TASK_PROGRESS_SEGMENTS = 10;

const TASK_TODO_STATUS_TONES = Object.freeze({
    done: "done",
    partially_done: "progress",
    needs_review: "awaiting",
    not_applicable: "archived",
    todo: "new",
});

/**
 * Reports whether a related-tab dataset is the ticket todo checklist.
 *
 * @param {string} datasetName
 * @returns {boolean}
 */
export function isTaskTodoChildDataset(datasetName) {
    return String(datasetName || "").trim() === TASK_TODO_DATASET;
}

/**
 * Canonicalizes a todo status slug for checkbox and progress math.
 *
 * @param {unknown} status
 * @returns {string}
 */
export function normalizeTaskTodoStatus(status) {
    const normalized = String(status ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");
    return normalized || TASK_TODO_OPEN_STATUS;
}

/**
 * Returns whether a todo status counts as completed for the progress bar.
 *
 * @param {unknown} status
 * @returns {boolean}
 */
export function isTaskTodoCompletionStatus(status) {
    return normalizeTaskTodoStatus(status) === TASK_TODO_DONE_STATUS;
}

/**
 * Maps one click of the checklist checkbox onto todo ↔ done.
 * Other statuses stay visible on the secondary chip; checking them marks done.
 *
 * @param {unknown} status
 * @returns {string}
 */
export function nextTaskTodoToggleStatus(status) {
    return isTaskTodoCompletionStatus(status)
        ? TASK_TODO_OPEN_STATUS
        : TASK_TODO_DONE_STATUS;
}

/**
 * Returns the visual tone used by existing todo status chips.
 *
 * @param {unknown} status
 * @returns {string}
 */
export function getTaskTodoStatusTone(status) {
    const key = normalizeTaskTodoStatus(status);
    return TASK_TODO_STATUS_TONES[key] || TASK_TODO_STATUS_TONES.todo;
}

/**
 * Reads todo_text verbatim for checklist rows.
 *
 * @param {object} row
 * @returns {string}
 */
export function readTaskTodoText(row = {}) {
    if (row?.todo_text == null) {
        return "";
    }
    return String(row.todo_text);
}

function parseCount(value) {
    const count = Number.parseInt(String(value ?? "0"), 10);
    return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function cloneStatusCounts(statuses = []) {
    return (Array.isArray(statuses) ? statuses : []).map((status) => ({
        slug: normalizeTaskTodoStatus(status?.slug),
        title: String(status?.title || status?.slug || "").trim()
            || normalizeTaskTodoStatus(status?.slug),
        count: parseCount(status?.count),
        is_completion_status: status?.is_completion_status === true
            || isTaskTodoCompletionStatus(status?.slug),
    }));
}

function adjustStatusCount(statuses, slug, delta) {
    const normalized = normalizeTaskTodoStatus(slug);
    let entry = statuses.find((status) => status.slug === normalized);
    if (!entry && delta > 0) {
        entry = {
            slug: normalized,
            title: normalized,
            count: 0,
            is_completion_status: isTaskTodoCompletionStatus(normalized),
        };
        statuses.push(entry);
    }
    if (!entry) {
        return;
    }
    entry.count = Math.max(0, entry.count + delta);
}

/**
 * Converts status counts into percent and 10-light values.
 * Mirrors the server-side task progress rounding contract.
 *
 * @param {Array<{slug?: string, title?: string, count?: number, is_completion_status?: boolean}>} statuses
 * @returns {{
 *   total: number,
 *   completed: number,
 *   percent: number,
 *   litSegments: number,
 *   statuses: Array<{slug: string, title: string, count: number, is_completion_status: boolean}>,
 * }}
 */
export function summarizeTaskTodoProgress(statuses = []) {
    const nextStatuses = cloneStatusCounts(statuses).filter((status) => status.count > 0);
    let total = 0;
    let completed = 0;
    nextStatuses.forEach((status) => {
        total += status.count;
        if (status.is_completion_status) {
            completed += status.count;
        }
    });

    if (total <= 0) {
        return {
            total: 0,
            completed: 0,
            percent: 0,
            litSegments: 0,
            statuses: [],
        };
    }

    let percent = Math.round((completed / total) * 100);
    percent = Math.min(100, Math.max(0, percent));
    let litSegments = Math.floor(percent / TASK_PROGRESS_SEGMENTS);
    if (completed >= total) {
        litSegments = TASK_PROGRESS_SEGMENTS;
    }
    litSegments = Math.min(TASK_PROGRESS_SEGMENTS, Math.max(0, litSegments));

    nextStatuses.sort((left, right) => {
        if (left.is_completion_status !== right.is_completion_status) {
            return left.is_completion_status ? 1 : -1;
        }
        return left.slug.localeCompare(right.slug);
    });

    return {
        total,
        completed,
        percent,
        litSegments,
        statuses: nextStatuses,
    };
}

/**
 * Rebuilds progress from the same todo rows the checkbox list is showing.
 *
 * @param {Array<{status?: string}>} rows
 * @returns {ReturnType<typeof summarizeTaskTodoProgress>}
 */
export function summarizeTaskTodoProgressFromRows(rows = []) {
    const counts = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row) => {
        const slug = normalizeTaskTodoStatus(row?.status);
        const current = counts.get(slug) || {
            slug,
            title: slug,
            count: 0,
            is_completion_status: isTaskTodoCompletionStatus(slug),
        };
        current.count += 1;
        counts.set(slug, current);
    });
    return summarizeTaskTodoProgress([...counts.values()]);
}

/**
 * Applies one checkbox toggle to an existing progress payload.
 *
 * @param {object} payload
 * @param {unknown} fromStatus
 * @param {unknown} toStatus
 * @returns {ReturnType<typeof summarizeTaskTodoProgress>}
 */
export function patchTaskTodoProgressForStatusChange(payload = {}, fromStatus, toStatus) {
    const from = normalizeTaskTodoStatus(fromStatus);
    const to = normalizeTaskTodoStatus(toStatus);
    const statuses = cloneStatusCounts(payload.statuses);
    if (from !== to) {
        adjustStatusCount(statuses, from, -1);
        adjustStatusCount(statuses, to, 1);
    }
    return summarizeTaskTodoProgress(statuses);
}
