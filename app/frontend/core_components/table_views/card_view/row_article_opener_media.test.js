// @vitest-environment jsdom
// row_article_opener_media.test.js
// Verifies article gallery, inline-image and caption behavior through the shared opener.
// Bridges the real opener and catalogue with shared drawing/network stubs.
// Keeps every original promise while allowing the media suite to live separately.

import { describe, expect, onTestFinished, test, vi } from "vitest";
import { setupRowArticleOpenerTests, articleUiSettings, flushRowArticleHydration } from "./row_article_opener_test_setup.js";
import { openRowArticleView } from "./row_article_opener.js";
import { datasetAppearanceState } from "../dataset_appearance_state.js";
import * as inlineMedia from "./row_article_inline_media.js";
import { beginRowPresentationRequest } from "../row_presentation/row_presentation_choice.js";
import { beginImageFirstViewOpen, handleImageFirstViewHistory, imageFirstViewDidClose } from "../../navigation/nav_engine/image_first_view_history.js";
import { parseRoleString } from "./card_field_formatter.js";
import { hasDatasetPermission, primeDatasetPermissions } from "../../route_permission_checker.js";
import { buildRowArticleRelatedTabs } from "./row_article_child_tabs.js";
import { buildRowArticleImageGallery } from "./row_article_image_gallery.js";
import { buildRowArticleAttachmentList } from "./row_article_attachment_list.js";
import { resolveRowArticleImageGalleryChild, resolveRowArticleParentImageRows, resolveRowArticleSharedAssetChild } from "./row_article_asset_resolver.js";
import { buildRowArticleContent } from "./row_article_content_builder.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { getAllSpecs, setAllSpecs } from "../../state_stores/table_specs_reader.js";

