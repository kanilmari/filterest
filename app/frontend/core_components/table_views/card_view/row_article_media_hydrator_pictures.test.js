// @vitest-environment jsdom
// row_article_media_hydrator_pictures.test.js
// Verifies that an article's inline main image and gallery follow its fresh media response.
// Connects the hydrator with the real asset resolver, inline media and gallery builder.
// Guards K120 and K128: the server orders and names the gallery and names the card picture,
// the article opens on that picture, and row fields only stand in without a response.
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    activate: vi.fn(),
    bind: vi.fn((element) => element),
    confirm: vi.fn(),
    request: vi.fn(),
}));
vi.mock("./image_first_view_activation.js", () => ({
    activateImageFirstView: mocks.activate,
    bindImageFirstViewActivation: mocks.bind,
}));
vi.mock("./card_avatar_builder.js", () => ({ createImageElement: (src) => {
    const wrapper = document.createElement("div");
    wrapper.className = "wrapper";
    wrapper.dataset.imageFirstSrc = src;
    const image = document.createElement("img");
    image.setAttribute("src", src);
    wrapper.append(image);
    return wrapper;
} }));
vi.mock("./row_article_child_tabs.js", () => ({ buildRowArticleRelatedTabs: vi.fn(async () => null) }));
vi.mock("./row_article_attachment_list.js", () => ({ buildRowArticleAttachmentList: vi.fn(() => null) }));
vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: vi.fn(async () => true),
    primeDatasetPermissions: vi.fn(),
}));
vi.mock("../../endpoints/endpoint_router.js", () => ({ endpoint_router: mocks.request }));
vi.mock("../../../reusable_components/modal/confirm_modal_builder.js", () => ({ showConfirmModal: mocks.confirm }));
vi.mock("../../../reusable_components/notifications/toast_notification_printer.js", () => ({
    showErrorToast: vi.fn(),
    showSuccessToast: vi.fn(),
}));

import { createRowArticleMediaHydrator } from "./row_article_media_hydrator.js";
import { resolveImagePath } from "./row_article_content_builder_helpers.js";
import { setLanguage } from "../../state_stores/lang_preference_reader.js";

const relation = { dataset: "tickets_assets", column: "tickets_id" };
const first = { id: 1, asset_kind: "image", filename: "first.png", is_primary: true, sort_order: 1 };
const second = { id: 2, asset_kind: "image", filename: "second.png", sort_order: 9 };
const third = { id: 3, asset_kind: "image", filename: "third.png", sort_order: 10 };
const gallery = (rows) => ({ ...relation, relation_kind: "shared_asset", rows });
const rowImage = (filename) => ({
    asset_kind: "image",
    filename,
    is_parent_row_image: true,
    parent_image_column: "cached_image",
});

beforeEach(() => {
    localStorage.clear();
    document.body.replaceChildren();
    vi.clearAllMocks();
    mocks.confirm.mockResolvedValue(true);
    mocks.request.mockResolvedValue({ ok: true });
});

/** Opens one article whose inline image shows the row's own cached picture. */
function openArticle({ responses, cachedImage = "stale.png" }) {
    const article = document.createElement("article");
    const content = document.createElement("div");
    content.className = "big_card_content row_article_content";
    // The address the article renders for the row's picture, as the content builder does.
    const src = resolveImagePath(cachedImage);
    content.innerHTML = '<div class="big_card_image" data-row-article-image-column="cached_image">'
        + '<div class="wrapper"><img></div></div>';
    content.querySelector("img").setAttribute("src", src);
    content.querySelector(".wrapper").dataset.imageFirstSrc = src;
    article.append(content);
    document.body.append(article);

    const session = {
        fetchDynamicChildren: vi.fn(),
        fetchAttachmentLinking: vi.fn(async () => null),
    };
    responses.forEach((response) => session.fetchDynamicChildren.mockImplementationOnce(async () => {
        if (response instanceof Error) throw response;
        return response;
    }));
    const controller = createRowArticleMediaHydrator({
        rowArticleElement: article,
        rowArticleContentElement: content,
        rowArticleLoadSession: session,
        rowItem: { id: 2, cached_image: cachedImage },
        tableName: "tickets",
        selectedCard: null,
        rowLabel: "Ticket",
        parentImageRows: [rowImage(cachedImage)],
        currentUserId: 5,
        showRelatedItems: true,
        canCommit: () => true,
        onLinkedTaskChildCountChange: vi.fn(),
        sectionDefaults: {},
    });
    return { content, session, controller };
}

