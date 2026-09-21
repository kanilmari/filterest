// @vitest-environment jsdom
// first_listed_row.test.js
// Verifies the one rule for which row a waiting card or article view opens.
// Uses the real table state store, without rendering or fetching rows.
// Exists so the view selector, a view rebuild and the search cannot drift apart.
import { beforeEach, expect, test } from "vitest";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { claimFirstListedRow, getArticleStateKey } from "./first_listed_row.js";

beforeEach(() => {
    localStorage.clear();
});

test.each([
    ["a search", { pendingAutoOpenFirstSearchResult: true }],
    ["no search", { pendingAutoOpenFirstRenderedResult: true }],
])("a waiting article opens the first row of the list just drawn (%s)", (_label, flag) => {
    setUnifiedTableState("events", { articleView: { collapsed: true, expandedId: null, returnView: "card", ...flag } });

    const row = claimFirstListedRow("events", "article_view", [{ title: "no id" }, { id: 7 }, { id: 9 }]);

    expect(row).toEqual({ id: 7 });
    expect(getUnifiedTableState("events").articleView).toEqual({
        collapsed: true,
        expandedId: 7,
        returnView: "card",
        pendingAutoOpenFirstRenderedResult: false,
        pendingAutoOpenFirstSearchResult: false,
    });
});

test.each([
    ["nothing is waiting", { collapsed: true, expandedId: null }],
    ["a row is already open", { collapsed: true, expandedId: 3, pendingAutoOpenFirstSearchResult: true }],
    ["the article is not shown", { collapsed: false, expandedId: null, pendingAutoOpenFirstSearchResult: true }],
])("nothing opens when %s", (_label, articleView) => {
    setUnifiedTableState("events", { articleView });

    expect(claimFirstListedRow("events", "article_view", [{ id: 7 }])).toBeNull();
    expect(getUnifiedTableState("events").articleView).toEqual(articleView);
});

test("an empty list keeps the article waiting for the next list", () => {
    setUnifiedTableState("events", { cardView: { collapsed: true, expandedId: null, pendingAutoOpenFirstSearchResult: true } });

    expect(claimFirstListedRow("events", "card", [])).toBeNull();
    expect(getUnifiedTableState("events").cardView.pendingAutoOpenFirstSearchResult).toBe(true);
});

test("card and article views keep their own article state", () => {
    expect(getArticleStateKey("article_view")).toBe("articleView");
    expect(getArticleStateKey("card")).toBe("cardView");
});
