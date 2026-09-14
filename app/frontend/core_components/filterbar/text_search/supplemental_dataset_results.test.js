// @vitest-environment jsdom
// Tests localized text-only auxiliary links and approval-aware navigation.
// Keeps colliding row IDs scoped to the target dataset and preserves modified clicks.
import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
    navigate: vi.fn(), selected: vi.fn(), openArticle: vi.fn(), translate: vi.fn((_key, { fallback }) => fallback),
}));
vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({ openNavTab: mocks.navigate }));
vi.mock("../../state_stores/dataset_selection_saver.js", () => ({ getSelectedDataset: mocks.selected }));
vi.mock("../../table_views/card_view/row_article_opener.js", () => ({ openRowArticleView: mocks.openArticle }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: mocks.translate }));
vi.mock("../../navigation/nav_engine/dataset_aliases.js", () => ({ buildDatasetPath: name => "/alias-" + name }));
vi.mock("../../table_views/card_view/row_article_opener_helpers.js", () => ({
    buildCardUrl: (_prefix, name, id) => "/alias-" + name + "/" + id,
}));
import { createSupplementalDatasetGroup, getSupplementalSearchCopy } from "./supplemental_dataset_results.js";
import { refreshLocalizedDatasetValues } from "../../table_views/dataset_value_localizer.js";
const types = { title: { card_element: "header+lang_key", is_multilingual: true, show_value_on_card: true },
    description: { card_element: "description2", is_multilingual: true, show_value_on_card: true } };
const rows = [{ id: 1, title: JSON.stringify({ fi: "Suomen otsikko", en: "English title" }),
    description: JSON.stringify({ fi: "<p>Lyhyt <b>kuvaus</b><script>bad()</script></p>", en: "<p>Brief <b>description</b></p>" }) }];
function mount(dataset = "other") {
    const group = createSupplementalDatasetGroup({ dataset, text: "Other", langKey: "other" }, "shared query");
    document.body.append(group.element);
    group.render(rows, ["id", "title", "description"], types);
    return group;
}
beforeEach(() => {
    document.body.replaceChildren(); localStorage.clear(); vi.clearAllMocks();
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
test("dirty cancellation never opens a row and Show all requests replacement search only", async () => {
    const group = mount();
    mocks.navigate.mockResolvedValue({ abort: true, reason: "dirty_check_failed" });
    group.element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.navigate).toHaveBeenCalledWith("other", { forceReload: true, replacementParams: { search: "shared query" } });
    expect(mocks.openArticle).not.toHaveBeenCalled();
});
test("successful row navigation opens the exact target only after navigation approval", async () => {
    mount().element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.openArticle).toHaveBeenCalled());
    expect(mocks.openArticle).toHaveBeenCalledWith({ id: 1 }, "other", null, expect.any(Object));
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
