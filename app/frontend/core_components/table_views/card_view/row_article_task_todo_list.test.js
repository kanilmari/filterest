// row_article_task_todo_list.test.js
// Verifies ticket-article todo checkbox rendering and optimistic todo↔done persistence.
// Bridges child-tab todo rows, the updateRow API, and the article progress visual.
// Exists so the checklist cannot regress into observatory-style mass selection.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const { endpointRouterMock, showErrorToastMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
    showErrorToastMock: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: endpointRouterMock,
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: (key) => key,
}));

vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showErrorToast: showErrorToastMock,
}));

import { buildRowArticleTaskProgressSection } from "./row_article_task_progress.js";
import { renderTaskTodoCheckboxList } from "./row_article_task_todo_list.js";

describe("row_article_task_todo_list", () => {
    beforeEach(() => {
        document.body.innerHTML = `<article class="active_row_article"></article>`;
        endpointRouterMock.mockReset();
        showErrorToastMock.mockReset();
    });

    test("renders a real checkbox to the left of verbatim todo_text and keeps other statuses", async () => {
        const list = renderTaskTodoCheckboxList([
            { id: 11, todo_text: "  Quick toggle todo↔done  ", status: "todo", sort_order: 10 },
            { id: 12, todo_text: "Keep needs_review visible", status: "needs_review", sort_order: 20 },
            { id: 13, parent_todo_id: 11, todo_text: "Child identifier", status: "done", sort_order: 10 },
        ]);

        const todoRow = list.querySelector('[data-todo-id="11"]');
        const reviewRow = list.querySelector('[data-todo-id="12"]');
        const childRow = list.querySelector('[data-todo-id="13"]');
        const rows = [...list.querySelectorAll(".row_article_task_todo_item")];
        expect(rows.map((row) => row.dataset.todoId)).toEqual(["11", "13", "12"]);
        expect(list.dataset.testid).toBe("task-todo-checkbox-list");

        const firstCheckbox = todoRow.querySelector('input[type="checkbox"][data-testid="task-todo-checkbox"]');
        expect(firstCheckbox).toBeInstanceOf(HTMLInputElement);
        expect(firstCheckbox.checked).toBe(false);
        expect(todoRow.querySelector(".row_article_task_todo_text")?.textContent)
            .toBe("  Quick toggle todo↔done  ");
        expect(todoRow.querySelector("[data-testid='task-todo-phrase']")).toBeNull();
        expect(todoRow.querySelector(".row_article_task_todo_status")?.textContent).toBe("todo");

        expect(reviewRow.querySelector('input[type="checkbox"]').checked).toBe(false);
        expect(reviewRow.querySelector(".row_article_task_todo_status")?.textContent).toBe("needs_review");
        expect(reviewRow.querySelector(".row_article_task_todo_text")?.textContent)
            .toBe("Keep needs_review visible");

        expect(childRow.classList.contains("is-child")).toBe(true);
        expect(childRow.querySelector('input[type="checkbox"]').checked).toBe(true);
        expect(childRow.classList.contains("is-done")).toBe(true);
    });

    test("shows a lightning identifier phrase under the title only when todo_text has a newline", () => {
        const list = renderTaskTodoCheckboxList([
            { id: 41, todo_text: "Quick toggle todo↔done\nlightning-id 889", status: "todo" },
            { id: 42, todo_text: "Single line title", status: "todo" },
            { id: 43, parent_todo_id: 41, todo_text: "Child is a real subtask", status: "todo" },
        ]);

        const phrased = list.querySelector('[data-todo-id="41"]');
        expect(phrased.querySelector(".row_article_task_todo_text")?.textContent)
            .toBe("Quick toggle todo↔done");
        expect(phrased.querySelector("[data-testid='task-todo-phrase']")?.textContent)
            .toBe("lightning-id 889");
        expect(phrased.querySelector(".row_article_task_todo_phrase")).not.toBeNull();

        const single = list.querySelector('[data-todo-id="42"]');
        expect(single.querySelector(".row_article_task_todo_text")?.textContent)
            .toBe("Single line title");
        expect(single.querySelector("[data-testid='task-todo-phrase']")).toBeNull();

        const child = list.querySelector('[data-todo-id="43"]');
        expect(child.classList.contains("is-child")).toBe(true);
        expect(child.querySelector(".row_article_task_todo_text")?.textContent)
            .toBe("Child is a real subtask");
        expect(child.querySelector("[data-testid='task-todo-phrase']")).toBeNull();
        expect(phrased.querySelector("[data-testid='task-todo-phrase']")?.textContent)
            .not.toBe("Child is a real subtask");
    });

    test("toggles todo to done with optimistic UI, API persistence, and progress update", async () => {
        endpointRouterMock.mockImplementation((routeName) => {
            if (routeName === "getTaskTodoProgress") {
                return Promise.resolve({
                    total: 2,
                    completed: 0,
                    percent: 0,
                    lit_segments: 0,
                    statuses: [
                        { slug: "todo", title: "Todo", count: 2, is_completion_status: false },
                    ],
                });
            }
            if (routeName === "updateRow") {
                return Promise.resolve({ status: "ok" });
            }
            return Promise.resolve({});
        });

        const article = document.querySelector(".active_row_article");
        article.appendChild(await buildRowArticleTaskProgressSection("dev_agent_tasks", 889));
        article.appendChild(renderTaskTodoCheckboxList([
            { id: 21, todo_text: "Ship checkbox UX", status: "todo" },
            { id: 22, todo_text: "Leave secondary statuses", status: "todo" },
        ]));

        expect(article.querySelector(".row_article_task_progress_ratio")?.textContent).toBe("0/2");

        const checkbox = article.querySelector('[data-todo-id="21"] input[type="checkbox"]');
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));

        expect(article.querySelector('[data-todo-id="21"]')?.classList.contains("is-done")).toBe(true);
        expect(article.querySelector('[data-todo-id="21"] .row_article_task_todo_status')?.textContent)
            .toBe("done");
        expect(article.querySelector(".row_article_task_progress_ratio")?.textContent).toBe("1/2");
        expect(article.querySelector(".row_article_task_progress_percent")?.textContent).toBe("50%");
        expect(article.querySelectorAll(".row_article_task_progress_light.is-lit")).toHaveLength(5);

        await vi.waitFor(() => {
            expect(endpointRouterMock).toHaveBeenCalledWith("updateRow", {
                method: "POST",
                url_params: "?dataset=dev_agent_task_todos",
                body_data: {
                    id: 21,
                    column: "status",
                    value: "done",
                },
                suppressAuthRedirect: true,
            });
        });
    });

    test("rolls back the checkbox and progress when persistence fails", async () => {
        endpointRouterMock.mockImplementation((routeName) => {
            if (routeName === "getTaskTodoProgress") {
                return Promise.resolve({
                    total: 1,
                    completed: 1,
                    percent: 100,
                    lit_segments: 10,
                    statuses: [
                        { slug: "done", title: "Done", count: 1, is_completion_status: true },
                    ],
                });
            }
            if (routeName === "updateRow") {
                return Promise.reject(new Error("save failed"));
            }
            return Promise.resolve({});
        });

        const article = document.querySelector(".active_row_article");
        article.appendChild(await buildRowArticleTaskProgressSection("dev_agent_tasks", 889));
        article.appendChild(renderTaskTodoCheckboxList([
            { id: 31, todo_text: "Undo on failure", status: "done" },
        ]));

        const checkbox = article.querySelector('input[type="checkbox"]');
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));

        await vi.waitFor(() => {
            expect(showErrorToastMock).toHaveBeenCalled();
        });

        expect(article.querySelector(".row_article_task_todo_item")?.classList.contains("is-done")).toBe(true);
        expect(article.querySelector("input[type='checkbox']")?.checked).toBe(true);
        expect(article.querySelector(".row_article_task_progress_ratio")?.textContent).toBe("1/1");
        expect(article.querySelector(".row_article_task_todo_status")?.textContent).toBe("done");
    });
});
