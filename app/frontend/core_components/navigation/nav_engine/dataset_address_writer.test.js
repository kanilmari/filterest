// @vitest-environment jsdom
// dataset_address_writer.test.js
// Verifies that one owner keeps the browser address, the cached query parameters and the
// remembered per-dataset view describing the same thing after a state settles.
// Bridges the real article close, the real query-parameter cache and the real History API.
// Exists because those three stores answered "which view is showing" separately, so a closed
// article or a permission fallback left view=article_view, and sometimes a row path, in an
// address that no longer described the page — and reloading it reopened an article.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./dataset_aliases.js", () => ({
    buildDatasetPath: (datasetName, prefix = "/") => `${prefix}${datasetName}`,
    getInternalDatasetName: (datasetName) => datasetName,
    getPublicDatasetName: (datasetName) => datasetName,
}));

vi.mock("../../dev_tools/function_counter.js", () => ({
    count_this_function: vi.fn(),
}));
vi.mock("../../config_fetcher.js", () => ({ getDefaultViewSync: () => "card" }));
vi.mock("../../state_stores/table_specs_reader.js", () => ({ getAllSpecs: () => ({}) }));

const refreshTableUnifiedMock = vi.hoisted(() => vi.fn());
vi.mock("../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js", async () => {
    const store = await import("../../state_stores/table_state_store.js");
    return {
        getUnifiedTableState: store.getUnifiedTableState,
        setUnifiedTableState: store.setUnifiedTableState,
        refreshTableUnified: refreshTableUnifiedMock,
    };
});

import { closeRowArticle } from "../../table_views/card_view/row_article_ui_handler.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { resolveDatasetDefaultView } from "../../table_views/dataset_default_view.js";
import { getParams, setParams, updateURL, useUrlParams } from "./query_params.js";
import {
    updateDatasetAddress, resetDatasetAddressOwnershipForTests,
    replaceDatasetAddressQuery, postponeUntilDatasetOwnsAddress,
} from "./dataset_address_writer.js";
import { claimImageFirstViewEntry, imageFirstViewOwnsEntry } from "./image_first_view_history.js";
import { primeDatasetAccessRegistry } from './dataset_access_registry.js';
import { ensureHistoryEntryId, retainHistoryEntryAddress } from './history_entry_state.js';

const DATASET = "travel_deals";
const ROW_PATH = "/travel_deals/12-sunset-in-lapland";

/** The browser address as a person would read it out of the location bar. */
function currentAddress() {
    return window.location.pathname + window.location.search + window.location.hash;
}

function readAddressParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search));
}

/**
 * Lands the browser on an address the way a bookmark or a reload does: the
 * address is the only source, and the per-dataset cache is seeded from it.
 */
function landOn(address, historyState = {}) {
    window.history.replaceState(historyState, "", address);
    useUrlParams();
}

function mountOpenArticle({ viewKey = "article_view" } = {}) {
    document.body.innerHTML = `
        <div id="${DATASET}_container">
            <div id="${DATASET}_${viewKey}_container">
                <div class="card_view_wrapper big-card-open" data-view-key="${viewKey}">
                    <div class="card_container"><div class="card"></div></div>
                    <article class="active_row_article"></article>
                </div>
            </div>
        </div>
    `;
    const wrapper = document.querySelector(".card_view_wrapper");
    return {
        wrapper,
        cardContainer: wrapper.querySelector(".card_container"),
        article: wrapper.querySelector(".active_row_article"),
    };
}

/**
 * Commits a search exactly as the dataset search bar does in
 * `filterbar/text_search/dataset_search_component_builder.js`: it copies the
 * cached parameters, adds the query and writes the address from them. This is
 * the step that used to copy a stale article_view back into the address.
 */
function commitSearchTheWayTheSearchBarDoes(query) {
    const params = getParams(DATASET);
    params.search = query;
    setParams(DATASET, params);
    updateURL(DATASET, params, undefined, {});
}

