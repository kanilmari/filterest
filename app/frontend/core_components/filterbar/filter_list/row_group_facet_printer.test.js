// row_group_facet_printer.test.js
// Verifies localized facet rendering, active state, validation, and route-backed toggling.
// Bridges first-page facet metadata with the common dataset controls in jsdom.
// Exists to keep row-group filters consistent across every view without stale category controls.
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { applyActiveFilterRemoveSide } from "./active_filter_chip_builder.js";

const {
    interfaceLanguage,
    languageRenderers,
    renderActiveFiltersMock,
    doIntelligentSearchMock,
    getParamsMock,
    getUnifiedTableStateMock,
    refreshTableUnifiedMock,
    setParamsMock,
    setUnifiedTableStateMock,
    updateURLMock,
} = vi.hoisted(() => ({
    interfaceLanguage: { current: "fi" },
    languageRenderers: new Map(),
    renderActiveFiltersMock: vi.fn(),
    doIntelligentSearchMock: vi.fn(),
    getParamsMock: vi.fn(),
    getUnifiedTableStateMock: vi.fn(),
    refreshTableUnifiedMock: vi.fn(),
    setParamsMock: vi.fn(),
    setUnifiedTableStateMock: vi.fn(),
    updateURLMock: vi.fn(),
}));

vi.mock("../../table_views/dataset_value_localizer.js", () => ({
    bindDatasetLanguageRenderer: (element, render) => {
        const renderInLanguage = language => { interfaceLanguage.current = language; render(language); };
        languageRenderers.set(element, renderInLanguage);
        renderInLanguage(interfaceLanguage.current);
    },
    resolveDatasetDisplayValue: (value, _metadata, language) => value?.[language] || "",
}));

vi.mock("../../lang/translation_handler.js", () => ({
    getTranslationForKey: key => ({
        fi: { row_group_categories: "Kategoriat", filters: "Suodattimet", show_more: "Näytä enemmän", show_less: "Näytä vähemmän", clear_selections: "Tyhjennä valinnat", remove: "Poista", close: "Sulje", search: "Haku",
            row_group_categories_modes_hint: "Saman otsikon valinnat laajentavat hakua.", row_group_match_any_hint: "Jokin valituista.",
            row_group_match_mode: "Hakutapa", row_group_match_any: "Vähintään yksi", row_group_match_all: "Kaikki valitut", row_group_match_all_hint: "Kaikki valitut arvot.",
            row_group_single_value_hint: "Rivillä on tässä yksi arvo.", row_group_selected_count: "valittu",
            row_group_no_name_matches: "Ei osumia.", row_group_selection_limit: "Enintään 20 arvoa.", row_group_no_results_hint: "Poista jokin valinta tai tyhjennä kaikki." },
        en: { row_group_categories: "Categories", filters: "Filters", show_more: "Show more", show_less: "Show less", clear_selections: "Clear selections", remove: "Remove", close: "Close", search: "Search",
            row_group_categories_modes_hint: "Choices under one heading widen the search.", row_group_match_any_hint: "Any selected.",
            row_group_match_mode: "Match mode", row_group_match_any: "At least one", row_group_match_all: "All selected", row_group_match_all_hint: "All selected values.",
            row_group_single_value_hint: "A row has one value here.", row_group_selected_count: "selected",
            row_group_no_name_matches: "No matches.", row_group_selection_limit: "Up to 20 values.", row_group_no_results_hint: "Remove a filter or clear all." },
    })[interfaceLanguage.current][key],
}));

vi.mock("../../navigation/nav_engine/dataset_address_writer.js", () => ({ updateDatasetAddress: vi.fn() }));

vi.mock("./active_filter_tag_printer.js", () => ({ renderActiveFilters: renderActiveFiltersMock }));

vi.mock("../../state_stores/table_state_store.js", () => ({
    getUnifiedTableState: getUnifiedTableStateMock,
    setUnifiedTableState: setUnifiedTableStateMock,
}));

