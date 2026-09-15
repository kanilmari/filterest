// row_article_task_todo_list.js
// Renders ticket child-tab todos as a checkbox list with todo↔done persistence.
// Bridges dev_agent_task_todos rows, the updateRow API, and the article progress bar.
// Exists so ticket owners can tick plan identifiers without leaving the ticket article.

import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { showErrorToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { applyTaskTodoStatusChangeToArticleProgress } from "./row_article_task_progress.js";
import {
    getTaskTodoStatusTone,
    isTaskTodoCompletionStatus,
    normalizeTaskTodoStatus,
    readTaskTodoText,
    TASK_TODO_DATASET,
    TASK_TODO_DONE_STATUS,
    TASK_TODO_OPEN_STATUS,
} from "./row_article_task_todo_status.js";

export {
    isTaskTodoChildDataset,
    nextTaskTodoToggleStatus,
    TASK_TODO_DATASET,
} from "./row_article_task_todo_status.js";

function compareTaskTodoRows(left, right) {
    const leftParent = Number(left?.parent_todo_id ?? left?.id ?? 0);
    const rightParent = Number(right?.parent_todo_id ?? right?.id ?? 0);
    if (leftParent !== rightParent) {
        return leftParent - rightParent;
    }
    const leftIsChild = left?.parent_todo_id == null ? 0 : 1;
    const rightIsChild = right?.parent_todo_id == null ? 0 : 1;
    if (leftIsChild !== rightIsChild) {
        return leftIsChild - rightIsChild;
    }
    const leftSort = Number(left?.sort_order ?? 0);
    const rightSort = Number(right?.sort_order ?? 0);
    if (leftSort !== rightSort) {
        return leftSort - rightSort;
    }
    return Number(left?.id ?? 0) - Number(right?.id ?? 0);
}

function createTaskTodoStatusChip(status, { onOpen = null } = {}) {
    const normalized = normalizeTaskTodoStatus(status);
    const chip = document.createElement(onOpen ? "button" : "span");
    chip.classList.add("ticket_status_badge", "todo_status_chip", "row_article_task_todo_status");
    chip.dataset.statusTone = getTaskTodoStatusTone(normalized);
    chip.textContent = normalized;
    chip.title = normalized;
    if (onOpen) {
        chip.type = "button";
        chip.classList.add("row_article_task_todo_status_button");
        chip.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpen();
        });
    }
    return chip;
}

function applyTodoRowPresentation(item, row) {
    const status = normalizeTaskTodoStatus(row.status);
    const done = isTaskTodoCompletionStatus(status);
    const checkbox = item.querySelector(".row_article_task_todo_checkbox");
    const chip = item.querySelector(".row_article_task_todo_status");
    item.classList.toggle("is-done", done);
    item.dataset.todoStatus = status;
    if (checkbox instanceof HTMLInputElement) {
        checkbox.checked = done;
        checkbox.setAttribute("aria-checked", done ? "true" : "false");
    }
    if (chip) {
        chip.dataset.statusTone = getTaskTodoStatusTone(status);
        chip.textContent = status;
        chip.title = status;
    }
}

async function persistTaskTodoStatus(todoId, status) {
    await endpoint_router("updateRow", {
        method: "POST",
        url_params: `?dataset=${encodeURIComponent(TASK_TODO_DATASET)}`,
        body_data: {
            id: Number(todoId),
            column: "status",
            value: status,
        },
        suppressAuthRedirect: true,
    });
}

function findArticleRoot(listElement) {
    return listElement.closest(".active_row_article, .active_big_card, .row_article_content")
        || listElement.closest("article")
        || document;
}

