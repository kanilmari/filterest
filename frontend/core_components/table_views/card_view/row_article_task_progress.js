// row_article_task_progress.js
// Renders task todo progress as a row article disclosure section.
// Bridges the task-todo progress API and the 10-light article status visual.
// Exists so ticket progress can be followed from the Easelect UI without opening agent tooling.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { buildRowArticleDisclosureSection } from "./row_article_disclosure_section_builder.js";

const TASK_PROGRESS_DATASET = "dev_agent_tasks";
const TASK_PROGRESS_ICON_PATH = "/frontend/icons/general/visible-fields-icon.svg";
const TASK_PROGRESS_SEGMENTS = 10;

function normalizeProgressPayload(payload = {}) {
    const total = Number.parseInt(String(payload.total ?? "0"), 10);
    const completed = Number.parseInt(String(payload.completed ?? "0"), 10);
    const percent = Number.parseInt(String(payload.percent ?? "0"), 10);
    const litSegments = Number.parseInt(String(payload.lit_segments ?? "0"), 10);

    return {
        total: Number.isFinite(total) ? Math.max(0, total) : 0,
        completed: Number.isFinite(completed) ? Math.max(0, completed) : 0,
        percent: Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0,
        litSegments: Number.isFinite(litSegments)
            ? Math.min(TASK_PROGRESS_SEGMENTS, Math.max(0, litSegments))
            : 0,
        statuses: Array.isArray(payload.statuses) ? payload.statuses : [],
    };
}

function buildProgressLights(litSegments) {
    const lights = document.createElement("div");
    lights.classList.add("row_article_task_progress_lights");
    lights.setAttribute("aria-hidden", "true");

    for (let index = 1; index <= TASK_PROGRESS_SEGMENTS; index += 1) {
        const light = document.createElement("span");
        light.classList.add("row_article_task_progress_light");
        light.classList.toggle("is-lit", index <= litSegments);
        lights.appendChild(light);
    }

    return lights;
}

function buildStatusCounts(statuses) {
    const list = document.createElement("div");
    list.classList.add("row_article_task_progress_statuses");

    statuses.forEach((status) => {
        const count = Number.parseInt(String(status?.count ?? "0"), 10);
        if (!Number.isFinite(count) || count <= 0) {
            return;
        }
        const chip = document.createElement("span");
        chip.classList.add("row_article_task_progress_status_chip");
        chip.classList.toggle("is-complete", status?.is_completion_status === true);
        chip.textContent = `${status?.title || status?.slug || "status"}: ${count}`;
        list.appendChild(chip);
    });

    return list.children.length > 0 ? list : null;
}

function buildTaskProgressContent(payload = {}) {
    const progress = normalizeProgressPayload(payload);
    if (progress.total <= 0) {
        return null;
    }

    const content = document.createElement("div");
    content.classList.add("row_article_task_progress");
    content.dataset.percent = String(progress.percent);

    const overview = document.createElement("div");
    overview.classList.add("row_article_task_progress_overview");

    const percentValue = document.createElement("strong");
    percentValue.classList.add("row_article_task_progress_percent");
    percentValue.textContent = `${progress.percent}%`;

    const ratio = document.createElement("span");
    ratio.classList.add("row_article_task_progress_ratio");
    ratio.textContent = `${progress.completed}/${progress.total}`;

    overview.append(percentValue, ratio);
    content.append(overview, buildProgressLights(progress.litSegments));

    const statuses = buildStatusCounts(progress.statuses);
    if (statuses) {
        content.appendChild(statuses);
    }

    return content;
}

/**
 * Fetches and builds the task progress disclosure section for task rows.
 *
 * @param {string} tableName
 * @param {number|string} rowId
 * @returns {Promise<HTMLElement|null>}
 */
export async function buildRowArticleTaskProgressSection(tableName, rowId) {
    const normalizedTableName = String(tableName || "").trim();
    const normalizedRowId = String(rowId ?? "").trim();
    if (normalizedTableName !== TASK_PROGRESS_DATASET || !normalizedRowId) {
        return null;
    }

    let payload;
    try {
        payload = await endpoint_router("getTaskTodoProgress", {
            url_params: `?dataset=${encodeURIComponent(normalizedTableName)}&id=${encodeURIComponent(normalizedRowId)}`,
            suppressAuthRedirect: true,
        });
    } catch (err) {
        console.warn("row article task progress fetch failed:", err?.message || err);
        return null;
    }

    const contentElement = buildTaskProgressContent(payload);
    if (!contentElement) {
        return null;
    }

    return buildRowArticleDisclosureSection({
        titleLangKey: "row_article_section_task_progress",
        titleText: "Progress",
        iconPath: TASK_PROGRESS_ICON_PATH,
        contentElement,
        startOpen: true,
        sectionClassNames: "row_article_task_progress_section",
    });
}
