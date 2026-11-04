// row_presentation_cancellation.test.js
// Proves picker cancellation through real row resolution, image-first opening and history commitment.
// Bridges controlled network/content delays with actual modal reuse and phone-panel dismissal.
// Keeps navigation-away and changed-listing answers from becoming visible or writing history.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { fetchRows, buildContent, loadSession } = vi.hoisted(() => ({
    fetchRows: vi.fn(), buildContent: vi.fn(),
    loadSession: { fetchDynamicChildren: vi.fn(async () => ({ child_tables: [], card_picture: "" })) },
}));
vi.mock("../../endpoints/endpoint_data_fetcher.js", () => ({ fetchDatasetData: fetchRows }));
vi.mock("../../pipeline/navigation_pipeline.js", () => ({ runNavigationPipeline: vi.fn(async context => context) }));
vi.mock("../../route_permission_checker.js", () => ({ hasRoutePermission: () => true, hasDatasetPermission: async () => true }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: key => key }));
vi.mock("../../state_stores/lang_preference_reader.js", () => ({ getLanguageWithBrowserFallback: () => "fi" }));
vi.mock("../../user_tools/current_user_profile_fetcher.js", () => ({ fetchCurrentUserProfile: async () => ({ user_id: 1 }) }));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({ showToast: vi.fn() }));
vi.mock("../../../icons/icon_loader.js", () => ({ setElementSvgContent: vi.fn(async () => {}) }));
vi.mock("../card_view/row_article_section_defaults.js", () => ({ loadRowArticleSectionDefaults: async () => ({}) }));
vi.mock("../card_view/row_article_content_builder.js", () => ({ buildRowArticleContent: buildContent }));
vi.mock("../card_view/row_article_data_types_resolver.js", () => ({ resolveRowArticleDataTypes: () => ({}) }));
vi.mock("../card_view/row_article_load_session.js", () => ({ createRowArticleLoadSession: () => loadSession }));
vi.mock("../../../ui_config.js", () => ({
    enable_experimental_row_article_row_navigation: false, image_first_view_details_position: "after_description",
}));

import { openChosenRowPresentation } from "./row_presentation_opener.js";
import { beginRowPresentationRequest } from "./row_presentation_choice.js";
import { createRowPresentationSplitButton } from "./row_presentation_split_button.js";
import { openImageFirstView } from "../card_view/image_first_view_opener.js";
import { openImageModal } from "../card_view/card_image_modal.js";
import { createModal, hideModal, showModal } from "../../../reusable_components/modal/modal_builder.js";
import { setSelectedDataset } from "../../state_stores/dataset_selection_saver.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { wireOutsidePanelClose } from "../../filterbar/filterbar_outside_panel_close.js";
import { rememberHistoryDatasetView, writeHistoryEntry } from "../../navigation/nav_engine/history_entry_state.js";
import { getParams, setParams, updateURL } from "../../navigation/nav_engine/query_params.js";
import { getDatasetListingSignature } from "../../infinite_scroll/dataset_listing_filters.js";
import { VIEW_DEACTIVATE_EVENT } from "../../../reusable_components/view_lifecycle_events.js";

const VIEW = '[data-testid="image-first-view"]';
const response = () => ({ data: [{ id: 3, title: "Current row" }], columns: ["title"], types: {} });
function deferred() {
    let resolve;
    const promise = new Promise(answer => { resolve = answer; });
    return { promise, resolve };
}
function content() {
    return { rowArticleContentElement: document.createElement("article") };
}
function open(options = {}) {
    return openChosenRowPresentation({ tableName: "demo", viewKey: "image_first_view",
        loadOpener: async () => ({ openImageFirstView }), ...options });
}
function historyWrites() {
    return { push: vi.spyOn(history, "pushState"), replace: vi.spyOn(history, "replaceState"), length: history.length };
}
function expectNoOpen(writes) {
    expect(document.querySelector(VIEW)).toBeNull();
    expect(writes.push).not.toHaveBeenCalled();
    expect(writes.replace).not.toHaveBeenCalled();
    expect(history.length).toBe(writes.length);
}