const inlineSource = (content) => content
    .querySelector(".row_article_inline_media img")?.getAttribute("src") ?? null;
const inlinePosition = (content) => content
    .querySelector(".row_article_inline_media [data-testid='row-article-image-position']").textContent;
const gallerySources = (content) => Array
    .from(content.querySelectorAll('.row_article_image_gallery [data-testid^="big-card-image-thumb-"] img'))
    .map((image) => image.getAttribute("src"));
const activeThumbnail = (content) => Array
    .from(content.querySelectorAll('.row_article_image_gallery [data-testid^="big-card-image-thumb-"]'))
    .find((thumbnail) => thumbnail.classList.contains("active_thumb"))
    ?.querySelector("img").getAttribute("src") ?? null;

test("the inline main image and the gallery follow the fresh response, a card-only picture first", async () => {
    const { content, controller } = openArticle({
        responses: [{
            gallery_relation: relation,
            card_picture: "https://cdn.example/card.png",
            child_tables: [gallery([second, first])],
        }],
    });

    await controller.hydrateRelatedSections();

    const shown = ["https://cdn.example/card.png", "/storage/second.png", "/storage/first.png"];
    expect(inlineSource(content)).toBe(shown[0]);
    expect(inlinePosition(content)).toBe("1 / 3");
    // The server's order is kept even though the second row is not the primary one.
    expect(gallerySources(content)).toEqual(shown);
    expect(content.querySelector('img[src*="stale"]')).toBeNull();
    const cardOnlyItem = content.querySelector('[data-testid="big-card-image-item-0"]');
    expect(cardOnlyItem.querySelector(".big_card_thumbnail_primary, .big_card_thumbnail_delete")).toBeNull();
    expect(content.querySelector('[data-testid="big-card-image-delete-1"]')).not.toBeNull();
    expect(mocks.bind.mock.calls.at(-1)[1].imageRows.map((row) => row.filename))
        .toEqual(["https://cdn.example/card.png", "second.png", "first.png"]);
});

test("a picture deleted in the gallery disappears after the local refresh and does not return from the row", async () => {
    const { content, session, controller } = openArticle({
        cachedImage: "first.png",
        responses: [
            { gallery_relation: relation, card_picture: "first.png", child_tables: [gallery([first, second])] },
            { gallery_relation: relation, card_picture: "second.png", child_tables: [gallery([second])] },
        ],
    });
    await controller.hydrateRelatedSections();
    expect(inlineSource(content)).toBe("/storage/first.png");
    expect(gallerySources(content)).toEqual(["/storage/first.png", "/storage/second.png"]);

    content.querySelector('[data-testid="big-card-image-delete-0"]').click();

    await vi.waitFor(() => expect(gallerySources(content)).toEqual(["/storage/second.png"]));
    expect(mocks.request).toHaveBeenCalledWith("deleteRows", expect.objectContaining({
        url_params: "?dataset=tickets_assets",
        body_data: { ids: [1] },
    }));
    expect(session.fetchDynamicChildren).toHaveBeenLastCalledWith({ forceRefresh: true });
    expect(inlineSource(content)).toBe("/storage/second.png");
    expect(inlinePosition(content)).toBe("1 / 1");
    expect(content.querySelector('img[src$="first.png"]')).toBeNull();
});