vi.mock("../../navigation/nav_engine/query_params.js", () => ({
    getParams: getParamsMock,
    setParams: setParamsMock,
    updateURL: updateURLMock,
}));

vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", () => ({
    refreshTableUnified: refreshTableUnifiedMock,
    invalidateTableRefresh: vi.fn(),
}));

vi.mock("../../infinite_scroll/infinite_scroll_handler.js", () => ({ resetOffset: vi.fn(), disconnectInfiniteScroll: vi.fn() }));

vi.mock("../text_search/dataset_search_executor.js", () => ({
    do_intelligent_search: doIntelligentSearchMock,
}));

const heading = (id, sort_order = id, is_single = false) => ({ id, slug: `heading_${id}`, title: { fi: `Otsikko ${id}`, en: `Heading ${id}` }, sort_order, is_single });
const value = (id, slug, group = null, extra = {}) => ({ id, slug, title: { fi: slug, en: slug }, row_count: id, heading: group, ...extra });
const buttons = host => [...host.querySelectorAll('[data-testid="row-group-facet-heading"]')].filter(button => !button.hidden);
const open = (host, index = 0) => buttons(host)[index].click();
const popup = host => document.getElementById(host.querySelector('[aria-expanded="true"][data-heading-id]')?.getAttribute('aria-controls'));
const checkboxes = host => [...popup(host).querySelectorAll('[role="option"]')];

