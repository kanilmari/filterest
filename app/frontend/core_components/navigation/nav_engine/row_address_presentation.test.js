// @vitest-environment jsdom
// A row link without an article mode resolves its destination's defaults. Bookmarks and history pin a mode.
import { beforeEach, expect, test, vi } from "vitest";
const { resolve, denied } = vi.hoisted(() => ({ resolve: vi.fn(), denied: vi.fn() }));
vi.mock("../../table_views/row_presentation/row_presentation_dispatcher.js", () => ({ resolveRowOpening: resolve }));
vi.mock("../../table_views/card_view/article_view_access.js", async importOriginal => ({
    ...await importOriginal(), showArticleViewAccessDenied: denied,
}));
import { resolveRowAddress } from "./row_address_presentation.js";

beforeEach(() => {
    history.replaceState(null, "", "/events/7");
    resolve.mockReset().mockImplementation(async (_name, { viewKey }) => ({ status: "resolved", viewKey: viewKey ?? "image_first_page_view" }));
    denied.mockClear();
});
test("a calendar-backed row delegates to the target dataset, while an explicit Article wins", async () => {
    expect(await resolveRowAddress("events", 7, "calendar", () => true)).toMatchObject({ viewKey: "image_first_page_view" });
    expect(resolve).toHaveBeenCalledWith("events", expect.objectContaining({ viewKey: null, rowId: 7 }));
    expect(await resolveRowAddress("events", 7, "article_view", () => true)).toMatchObject({ viewKey: "article_view" });
});
test("a previously committed row restores its presentation without changing a preference", async () => {
    history.replaceState({ bigCard: true, dataset: "events", rowId: "7" }, "", "/events/7");
    expect(await resolveRowAddress("events", 7, null, () => true)).toMatchObject({ viewKey: "article_view" });
    expect(await resolveRowAddress("events", 8, null, () => true)).toMatchObject({ viewKey: "image_first_page_view" });
});
test("a refused explicit route shows one notice, and an abandoned resolution shows none", async () => {
    resolve.mockResolvedValue({ status: "denied" });
    expect(await resolveRowAddress("events", 7, "image_first_page_view", () => true)).toMatchObject({ status: "denied" });
    expect(await resolveRowAddress("events", 7, "image_first_page_view", () => false)).toMatchObject({ status: "stale" });
    expect(denied).toHaveBeenCalledTimes(1);
});