test("falls back to the row's own picture only when the lookup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { content, controller } = openArticle({ responses: [new Error("Unavailable")] });

    await controller.hydrateRelatedSections();

    expect(inlineSource(content)).toBe("/storage/stale.png");
    expect(inlinePosition(content)).toBe("1 / 1");
    expect(content.querySelector(".row_article_image_gallery_section")).toBeNull();
    warn.mockRestore();
});

test.each([
    ["a failed refresh", new Error("Unavailable")],
    ["a refresh without child tables", {}],
])("%s keeps the fresh pictures instead of returning to the row's own picture", async (_label, refresh) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { content, controller } = openArticle({
        responses: [
            { gallery_relation: relation, card_picture: "first.png", child_tables: [gallery([first, second])] },
            refresh,
        ],
    });
    await controller.hydrateRelatedSections();

    await controller.refreshMediaSections();

    expect(inlineSource(content)).toBe("/storage/first.png");
    expect(inlinePosition(content)).toBe("1 / 2");
    expect(gallerySources(content)).toEqual(["/storage/first.png", "/storage/second.png"]);
    expect(content.querySelector('img[src*="stale"]')).toBeNull();
    warn.mockRestore();
});

test("the article opens on the card's picture when a later gallery row shows it, keeping the gallery order", async () => {
    const { content, controller } = openArticle({
        responses: [{ gallery_relation: relation, card_picture: "second.png", child_tables: [gallery([first, second])] }],
    });

    await controller.hydrateRelatedSections();

    expect(inlineSource(content)).toBe("/storage/second.png");
    expect(inlinePosition(content)).toBe("2 / 2");
    expect(gallerySources(content)).toEqual(["/storage/first.png", "/storage/second.png"]);
    expect(content.querySelector('[data-testid="big-card-image-thumb-0"]').classList.contains("active_thumb")).toBe(false);
    expect(content.querySelector('[data-testid="big-card-image-thumb-1"]').classList.contains("active_thumb")).toBe(true);
});

test("the first response starts on the card's picture even when the gallery also lists the row's earlier picture", async () => {
    // The row last showed first.png; meanwhile the card's picture became second.png.
    const { content, controller } = openArticle({
        cachedImage: "first.png",
        responses: [{ gallery_relation: relation, card_picture: "second.png", child_tables: [gallery([first, second])] }],
    });

    await controller.hydrateRelatedSections();

    expect(inlineSource(content)).toBe("/storage/second.png");
    expect(inlinePosition(content)).toBe("2 / 2");
    expect(gallerySources(content)).toEqual(["/storage/first.png", "/storage/second.png"]);
    expect(activeThumbnail(content)).toBe("/storage/second.png");
});

test("a refresh keeps the pictures the viewer chose in the main image and the gallery while they are listed", async () => {
    const { content, controller } = openArticle({
        cachedImage: "first.png",
        responses: [
            { gallery_relation: relation, card_picture: "first.png", child_tables: [gallery([first, second])] },
            // After an upload: a new picture at the end, the card's picture unchanged.
            { gallery_relation: relation, card_picture: "first.png", child_tables: [gallery([first, second, third])] },
        ],
    });
    await controller.hydrateRelatedSections();
    expect(inlineSource(content)).toBe("/storage/first.png");
    expect(activeThumbnail(content)).toBe("/storage/first.png");

    // The viewer browses the main image to the next picture and picks it in the gallery.
    content.querySelector(".row_article_inline_media [data-testid='row-article-image-next']").click();
    content.querySelector('[data-testid="big-card-image-thumb-1"]').click();
    expect(inlineSource(content)).toBe("/storage/second.png");
    expect(activeThumbnail(content)).toBe("/storage/second.png");

    await controller.refreshMediaSections();

    expect(gallerySources(content)).toEqual(["/storage/first.png", "/storage/second.png", "/storage/third.png"]);
    expect(inlineSource(content)).toBe("/storage/second.png");
    expect(inlinePosition(content)).toBe("2 / 3");
    expect(activeThumbnail(content)).toBe("/storage/second.png");
});