/** Lets the address owner's coalesced write, and any it supersedes, run. */
async function settle() {
    for (let turn = 0; turn < 4; turn += 1) {
        await Promise.resolve();
    }
}

describe("dataset address ownership", () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        document.body.innerHTML = "";
        refreshTableUnifiedMock.mockReset();
        resetDatasetAddressOwnershipForTests();
        window.history.replaceState({}, "", "/");
        primeDatasetAccessRegistry({ datasets: [{ table_uid: 11, dataset_name: DATASET, names: [DATASET], preferred_name: DATASET }] });
        useUrlParams();
    });

    afterEach(() => {
        resetDatasetAddressOwnershipForTests();
    });

    test.each([["calendar", "calendar"], [null, "card"]])(
        "loading without an address or tab view resolves default %s and replaces the address with %s",
        async (savedDefault, effectiveView) => {
            landOn(`/${DATASET}?search=lapland#section-2`, { __filterestEntryId: "default-load" });
            localStorage.setItem(`${DATASET}_tableMeta`, JSON.stringify({ default_view_name: savedDefault }));
            expect(getChosenDatasetView(DATASET)).toBeNull();
            expect(new URL(location.href).searchParams.has("view")).toBe(false);
            const lengthBefore = history.length;
            const entryBefore = history.state.__filterestEntryId;

            // The renderer records its resolved default before the settled-address write.
            setChosenDatasetView(DATASET, resolveDatasetDefaultView(DATASET));
            await updateDatasetAddress({ dataset: DATASET });

            expect(currentAddress()).toBe(`/${DATASET}?search=lapland&view=${effectiveView}#section-2`);
            expect(getParams(DATASET)).toEqual({ search: "lapland", view: effectiveView });
            expect(history.length).toBe(lengthBefore);
            expect(history.state.__filterestEntryId).toBe(entryBefore);
        },
    );

    // The owner's own sequence: a bookmarked row address whose cached parameters
    // still say article_view, closed directly, then searched.
    test.each(["card", "table", "normal"])(
        "closing a bookmarked article directly settles stored view, cache and address on %s",
        async (returnView) => {
            landOn(`${ROW_PATH}?view=article_view&search=lapland&country=FI`);
            expect(getParams(DATASET).view).toBe("article_view");
            setChosenDatasetView(DATASET, "article_view");
            setUnifiedTableState(DATASET, {
                articleView: { collapsed: true, expandedId: 12, returnView },
            });
            const { wrapper, cardContainer, article } = mountOpenArticle();

            closeRowArticle(wrapper, cardContainer, article, null, DATASET);
            await settle();

            expect(sessionStorage.getItem(`${DATASET}_view`)).toBe(returnView);
            expect(window.location.pathname).toBe(`/${DATASET}`);
            expect(readAddressParams()).toEqual({
                view: returnView,
                search: "lapland",
                country: "FI",
            });
            expect(getParams(DATASET)).toEqual({
                view: returnView,
                search: "lapland",
                country: "FI",
            });

            // The step that used to resurrect the closed article's view.
            commitSearchTheWayTheSearchBarDoes("harbour");
            await settle();

            expect(window.location.pathname).toBe(`/${DATASET}`);
            expect(readAddressParams()).toEqual({
                view: returnView,
                search: "harbour",
                country: "FI",
            });
            expect(getParams(DATASET).view).toBe(returnView);
            // Nothing in the settled address or state would reopen an article
            // if the person reloaded here.
            expect(getUnifiedTableState(DATASET).articleView.expandedId).toBeNull();
        }
    );

    test.each(["card", "table"])("Close after a row change renders the real %s list without stepping onto the previous article", async returnView => {
        landOn(`${ROW_PATH}?view=article_view&search=harbour`, {
            bigCard: true, dataset: DATASET, rowId: "12", articleReturnAvailable: false, articleFromRow: true,
        });
        setChosenDatasetView(DATASET, "article_view");
        setUnifiedTableState(DATASET, { articleView: { collapsed: true, expandedId: 12, returnView } });
        const { wrapper, cardContainer, article } = mountOpenArticle();
        const articleEntry = ensureHistoryEntryId();
        const historyLength = history.length;
        const back = vi.spyOn(history, "back");
        try {
            closeRowArticle(wrapper, cardContainer, article, null, DATASET);
            await settle();
            expect(back).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(refreshTableUnifiedMock).toHaveBeenCalledWith(DATASET, expect.objectContaining({ skipUrlParams: true })));
            expect(getChosenDatasetView(DATASET)).toBe(returnView);
            expect(readAddressParams()).toEqual({ view: returnView, search: "harbour" });
            expect(location.pathname).toBe(`/${DATASET}`);
            expect(getUnifiedTableState(DATASET).articleView.expandedId).toBeNull();
            // Closing is a new list visit. The last article must remain directly
            // reachable, including when it came from a bookmark without a list.
            expect(history.length).toBe(historyLength + 1);
            const listEntry = history.state.__filterestEntryId;
            history.back();
            await vi.waitFor(() => expect(history.state.__filterestEntryId).toBe(articleEntry));
            expect(location.pathname).toBe(ROW_PATH);
            history.forward();
            await vi.waitFor(() => expect(history.state.__filterestEntryId).toBe(listEntry));
            expect(location.pathname).toBe(`/${DATASET}`);
        } finally { back.mockRestore(); }
    });

    test("a view the person may not use falls back, and the settled address follows", async () => {
        landOn(`${ROW_PATH}?view=article_view&search=lapland`, {
            bigCard: true, dataset: DATASET, rowId: "12",
        });
        setUnifiedTableState(DATASET, {
            articleView: { collapsed: true, expandedId: 12, returnView: "card" },
        });
        // What the renderer records when a permission or capability check picks
        // another view: the corrected view, written back before it draws.
        setChosenDatasetView(DATASET, "table");

        await updateDatasetAddress({ dataset: DATASET });

        expect(window.location.pathname).toBe(`/${DATASET}`);
        expect(readAddressParams()).toEqual({ view: "table", search: "lapland" });
        expect(getParams(DATASET)).toEqual({ view: "table", search: "lapland" });
        expect(history.state.bigCard).toBe(false);
        expect(history.state.rowId).toBeUndefined();
    });

    test("an article view with no open row keeps article_view and drops only the row", async () => {
        landOn(`${ROW_PATH}?view=article_view&search=lapland`);
        setChosenDatasetView(DATASET, "article_view");
        setUnifiedTableState(DATASET, {
            articleView: { collapsed: false, expandedId: null },
        });

        await updateDatasetAddress({ dataset: DATASET });

        expect(window.location.pathname).toBe(`/${DATASET}`);
        expect(readAddressParams()).toEqual({ view: "article_view", search: "lapland" });
    });

    test("an open article keeps its own readable row address and its hash", async () => {
        landOn(`${ROW_PATH}?view=article_view&search=lapland#section-2`);
        setChosenDatasetView(DATASET, "article_view");
        setUnifiedTableState(DATASET, {
            articleView: { collapsed: true, expandedId: 12, returnView: "card" },
        });

        await updateDatasetAddress({ dataset: DATASET });

        expect(currentAddress()).toBe(`${ROW_PATH}?view=article_view&search=lapland#section-2`);
        expect(history.state).toMatchObject({ bigCard: true, dataset: DATASET, rowId: "12" });
    });

    test("reconciliation replaces the current entry instead of adding a step back", async () => {
        landOn(`/${DATASET}?view=article_view&search=lapland`);
        setChosenDatasetView(DATASET, "card");
        const lengthBefore = window.history.length;

        await updateDatasetAddress({ dataset: DATASET });

        expect(readAddressParams()).toEqual({ view: "card", search: "lapland" });
        expect(window.history.length).toBe(lengthBefore);
    });

    test("the image-first article keeps its own address", async () => {
        landOn(`${ROW_PATH}?view=image_first_view&search=lapland#image=3`);
        setChosenDatasetView(DATASET, "card");

        await updateDatasetAddress({ dataset: DATASET });

        expect(currentAddress()).toBe(`${ROW_PATH}?view=image_first_view&search=lapland#image=3`);
    });

    test("a late answer about a dataset the person already left writes nothing", async () => {
        landOn(`/${DATASET}?view=article_view`);
        setChosenDatasetView(DATASET, "card");

        const pending = updateDatasetAddress({ dataset: DATASET });
        landOn("/other_dataset?view=table");
        await pending;

        expect(currentAddress()).toBe("/other_dataset?view=table");
    });

    test("a superseded navigation does not write its address", async () => {
        landOn(`/${DATASET}?view=article_view`);
        setChosenDatasetView(DATASET, "card");

        await updateDatasetAddress({ dataset: DATASET, isCurrent: () => false });

        expect(currentAddress()).toBe(`/${DATASET}?view=article_view`);
    });

    test("only the newest request writes when one transition settles twice", async () => {
        landOn(`/${DATASET}?view=article_view`);
        setChosenDatasetView(DATASET, "card");

        const [firstWrote, secondWrote] = await Promise.all([
            updateDatasetAddress({ dataset: DATASET }),
            updateDatasetAddress({ dataset: DATASET }),
        ]);

        expect(firstWrote).toBe(false);
        expect(secondWrote).toBe(true);
        expect(readAddressParams()).toEqual({ view: "card" });
    });
});

