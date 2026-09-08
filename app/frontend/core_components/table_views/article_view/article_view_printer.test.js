// @vitest-environment jsdom
// article_view_printer.test.js
// Exercises independent article state through the real article renderer.
// Bridges shared result summaries with separate article selection and shell metadata.
// Prevents article viewing from reusing or modifying card presentation preferences.
import { beforeEach, expect, test, vi } from "vitest";
const render = vi.hoisted(() => vi.fn());
vi.mock("../card_view/card_view_printer.js", () => ({ create_card_view: render }));
import { create_article_view } from "./article_view_printer.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
beforeEach(() => { localStorage.clear(); render.mockReset(); render.mockResolvedValue(document.createElement("div")); });
test("builds a distinct article shell with its own state contract", async () => {
    setUnifiedTableState("demo", { cardView: { expandedId: 99, collapsed: false } });
    const rows = [{ id: 1, title: "Article" }];
    const wrapper = await create_article_view(["title"], rows, "demo");
    expect(render).toHaveBeenCalledWith(["title"], rows, "demo", { viewKey: "article_view", stateKey: "articleView" });
    expect(wrapper.classList.contains("article_view_wrapper")).toBe(true);
    expect(getUnifiedTableState("demo").cardView).toEqual({ expandedId: 99, collapsed: false });
    expect(getUnifiedTableState("demo").articleView.pendingAutoOpenFirstRenderedResult).toBe(true);
});
test("keeps a pending text search and its selected article unchanged", async () => {
    setUnifiedTableState("demo", { articleView: { collapsed: true, expandedId: null, pendingAutoOpenFirstSearchResult: true } });
    await create_article_view(["title"], [], "demo");
    expect(getUnifiedTableState("demo").articleView).toEqual({ collapsed: true, expandedId: null, pendingAutoOpenFirstSearchResult: true });
});