beforeEach(() => {
    document.body.innerHTML = '<div id="demo_container"><div class="tab_parts_container" data-view="table"></div></div>';
    history.replaceState({ __filterestEntryId: "origin" }, "", "/demo?view=table");
    sessionStorage.clear(); localStorage.clear();
    setSelectedDataset("demo"); setChosenDatasetView("demo", "table");
    setUnifiedTableState("demo", { filters: { status: "open" }, sort: { column: "id", direction: "ASC" } });
    setParams("demo", {});
    fetchRows.mockReset().mockImplementation(async () => response());
    buildContent.mockReset().mockImplementation(async () => content());
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    // Keep close from scheduling jsdom traversal into another test's history.
    vi.spyOn(history, "back").mockImplementation(() => {});
});
afterEach(() => {
    hideModal({ immediate: true });
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("the listing remains current through record loading and rendering", () => {
    test.each(["filters", "sort"])("changed shared %s at the same address discard a delayed record", async field => {
        const record = deferred();
        fetchRows.mockImplementation(options => options.callerName === "openImageFirstView" ? record.promise : response());
        const writes = historyWrites();
        const opening = open();
        await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledWith(expect.objectContaining({ callerName: "openImageFirstView" })));
        const address = location.href;
        setUnifiedTableState("demo", field === "filters" ? { filters: { status: "closed" } }
            : { sort: { column: "id", direction: "DESC" } });
        expect(location.href).toBe(address);
        record.resolve(response());
        expect(await opening).toEqual({ status: "stale", rowId: 3 });
        expect(buildContent).not.toHaveBeenCalled();
        expectNoOpen(writes);
    });

    test("a change during content rendering still prevents history commitment", async () => {
        const rendered = deferred();
        buildContent.mockReturnValueOnce(rendered.promise);
        const writes = historyWrites();
        const opening = open();
        await vi.waitFor(() => expect(buildContent).toHaveBeenCalledOnce());
        setUnifiedTableState("demo", { sort: { column: "id", direction: "DESC" } });
        rendered.resolve(content());
        expect(await opening).toEqual({ status: "stale", rowId: 3 });
        expectNoOpen(writes);
    });

    test.each([true, false])("an uninterrupted open survives its own commit (origin already has identity: %s)", async hasIdentity => {
        if (!hasIdentity) history.replaceState({}, "", location.href);
        const writes = historyWrites();
        expect(await open()).toEqual({ status: "opened", rowId: 3 });
        expect(document.querySelector(VIEW)).not.toBeNull();
        expect(history.state.imageFirstView).toMatchObject({ dataset: "demo", rowId: "3", presentationChoice: true });
        expect(writes.push).toHaveBeenCalledOnce();
        expect(writes.replace).toHaveBeenCalledTimes(hasIdentity ? 0 : 1);
        expect(history.length).toBe(writes.length + 1);
    });
});

describe("every application address write permanently cancels a pending opening", () => {
    test.each(["sort round trip", "filter set and cleared", "replace with itself", "suppressed replace with itself"])("%s before the held first-row answer", async kind => {
        // An object-valued owner keeps the native replacement enabled, even at
        // the same address with equal state; the primitive-only variant is skipped.
        if (kind === "replace with itself") history.replaceState({ ...history.state, otherOwner: { value: 7 } }, "", location.href);
        const initialParams = { view: "table", sort_column: "id", sort_order: "ASC" };
        updateURL("demo", initialParams, undefined, { replace: true });
        const signature = () => {
            const state = getUnifiedTableState("demo");
            return getDatasetListingSignature("demo", state.filters, state.sort);
        };
        const origin = { address: location.href, state: structuredClone(history.state), signature: signature() };
        const first = deferred();
        fetchRows.mockReturnValueOnce(first.promise);
        const opening = open();
        await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledOnce());
        const writes = historyWrites();
        if (kind === "sort round trip") {
            for (const direction of ["DESC", "ASC"]) {
                setUnifiedTableState("demo", { sort: { column: "id", direction } });
                updateURL("demo", { ...getParams("demo"), sort_order: direction }, undefined, { replace: true });
            }
        } else if (kind === "filter set and cleared") {
            const filters = { ...getUnifiedTableState("demo").filters };
            setUnifiedTableState("demo", { filters: { ...filters, title: "one" } });
            updateURL("demo", { ...initialParams, title: "one" }, undefined, { replace: true });
            setUnifiedTableState("demo", { filters });
            updateURL("demo", initialParams, undefined, { replace: true });
        } else {
            // Both an actual same-address write and the writer's suppressed
            // no-op must cancel, while preserving that existing distinction.
            updateURL("demo", initialParams, undefined, { replace: true });
        }
        expect(location.href).toBe(origin.address);
        expect(history.state).toEqual(origin.state);
        expect(signature()).toBe(origin.signature);
        const replacements = kind === "suppressed replace with itself" ? 0 : kind === "replace with itself" ? 1 : 2;
        expect(writes.replace).toHaveBeenCalledTimes(replacements);
        writes.replace.mockClear();
        first.resolve(response());
        expect(await opening).toEqual({ status: "stale" });
        expect(buildContent).not.toHaveBeenCalled();
        expectNoOpen(writes);
    });

    test("a state-only native replacement ends an activation before its lazy import", async () => {
        const isRequestCurrent = beginRowPresentationRequest("demo");
        const address = location.href;
        const entryId = history.state.__filterestEntryId;
        rememberHistoryDatasetView("demo", "table");
        expect(location.href).toBe(address);
        expect(history.state.__filterestEntryId).toBe(entryId);
        const writes = historyWrites();
        expect(await open({ isRequestCurrent })).toEqual({ status: "stale" });
        expectNoOpen(writes);
    });
});