describe("an image-first article owns the entry it lands on", () => {
    // A row address need not name the view: a shared link or a search result is
    // only "/{dataset}/{id}-{words}". The list behind the article used to put its
    // own address there before the article could open (fintravel.fi, 9.6.12).
    let release = null;
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        document.body.innerHTML = "";
        resetDatasetAddressOwnershipForTests();
        window.history.replaceState({}, "", "/");
        primeDatasetAccessRegistry({ datasets: [{ table_uid: 11, dataset_name: DATASET, names: [DATASET], preferred_name: DATASET }] });
        useUrlParams();
        release = null;
    });
    afterEach(() => {
        release?.();
        resetDatasetAddressOwnershipForTests();
    });

    test("the list behind a claimed plain row address settles without replacing it", async () => {
        landOn(`${ROW_PATH}?lang=fi`);
        setChosenDatasetView(DATASET, "card");
        release = claimImageFirstViewEntry();

        expect(await updateDatasetAddress({ dataset: DATASET })).toBe(false);
        expect(currentAddress()).toBe(`${ROW_PATH}?lang=fi`);

        // Without the claim the same settle describes the list: this is the
        // write that used to replace the row.
        release();
        expect(await updateDatasetAddress({ dataset: DATASET })).toBe(true);
        expect(currentAddress()).toBe(`/${DATASET}?lang=fi&view=card`);
    });

    test("a replacing list write keeps its parameters but leaves the address and its state alone", () => {
        landOn(`${ROW_PATH}?search=helsinki#image=3`, { anotherOwner: true });
        release = claimImageFirstViewEntry();
        const stateBefore = history.state;

        // A saved sort and a restored search both arrive like this.
        updateURL(DATASET, { search: "helsinki", sort_column: "__newest", sort_order: "DESC" }, undefined, { replace: true });

        expect(currentAddress()).toBe(`${ROW_PATH}?search=helsinki#image=3`);
        expect(history.state).toEqual(stateBefore);
        expect(getParams(DATASET)).toEqual({ search: "helsinki", sort_column: "__newest", sort_order: "DESC" });
    });

    test("the list can still move on to an entry of its own", () => {
        landOn(ROW_PATH);
        release = claimImageFirstViewEntry();
        const lengthBefore = window.history.length;

        updateURL(DATASET, { search: "oulu" }, undefined, {});

        expect(currentAddress()).toBe(`/${DATASET}?search=oulu`);
        expect(window.history.length).toBe(lengthBefore + 1);
        expect(imageFirstViewOwnsEntry()).toBe(false);
    });

    test("filter cleanup waits for the list's own address", () => {
        landOn(`${ROW_PATH}?retired_field=x`);
        release = claimImageFirstViewEntry();

        expect(replaceDatasetAddressQuery(DATASET, {})).toBe(false);
        expect(currentAddress()).toBe(`${ROW_PATH}?retired_field=x`);

        release();
        expect(replaceDatasetAddressQuery(DATASET, {})).toBe(true);
        expect(currentAddress()).toBe(ROW_PATH);
    });

    test("what the list put off runs once, when it settles on the same entry", async () => {
        landOn(ROW_PATH);
        setChosenDatasetView(DATASET, "card");
        release = claimImageFirstViewEntry();
        const run = vi.fn();
        postponeUntilDatasetOwnsAddress(DATASET, run);

        await updateDatasetAddress({ dataset: DATASET });
        await settle();
        expect(run).not.toHaveBeenCalled();

        // The article closes onto the list's address in the same entry.
        release();
        window.history.replaceState(history.state, "", `/${DATASET}?view=card`);
        useUrlParams();
        await updateDatasetAddress({ dataset: DATASET });
        await settle();
        expect(run).toHaveBeenCalledTimes(1);

        await updateDatasetAddress({ dataset: DATASET });
        await settle();
        expect(run).toHaveBeenCalledTimes(1);
    });

    test("work put off on an entry the person has left is dropped", async () => {
        landOn(ROW_PATH);
        setChosenDatasetView(DATASET, "card");
        release = claimImageFirstViewEntry();
        const run = vi.fn();
        postponeUntilDatasetOwnsAddress(DATASET, run);

        window.history.pushState({}, "", `/${DATASET}?view=card`);
        useUrlParams();
        await updateDatasetAddress({ dataset: DATASET });
        await settle();

        expect(run).not.toHaveBeenCalled();
    });

    test("a kept, refused address that names the view is not owned: the reader's own sort still writes", () => {
        landOn(`${ROW_PATH}?view=image_first_page_view`);
        retainHistoryEntryAddress();

        expect(imageFirstViewOwnsEntry()).toBe(false);
        updateURL(DATASET, { view: "card", sort_column: "price", sort_order: "ASC" }, undefined, { replace: true });

        expect(currentAddress()).toBe(`/${DATASET}?view=card&sort_column=price&sort_order=ASC`);
    });
});

