// @vitest-environment jsdom
// row_article_media_hydrator_lifecycle.test.js
// Verifies article media teardown at replacement, close and containing-view removal.
// Connects real DOM mutation delivery with hydration guards and inline disposal.
// Prevents retained result lists from keeping discarded article observers alive.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sync: vi.fn(), dispose: vi.fn() }));
vi.mock("./row_article_inline_media.js", () => ({
    syncRowArticleInlineMedia: mocks.sync,
    disposeRowArticleInlineMedia: mocks.dispose,
}));
vi.mock("./row_article_child_tabs.js", () => ({ buildRowArticleRelatedTabs: vi.fn() }));
vi.mock("./row_article_image_gallery.js", () => ({ buildRowArticleImageGallery: vi.fn() }));
vi.mock("./row_article_attachment_list.js", () => ({ buildRowArticleAttachmentList: vi.fn() }));
vi.mock("../../route_permission_checker.js", () => ({
    hasDatasetPermission: vi.fn(), primeDatasetPermissions: vi.fn(),
}));
import { createRowArticleMediaHydrator } from "./row_article_media_hydrator.js";

const NativeObserver = globalThis.MutationObserver;
let observers;
beforeEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks(); observers = [];
    vi.stubGlobal("MutationObserver", class extends NativeObserver {
        constructor(callback) {
            super(callback);
            const observe = this.observe.bind(this), disconnect = this.disconnect.bind(this);
            this.observe = vi.fn(observe);
            this.disconnect = vi.fn(disconnect);
            observers.push(this);
        }
    });
});
afterEach(() => { observers.forEach(observer => observer.disconnect()); vi.unstubAllGlobals(); });

function fixture() {
    const view = document.createElement("section");
    view.innerHTML = '<div class="placeholder"><article><div class="content"><div class="big_card_image" data-row-article-image-column="image"></div></div></article></div>';
    document.body.append(view);
    const article = view.querySelector("article"), content = view.querySelector(".content");
    const session = { fetchDynamicChildren: vi.fn(async () => ({ child_tables: [] })),
        fetchImageLinking: vi.fn(async () => null), fetchAttachmentLinking: vi.fn(async () => null) };
    let current = true;
    const controller = createRowArticleMediaHydrator({
        rowArticleElement: article, rowArticleContentElement: content,
        rowArticleLoadSession: session, rowItem: { id: 12 }, tableName: "places",
        parentImageRows: [], showRelatedItems: false, canCommit: () => current,
    });
    return { view, article, content, session, controller, invalidate: () => { current = false; } };
}

const flushMutations = () => new Promise(resolve => setTimeout(resolve, 0));

test.each(["article", "content", "view"])("removing the %s disposes inline media without another result-list mutation", async target => {
    const f = fixture();
    await f.controller.hydrateRelatedSections();
    expect(mocks.sync).toHaveBeenCalled();
    expect(observers).toHaveLength(1);
    expect(observers[0].observe.mock.calls.every(([, options]) => options.childList === true && !options.subtree)).toBe(true);
    f[target].remove();
    await flushMutations();
    expect(mocks.dispose).toHaveBeenCalledExactlyOnceWith(f.content);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
    const calls = mocks.sync.mock.calls.length;
    document.body.append(f.view);
    await f.controller.hydrateRelatedSections();
    expect(mocks.sync).toHaveBeenCalledTimes(calls);
});

test("replacing the article disposes only the removed article", async () => {
    const f = fixture();
    await f.controller.hydrateRelatedSections();
    f.article.replaceWith(document.createElement("article"));
    await flushMutations();
    expect(mocks.dispose).toHaveBeenCalledExactlyOnceWith(f.content);
});

test("a connected move rebinds the ancestor chain before its new owner is removed", async () => {
    const f = fixture();
    await f.controller.hydrateRelatedSections();
    const nextOwner = document.createElement("aside");
    document.body.append(nextOwner);
    nextOwner.append(f.article);
    await flushMutations();
    expect(mocks.dispose).not.toHaveBeenCalled();
    nextOwner.replaceChildren();
    await flushMutations();
    expect(mocks.dispose).toHaveBeenCalledExactlyOnceWith(f.content);
});

test("late media responses and inline navigation guards cannot revive a disposed article", async () => {
    const f = fixture();
    let complete;
    f.session.fetchDynamicChildren.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = f.controller.hydrateRelatedSections();
    const context = mocks.sync.mock.calls.at(-1)[2];
    expect(context.canCommit()).toBe(true);
    f.view.remove();
    await flushMutations();
    complete({ child_tables: [] });
    await pending;
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(context.canCommit()).toBe(false);
    expect(mocks.dispose).toHaveBeenCalledExactlyOnceWith(f.content);
});

test("explicit dispose is idempotent and the caller's current-view guard is retained", async () => {
    const f = fixture();
    await f.controller.hydrateRelatedSections();
    const context = mocks.sync.mock.calls.at(-1)[2];
    f.invalidate();
    expect(context.canCommit()).toBe(false);
    f.controller.dispose(); f.controller.dispose();
    expect(mocks.dispose).toHaveBeenCalledExactlyOnceWith(f.content);
    expect(observers[0].disconnect).toHaveBeenCalledOnce();
});