test("a refresh moves pictures the viewer did not choose to the card's new picture", async () => {
    const { content, controller } = openArticle({
        cachedImage: "first.png",
        responses: [
            { gallery_relation: relation, card_picture: "first.png", child_tables: [gallery([first, second])] },
            // second.png became the card's picture, for example as the new primary picture.
            { gallery_relation: relation, card_picture: "second.png", child_tables: [gallery([first, second])] },
        ],
    });
    await controller.hydrateRelatedSections();
    expect(inlineSource(content)).toBe("/storage/first.png");

    await controller.refreshMediaSections();

    expect(inlineSource(content)).toBe("/storage/second.png");
    expect(inlinePosition(content)).toBe("2 / 2");
    expect(activeThumbnail(content)).toBe("/storage/second.png");
});

// The same path on another host, or with another query, is another picture.
const samePathPictures = [
    ["another host", "https://old.example/logo.png", "https://new.example/logo.png"],
    ["another query", "logo.png?v=1", "logo.png?v=2"],
];

test.each(samePathPictures)(
    "the first response replaces the row's earlier picture at the same path on %s",
    async (_label, oldPicture, newPicture) => {
        // Both pictures stay in the gallery, so only the card picture's own address
        // tells which one the article and the gallery start on.
        const { content, controller } = openArticle({
            cachedImage: oldPicture,
            responses: [{
                gallery_relation: relation,
                card_picture: newPicture,
                child_tables: [gallery([
                    { id: 6, asset_kind: "image", filename: oldPicture },
                    { id: 7, asset_kind: "image", filename: newPicture },
                ])],
            }],
        });

        await controller.hydrateRelatedSections();

        expect(inlineSource(content)).toBe(resolveImagePath(newPicture));
        expect(inlinePosition(content)).toBe("2 / 2");
        expect(mocks.bind.mock.calls.at(-1)[1].imageSrc).toBe(resolveImagePath(newPicture));
        expect(gallerySources(content)).toEqual([resolveImagePath(oldPicture), resolveImagePath(newPicture)]);
        expect(activeThumbnail(content)).toBe(resolveImagePath(newPicture));
    },
);

test.each(samePathPictures)(
    "a refresh replaces a main picture the card no longer shows at the same path on %s",
    async (_label, oldPicture, newPicture) => {
        const { content, controller } = openArticle({
            cachedImage: oldPicture,
            responses: [
                {
                    gallery_relation: relation,
                    card_picture: oldPicture,
                    child_tables: [gallery([{ id: 7, asset_kind: "image", filename: oldPicture }])],
                },
                {
                    gallery_relation: relation,
                    card_picture: newPicture,
                    child_tables: [gallery([
                        { id: 7, asset_kind: "image", filename: oldPicture },
                        { id: 8, asset_kind: "image", filename: newPicture },
                    ])],
                },
            ],
        });
        await controller.hydrateRelatedSections();
        expect(inlineSource(content)).toBe(resolveImagePath(oldPicture));

        await controller.refreshMediaSections();

        expect(inlineSource(content)).toBe(resolveImagePath(newPicture));
        expect(inlinePosition(content)).toBe("2 / 2");
        expect(mocks.bind.mock.calls.at(-1)[1].imageSrc).toBe(resolveImagePath(newPicture));
        expect(gallerySources(content)).toEqual([resolveImagePath(oldPicture), resolveImagePath(newPicture)]);
        expect(activeThumbnail(content)).toBe(resolveImagePath(newPicture));
    },
);

