// @vitest-environment jsdom
// row_article_media_hydrator_restore.test.js
// Verifies article media hydration restores related-tab and Related rows state.
// Bridges persisted articleView restore fields with related-tab construction.
// Exists so F5 on the same ticket article_view URL reopens Agent task todos.
import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    buildTabs: vi.fn(async () => {
        const tabs = document.createElement("div");
        tabs.className = "related_tabs_container";
        return tabs;
    }),
}));

vi.mock("./row_article_child_tabs.js", () => ({
    buildRowArticleRelatedTabs: mocks.buildTabs,
}));
vi.mock("./row_article_image_gallery.js", () => ({
    buildRowArticleImageGallery: vi.fn(),
}));
vi.mock("./row_article_attachment_list.js", () => ({
    buildRowArticleAttachmentList: vi.fn(),
}));
vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: vi.fn(),
    primeDatasetPermissions: vi.fn(),
}));
vi.mock("./row_article_inline_media.js", () => ({
    syncRowArticleInlineMedia: vi.fn(),
    disposeRowArticleInlineMedia: vi.fn(),
}));
vi.mock("./row_article_asset_resolver.js", () => ({
    filterRowArticleNonMediaChildTables: (tables) => tables,
    resolveRowArticleAttachmentListChild: vi.fn(),
    resolveRowArticleDynamicAssetChildren: vi.fn(() => ({})),
    resolveRowArticleImageGalleryChild: vi.fn(),
}));

import { setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { createRowArticleMediaHydrator } from "./row_article_media_hydrator.js";

beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    vi.clearAllMocks();
});

test("hydrates Related rows open with the restored Agent task todos tab", async () => {
    setUnifiedTableState("dev_agent_tasks", {
        articleView: {
            collapsed: true,
            expandedId: 889,
            relatedTabKey: "dev_agent_task_todos__task_id__",
            relatedRowsOpen: true,
            scrollTop: 240,
        },
    });

    const article = document.createElement("article");
    const content = document.createElement("div");
    content.className = "big_card_content row_article_content";
    article.append(content);
    document.body.append(article);

    const session = {
        fetchDynamicChildren: vi.fn(async () => ({
            child_tables: [{
                dataset: "dev_agent_task_todos",
                column: "task_id",
                row_count: 1,
                rows: [{ id: 101, todo_text: "Stay open after F5", status: "todo" }],
            }],
        })),
        fetchImageLinking: vi.fn(async () => null),
        fetchAttachmentLinking: vi.fn(async () => null),
    };
    const controller = createRowArticleMediaHydrator({
        rowArticleElement: article,
        rowArticleContentElement: content,
        rowArticleLoadSession: session,
        rowItem: { id: 889 },
        tableName: "dev_agent_tasks",
        parentImageRows: [],
        showRelatedItems: true,
        canCommit: () => true,
        onLinkedTaskChildCountChange: vi.fn(),
        sectionDefaults: { related_rows: false, images: false, attachments: false },
    });

    await controller.hydrateRelatedSections();

    expect(mocks.buildTabs).toHaveBeenCalledWith(
        expect.any(Array),
        "dev_agent_tasks",
        889,
        undefined,
        "dev_agent_task_todos__task_id__",
        expect.objectContaining({ fetchDynamicChildren: session.fetchDynamicChildren }),
    );
    expect(content.querySelector(".row_article_related_items_section")?.dataset.disclosureState)
        .toBe("expanded");
    expect(content.scrollTop).toBe(240);
});