test("settling a closed list preserves its return reference and original identity", async () => {
    landOn(`/${DATASET}?view=article_view&country=FI`, {
        bigCard: false, dataset: DATASET, cardReturnOriginEntry: "original-list",
    });
    const entry = ensureHistoryEntryId();
    setChosenDatasetView(DATASET, "card");
    await updateDatasetAddress({ dataset: DATASET });
    expect(readAddressParams()).toEqual({ view: "card", country: "FI" });
    expect(history.state).toMatchObject({ __filterestEntryId: entry, cardReturnOriginEntry: "original-list" });
});

test("a same-row address repair keeps its switch history until the entry becomes a list", async () => {
    landOn(`${ROW_PATH}?view=card`, { bigCard: true, dataset: DATASET, rowId: "12", articleFromRow: true });
    const entry = ensureHistoryEntryId();
    setChosenDatasetView(DATASET, "article_view");
    setUnifiedTableState(DATASET, { articleView: { collapsed: true, expandedId: 12 } });
    await updateDatasetAddress({ dataset: DATASET });
    expect(readAddressParams().view).toBe("article_view");
    expect(history.state).toMatchObject({ __filterestEntryId: entry, articleFromRow: true });

    setChosenDatasetView(DATASET, "card");
    await updateDatasetAddress({ dataset: DATASET });
    expect(location.pathname).toBe(`/${DATASET}`);
    expect(history.state.__filterestEntryId).toBe(entry);
    expect(history.state).not.toHaveProperty("articleFromRow");
});