describe("openRowArticleView", () => {
    setupRowArticleOpenerTests();

    function prepareInlineCaptionArticle({ parentRows = [], childRows = [], loadSession } = {}) {
        document.body.innerHTML = `<div id="tickets_article_view_container"><div class="card_view_wrapper"><div class="card_container"><div class="card" data-id="2"></div></div><div class="row_article_placeholder"></div></div></div>`;
        const content = document.createElement("div");
        const inlineImage = document.createElement("div");
        inlineImage.className = "big_card_image";
        inlineImage.dataset.rowArticleImageColumn = "cached_image";
        const image = document.createElement("img");
        image.src = "/storage/10_2_1.webp";
        inlineImage.appendChild(image);
        content.appendChild(inlineImage);
        vi.mocked(buildRowArticleContent).mockResolvedValueOnce({ rowArticleContentElement: content });
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(parentRows);
        const child = { dataset: "tickets_assets", column: "tickets_id", rows: childRows };
        vi.mocked(resolveRowArticleSharedAssetChild).mockReturnValue(child);
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValue(child);
        const session = loadSession ?? {
            fetchDynamicChildren: vi.fn(async () => ({
                gallery_relation: { dataset: "tickets_assets", column: "tickets_id" },
                child_tables: [child],
            })),
            fetchAttachmentLinking: vi.fn(async () => null),
        };
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce(session);
        return { inlineImage, session, selectedCard: document.querySelector(".card") };
    }

    function galleryResponse(rows) {
        const relation = { dataset: "tickets_assets", column: "tickets_id" };
        return { gallery_relation: relation, child_tables: [{ ...relation, rows }] };
    }

    async function openClassicAndReturnFromImages({ browseFirst = false, firstRequest, defaultOpener = false } = {}) {
        articleUiSettings.showRelatedItems = false;
        const childRows = Array.from({ length: 6 }, (_, index) => ({ filename: `10_2_${index + 1}.webp` }));
        const { createRowArticleLoadSession: createSession } = await vi.importActual("./row_article_load_session.js");
        const { resolveRowArticleImageGalleryChild: resolveGallery } = await vi.importActual("./row_article_asset_resolver.js");
        const requestChildren = vi.fn(async () => galleryResponse(childRows));
        if (firstRequest) requestChildren.mockImplementationOnce(firstRequest);
        const session = createSession({ tableName: "tickets", rowId: 2, requestFn: requestChildren });
        const { inlineImage, selectedCard } = prepareInlineCaptionArticle({
            parentRows: childRows, childRows, loadSession: session,
        });
        vi.mocked(resolveRowArticleImageGalleryChild).mockImplementation(resolveGallery);
        inlineImage.querySelector("img").src = "/storage/10/2/original/10_2_1.webp";
        const root = document.createElement("section");
        root.id = "tickets_container";
        root.innerHTML = '<div class="tab_parts_container" data-view="article_view"></div>';
        document.body.append(root);
        onTestFinished(async () => { root.remove(); await flushRowArticleHydration(); });
        root.firstElementChild.append(document.getElementById("tickets_article_view_container"));

        const row = { id: 2, cached_image: childRows[0].filename };
        const request = defaultOpener ? null : beginRowPresentationRequest("tickets");
        if (defaultOpener) {
            // Previous/Next in the classic record bar calls this three-argument overload.
            await openRowArticleView(row, "tickets", selectedCard);
        } else {
            await openRowArticleView(row, "tickets", selectedCard, {
                isCurrent: request, withOwnAddressWrite: request.withOwnAddressWrite,
            });
        }
        await flushRowArticleHydration();
        const next = inlineImage.querySelector('[data-testid="row-article-image-next"]');
        const position = inlineImage.querySelector('[data-testid="row-article-image-position"]');
        expect(position.textContent).toBe("1 / 6");
        expect(next.disabled).toBe(false);
        if (browseFirst) next.click();
        const origin = { state: history.state, url: location.href };
        const intent = beginImageFirstViewOpen({ tableName: "tickets", rowId: 2, listPath: "/tickets" });
        const overlayId = intent.commit(childRows[0].filename);
        expect(overlayId).toBeTruthy();
        const back = vi.spyOn(history, "back").mockImplementation(() => {});
        imageFirstViewDidClose(overlayId);
        expect(back).toHaveBeenCalledOnce();
        history.replaceState(origin.state, "", origin.url);
        window.dispatchEvent(new PopStateEvent("popstate", { state: origin.state }));
        if (request) expect(request()).toBe(false);
        expect(requestChildren).toHaveBeenCalledTimes(1);
        return { inlineImage, next, position, request, root, requestChildren, childRows };
    }

    test("keeps the mounted classic carousel usable after closing its image-first overlay", async () => {
        const { inlineImage, next, position, request, root } = await openClassicAndReturnFromImages();
        let current = true;
        expect(await handleImageFirstViewHistory({
            tableName: "tickets", rowId: "2", viewKey: "article_view", isCurrentNavigation: () => current,
        })).toBe(true);
        expect(root.contains(next)).toBe(true);
        next.click();
        expect(position.textContent).toBe("2 / 6");
        expect(inlineImage.querySelector("img").src).toContain("/storage/10/2/original/10_2_2.webp");
        expect(request()).toBe(false);
        current = false;
        next.click();
        expect(position.textContent).toBe("2 / 6");
    });

    test("preserves a picture already selected in the mounted classic article", async () => {
        const { next, position } = await openClassicAndReturnFromImages({ browseFirst: true });
        expect(position.textContent).toBe("2 / 6");
        await handleImageFirstViewHistory({ tableName: "tickets", rowId: "2", viewKey: "article_view" });
        expect(position.textContent).toBe("2 / 6");
        next.click();
        expect(position.textContent).toBe("3 / 6");
    });

    test("does not rebind a different classic row", async () => {
        const wrongRow = await openClassicAndReturnFromImages();
        expect(await handleImageFirstViewHistory({ tableName: "tickets", rowId: "3", viewKey: "article_view" })).toBe(false);
        wrongRow.next.click();
        expect(wrongRow.position.textContent).toBe("1 / 6");
    });

    const classicTarget = { tableName: "tickets", rowId: "2", viewKey: "article_view" };

    test.each([false, true])("reads fresh media after a completed request (default opener %s)", async (defaultOpener) => {
        const { requestChildren, childRows, inlineImage, next, position } = await openClassicAndReturnFromImages({ defaultOpener });
        datasetAppearanceState.forget("tickets_assets");
        requestChildren.mockResolvedValueOnce(galleryResponse([childRows[0], childRows[4]]));
        await handleImageFirstViewHistory(classicTarget);
        expect(requestChildren).toHaveBeenCalledTimes(2);
        expect(position.textContent).toBe("1 / 2");
        next.click();
        expect(position.textContent).toBe("2 / 2");
        expect(inlineImage.querySelector("img").src).toContain("10_2_5.webp");
    });

    test.each([false, true])("ignores the old pending response during return (default opener %s)", async (defaultOpener) => {
        const original = Promise.withResolvers();
        const refresh = Promise.withResolvers();
        const { requestChildren, childRows, inlineImage, next, position } = await openClassicAndReturnFromImages({
            defaultOpener, firstRequest: () => original.promise,
        });
        requestChildren.mockReturnValueOnce(refresh.promise);
        const sync = vi.spyOn(inlineMedia, "syncRowArticleInlineMedia");
        const restoring = handleImageFirstViewHistory(classicTarget);
        expect(requestChildren).toHaveBeenCalledTimes(2);
        expect(next.disabled).toBe(true);
        original.resolve(galleryResponse([childRows[1], childRows[2]]));
        await flushRowArticleHydration();
        expect(sync).not.toHaveBeenCalled();
        refresh.resolve(galleryResponse([childRows[0], childRows[5]]));
        await restoring;
        expect(sync).toHaveBeenCalledTimes(1);
        next.click();
        expect(position.textContent).toBe("2 / 2");
        expect(inlineImage.querySelector("img").src).toContain("10_2_6.webp");
    });

    test.each(["navigation", "child removal"])("does not sync an in-flight return after %s", async (reason) => {
        const { next, position, requestChildren, childRows } = await openClassicAndReturnFromImages();
        const refresh = Promise.withResolvers();
        requestChildren.mockReturnValueOnce(refresh.promise);
        const sync = vi.spyOn(inlineMedia, "syncRowArticleInlineMedia");
        let current = true;
        const restoring = handleImageFirstViewHistory({ ...classicTarget, isCurrentNavigation: () => current });
        if (reason === "navigation") current = false;
        else datasetAppearanceState.forget("tickets_assets");
        refresh.resolve(galleryResponse(childRows));
        await restoring;
        expect(sync).not.toHaveBeenCalled();
        next.click();
        expect(position.textContent).toBe("1 / 6");
    });

    test("stops browsing a restored gallery when its child dataset is invalidated", async () => {
        const { next, position } = await openClassicAndReturnFromImages();
        await handleImageFirstViewHistory(classicTarget);
        next.click();
        expect(position.textContent).toBe("2 / 6");
        datasetAppearanceState.forget("tickets_assets");
        next.click();
        expect(position.textContent).toBe("2 / 6");
    });

    test.each([
        ["denied", () => Promise.reject(Object.assign(new Error("Forbidden"), { status: 403 }))],
        ["aborted", () => Promise.reject(new DOMException("Cancelled", "AbortError"))],
        ["missing", () => Promise.resolve(null)],
        ["malformed", () => Promise.resolve({ child_tables: {} })],
        ["error", () => Promise.resolve({ error: "unavailable", child_tables: [] })],
    ])("does not reuse parent images when the return response is %s", async (_reason, reply) => {
        const { next, position, requestChildren } = await openClassicAndReturnFromImages();
        requestChildren.mockImplementationOnce(reply);
        const sync = vi.spyOn(inlineMedia, "syncRowArticleInlineMedia");
        await handleImageFirstViewHistory(classicTarget);
        expect(requestChildren).toHaveBeenCalledTimes(2);
        expect(sync).not.toHaveBeenCalled();
        expect(next.disabled).toBe(true);
        next.click();
        expect(position.textContent).toBe("1 / 6");
    });

    test.each(["fresh", "denied", "aborted"])("a late original response cannot replace a %s record-bar return", async (result) => {
        const original = Promise.withResolvers();
        const { inlineImage, next, position, requestChildren, childRows } = await openClassicAndReturnFromImages({
            defaultOpener: true, firstRequest: () => original.promise,
        });
        if (result === "fresh") requestChildren.mockResolvedValueOnce(galleryResponse([childRows[0], childRows[4]]));
        else if (result === "denied") requestChildren.mockRejectedValueOnce(Object.assign(new Error("Forbidden"), { status: 403 }));
        else requestChildren.mockRejectedValueOnce(new DOMException("Cancelled", "AbortError"));
        await handleImageFirstViewHistory(classicTarget);
        expect(requestChildren).toHaveBeenCalledTimes(2);
        const sync = vi.spyOn(inlineMedia, "syncRowArticleInlineMedia");
        original.resolve(galleryResponse([childRows[1], childRows[2]]));
        await flushRowArticleHydration();
        expect(sync).not.toHaveBeenCalled();
        inlineImage.querySelector(".row_article_inline_media").dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowRight", bubbles: true,
        }));
        if (result === "fresh") {
            expect(position.textContent).toBe("2 / 2");
            expect(inlineImage.querySelector("img").src).toContain("10_2_5.webp");
        } else {
            expect(next.disabled).toBe(true);
            expect(position.textContent).toBe("1 / 6");
        }
    });

    function addUnrelatedTableToNavigationTree() {
        // The navigation tree replaces the specs map when its data is refreshed.
        const specs = getAllSpecs();
        onTestFinished(() => setAllSpecs(specs));
        setAllSpecs({ ...specs, unrelated_catalog: { table_uid: 83001 } });
    }

    test.each([
        ["the gallery is invalidated", () => datasetAppearanceState.forget("tickets_assets")],
        ["an unrelated table is added to the navigation tree", addUnrelatedTableToNavigationTree],
    ])("a saved article refreshes its media after %s", async (_change, updateRegistry) => {
        vi.mocked(hasDatasetPermission).mockResolvedValue(true);
        const { inlineImage, next, position, requestChildren, childRows } = await openClassicAndReturnFromImages({ defaultOpener: true });
        requestChildren.mockResolvedValueOnce(galleryResponse([childRows[0], childRows[4]]));
        await handleImageFirstViewHistory(classicTarget);
        expect(position.textContent).toBe("1 / 2");

        const articleState = datasetAppearanceState.capture("tickets");
        const registryState = datasetAppearanceState.captureRegistry();
        updateRegistry();
        expect(datasetAppearanceState.isCurrent(articleState)).toBe(true);
        expect(datasetAppearanceState.isCurrent(registryState)).toBe(false);
        expect(requestChildren).toHaveBeenCalledTimes(2);

        requestChildren.mockResolvedValueOnce(galleryResponse([childRows[0], childRows[1], childRows[3]]));
        const edit = document.querySelector('[data-testid="big-card-edit-button"]');
        edit.click();
        edit.click();
        await vi.waitFor(() => expect(requestChildren).toHaveBeenCalledTimes(3));
        await vi.waitFor(() => expect(position.textContent).toBe("1 / 3"));
        next.click();
        expect(inlineImage.querySelector("img").src).toContain("10_2_2.webp");
    });

    test("a tree change during a save discards that media response and the next save can refresh", async () => {
        vi.mocked(hasDatasetPermission).mockResolvedValue(true);
        const { inlineImage, position, requestChildren, childRows } = await openClassicAndReturnFromImages({ defaultOpener: true });
        requestChildren.mockResolvedValueOnce(galleryResponse([childRows[0], childRows[4]]));
        await handleImageFirstViewHistory(classicTarget);

        const edit = document.querySelector('[data-testid="big-card-edit-button"]');
        const pending = Promise.withResolvers();
        requestChildren.mockReturnValueOnce(pending.promise);
        edit.click();
        edit.click();
        await vi.waitFor(() => expect(requestChildren).toHaveBeenCalledTimes(3));
        addUnrelatedTableToNavigationTree();
        const sync = vi.spyOn(inlineMedia, "syncRowArticleInlineMedia");
        pending.resolve(galleryResponse([childRows[3]]));
        await vi.waitFor(() => expect(edit.disabled).toBe(false));
        expect(sync).not.toHaveBeenCalled();
        expect(position.textContent).toBe("1 / 2");

        requestChildren.mockResolvedValueOnce(galleryResponse([childRows[2]]));
        edit.click();
        edit.click();
        await vi.waitFor(() => expect(position.textContent).toBe("1 / 1"));
        expect(requestChildren).toHaveBeenCalledTimes(4);
        expect(inlineImage.querySelector("img").src).toContain("10_2_3.webp");
    });

    test("removes old images when a successful return has no permitted media", async () => {
        const { inlineImage, next, position, requestChildren } = await openClassicAndReturnFromImages();
        requestChildren.mockResolvedValueOnce({ child_tables: [] });
        await handleImageFirstViewHistory(classicTarget);
        expect(position.textContent).toBe("");
        expect(next.disabled).toBe(true);
        expect(inlineImage.querySelector("img")).toBeNull();
    });

    test("loads classic image credits without optional related sections or editing permission checks", async () => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, session, selectedCard } = prepareInlineCaptionArticle({
            childRows: [{ filename: "10_2_1.webp", description: "Child photo credit" }],
        });
        await openRowArticleView({ id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard);
        await flushRowArticleHydration();

        expect(inlineImage.querySelector(".row_article_inline_image_caption")?.textContent).toBe("Child photo credit");
        expect(session.fetchDynamicChildren).toHaveBeenCalledTimes(1);
        // The response names the gallery, so no linking status is asked for the pictures.
        expect(session.fetchAttachmentLinking).not.toHaveBeenCalled();
        expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
        expect(buildRowArticleAttachmentList).not.toHaveBeenCalled();
        expect(buildRowArticleRelatedTabs).not.toHaveBeenCalled();
        expect(primeDatasetPermissions).not.toHaveBeenCalledWith("tickets_assets", expect.anything());
        expect(hasDatasetPermission.mock.calls.some(([, dataset]) => dataset === "tickets_assets")).toBe(false);
    });

    test.each([
        ["missing response", undefined],
        ["missing child tables", {}],
        ["failed request", new Error("Unavailable")],
    ])("keeps permitted parent credits when child loading has a %s", async (_label, response) => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, session, selectedCard } = prepareInlineCaptionArticle({
            parentRows: [{ filename: "10_2_1.webp", description: "Parent photo credit" }],
        });
        session.fetchDynamicChildren.mockImplementationOnce(async () => {
            if (response instanceof Error) throw response;
            return response;
        });
        await openRowArticleView({ id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard);
        await flushRowArticleHydration();

        expect(inlineImage.querySelector(".row_article_inline_image_caption")?.textContent).toBe("Parent photo credit");
        expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
    });

    test("clears stale parent credits when the authoritative child has no images", async () => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, selectedCard } = prepareInlineCaptionArticle({
            parentRows: [{ filename: "10_2_1.webp", description: "Deleted photo credit" }],
            childRows: [],
        });
        await openRowArticleView({ id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard);
        await flushRowArticleHydration();
        expect(inlineImage.querySelector(".row_article_inline_image_caption")).toBeNull();
    });

    test.each(["superseded", "disconnected"])("does not hydrate captions after the article becomes %s", async (state) => {
        articleUiSettings.showRelatedItems = false;
        const { inlineImage, session, selectedCard } = prepareInlineCaptionArticle({
            childRows: [{ filename: "10_2_1.webp", description: "Late photo credit" }],
        });
        let resolveChildren;
        let current = true;
        session.fetchDynamicChildren.mockImplementationOnce(() => new Promise((resolve) => { resolveChildren = resolve; }));
        await openRowArticleView(
            { id: 2, cached_image: "10_2_1.webp" }, "tickets", selectedCard,
            { isCurrent: () => current },
        );
        await flushRowArticleHydration();
        expect(session.fetchDynamicChildren).toHaveBeenCalledTimes(1);
        if (state === "superseded") current = false;
        else document.querySelector(".active_row_article").remove();
        resolveChildren({
            gallery_relation: { dataset: "tickets_assets", column: "tickets_id" },
            child_tables: [{ dataset: "tickets_assets", column: "tickets_id", rows: [{ filename: "10_2_1.webp", description: "Late photo credit" }] }],
        });
        await flushRowArticleHydration();

        expect(inlineImage.querySelector(".row_article_inline_image_caption")).toBeNull();
        expect(buildRowArticleImageGallery).not.toHaveBeenCalled();
    });

    test("passes only the card's picture, not the row's image fields, to the gallery when the response carries no gallery", async () => {
        document.body.innerHTML = `
            <div id="tickets_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="2"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='2']");
        selectedCard._data_types = {
            cached_image: { card_element: "image" },
            title: { card_element: "header" },
        };
        const parentImageRows = [{
            asset_kind: "image",
            filename: "10_2_1.webp",
            is_parent_row_image: true,
        }];
        vi.mocked(parseRoleString).mockImplementation((roleString = "") => ({
            baseRoles: String(roleString).split(/\s+/).filter(Boolean),
        }));
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(parentImageRows);
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({ child_tables: [], card_picture: "10_2_3.webp" })),
        });

        await openRowArticleView(
            { id: 2, title: "VPN disconnects", cached_image: "10_2_1.webp" },
            "tickets",
            selectedCard,
        );
        await flushRowArticleHydration();

        // The row's image fields only stand in until the response arrives.
        expect(resolveRowArticleParentImageRows).toHaveBeenCalledWith(
            expect.objectContaining({ cached_image: "10_2_1.webp" }),
            ["cached_image"],
        );
        expect(buildRowArticleImageGallery).toHaveBeenCalledWith(
            "tickets",
            2,
            null,
            expect.any(Function),
            expect.objectContaining({
                imageRows: [{ asset_kind: "image", filename: "10_2_3.webp", is_card_only_picture: true }],
                cardPicture: "10_2_3.webp",
            }),
        );
    });

    test("does not resurrect a deleted cached image once the response carries the gallery", async () => {
        document.body.innerHTML = `
            <div id="tickets_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="2"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='2']");
        selectedCard._data_types = {
            cached_image: { card_element: "image" },
            title: { card_element: "header" },
        };
        const staleParentImageRows = [{
            asset_kind: "image",
            filename: "deleted-image.webp",
            is_parent_row_image: true,
        }];
        const authoritativeImageChild = {
            dataset: "tickets_assets",
            column: "tickets_id",
            relation_kind: "shared_asset",
            rows: [],
        };
        const freshResponse = {
            gallery_relation: { dataset: "tickets_assets", column: "tickets_id" },
            card_picture: "",
            child_tables: [authoritativeImageChild],
        };
        vi.mocked(parseRoleString).mockImplementation((roleString = "") => ({
            baseRoles: String(roleString).split(/\s+/).filter(Boolean),
        }));
        vi.mocked(resolveRowArticleParentImageRows).mockReturnValueOnce(staleParentImageRows);
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve(freshResponse)),
        });
        vi.mocked(resolveRowArticleSharedAssetChild).mockReturnValueOnce(authoritativeImageChild);
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValueOnce(authoritativeImageChild);
        vi.mocked(buildRowArticleImageGallery).mockReturnValueOnce(document.createElement("div"));

        await openRowArticleView(
            { id: 2, title: "VPN disconnects", cached_image: "deleted-image.webp" },
            "tickets",
            selectedCard,
        );
        await flushRowArticleHydration();

        // The gallery comes from the response alone, never from linking metadata.
        expect(resolveRowArticleImageGalleryChild).toHaveBeenCalledWith(freshResponse);
        expect(buildRowArticleImageGallery).toHaveBeenCalledWith(
            "tickets",
            2,
            authoritativeImageChild,
            expect.any(Function),
            expect.objectContaining({ imageRows: [] }),
        );
    });

    test.each(["app_service_catalog", "ordinary_dataset"])("keeps %s inline image and gallery thumbnails visible", async (tableName) => {
        setChosenDatasetView(tableName, "article_view");
        document.body.innerHTML = `
            <div id="${tableName}_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='42']");
        const assetsChild = {
            dataset: "app_service_catalog_assets",
            column: "app_service_catalog_id",
            relation_kind: "shared_asset",
            rows: [{ id: 7, asset_kind: "image", filename: "canonical.svg" }],
        };
        const inlineImage = document.createElement("div");
        inlineImage.classList.add("big_card_image");
        inlineImage.dataset.rowArticleImageColumn = "cached_image";

        vi.mocked(buildRowArticleContent).mockResolvedValueOnce({
            rowArticleContentElement: (() => {
                const content = document.createElement("div");
                content.classList.add("big_card_content");
                content.appendChild(inlineImage);
                return content;
            })(),
        });
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({
                gallery_relation: { dataset: "app_service_catalog_assets", column: "app_service_catalog_id" },
                child_tables: [assetsChild],
            })),
        });
        vi.mocked(resolveRowArticleSharedAssetChild).mockReturnValueOnce(assetsChild);
        vi.mocked(resolveRowArticleImageGalleryChild).mockReturnValueOnce(assetsChild);
        vi.mocked(buildRowArticleImageGallery).mockImplementationOnce(() => {
            const gallery = document.createElement("div");
            gallery.classList.add("big_card_image_gallery", "row_article_image_gallery");
            const thumbnails = document.createElement("div");
            thumbnails.classList.add("big_card_thumbnail_row");
            thumbnails.appendChild(document.createElement("img"));
            gallery.appendChild(thumbnails);
            return gallery;
        });

        await openRowArticleView(
            { id: 42, title: "Firefox", cached_image: "/storage/104/42/original/firefox.svg" },
            tableName,
            selectedCard,
        );
        await flushRowArticleHydration();

        const gallery = document.querySelector(".row_article_image_gallery");
        const thumbnails = gallery?.querySelector(".big_card_thumbnail_row");
        expect(gallery).not.toBeNull();
        expect(inlineImage.hidden).toBe(false);
        expect(thumbnails?.hidden).toBe(false);
        expect(thumbnails?.querySelector("img")).not.toBeNull();
        expect(gallery.querySelector(".big_card_hero_image")).toBeNull();
        expect(inlineImage.dataset.serviceCatalogInlineImagePrimary).toBeUndefined();
    });

    test("keeps an inline image visible when its gallery is empty", async () => {
        document.body.innerHTML = `
            <div id="app_service_catalog_article_view_container">
                <div class="card_view_wrapper">
                    <div class="card_container">
                        <div class="card" data-id="42"></div>
                    </div>
                    <div class="big_card_placeholder row_article_placeholder"></div>
                </div>
            </div>
        `;
        const selectedCard = document.querySelector(".card[data-id='42']");
        const inlineImage = document.createElement("div");
        inlineImage.classList.add("big_card_image");
        inlineImage.dataset.rowArticleImageColumn = "cached_image";

        vi.mocked(buildRowArticleContent).mockResolvedValueOnce({
            rowArticleContentElement: (() => {
                const content = document.createElement("div");
                content.classList.add("big_card_content");
                content.appendChild(inlineImage);
                return content;
            })(),
        });
        vi.mocked(createRowArticleLoadSession).mockReturnValueOnce({
            fetchAttachmentLinking: vi.fn(() => Promise.resolve(null)),
            fetchDynamicChildren: vi.fn(() => Promise.resolve({ child_tables: [] })),
        });
        vi.mocked(buildRowArticleImageGallery).mockImplementationOnce(() => {
            const gallery = document.createElement("div");
            gallery.classList.add("big_card_image_gallery", "row_article_image_gallery");
            return gallery;
        });

        await openRowArticleView(
            { id: 42, title: "Firefox", cached_image: "/storage/104/42/original/firefox.svg" },
            "app_service_catalog",
            selectedCard,
        );
        await flushRowArticleHydration();

        expect(inlineImage.hidden).toBe(false);
        expect(document.querySelector(".row_article_image_gallery")?.hidden).toBe(false);
        expect(document.querySelector(".big_card_hero_image")).toBeNull();
    });


});
