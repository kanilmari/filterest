// row_article_task_todo_status.test.js
// Verifies ticket todo checkbox status math and progress patching.
// Bridges todo row payloads and the article 10-light progress contract.
// Exists so todo↔done toggles cannot drift away from the server progress rounding.
import { describe, expect, test } from "vitest";
import {
    getTaskTodoStatusTone,
    isTaskTodoChildDataset,
    nextTaskTodoToggleStatus,
    normalizeTaskTodoStatus,
    patchTaskTodoProgressForStatusChange,
    readTaskTodoText,
    splitTaskTodoText,
    summarizeTaskTodoProgress,
    summarizeTaskTodoProgressFromRows,
} from "./row_article_task_todo_status.js";

describe("row_article_task_todo_status", () => {
    test("recognizes only the ticket todo child dataset", () => {
        expect(isTaskTodoChildDataset("dev_agent_task_todos")).toBe(true);
        expect(isTaskTodoChildDataset("dev_agent_tasks")).toBe(false);
        expect(isTaskTodoChildDataset("dev_agent_worklines")).toBe(false);
    });

    test("toggles only todo ↔ done and keeps other statuses on the checkbox path to done", () => {
        expect(nextTaskTodoToggleStatus("todo")).toBe("done");
        expect(nextTaskTodoToggleStatus("done")).toBe("todo");
        expect(nextTaskTodoToggleStatus("needs_review")).toBe("done");
        expect(nextTaskTodoToggleStatus("partially_done")).toBe("done");
        expect(nextTaskTodoToggleStatus("not_applicable")).toBe("done");
        expect(normalizeTaskTodoStatus(" Done ")).toBe("done");
        expect(getTaskTodoStatusTone("needs_review")).toBe("awaiting");
    });

    test("shows todo_text verbatim without trimming owner identifier text", () => {
        expect(readTaskTodoText({ todo_text: "  #889 checkbox UX  " }))
            .toBe("  #889 checkbox UX  ");
        expect(readTaskTodoText({})).toBe("");
    });

    test("splits a newline todo_text into title plus lightning identifier phrase", () => {
        expect(splitTaskTodoText("Quick toggle todo↔done\nlightning-id 889")).toEqual({
            title: "Quick toggle todo↔done",
            phrase: "lightning-id 889",
        });
        expect(splitTaskTodoText("Title line\n\n  keep spaced phrase  \n")).toEqual({
            title: "Title line",
            phrase: "  keep spaced phrase  ",
        });
        expect(splitTaskTodoText("Title\r\nphrase one\r\nphrase two")).toEqual({
            title: "Title",
            phrase: "phrase one\nphrase two",
        });
    });

    test("omits the identifier phrase when todo_text is a single line", () => {
        expect(splitTaskTodoText("  Identifier text stays  ")).toEqual({
            title: "  Identifier text stays  ",
            phrase: "",
        });
        expect(splitTaskTodoText("Title only\n\n")).toEqual({
            title: "Title only",
            phrase: "",
        });
        expect(splitTaskTodoText("")).toEqual({ title: "", phrase: "" });
    });

    test("matches server rounding for the 10-light progress bar", () => {
        const summary = summarizeTaskTodoProgress([
            { slug: "todo", title: "Todo", count: 82, is_completion_status: false },
            { slug: "done", title: "Done", count: 48, is_completion_status: true },
        ]);

        expect(summary).toMatchObject({
            total: 130,
            completed: 48,
            percent: 37,
            litSegments: 3,
        });
    });

    test("rebuilds progress from the same todo rows after a checkbox toggle", () => {
        const rows = [
            { id: 1, status: "todo" },
            { id: 2, status: "done" },
            { id: 3, status: "needs_review" },
        ];
        expect(summarizeTaskTodoProgressFromRows(rows)).toMatchObject({
            total: 3,
            completed: 1,
            percent: 33,
            litSegments: 3,
        });

        rows[0].status = "done";
        expect(summarizeTaskTodoProgressFromRows(rows)).toMatchObject({
            total: 3,
            completed: 2,
            percent: 67,
            litSegments: 6,
        });
    });

    test("patches an existing progress payload without dropping secondary status counts", () => {
        const patched = patchTaskTodoProgressForStatusChange(
            {
                statuses: [
                    { slug: "todo", title: "Todo", count: 2, is_completion_status: false },
                    { slug: "needs_review", title: "Needs review", count: 1, is_completion_status: false },
                    { slug: "done", title: "Done", count: 1, is_completion_status: true },
                ],
            },
            "needs_review",
            "done",
        );

        expect(patched.total).toBe(4);
        expect(patched.completed).toBe(2);
        expect(patched.percent).toBe(50);
        expect(patched.litSegments).toBe(5);
        expect(patched.statuses.map((status) => ({ slug: status.slug, count: status.count }))).toEqual([
            { slug: "todo", count: 2 },
            { slug: "done", count: 2 },
        ]);
        expect(patched.statuses.find((status) => status.slug === "needs_review")).toBeUndefined();
    });
});