describe("row group category panel", () => {
    afterEach(async () => {
        const { clearRowGroupFacets } = await import("./row_group_facet_printer.js");
        clearRowGroupFacets("travel_info");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        setUnifiedTableStateMock.mockReset();
        setParamsMock.mockReset();
        interfaceLanguage.current = "fi";
        languageRenderers.clear();
        document.body.innerHTML = `<div id="travel_info_card_top_controls"><div class="active_filters"></div><div class="results_count">8 results</div></div>`;
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "security" }, offset: 0 });
        getParamsMock.mockReturnValue({ sort_column: "created", row_group: "security", offset: "20" });
        refreshTableUnifiedMock.mockResolvedValue(undefined);
    });

    test("places the safe localized panel before selected tags and results, with distinct selection and hit counts", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const onToggle = vi.fn();
        const host = renderRowGroupFacets("travel_info", [
            value(4, "security", null, { title: { fi: "Turvallisuus", en: "Security" }, row_count: 5 }),
            value(7, "lappi", null, { title: { fi: "Lappi", en: "Lapland" }, row_count: 3 }),
            value(9, "Unsafe value"),
        ], { onToggle });
        expect(host.previousElementSibling).toBeNull();
        expect(host.nextElementSibling.className).toBe("active_filters");
        expect(host.nextElementSibling.nextElementSibling.className).toBe("results_count");
        expect(host.getAttribute("aria-label")).toBe("Kategoriat");
        expect(host.querySelector("h2").textContent).toBe("Kategoriat");
        expect(host.querySelector(".row-group-facet-heading__badge").textContent).toBe("1");
        expect(host.querySelector(".row-group-facet-heading__badge").getAttribute("aria-label")).toBe("1 valittu");
        expect(popup(host)).toBeNull();
        open(host);
        expect(checkboxes(host)).toHaveLength(2);
        expect(checkboxes(host)[0].getAttribute("aria-selected") === "true").toBe(true);
        expect(checkboxes(host)[0].getAttribute("aria-label")).toBe("Turvallisuus: 5");
        checkboxes(host)[1].click();
        await vi.waitFor(() => expect(onToggle).toHaveBeenCalledWith("travel_info", "lappi"));
    });

    test("discloses exactly one panel and returns focus on Close, Escape and heading toggle", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const host = renderRowGroupFacets("travel_info", [value(1, "boat", heading(1)), value(2, "train", heading(2))]);
        open(host);
        expect(buttons(host).map(button => button.getAttribute("aria-expanded"))).toEqual(["true", "false"]);
        expect(popup(host).getAttribute("aria-labelledby")).toBe(popup(host).querySelector("h3").id);
        expect(document.activeElement).toBe(popup(host).querySelector("input[type=search]"));
        open(host, 1);
        expect(buttons(host).map(button => button.getAttribute("aria-expanded"))).toEqual(["false", "true"]);
        expect(checkboxes(host).map(input => input.dataset.optionValue)).toEqual(["train"]);
        checkboxes(host)[0].focus();
        checkboxes(host)[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(popup(host)).toBeNull();
        expect(document.activeElement).toBe(buttons(host)[1]);
        open(host);
        popup(host).querySelector(".msd-popup-close").click();
        expect(document.activeElement).toBe(buttons(host)[0]);
        open(host);
        open(host);
        expect(popup(host)).toBeNull();
    });

    test("a redraw that moves the focused value earlier reveals it in a popup that scrolls as a whole", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const host = renderRowGroupFacets("travel_info", [value(1, "boat"), value(2, "train"), value(3, "plane")]);
        open(host);
        const dialog = popup(host);
        const listbox = dialog.querySelector('[role="listbox"]');
        dialog.style.overflowY = "auto";
        vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ top: 16, bottom: 334 });
        vi.spyOn(listbox, "getBoundingClientRect").mockReturnValue({ top: -150, bottom: 340 });
        const plane = checkboxes(host)[2];
        const box = vi.spyOn(plane, "getBoundingClientRect").mockReturnValue({ top: 290, bottom: 334 });
        plane.focus(); dialog.scrollTop = 270; listbox.scrollTop = 100;
        // An administrator moved the value first; the redraw puts it above the popup's visible top, and the popup's
        // scroll moves it as in a browser (the card may render more than once per redraw).
        box.mockImplementation(() => ({ top: -106 + 270 - dialog.scrollTop, bottom: -62 + 270 - dialog.scrollTop }));
        renderRowGroupFacets("travel_info", [value(3, "plane"), value(1, "boat"), value(2, "train")]);
        expect(checkboxes(host)[0]).toBe(plane); expect(document.activeElement).toBe(plane);
        expect(listbox.scrollTop).toBe(100); expect(dialog.scrollTop).toBe(148);
    });

    test("lists all returned values in payload order and searches locally without changing selections or URL", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const facets = Array.from({ length: 14 }, (_, i) => value(i + 1, `group_${i}`));
        facets.push(value(20, "security", null, { row_count: 0, selected: true }));
        const host = renderRowGroupFacets("travel_info", facets);
        open(host);
        expect(checkboxes(host).map(input => input.dataset.optionValue)).toEqual(facets.map(facet => facet.slug));
        const search = popup(host).querySelector('input[type="search"]');
        search.focus();
        search.value = " SECURITY ";
        search.dispatchEvent(new Event("input"));
        expect(checkboxes(host)).toHaveLength(1);
        expect(checkboxes(host)[0].getAttribute("aria-selected") === "true").toBe(true);
        expect(document.activeElement).toBe(search);
        search.value = "absent";
        search.dispatchEvent(new Event("input"));
        expect(popup(host).querySelector(".msd-no-results").hidden).toBe(false);
        search.value = "";
        search.dispatchEvent(new Event("search"));
        expect(checkboxes(host)).toHaveLength(15);
        expect(updateURLMock).not.toHaveBeenCalled();
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
    });

    test("language switch retains panel, query, caret and scroll and translates labels and guidance", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const host = renderRowGroupFacets("travel_info", [value(1, "security", heading(1), { title: { fi: "Turvallisuus", en: "Security" }, row_count: 0, selected: true })]);
        open(host);
        const search = popup(host).querySelector('input[type="search"]');
        search.value = "i";
        search.dispatchEvent(new Event("input"));
        search.focus();
        search.setSelectionRange(1, 1);
        popup(host).querySelector(".msd-dropdown-options").scrollTop = 80;
        languageRenderers.get(host)("en");
        expect(host.getAttribute("aria-label")).toBe("Categories");
        expect(popup(host).querySelector("h3").textContent).toBe("Heading 1");
        const close = popup(host).querySelector(".msd-popup-close");
        expect([close.textContent, close.getAttribute("aria-label"), close.title]).toEqual(["×", "Close", "Close"]);
        expect(popup(host).querySelector('[data-lang-key="row_group_match_any_hint"]').textContent).toBe("Any selected.");
        expect(popup(host).querySelector("legend").textContent).toBe("Match mode");
        expect([...popup(host).querySelectorAll("fieldset label span")].map(item => item.textContent)).toEqual(["At least one", "All selected"]);
        expect(checkboxes(host)[0].getAttribute("aria-label")).toBe("Security: 0");
        expect(document.activeElement.type).toBe("search");
        expect(document.activeElement.value).toBe("i");
        expect(document.activeElement.selectionStart).toBe(1);
        expect(popup(host).querySelector(".msd-dropdown-options").scrollTop).toBe(80);
    });

    test("keeps open heading, search, selections and focused value across first-page rebuilds", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const facets = [value(1, "security", heading(1), { row_count: 0, selected: true }), value(2, "boat", heading(2))];
        let host = renderRowGroupFacets("travel_info", facets);
        open(host);
        const search = popup(host).querySelector('input[type="search"]');
        search.value = "security";
        search.dispatchEvent(new Event("input"));
        checkboxes(host)[0].focus();
        host = renderRowGroupFacets("travel_info", facets);
        expect(buttons(host)[0].getAttribute("aria-expanded")).toBe("true");
        expect(popup(host).querySelector('input[type="search"]').value).toBe("security");
        expect(document.activeElement.dataset.optionValue).toBe("security");
        expect(document.activeElement.getAttribute("aria-selected") === "true").toBe(true);
    });

    test.each(["start", "end"])("sorts headings, preserves untitled values and displays text safely with %s chip order", async side => {
        applyActiveFilterRemoveSide(side);
        const { renderRowGroupFacets, renderRowGroupFilterTags } = await import("./row_group_facet_printer.js");
        const tags = document.createElement("div");
        document.body.appendChild(tags);
        renderRowGroupFilterTags("travel_info", tags);
        const host = renderRowGroupFacets("travel_info", [
            value(1, "security", { ...heading(2, 10), title: { fi: "<img src=x>", en: "Theme" } }),
            value(2, "boat", heading(1, -1, true)), value(3, "legacy"),
        ]);
        expect(buttons(host).map(button => button.firstChild.textContent)).toEqual(["Otsikko 1", "Suodattimet", "<img src=x>"]);
        expect(host.querySelector("img")).toBeNull();
        open(host);
        expect(popup(host).querySelector('[data-lang-key="row_group_single_value_hint"]')).not.toBeNull();
        const chip = tags.firstChild;
        expect(chip.firstElementChild.classList.contains("remove-active-filter")).toBe(side === "start");
        expect(tags.querySelector("button").getAttribute("aria-label")).toBe("Poista: <img src=x>: security");
        expect(tags.querySelector(".row-group-filter-label").textContent).toBe("<img src=x>: security");
        languageRenderers.get(tags.firstChild)("en");
        expect(tags.querySelector("button").getAttribute("aria-label")).toBe("Remove: Theme: security");
    });

    test("keeps selected later headings available and expands other headings without truncating values", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "value_4_13" } });
        const facets = Array.from({ length: 5 }, (_, h) => Array.from({ length: 14 }, (_, v) => value(h * 20 + v + 1, `value_${h}_${v}`, heading(h + 1)))).flat();
        facets.at(-1).selected = true;
        facets.at(-1).row_count = 0;
        const host = renderRowGroupFacets("travel_info", facets);
        expect(buttons(host)).toHaveLength(4);
        open(host, 3);
        expect(checkboxes(host)).toHaveLength(14);
        expect(checkboxes(host).at(-1).getAttribute("aria-selected") === "true").toBe(true);
        host.querySelector('[data-lang-key="show_more"]').click();
        expect(buttons(host)).toHaveLength(5);
        host.querySelector('[data-lang-key="show_less"]').click();
        expect(buttons(host)).toHaveLength(4);
    });

    test("returns focus to a later heading even when closing would otherwise hide it", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        getUnifiedTableStateMock.mockReturnValue({ filters: {} });
        const host = renderRowGroupFacets("travel_info", Array.from({ length: 5 }, (_, i) => value(i + 1, `value_${i}`, heading(i + 1))));
        host.querySelector('[data-lang-key="show_more"]').click();
        open(host, 4);
        host.querySelector('[data-lang-key="show_less"]').click();
        expect(buttons(host)).toHaveLength(4);
        popup(host).querySelector(".msd-popup-close").click();
        expect(document.activeElement.dataset.headingId).toBe("5");
        expect(document.activeElement.getAttribute("aria-expanded")).toBe("false");
    });

    test("blocks a twenty-first value but allows removal of selected values", async () => {
        const { renderRowGroupFacets, toggleRowGroupFacet } = await import("./row_group_facet_printer.js");
        const selected = Array.from({ length: 20 }, (_, i) => `group_${i}`);
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: selected.join(",") } });
        const host = renderRowGroupFacets("travel_info", [...selected.map((slug, i) => value(i + 1, slug)), value(30, "extra")]);
        open(host);
        expect(checkboxes(host).at(-1).getAttribute("aria-disabled") === "true").toBe(true);
        expect(checkboxes(host)[0].getAttribute("aria-disabled") === "true").toBe(false);
        expect(popup(host).querySelector('[data-lang-key="row_group_selection_limit"]')).not.toBeNull();
        expect(await toggleRowGroupFacet("travel_info", "extra")).toBe(false);
        expect(await toggleRowGroupFacet("travel_info", "bad value")).toBe(false);
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
        expect(await toggleRowGroupFacet("travel_info", "group_0")).toBe(true);
    });

    test("rejects stale responses without disturbing the open panel, focus or selection", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const host = renderRowGroupFacets("travel_info", [value(1, "security")]);
        open(host);
        checkboxes(host)[0].focus();
        expect(renderRowGroupFacets("travel_info", [], { authoritative: true, isCurrent: () => false })).toBe(host);
        expect(renderRowGroupFacets("travel_info", [], { authoritative: true, requestFilters: {} })).toBe(host);
        expect(document.activeElement.getAttribute("aria-selected") === "true").toBe(true);
        expect(setUnifiedTableStateMock).not.toHaveBeenCalled();
    });

    test("updates zero-result recovery from the existing count and suppresses it for AI results", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const { setResultsCount, setSearchAiResultsCount } = await import("../../../reusable_components/results_count/results_count_printer.js");
        const count = document.querySelector(".results_count");
        count.dataset.resultsCountFor = "travel_info";
        const host = renderRowGroupFacets("travel_info", [value(1, "security", null, { row_count: 0, selected: true })]);
        const hint = host.querySelector(".row-group-facets__empty-hint");
        expect(hint.hidden).toBe(true);
        setResultsCount("travel_info", 0);
        expect(hint.hidden).toBe(false);
        setSearchAiResultsCount("travel_info", 3);
        setResultsCount("travel_info", 0);
        expect(hint.hidden).toBe(true);
        setSearchAiResultsCount("travel_info", null);
        getUnifiedTableStateMock.mockReturnValue({ filters: {} });
        setResultsCount("travel_info", 0);
        expect(hint.hidden).toBe(true);
    });

    test("receives count changes when article tags move to a sidebar without a top count mirror", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const { setResultsCount } = await import("../../../reusable_components/results_count/results_count_printer.js");
        document.body.innerHTML = '<div id="travel_info_card_top_controls"></div><div id="travel_info_results_count"></div>';
        const host = renderRowGroupFacets("travel_info", [value(1, "security", null, { selected: true, row_count: 0 })]);
        setResultsCount("travel_info", 0);
        expect(host.querySelector(".row-group-facets__empty-hint").hidden).toBe(false);
        setResultsCount("travel_info", 1);
        expect(host.querySelector(".row-group-facets__empty-hint").hidden).toBe(true);
    });

    test("removes the host and its count listener when facets are explicitly cleared", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const host = renderRowGroupFacets("travel_info", [value(1, "security")]);
        const dispose = vi.spyOn(host, "disposeRowGroupPanel");
        expect(renderRowGroupFacets("travel_info", null)).toBeNull();
        expect(dispose).toHaveBeenCalledOnce();
        expect(host.isConnected).toBe(false);
    });

    test("toggles canonical selection in state and URL, preserves other filters and resets paging", async () => {
        const { toggleRowGroupFacet } = await import("./row_group_facet_printer.js");
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "security,boat,security", published: "true" } });
        await toggleRowGroupFacet("travel_info", "train");
        expect(setUnifiedTableStateMock).toHaveBeenLastCalledWith("travel_info", { filters: { row_group: "boat,security,train", published: "true" }, offset: 0 });
        expect(updateURLMock).toHaveBeenLastCalledWith("travel_info", { sort_column: "created", row_group: "boat,security,train" });
        expect(refreshTableUnifiedMock).toHaveBeenCalledWith("travel_info", { skipUrlParams: true });
    });

    test("clears only categories and reruns committed search, preserving ordinary filters", async () => {
        const { clearRowGroupSelection } = await import("./row_group_facet_printer.js");
        getUnifiedTableStateMock.mockReturnValue({ filters: { row_group: "boat,train", published: "true" } });
        getParamsMock.mockReturnValue({ row_group: "boat,train", published: "true", search: "matka", offset: "20" });
        await clearRowGroupSelection("travel_info");
        expect(setUnifiedTableStateMock).toHaveBeenCalledWith("travel_info", { filters: { published: "true" }, offset: 0 });
        expect(updateURLMock).toHaveBeenCalledWith("travel_info", { published: "true", search: "matka" });
        expect(doIntelligentSearchMock).toHaveBeenCalledExactlyOnceWith("travel_info", "matka");
        expect(refreshTableUnifiedMock).not.toHaveBeenCalled();
    });

    test("multi-valued and legacy headings expose translated radios before search; single headings keep their hint", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const host = renderRowGroupFacets("travel_info", [value(1, "boat", heading(1)), value(2, "train", heading(2, 2, true)), value(3, "legacy")]);
        open(host, 1);
        const fieldset = popup(host).querySelector("fieldset:not([hidden])");
        expect(fieldset.querySelector("legend").textContent).toBe("Hakutapa");
        expect([...fieldset.querySelectorAll("span")].map(item => item.textContent)).toEqual(["Vähintään yksi", "Kaikki valitut"]);
        expect(fieldset.compareDocumentPosition(popup(host).querySelector('input[type="search"]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(fieldset.querySelector('[value="any"]').checked).toBe(true);
        expect(fieldset.getAttribute("aria-describedby")).toBe(popup(host).querySelector(".row-group-facet-panel__hint").id);
        open(host, 0);
        expect(popup(host).querySelector("fieldset:not([hidden])")).not.toBeNull();
        open(host, 2);
        expect(popup(host).querySelector("fieldset:not([hidden])")).toBeNull();
        expect(popup(host).querySelector(".row-group-facet-panel__hint").textContent).toBe("Rivillä on tässä yksi arvo.");
    });

    test("ALL refresh preserves radio focus, query and scroll; hint and Escape follow the mode", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        let state = { filters: { row_group: "security" } };
        getUnifiedTableStateMock.mockImplementation(() => state);
        const facets = [value(1, "security", heading(1)), value(2, "train", heading(1))];
        const onModeChange = vi.fn((_table, id, mode) => { state = { filters: { ...state.filters, row_group_mode: `${id}:${mode}` } }; });
        let host = renderRowGroupFacets("travel_info", facets, { onModeChange });
        open(host);
        popup(host).querySelector('input[type="search"]').value = "sec";
        popup(host).querySelector('input[type="search"]').dispatchEvent(new Event("input"));
        popup(host).querySelector(".msd-dropdown-options").scrollTop = 81;
        const radio = popup(host).querySelector('[value="all"]'); radio.focus(); radio.click();
        await vi.waitFor(() => expect(host.getAttribute("aria-busy")).not.toBe("true"));
        expect(onModeChange).toHaveBeenCalledWith("travel_info", 1, "all");
        host = renderRowGroupFacets("travel_info", facets, { onModeChange });
        expect(document.activeElement).toBe(popup(host).querySelector('[value="all"]'));
        expect(popup(host).querySelector('[value="all"]').checked).toBe(true);
        expect(popup(host).querySelector('input[type="search"]').value).toBe("sec");
        expect(popup(host).querySelector(".msd-dropdown-options").scrollTop).toBe(81);
        expect(popup(host).querySelector(".row-group-facet-panel__hint").textContent).toBe("Kaikki valitut arvot.");
        document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(document.activeElement).toBe(buttons(host)[0]);
    });

    test("unselected zero hits remain dimmed, focusable and selectable", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        const onToggle = vi.fn();
        const host = renderRowGroupFacets("travel_info", [value(1, "empty", heading(1), { row_count: 0, zero_hit: true })], { onToggle });
        open(host);
        const checkbox = checkboxes(host)[0];
        expect(checkbox.getAttribute("aria-disabled") === "true").toBe(false);
        expect(checkbox.classList.contains("msd-option--dimmed")).toBe(true);
        checkbox.focus(); expect(document.activeElement).toBe(checkbox);
        checkbox.click(); await vi.waitFor(() => expect(onToggle).toHaveBeenCalledWith("travel_info", "empty"));
    });

    test("mode preference, tag removal and category clear share the state/URL refresh path", async () => {
        const { renderRowGroupFacets, setRowGroupMatchMode, toggleRowGroupFacet, clearRowGroupSelection } = await import("./row_group_facet_printer.js");
        let state = { filters: { status: "open" }, offset: 12 };
        let params = { status: "open", offset: "12" };
        getUnifiedTableStateMock.mockImplementation(() => state);
        setUnifiedTableStateMock.mockImplementation((_table, next) => { state = { ...state, ...next }; });
        getParamsMock.mockImplementation(() => ({ ...params }));
        setParamsMock.mockImplementation((_table, next) => { params = next; });
        renderRowGroupFacets("travel_info", [value(1, "boat", heading(10)), value(2, "train", heading(10))]);
        expect(await setRowGroupMatchMode("travel_info", 10, "all")).toBe(true);
        expect(state.filters).toEqual({ status: "open", row_group_mode: "10:all" });
        expect(params).toEqual({ status: "open", row_group_mode: "10:all" });
        expect(state.offset).toBe(0);
        await toggleRowGroupFacet("travel_info", "boat"); await toggleRowGroupFacet("travel_info", "boat");
        expect(state.filters).toEqual({ status: "open", row_group_mode: "10:all" });
        await clearRowGroupSelection("travel_info");
        expect(state.filters).toEqual({ status: "open" }); expect(params).toEqual({ status: "open" });
        expect(refreshTableUnifiedMock).toHaveBeenCalledTimes(4);
    });

    test("each heading preserves its own query and clear resets modes without closing the popup", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        let state = { filters: { row_group: "security", row_group_mode: "1:all" } };
        getUnifiedTableStateMock.mockImplementation(() => state);
        const onClear = vi.fn(() => { state = { filters: {} }; });
        const host = renderRowGroupFacets("travel_info", [value(1, "security", heading(1)), value(2, "train", heading(2))], { onClear });
        const firstHeading = buttons(host)[0];
        open(host); const firstPopup = popup(host); const firstSearch = firstPopup.querySelector("input[type=search]");
        firstSearch.value = "sec"; firstSearch.dispatchEvent(new Event("input"));
        open(host, 1); popup(host).querySelector("input[type=search]").value = "train";
        expect(firstPopup.style.display).toBe("none");
        open(host); expect(popup(host)).toBe(firstPopup); expect(firstSearch.value).toBe("sec");
        const radio = firstPopup.querySelector('[value="all"]'); radio.focus();
        host.querySelector('[data-row-group-focus="clear-categories"]').click();
        await vi.waitFor(() => expect(host.hasAttribute("aria-busy")).toBe(false));
        expect(onClear).toHaveBeenCalledWith("travel_info"); expect(firstHeading.getAttribute("aria-expanded")).toBe("true");
        expect(firstSearch.value).toBe("sec"); expect(firstPopup.querySelector('[value="any"]').checked).toBe(true);
        expect(firstPopup.querySelector('[role="option"]').getAttribute("aria-selected")).toBe("false");
    });

    test("cross-heading limit and refused selection resynchronize options without replacing metadata", async () => {
        const { renderRowGroupFacets } = await import("./row_group_facet_printer.js");
        let state = { filters: { row_group: Array.from({ length: 20 }, (_, i) => `hidden_${i}`).join(",") } };
        getUnifiedTableStateMock.mockImplementation(() => state);
        const onToggle = vi.fn(() => false);
        const facets = [value(1, "security", heading(1), { row_count: 0, zero_hit: true })];
        const host = renderRowGroupFacets("travel_info", facets, { onToggle }); open(host);
        checkboxes(host)[0].click(); expect(onToggle).not.toHaveBeenCalled();
        expect(checkboxes(host)[0].getAttribute("aria-disabled")).toBe("true");
        state = { filters: {} }; renderRowGroupFacets("travel_info", facets, { onToggle });
        const row = checkboxes(host)[0]; row.focus(); row.click();
        await vi.waitFor(() => expect(host.hasAttribute("aria-busy")).toBe(false));
        expect(row.getAttribute("aria-selected")).toBe("false"); expect(checkboxes(host)[0]).toBe(row);
        expect(document.activeElement).toBe(row);
        const nextToggle = vi.fn();
        renderRowGroupFacets("travel_info", [value(1, "security", heading(1), { row_count: 7 })], { onToggle: nextToggle });
        expect(row.getAttribute("aria-label")).toBe("security: 7"); expect(row.classList.contains("msd-option--dimmed")).toBe(false);
        row.click(); await vi.waitFor(() => expect(nextToggle).toHaveBeenCalledWith("travel_info", "security"));
    });

    test("removed headings and an explicitly cleared card dispose every popup", async () => {
        const { renderRowGroupFacets, clearRowGroupFacets } = await import("./row_group_facet_printer.js");
        const host = renderRowGroupFacets("travel_info", [value(1, "security", heading(1)), value(2, "train", heading(2))]);
        open(host); const firstPopup = popup(host); open(host, 1); const secondPopup = popup(host);
        renderRowGroupFacets("travel_info", [value(1, "security", heading(1))]);
        expect(firstPopup.isConnected).toBe(true); expect(secondPopup.isConnected).toBe(false);
        clearRowGroupFacets("travel_info"); expect(firstPopup.isConnected).toBe(false);
        expect(host.hasAttribute("data-dataset-language-renderer")).toBe(false);
    });

});