test("a successful split-button activation clears busy state after committing its new address", async () => {
    const split = createRowPresentationSplitButton({ tableName: "demo", openPresentation: open });
    document.body.append(split);
    split.querySelector('[data-testid="row-presentation-toggle"]').click();
    document.querySelector('[data-testid="row-presentation-menu-option-image_first_view"]').click();
    await vi.waitFor(() => expect(document.querySelector(VIEW)).not.toBeNull());
    expect(split.hasAttribute("aria-busy")).toBe(false);
});

describe("navigation permanently cancels the original activation", () => {
    test.each([false, true])("A → B → A cannot revive A (choice in B: %s)", async chooseInB => {
        const first = deferred();
        fetchRows.mockReturnValueOnce(first.promise);
        const opening = open();
        await vi.waitFor(() => expect(fetchRows).toHaveBeenCalledOnce());
        const origin = { url: location.href, state: history.state };
        writeHistoryEntry("/other?view=table");
        setSelectedDataset("other");
        document.getElementById("demo_container").dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
        if (chooseInB) {
            const split = createRowPresentationSplitButton({ tableName: "other", selectArticle: () => {} });
            split.querySelector('[data-testid="view-btn-article_view"]').click();
        }
        // Restore the exact address AND entry identity: equality cannot revive it.
        history.replaceState(origin.state, "", origin.url);
        setSelectedDataset("demo");
        window.dispatchEvent(new PopStateEvent("popstate", { state: origin.state }));
        const writes = historyWrites();
        first.resolve(response());
        expect(await opening).toEqual({ status: "stale" });
        expectNoOpen(writes);
    });

    test("view deactivation alone ends the request, even without a history move or a B choice", async () => {
        const first = deferred();
        fetchRows.mockReturnValueOnce(first.promise);
        const opening = open();
        setSelectedDataset("other");
        document.getElementById("demo_container").dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));
        setSelectedDataset("demo");
        const writes = historyWrites();
        first.resolve(response());
        expect(await opening).toEqual({ status: "stale" });
        expectNoOpen(writes);
    });

    test("any history move ends a pre-import activation, even at the same URL and entry", async () => {
        const isRequestCurrent = beginRowPresentationRequest("demo");
        window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
        const writes = historyWrites();
        expect(await open({ isRequestCurrent })).toEqual({ status: "stale" });
        expectNoOpen(writes);
    });

    test("a newer activation in any dataset ends an older unfinished one", async () => {
        const first = deferred();
        fetchRows.mockReturnValueOnce(first.promise);
        const opening = open();
        beginRowPresentationRequest("other");
        const writes = historyWrites();
        first.resolve(response());
        expect(await opening).toEqual({ status: "stale" });
        expectNoOpen(writes);
    });
});

describe("picker dialog ownership", () => {
    test.each([true, false])("ordinary and photo dialogs retain main's outside dismissal (close picker first: %s)", async closeFirst => {
        const panel = document.createElement("aside");
        document.body.append(panel);
        const controller = new AbortController();
        const onClose = vi.fn();
        wireOutsidePanelClose({ tableName: "demo", panel, signal: controller.signal,
            isNarrowScreen: () => true, isHidden: () => false, onClose });
        try {
            expect(await open()).toEqual({ status: "opened", rowId: 3 });
            const overlay = document.getElementById("custom_modal_overlay");
            expect(overlay.dataset.rowPresentationOwner).toBeUndefined();
            expect(document.querySelector(VIEW).dataset.rowPresentationOwner).toBe("demo");
            document.querySelector(`${VIEW} .image_first_view_article_content`).click();
            expect(onClose).not.toHaveBeenCalled();
            if (closeFirst) {
                overlay.querySelector('[data-testid="modal-close-button"]').click();
                expect(onClose).not.toHaveBeenCalled();
                expect(document.querySelector('[data-row-presentation-owner]')).toBeNull();
            }
            const ordinary = document.createElement("button");
            createModal({ contentElements: [ordinary] }); showModal();
            expect(document.querySelector('[data-row-presentation-owner]')).toBeNull();
            ordinary.click();
            expect(onClose).toHaveBeenCalledTimes(1);
            openImageModal("photo.png");
            overlay.querySelector(".image_modal_wrapper img").click();
            expect(onClose).toHaveBeenCalledTimes(2);
        } finally { controller.abort(); }
    });
});
