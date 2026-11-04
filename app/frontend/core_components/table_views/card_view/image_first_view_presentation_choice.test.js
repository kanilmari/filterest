// image_first_view_presentation_choice.test.js
// Proves image-first opens chosen in the view picker's split button: fresh record, text-only body, history mark.
// Bridges the shared opener with its real history module, mocking only network, modal and content builders.
// Exists so an explicit IFAV choice survives reload and Forward without reviving stale or denied photos.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";

const { buildContentMock, loadSession, openImageModalContentMock, grants } = vi.hoisted(() => ({
    buildContentMock: vi.fn(),
    loadSession: { fetchDynamicChildren: vi.fn() },
    openImageModalContentMock: vi.fn(),
    grants: new Set(),
}));

vi.mock("./row_article_section_defaults.js", () => ({ loadRowArticleSectionDefaults: vi.fn(async () => ({})) }));
vi.mock("../../pipeline/navigation_pipeline.js", () => ({ runNavigationPipeline: vi.fn(async (context) => context) }));
vi.mock("../../navigation/nav_engine/dataset_aliases.js", () => ({ buildDatasetPath: (name) => "/" + name }));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({ DATASET_PREFIX: "/" }));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: vi.fn() }));
vi.mock("./card_image_modal.js", () => ({
    openImageModalContent: openImageModalContentMock,
    transitionImageFirstModalContent: vi.fn(() => null),
}));
vi.mock("./row_article_content_builder.js", () => ({ buildRowArticleContent: buildContentMock }));
vi.mock("./row_article_data_types_resolver.js", () => ({ resolveRowArticleDataTypes: vi.fn(() => ({})) }));
vi.mock("./row_article_load_session.js", () => ({ createRowArticleLoadSession: vi.fn(() => loadSession) }));
vi.mock("../../route_permission_checker.js", () => ({
    hasRoutePermission: vi.fn((route) => grants.has(route)),
    hasDatasetPermission: vi.fn(async () => true),
}));
vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({ fetchCurrentUserProfile: vi.fn(async () => ({ user_id: 1 })) }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: vi.fn((key) => key) }));
vi.mock("../../../ui_config.js", () => ({
    enable_experimental_row_article_row_navigation: false,
    image_first_view_details_position: "after_description",
}));

import { openImageFirstView } from "./image_first_view_opener.js";
import { fetchDatasetData } from "../../endpoints/endpoint_data_fetcher.js";
import { runNavigationPipeline } from "../../pipeline/navigation_pipeline.js";

const TYPES = { title: { card_element: "header" }, photo: { card_element: "image" } };
const VIEW = '[data-testid="image-first-view"]';
const savedEntry = () => history.state?.imageFirstView;

function content() {
    const element = document.createElement("div");
    element.className = "row_article_content";
    element.innerHTML = '<h1 class="big_card_header">Fresh title</h1>';
    return element;
}

beforeEach(() => {
    document.body.replaceChildren();
    history.replaceState({}, "", "/examples?view=table");
    grants.clear(); grants.add("/ui/view/article_view"); grants.add("/ui/view/image_first_page_view");
    vi.mocked(fetchDatasetData).mockReset().mockResolvedValue({
        columns: ["title", "photo"], data: [{ id: 3, title: "Fresh title", photo: "" }], types: TYPES,
    });
    loadSession.fetchDynamicChildren.mockReset().mockResolvedValue({ child_tables: [], card_picture: "" });
    buildContentMock.mockReset().mockImplementation(async () => ({ rowArticleContentElement: content() }));
    openImageModalContentMock.mockReset().mockImplementation(({ contentElement }) => {
        document.body.append(contentElement);
        return { modal: document.createElement("div"), close: vi.fn() };
    });
});

