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
import { getParams, setParams, updateURL, useUrlParams } from "./query_params.js";
import { updateDatasetAddress, resetDatasetAddressOwnershipForTests } from "./dataset_address_writer.js";

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
        document.body.innerHTML = "";
        refreshTableUnifiedMock.mockReset();
        resetDatasetAddressOwnershipForTests();
        window.history.replaceState({}, "", "/");
        useUrlParams();
    });

    afterEach(() => {
        resetDatasetAddressOwnershipForTests();
    });

    // The owner's own sequence: a bookmarked row address whose cached parameters
    // still say article_view, closed directly, then searched.
    test.each(["card", "table", "normal"])(
        "closing a bookmarked article directly settles stored view, cache and address on %s",
        async (returnView) => {
            landOn(`${ROW_PATH}?view=article_view&search=lapland&country=FI`);
            expect(getParams(DATASET).view).toBe("article_view");
            localStorage.setItem(`${DATASET}_view`, "article_view");
            setUnifiedTableState(DATASET, {
                articleView: { collapsed: true, expandedId: 12, returnView },
            });
            const { wrapper, cardContainer, article } = mountOpenArticle();

            closeRowArticle(wrapper, cardContainer, article, null, DATASET);
            await settle();

            expect(localStorage.getItem(`${DATASET}_view`)).toBe(returnView);
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

    test("a view the person may not use falls back, and the settled address follows", async () => {
        landOn(`${ROW_PATH}?view=article_view&search=lapland`, {
            bigCard: true, dataset: DATASET, rowId: "12",
        });
        setUnifiedTableState(DATASET, {
            articleView: { collapsed: true, expandedId: 12, returnView: "card" },
        });
        // What the renderer records when a permission or capability check picks
        // another view: the corrected view, written back before it draws.
        localStorage.setItem(`${DATASET}_view`, "table");

        await updateDatasetAddress({ dataset: DATASET });

        expect(window.location.pathname).toBe(`/${DATASET}`);
        expect(readAddressParams()).toEqual({ view: "table", search: "lapland" });
        expect(getParams(DATASET)).toEqual({ view: "table", search: "lapland" });
        expect(history.state.bigCard).toBe(false);
        expect(history.state.rowId).toBeUndefined();
    });

    test("an article view with no open row keeps article_view and drops only the row", async () => {
        landOn(`${ROW_PATH}?view=article_view&search=lapland`);
        localStorage.setItem(`${DATASET}_view`, "article_view");
        setUnifiedTableState(DATASET, {
            articleView: { collapsed: false, expandedId: null },
        });

        await updateDatasetAddress({ dataset: DATASET });

        expect(window.location.pathname).toBe(`/${DATASET}`);
        expect(readAddressParams()).toEqual({ view: "article_view", search: "lapland" });
    });

    test("an open article keeps its own readable row address and its hash", async () => {
        landOn(`${ROW_PATH}?view=article_view&search=lapland#section-2`);
        localStorage.setItem(`${DATASET}_view`, "article_view");
        setUnifiedTableState(DATASET, {
            articleView: { collapsed: true, expandedId: 12, returnView: "card" },
        });

        await updateDatasetAddress({ dataset: DATASET });

        expect(currentAddress()).toBe(`${ROW_PATH}?view=article_view&search=lapland#section-2`);
        expect(history.state).toMatchObject({ bigCard: true, dataset: DATASET, rowId: "12" });
    });

    test("reconciliation replaces the current entry instead of adding a step back", async () => {
        landOn(`/${DATASET}?view=article_view&search=lapland`);
        localStorage.setItem(`${DATASET}_view`, "card");
        const lengthBefore = window.history.length;

        await updateDatasetAddress({ dataset: DATASET });

        expect(readAddressParams()).toEqual({ view: "card", search: "lapland" });
        expect(window.history.length).toBe(lengthBefore);
    });

    test("the image-first article keeps its own address", async () => {
        landOn(`${ROW_PATH}?view=image_first_view&search=lapland#image=3`);
        localStorage.setItem(`${DATASET}_view`, "card");

        await updateDatasetAddress({ dataset: DATASET });

        expect(currentAddress()).toBe(`${ROW_PATH}?view=image_first_view&search=lapland#image=3`);
    });

    test("a late answer about a dataset the person already left writes nothing", async () => {
        landOn(`/${DATASET}?view=article_view`);
        localStorage.setItem(`${DATASET}_view`, "card");

        const pending = updateDatasetAddress({ dataset: DATASET });
        landOn("/other_dataset?view=table");
        await pending;

        expect(currentAddress()).toBe("/other_dataset?view=table");
    });

    test("a superseded navigation does not write its address", async () => {
        landOn(`/${DATASET}?view=article_view`);
        localStorage.setItem(`${DATASET}_view`, "card");

        await updateDatasetAddress({ dataset: DATASET, isCurrent: () => false });

        expect(currentAddress()).toBe(`/${DATASET}?view=article_view`);
    });

    test("only the newest request writes when one transition settles twice", async () => {
        landOn(`/${DATASET}?view=article_view`);
        localStorage.setItem(`${DATASET}_view`, "card");

        const [firstWrote, secondWrote] = await Promise.all([
            updateDatasetAddress({ dataset: DATASET }),
            updateDatasetAddress({ dataset: DATASET }),
        ]);

        expect(firstWrote).toBe(false);
        expect(secondWrote).toBe(true);
        expect(readAddressParams()).toEqual({ view: "card" });
    });
});
