// @vitest-environment jsdom
// Tests localized text-only auxiliary links and approval-aware navigation.
// Keeps colliding row IDs scoped to the target dataset and preserves modified clicks.
import { beforeEach, describe, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    navigate: vi.fn(), selected: vi.fn(), openArticle: vi.fn(), translate: vi.fn((_key, { fallback }) => fallback),
}));
vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({ openNavTab: mocks.navigate }));
vi.mock("../../state_stores/dataset_selection_saver.js", () => ({ getSelectedDataset: mocks.selected }));
vi.mock("../../table_views/card_view/row_article_opener.js", () => ({ openRowArticleView: mocks.openArticle }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: mocks.translate }));
vi.mock("../../navigation/nav_engine/dataset_aliases.js", () => ({ buildDatasetPath: name => "/alias-" + name, getInternalDatasetName: name => name }));
vi.mock("../../table_views/card_view/row_article_opener_helpers.js", () => ({
    buildCardUrl: (_prefix, name, id) => "/alias-" + name + "/" + id,
}));
import {
    createSupplementalDatasetGroup,
    getSupplementalSearchCopy,
    renderExcerptWithMatchesMarked,
} from "../../table_views/compact_dataset_group.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { refreshLocalizedDatasetValues } from "../../table_views/dataset_value_localizer.js";
const types = { title: { card_element: "header+lang_key", is_multilingual: true, show_value_on_card: true },
    description: { card_element: "description2", is_multilingual: true, show_value_on_card: true } };
const rows = [{ id: 1, title: JSON.stringify({ fi: "Suomen otsikko", en: "English title" }),
    description: JSON.stringify({ fi: "<p>Lyhyt <b>kuvaus</b><script>bad()</script></p>", en: "<p>Brief <b>description</b></p>" }) }];