describe("explicit IFAV choice", () => {
    test("fetches the permitted record with its current fields from an id only", async () => {
        await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, presentationChoice: true });
        expect(fetchDatasetData).toHaveBeenCalledWith({ dataset_name: "examples", filters: { id: 3 },
            view_key: "article_view", callerName: "openImageFirstView" });
        expect(buildContentMock).toHaveBeenCalledWith(expect.objectContaining({ id: 3, title: "Fresh title" }),
            "examples", TYPES, expect.anything(), expect.anything(), expect.anything(), true,
            expect.anything(), expect.anything());
    });

    test("a readable row without permitted photos opens as a text-only article and marks its entry", async () => {
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, presentationChoice: true })).not.toBeNull();
        const view = document.querySelector(VIEW);
        expect(view.classList.contains("image_first_view--text-only")).toBe(true);
        expect(view.querySelector(".row_article_image_first_stage, img")).toBeNull();
        expect(view.querySelector(".image_first_view_article_content").textContent).toContain("Fresh title");
        expect(location.pathname).toBe("/examples/3");
        expect(new URL(location.href).searchParams.get("view")).toBe("image_first_view");
        expect(location.hash).toBe("");
        expect(savedEntry()).toMatchObject({ dataset: "examples", rowId: "3", presentationChoice: true });
        expect(savedEntry().origin.url).toContain("/examples?view=table");
    });

    test("a row with a permitted photo keeps the full-height stage", async () => {
        loadSession.fetchDynamicChildren.mockResolvedValueOnce({ child_tables: [], card_picture: "card.png" });
        await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, presentationChoice: true });
        const view = document.querySelector(VIEW);
        expect(view.classList.contains("image_first_view--text-only")).toBe(false);
        expect(view.querySelector(".row_article_image_first_stage")).not.toBeNull();
    });

    test("a failed media lookup uses only the fresh record's own fields, never an older picture", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        loadSession.fetchDynamicChildren.mockRejectedValueOnce(new Error("Unavailable"));
        await openImageFirstView({ tableName: "examples", rowItem: { id: 3, photo: "stale.png" }, presentationChoice: true });
        expect(document.querySelector(`${VIEW} img`)).toBeNull();
        expect(document.querySelector(VIEW).classList.contains("image_first_view--text-only")).toBe(true);
        warn.mockRestore();
    });

    test("a photo-click open without photos keeps the existing contract and opens nothing", async () => {
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3, title: "Card" } })).toBeNull();
        expect(openImageModalContentMock).not.toHaveBeenCalled();
        expect(location.pathname).toBe("/examples");
    });

    test("a denied or removed record, a failed fetch or a refused route never opens content", async () => {
        vi.mocked(fetchDatasetData).mockResolvedValueOnce({ data: [], types: {} });
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, presentationChoice: true })).toBeNull();
        vi.mocked(fetchDatasetData).mockRejectedValueOnce(new Error("403"));
        await expect(openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, presentationChoice: true }))
            .rejects.toThrow("403");
        vi.mocked(fetchDatasetData).mockClear();
        vi.mocked(runNavigationPipeline).mockResolvedValueOnce({ abort: true, reason: "dirty_form" });
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, presentationChoice: true })).toBeNull();
        expect(fetchDatasetData).not.toHaveBeenCalled();
        expect(openImageModalContentMock).not.toHaveBeenCalled();
        expect(location.pathname).toBe("/examples");
    });
});

describe("reload and Forward", () => {
    test("restoring a chosen entry reopens the text-only article from a fresh record", async () => {
        history.replaceState({ imageFirstView: { dataset: "examples", rowId: "3", image: "",
            origin: { url: location.origin + "/examples?view=table", entryId: "a" }, presentationChoice: true } },
        "", "/examples/3?view=image_first_view");
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, restoringHistory: true })).not.toBeNull();
        expect(fetchDatasetData).toHaveBeenCalledOnce();
        expect(document.querySelector(VIEW).classList.contains("image_first_view--text-only")).toBe(true);
        expect(savedEntry().presentationChoice).toBe(true);
    });

    test("restoring a photo-click entry whose photo is gone still opens nothing", async () => {
        history.replaceState({ imageFirstView: { dataset: "examples", rowId: "3", image: "gone.png" } },
            "", "/examples/3?view=image_first_view#image=gone.png");
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, restoringHistory: true })).toBeNull();
        expect(openImageModalContentMock).not.toHaveBeenCalled();
    });

    test("a mark saved for another row is not trusted", async () => {
        history.replaceState({ imageFirstView: { dataset: "examples", rowId: "4", presentationChoice: true } },
            "", "/examples/3?view=image_first_view");
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, restoringHistory: true })).toBeNull();
    });
});

describe("explicit Page choice", () => {
    test("opens Page without an image and without the Article route", async () => {
        grants.delete("/ui/view/article_view");
        vi.mocked(fetchDatasetData).mockResolvedValueOnce({ columns: ["title"], data: [{ id: 3, title: "Page" }], types: {} });
        expect(await openImageFirstView({ tableName: "examples", rowItem: { id: 3 }, layout: "page",
            presentationChoice: true })).not.toBeNull();
        expect(fetchDatasetData).toHaveBeenCalledWith(expect.objectContaining({ view_key: "image_first_page_view" }));
        const view = document.querySelector(".image_first_page_view");
        expect(view.querySelector("img, .row_article_page_image, .row_article_image_first_stage")).toBeNull();
        expect(new URL(location.href).searchParams.get("view")).toBe("image_first_page_view");
    });
});
