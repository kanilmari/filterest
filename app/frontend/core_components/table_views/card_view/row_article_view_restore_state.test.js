// @vitest-environment jsdom
// row_article_view_restore_state.test.js
// Verifies classic article-view F5 restore for the same ticket row.
// Bridges table_state_store.articleView with related-tab, related-rows, and content-scroll persistence.
// Exists so refresh cannot drop the open child tab or article scroll position.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import {
    articleViewRestoreFieldsForRowChange,
    attachRowArticleContentScrollPersistence,
    bindRelatedRowsDisclosurePersist,
    persistRowArticleViewRestoreState,
    readRowArticleViewRestoreState,
} from "./row_article_view_restore_state.js";

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("row_article_view_restore_state", () => {
    test("reads persisted tab, related-rows, and scroll only for the same expanded ticket", () => {
        setUnifiedTableState("dev_agent_tasks", {
            articleView: {
                collapsed: true,
                expandedId: 889,
                relatedTabKey: "dev_agent_task_todos__task_id__",
                relatedRowsOpen: true,
                scrollTop: 420,
            },
        });

        expect(readRowArticleViewRestoreState("dev_agent_tasks", 889)).toEqual({
            relatedTabKey: "dev_agent_task_todos__task_id__",
            relatedRowsOpen: true,
            scrollTop: 420,
        });
        expect(readRowArticleViewRestoreState("dev_agent_tasks", 890)).toEqual({
            relatedTabKey: null,
            relatedRowsOpen: null,
            scrollTop: null,
        });
    });

    test("keeps restore fields on F5 of the same row and clears them when the ticket changes", () => {
        setUnifiedTableState("dev_agent_tasks", {
            articleView: {
                expandedId: 889,
                relatedTabKey: "dev_agent_task_todos__task_id__",
                relatedRowsOpen: true,
                scrollTop: 180,
            },
        });

        expect(articleViewRestoreFieldsForRowChange("dev_agent_tasks", 889)).toEqual({});
        expect(articleViewRestoreFieldsForRowChange("dev_agent_tasks", 890)).toEqual({
            relatedTabKey: null,
            relatedRowsOpen: null,
            scrollTop: null,
        });
    });

    test("persists reader related-tab and related-rows state without changing another ticket", () => {
        setUnifiedTableState("dev_agent_tasks", { articleView: { expandedId: 889 } });
        persistRowArticleViewRestoreState("dev_agent_tasks", 890, {
            relatedTabKey: "dev_agent_task_todos__task_id__",
        });
        expect(getUnifiedTableState("dev_agent_tasks").articleView.relatedTabKey).toBeUndefined();

        persistRowArticleViewRestoreState("dev_agent_tasks", 889, {
            relatedTabKey: "dev_agent_task_todos__task_id__",
            relatedRowsOpen: true,
        });
        expect(getUnifiedTableState("dev_agent_tasks").articleView).toEqual(
            expect.objectContaining({
                expandedId: 889,
                relatedTabKey: "dev_agent_task_todos__task_id__",
                relatedRowsOpen: true,
            }),
        );
    });

    test("restores article content scroll and remembers later user scroll", async () => {
        setUnifiedTableState("dev_agent_tasks", {
            articleView: { expandedId: 889, scrollTop: 360 },
        });
        const content = document.createElement("div");
        const persistence = attachRowArticleContentScrollPersistence(
            content,
            "dev_agent_tasks",
            889,
        );

        persistence.restore();
        expect(content.scrollTop).toBe(360);
        content.scrollTop = 0;
        content.dispatchEvent(new Event("scroll"));
        expect(getUnifiedTableState("dev_agent_tasks").articleView.scrollTop).toBe(360);

        await new Promise((resolve) => requestAnimationFrame(resolve));
        content.scrollTop = 90;
        content.dispatchEvent(new Event("scroll"));
        expect(getUnifiedTableState("dev_agent_tasks").articleView.scrollTop).toBe(90);
        persistence.detach();
    });

    test("records Related rows disclosure toggles for the open ticket", () => {
        setUnifiedTableState("dev_agent_tasks", { articleView: { expandedId: 889 } });
        const section = document.createElement("section");
        bindRelatedRowsDisclosurePersist(section, "dev_agent_tasks", 889);
        section.dispatchEvent(new CustomEvent("animated-disclosure-toggle", {
            detail: { expanded: true },
        }));
        expect(getUnifiedTableState("dev_agent_tasks").articleView.relatedRowsOpen).toBe(true);
        section.dispatchEvent(new CustomEvent("animated-disclosure-toggle", {
            detail: { expanded: false },
        }));
        expect(getUnifiedTableState("dev_agent_tasks").articleView.relatedRowsOpen).toBe(false);
    });
});