test("a card picture naming a gallery file with a query adds no second tile for that file", async () => {
    const { content, controller } = openArticle({
        cachedImage: "10_2_1.webp?v=1",
        responses: [{
            gallery_relation: relation,
            card_picture: "10_2_1.webp?v=1",
            child_tables: [gallery([{ id: 7, asset_kind: "image", filename: "/storage/10/2/original/10_2_1.webp?v=1" }])],
        }],
    });

    await controller.hydrateRelatedSections();

    expect(gallerySources(content)).toEqual(["/storage/10/2/original/10_2_1.webp?v=1"]);
    expect(inlineSource(content)).toBe("/storage/10/2/original/10_2_1.webp?v=1");
    expect(inlinePosition(content)).toBe("1 / 1");
});

describe("a multilingual card picture", () => {
    const twoLanguages = JSON.stringify({ fi: "fi.png", en: "en.png" });
    const fiPicture = { id: 11, asset_kind: "image", filename: "fi.png" };
    const enPicture = { id: 12, asset_kind: "image", filename: "en.png" };

    beforeEach(() => {
        setLanguage("fi");
    });

    test("starts the article and the gallery on the picture in the viewer's language", async () => {
        const { content, controller } = openArticle({
            cachedImage: "en.png",
            responses: [{
                gallery_relation: relation,
                card_picture: twoLanguages,
                child_tables: [gallery([enPicture, fiPicture])],
            }],
        });

        await controller.hydrateRelatedSections();

        expect(inlineSource(content)).toBe("/storage/fi.png");
        expect(inlinePosition(content)).toBe("2 / 2");
        expect(activeThumbnail(content)).toBe("/storage/fi.png");
    });

    test("shows the viewer's language as the card-only picture, never the stored text", async () => {
        const { content, controller } = openArticle({
            cachedImage: "en.png",
            responses: [{ child_tables: [], card_picture: twoLanguages }],
        });

        await controller.hydrateRelatedSections();

        expect(gallerySources(content)).toEqual(["/storage/fi.png"]);
        expect(inlineSource(content)).toBe("/storage/fi.png");
        expect(content.querySelector('img[src*="{"]')).toBeNull();
    });

    test("an empty value in the viewer's language leaves the first gallery picture as the main one", async () => {
        const { content, controller } = openArticle({
            cachedImage: "stale.png",
            responses: [{
                gallery_relation: relation,
                card_picture: JSON.stringify({ fi: "", en: "en.png" }),
                child_tables: [gallery([enPicture, fiPicture])],
            }],
        });

        await controller.hydrateRelatedSections();

        expect(gallerySources(content)).toEqual(["/storage/en.png", "/storage/fi.png"]);
        expect(inlineSource(content)).toBe("/storage/en.png");
        expect(activeThumbnail(content)).toBe("/storage/en.png");
    });
});

test("without a gallery it may read the article shows only the card's picture, not the row's own one", async () => {
    // The server leaves out both the name and the rows of a gallery this viewer may not read.
    const { content, controller } = openArticle({ responses: [{ child_tables: [], card_picture: "card.png" }] });

    await controller.hydrateRelatedSections();

    expect(inlineSource(content)).toBe("/storage/card.png");
    expect(gallerySources(content)).toEqual(["/storage/card.png"]);
    expect(content.querySelector('img[src*="stale"]')).toBeNull();
    expect(content.querySelector(".big_card_thumbnail_primary, .big_card_thumbnail_delete")).toBeNull();
});

test.each([
    ["an empty card picture", { child_tables: [], card_picture: "" }],
    ["no card picture", { child_tables: [] }],
])("a response without a gallery and with %s removes the row's own picture", async (_label, response) => {
    const { content, controller } = openArticle({ responses: [response] });

    await controller.hydrateRelatedSections();

    expect(inlineSource(content)).toBeNull();
    expect(gallerySources(content)).toEqual([]);
    expect(content.querySelector('img[src*="stale"]')).toBeNull();
    // Without a named gallery there is nothing to upload into either.
    expect(content.querySelector('.row_article_image_gallery input[type="file"]')).toBeNull();
});