function bindTodoCheckbox(item, row, listElement) {
    const checkbox = item.querySelector(".row_article_task_todo_checkbox");
    if (!(checkbox instanceof HTMLInputElement) || row?.id == null) {
        return;
    }

    checkbox.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    checkbox.addEventListener("change", async (event) => {
        event.stopPropagation();
        if (item.dataset.todoBusy === "true") {
            applyTodoRowPresentation(item, row);
            return;
        }

        const previousStatus = normalizeTaskTodoStatus(row.status);
        const nextStatus = checkbox.checked ? TASK_TODO_DONE_STATUS : TASK_TODO_OPEN_STATUS;
        if (previousStatus === nextStatus) {
            applyTodoRowPresentation(item, row);
            return;
        }

        item.dataset.todoBusy = "true";
        checkbox.disabled = true;
        row.status = nextStatus;
        applyTodoRowPresentation(item, row);
        applyTaskTodoStatusChangeToArticleProgress(
            findArticleRoot(listElement),
            previousStatus,
            nextStatus,
        );

        try {
            await persistTaskTodoStatus(row.id, nextStatus);
        } catch (err) {
            row.status = previousStatus;
            applyTodoRowPresentation(item, row);
            applyTaskTodoStatusChangeToArticleProgress(
                findArticleRoot(listElement),
                nextStatus,
                previousStatus,
            );
            console.warn("ticket todo checkbox persist failed:", err?.message || err);
            showErrorToast(getTranslationForKey("save_failed") || "Tallennus ei onnistunut.");
        } finally {
            item.dataset.todoBusy = "false";
            checkbox.disabled = false;
        }
    });
}

function createTaskTodoRow(row, {
    dataTypes = {},
    onOpen = null,
    onDelete = null,
    listElement,
} = {}) {
    const item = document.createElement("div");
    item.classList.add(
        "row_article_task_todo_item",
        "related_pretty_card",
        "child_pretty_card",
        "comment_item",
        "related_record_list_item",
        "child_record_list_item",
    );
    if (row?.id != null) {
        item.dataset.recordId = String(row.id);
        item.dataset.todoId = String(row.id);
    }
    if (row?.parent_todo_id != null) {
        item.classList.add("is-child");
        item.dataset.parentTodoId = String(row.parent_todo_id);
    }

    const todoText = readTaskTodoText(row);
    const toggle = document.createElement("label");
    toggle.classList.add("row_article_task_todo_toggle");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.classList.add("row_article_task_todo_checkbox");
    checkbox.dataset.testid = "task-todo-checkbox";
    checkbox.setAttribute("aria-label", todoText || "todo");

    const text = document.createElement("span");
    text.classList.add("row_article_task_todo_text");
    text.textContent = todoText;
    text.title = todoText;

    toggle.append(checkbox, text);
    item.appendChild(toggle);
    item.appendChild(createTaskTodoStatusChip(row?.status, {
        onOpen: typeof onOpen === "function" ? () => onOpen(row, dataTypes) : null,
    }));

    if (typeof onDelete === "function" && row?.id != null) {
        const actions = document.createElement("div");
        actions.classList.add(
            "related_record_actions",
            "child_record_actions",
            "row_article_task_todo_actions",
        );
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "related_record_action related_record_action--delete child_record_action child_record_action--delete";
        deleteButton.dataset.langKey = "delete";
        deleteButton.textContent = getTranslationForKey("delete") || "Poista";
        deleteButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete(row);
        });
        actions.appendChild(deleteButton);
        item.appendChild(actions);
    }

    applyTodoRowPresentation(item, row);
    bindTodoCheckbox(item, row, listElement);
    return item;
}

/**
 * Builds the ticket-article checkbox list for dev_agent_task_todos rows.
 *
 * @param {object[]} rows
 * @param {{
 *   container?: HTMLElement,
 *   dataTypes?: object,
 *   onOpen?: Function|null,
 *   onDelete?: Function|null,
 * }} [options]
 * @returns {HTMLElement}
 */
export function renderTaskTodoCheckboxList(rows = [], options = {}) {
    const list = options.container || document.createElement("div");
    list.classList.add(
        "row_article_task_todo_list",
        "comment_list",
        "related_record_list",
        "child_record_list",
    );
    list.dataset.testid = "task-todo-checkbox-list";
    list.dataset.todoDataset = TASK_TODO_DATASET;
    list.replaceChildren();

    const orderedRows = [...(Array.isArray(rows) ? rows : [])].sort(compareTaskTodoRows);
    if (orderedRows.length === 0) {
        const empty = document.createElement("div");
        empty.classList.add("comment_empty");
        empty.textContent = getTranslationForKey("no_results") || "Ei riveja";
        list.appendChild(empty);
        return list;
    }

    orderedRows.forEach((row) => {
        list.appendChild(createTaskTodoRow(row, {
            ...options,
            listElement: list,
        }));
    });
    return list;
}
