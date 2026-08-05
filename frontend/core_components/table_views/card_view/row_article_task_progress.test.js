// row_article_task_progress.test.js
// Verifies task todo progress rendering for article-view status visuals.
// Bridges task-progress API payloads and the DOM segment lights shown below Details.
// Exists so ticket progress can evolve without breaking the first visible UI contract.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const { endpointRouterMock } = vi.hoisted(() => ({
    endpointRouterMock: vi.fn(),
}));

vi.mock("../../endpoints/endpoint_router.js", () => ({
    endpoint_router: endpointRouterMock,
}));

import { buildRowArticleTaskProgressSection } from "./row_article_task_progress.js";

describe("row_article_task_progress", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
        endpointRouterMock.mockReset();
    });

    test("skips non-task datasets", async () => {
        const section = await buildRowArticleTaskProgressSection("risks", 42);

        expect(section).toBeNull();
        expect(endpointRouterMock).not.toHaveBeenCalled();
    });

    test("renders percent, ratio, and whole-ten lights for task todos", async () => {
        endpointRouterMock.mockResolvedValue({
            total: 130,
            completed: 48,
            percent: 37,
            lit_segments: 3,
            statuses: [
                { slug: "todo", title: "Todo", count: 82, is_completion_status: false },
                { slug: "done", title: "Done", count: 48, is_completion_status: true },
            ],
        });

        const section = await buildRowArticleTaskProgressSection("dev_agent_tasks", 853);

        expect(section?.classList.contains("row_article_task_progress_section")).toBe(true);
        expect(section?.querySelector(".animated-disclosure-title")?.dataset.langKey)
            .toBe("row_article_section_task_progress");
        expect(section?.querySelector(".row_article_task_progress_percent")?.textContent)
            .toBe("37%");
        expect(section?.querySelector(".row_article_task_progress_ratio")?.textContent)
            .toBe("48/130");
        expect(section?.querySelectorAll(".row_article_task_progress_light.is-lit"))
            .toHaveLength(3);
        expect(section?.querySelectorAll(".row_article_task_progress_light"))
            .toHaveLength(10);
        expect(endpointRouterMock).toHaveBeenCalledWith("getTaskTodoProgress", {
            url_params: "?dataset=dev_agent_tasks&id=853",
            suppressAuthRedirect: true,
        });
    });
});