function mount(dataset = "other", options = {}) {
    const group = createSupplementalDatasetGroup({ dataset, text: "Other", langKey: "other" }, "shared query", options);
    document.body.append(group.element);
    group.render(rows, ["id", "title", "description"], types);
    return group;
}
beforeEach(() => {
    document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
    mocks.navigate.mockResolvedValue({ abort: false });
    mocks.selected.mockReturnValue("other");
});
test("refreshes one-language titles and plain descriptions without JSON, markup or script output", async () => {
    const group = mount();
    mocks.translate.mockReturnValue("Muut");
    await refreshLocalizedDatasetValues("fi");
    expect(group.element.querySelector("h3").textContent).toBe("Muut");
    expect(group.element.querySelector("li a").textContent).toBe("Suomen otsikko");
    expect(group.element.querySelector("p").textContent).toBe("Lyhyt kuvaus");
    expect(group.element.querySelector("script,b")).toBeNull();
    expect(group.element.textContent).not.toContain("bad()");
    await refreshLocalizedDatasetValues("en");
    expect(group.element.querySelector("li a").textContent).toBe("English title");
    expect(group.element.querySelector("p").textContent).toBe("Brief description");
});
test("shows a short extract around the matching words instead of the document beginning", () => {
    const longBeginning = "Opening material without the searched phrase. ".repeat(8);
    const longEnding = " Closing material after the searched phrase.".repeat(8);
    const fullText = `${longBeginning}Claude appears in the relevant sentence.${longEnding}`;
    const group = createSupplementalDatasetGroup(
        { dataset: "tickets", text: "Tickets", langKey: "tickets" }, "claude"
    );
    document.body.append(group.element);
    group.render(
        [{ id: 9, title: "Matching ticket", description: fullText }],
        ["id", "title", "description"],
        {
            title: { card_element: "header", show_value_on_card: true },
            description: { card_element: "description", show_value_on_card: true },
        }
    );
    const excerpt = group.element.querySelector("li p").textContent;

    expect(excerpt.toLowerCase()).toContain("claude");
    expect(excerpt).not.toContain(longBeginning.trim());
    expect(excerpt).not.toBe(fullText);
    expect(excerpt.length).toBeLessThanOrEqual(180);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
});
test.each(["fi", "en", "ch", "yue", "zh-Hant"])("localizes Show all in %s", async language => {
    const group = mount();
    await refreshLocalizedDatasetValues(language);
    expect(group.element.querySelector(".supplemental-dataset-show-all").textContent).toBe(getSupplementalSearchCopy(language).showAll);
});
test("links use the target alias, target row identity, and exact shared query", () => {
    const a = mount("first").element.querySelector("li a");
    const b = mount("second").element.querySelector("li a");
    expect(new URL(a.href).pathname).toBe("/alias-first/1");
    expect(new URL(b.href).pathname).toBe("/alias-second/1");
    expect(new URL(b.href).searchParams.get("search")).toBe("shared query");
});
test("Home cancellation restores the remembered row and dataset view", async () => {
    const group = mount("other", { preselectArticle: true });
    setChosenDatasetView("other", "card");
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockResolvedValue({ abort: true, reason: "dirty_check_failed" });
    group.element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    await vi.waitFor(() => expect(getUnifiedTableState("other").articleView.expandedId).toBe(99));
    expect(mocks.navigate).toHaveBeenCalledWith("other", {
        forceReload: true, skipUrlUpdate: true, replacementParams: { search: "shared query", view: "article_view" },
    });
    expect(getChosenDatasetView("other")).toBe("card");
    expect(mocks.openArticle).not.toHaveBeenCalled();
});
test("Home row navigation pre-sets the exact article before loading without a dataset history entry", async () => {
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockImplementation(async () => {
        expect(getChosenDatasetView("other")).toBe("article_view");
        expect(getUnifiedTableState("other").articleView.expandedId).toBe(1);
        return { abort: false };
    });
    mount("other", { preselectArticle: true }).element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.openArticle).not.toHaveBeenCalled();
});
test("search row links keep their existing dataset entry and approved article open", async () => {
    mount().element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.openArticle).toHaveBeenCalled());
    expect(mocks.navigate).toHaveBeenCalledWith("other", { forceReload: true, replacementParams: { search: "shared query" } });
    expect(mocks.openArticle).toHaveBeenCalledWith({ id: 1 }, "other", null, expect.any(Object));
});
test("search row cancellation keeps the existing state and never opens an article", async () => {
    setChosenDatasetView("other", "card");
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockResolvedValue({ abort: true });
    mount().element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(getChosenDatasetView("other")).toBe("card");
    expect(getUnifiedTableState("other").articleView.expandedId).toBe(99);
    expect(mocks.openArticle).not.toHaveBeenCalled();
});
test("Show all keeps the search collection behavior", async () => {
    mount().element.querySelector(".supplemental-dataset-show-all").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.navigate).toHaveBeenCalledWith("other", {
        forceReload: true, replacementParams: { search: "shared query" },
    });
});
test("the shared group accepts a row cap while search still defaults to three", () => {
    const manyRows = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: "Row " + i }));
    const search = mount();
    search.render(manyRows, ["title"], types);
    expect(search.element.querySelectorAll("li")).toHaveLength(3);
    const home = createSupplementalDatasetGroup({ dataset: "other", langKey: "other" }, "", { rowCap: 5 });
    home.render(manyRows, ["title"], types);
    expect(home.element.querySelectorAll("li")).toHaveLength(5);
});
test("Home Show all clears remembered articles and opens the newest-first card collection", async () => {
    const group = createSupplementalDatasetGroup({ dataset: "other", langKey: "other" }, "", {
        rowCap: 5, preselectArticle: true, emptyKey: "front_page_no_results", showAllKey: "front_page_show_all",
        replacementParams: { sort_column: "__newest", sort_order: "DESC", view: "card" },
    });
    document.body.append(group.element);
    group.render([], [], {});
    expect(group.element.hidden).toBe(false);
    setChosenDatasetView("other", "article_view");
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 }, cardView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockImplementation(async () => {
        expect(getChosenDatasetView("other")).toBe("card");
        expect(getUnifiedTableState("other").articleView.expandedId).toBeNull();
        expect(getUnifiedTableState("other").cardView.expandedId).toBeNull();
        return { abort: false };
    });
    group.element.querySelector(".supplemental-dataset-show-all").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("other", {
        forceReload: true, replacementParams: { sort_column: "__newest", sort_order: "DESC", view: "card" },
    }));
});
test("modified-click keeps native href behavior without touching navigation state", () => {
    const anchor = mount().element.querySelector("li a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
});

test.each([
    { show_value_on_card: false }, { hide_everywhere: true }, { hide_on_small_card: true },
    { card_element: "hidden,header" },
])("respects real streamed field-visibility metadata: %o", hidden => {
    const group = mount();
    group.render([{ id: 1, title: "HIDDEN TITLE", description: "HIDDEN DESCRIPTION" }], ["id", "title", "description"], {
        title: { ...types.title, ...hidden },
        description: { ...types.description, ...hidden },
    });
    expect(group.element.textContent).not.toContain("HIDDEN");
});

describe("renderExcerptWithMatchesMarked", () => {
    test("marks the searched word and leaves the rest as plain text", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "a domain name is registered", "domain");

        expect(element.textContent).toBe("a domain name is registered");
        const marks = element.querySelectorAll("mark");
        expect(marks).toHaveLength(1);
        expect(marks[0].textContent).toBe("domain");
    });

    test("marks every occurrence, not only the first", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "report on the report", "report");

        expect(element.querySelectorAll("mark")).toHaveLength(2);
        expect(element.textContent).toBe("report on the report");
    });

    test("never inserts stored text as markup", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "<img src=x onerror=alert(1)> domain", "domain");

        expect(element.querySelector("img")).toBeNull();
        expect(element.textContent).toContain("<img src=x onerror=alert(1)>");
    });

    test("leaves an extract with no match untouched", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "nothing of note here", "domain");

        expect(element.querySelectorAll("mark")).toHaveLength(0);
        expect(element.textContent).toBe("nothing of note here");
    });
});
