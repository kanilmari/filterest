// @vitest-environment jsdom
// row_article_url_state.test.js
// Verifies canonical article URLs preserve search and filter state.
// Bridges bookmarked result queries with the independent article renderer name.
// Keeps older links readable while every newly written link uses article_view.
import { expect, test, vi } from "vitest";
const params = vi.hoisted(() => ({ value: { search: "birds", filter: "active" }, write: vi.fn() }));
vi.mock("../../navigation/nav_engine/query_params.js", () => ({ getParams: () => params.value, setParams: params.write }));
import { buildRowArticleQueryString } from "./row_article_url_state.js";
test("preserves query state and writes the canonical article key", () => {
    const query = new URLSearchParams(buildRowArticleQueryString("demo"));
    expect(query.get("search")).toBe("birds");
    expect(query.get("filter")).toBe("active");
    expect(query.get("view")).toBe("article_view");
    expect(params.write).toHaveBeenCalledWith("demo", { search: "birds", filter: "active", view: "article_view" });
});
