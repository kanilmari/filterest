// results_count_printer.test.js
// Verifies legacy and split intelligent-search count rendering in jsdom.
// Bridges the shared results-count renderer with primary and mirrored count hosts.
// Exists to prevent regressions when search UIs show separate text and AI result totals.
// @vitest-environment jsdom

import { afterEach, describe, expect, test } from "vitest";
import { setResultsCount, setSearchAiResultsCount, withdrawSearchAiResultsCount } from "./results_count_printer.js";

describe("setResultsCount", () => {
    afterEach(() => {
        setSearchAiResultsCount("tasks", null);
    });

    test("renders the numeric count with its dedicated plural key", () => {
        document.documentElement.lang = "en";
        document.body.innerHTML = `
            <div id="tasks_results_count"></div>
            <div data-results-count-for="tasks"></div>
        `;

        setResultsCount("tasks", 3);

        const primary = document.getElementById("tasks_results_count");
        const mirror = document.querySelector('[data-results-count-for="tasks"]');

        expect(primary.textContent).toBe("3 results");
        expect(primary.querySelector('[data-lang-key="results_count_plural"]')).not.toBeNull();
        expect(primary.classList.contains("results-count--search-breakdown")).toBe(false);
        expect(mirror.textContent).toBe("3 results");
    });

    test("marks the plural label for page translation regardless of HTML language", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setResultsCount("tasks", 5);

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("5 results");
        expect(primary.querySelector('[data-lang-key="results_count_plural"]')).not.toBeNull();
    });

    test("marks the singular label for page translation", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setResultsCount("tasks", 1);

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("1 result");
        expect(primary.querySelector('[data-lang-key="results_count_singular"]')).not.toBeNull();
    });

    test("renders separate text and AI counts for intelligent search", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `
            <div id="tasks_results_count"></div>
            <div data-results-count-for="tasks"></div>
        `;

        setResultsCount("tasks", {
            mode: "search-breakdown",
            textCount: 3,
            aiCount: 10,
        });

        const primary = document.getElementById("tasks_results_count");
        const mirror = document.querySelector('[data-results-count-for="tasks"]');
        const items = primary.querySelectorAll(".results-count-breakdown-item");

        expect(primary.classList.contains("results-count--search-breakdown")).toBe(true);
        expect(primary.textContent).toBe("3 results in text search + 10 results in AI search");
        expect(items).toHaveLength(2);
        expect(items[0].querySelector(".results-count-breakdown-label").dataset.langKey).toBe("results_count_text_search_plural");
        expect(items[1].querySelector(".results-count-breakdown-label").dataset.langKey).toBe("results_count_ai_search_plural");
        expect(items[0].textContent).toContain("3");
        expect(items[0].querySelector(".results-count-breakdown-label")?.textContent).toBe("results in text search");
        expect(items[1].textContent).toContain("10");
        expect(items[1].querySelector(".results-count-breakdown-label")?.textContent).toBe("results in AI search");
        expect(primary.querySelector('[data-lang-key="results_count_plural"]')).toBeNull();
        expect(mirror.textContent).toBe(primary.textContent);
    });

    test("uses singular phrasing when the text-search count is one", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setResultsCount("tasks", {
            mode: "search-breakdown",
            textCount: 1,
            aiCount: 0,
        });

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("1 result in text search + 0 results in AI search");
        expect(primary.querySelector(".results-count-breakdown-label")?.textContent).toBe("result in text search");
        expect(primary.querySelector(".results-count-breakdown-label").dataset.langKey).toBe("results_count_text_search_singular");
    });

    test("uses the dedicated singular AI key beside a zero text count", () => {
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;
        setResultsCount("tasks", { mode: "search-breakdown", textCount: 0, aiCount: 1 });
        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("0 results in text search + 1 result in AI search");
        expect(primary.querySelector('[data-lang-key="results_count_text_search_plural"]')).not.toBeNull();
        expect(primary.querySelector('[data-lang-key="results_count_ai_search_singular"]')).not.toBeNull();
    });

    test("keeps the search's AI number beside the dataset's own count", () => {
        // The listing publishes the true number of matches whenever another
        // batch arrives; the AI number registered by the search must survive it.
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setSearchAiResultsCount("tasks", 8);
        setResultsCount("tasks", 251);

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("251 results in text search + 8 results in AI search");
        expect(primary.classList.contains("results-count--search-breakdown")).toBe(true);
    });

    test("returns to a single number once the search's AI group is withdrawn", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setSearchAiResultsCount("tasks", 8);
        setResultsCount("tasks", 251);
        setSearchAiResultsCount("tasks", null);
        setResultsCount("tasks", 313);

        const primary = document.getElementById("tasks_results_count");
        expect(primary.textContent).toBe("313 results");
        expect(primary.classList.contains("results-count--search-breakdown")).toBe(false);
    });

    test("an empty AI group is not a second number", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `<div id="tasks_results_count"></div>`;

        setSearchAiResultsCount("tasks", 0);
        setResultsCount("tasks", 251);

        expect(document.getElementById("tasks_results_count").textContent).toBe("251 results");
    });

    test("one dataset's AI group never reaches another dataset's counter", () => {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `
            <div id="tasks_results_count"></div>
            <div id="orders_results_count"></div>
        `;

        setSearchAiResultsCount("tasks", 8);
        setResultsCount("tasks", 251);
        setResultsCount("orders", 12);

        expect(document.getElementById("orders_results_count").textContent).toBe("12 results");
    });
});

// #1039: the counter and the rows it describes change together. When the AI
// group leaves the screen without a new listing, the counter returns at once
// to the dataset's own number, which still describes the rows on screen.
describe("the AI part follows the AI group on the page", () => {
    afterEach(() => {
        setSearchAiResultsCount("tasks", null);
    });

    function countDom() {
        document.documentElement.lang = "fi";
        document.body.innerHTML = `
            <div id="tasks_results_count"></div>
            <div data-results-count-for="tasks"></div>
            <div id="tasks_search_ai_cards"></div>
        `;
        return {
            primary: document.getElementById("tasks_results_count"),
            mirror: document.querySelector('[data-results-count-for="tasks"]'),
            host: document.getElementById("tasks_search_ai_cards"),
        };
    }

    test("withdrawing the AI part redraws both counters with the dataset's own number", () => {
        const { primary, mirror, host } = countDom();
        setResultsCount("tasks", 5);
        setSearchAiResultsCount("tasks", 3, { isShown: () => host.isConnected });
        setResultsCount("tasks", 5);
        expect(primary.textContent).toBe("5 results in text search + 3 results in AI search");

        expect(withdrawSearchAiResultsCount("tasks")).toBe(true);

        expect(primary.textContent).toBe("5 results");
        expect(mirror.textContent).toBe("5 results");
        expect(primary.dataset.resultCount).toBe("5");
    });

    test("without an AI part the counter is left as it is", () => {
        const { primary } = countDom();
        setResultsCount("tasks", 5);
        const updates = [];
        primary.addEventListener("results-count-updated", () => updates.push(primary.textContent));

        expect(withdrawSearchAiResultsCount("tasks")).toBe(false);

        expect(updates).toEqual([]);
        expect(primary.textContent).toBe("5 results");
    });

    test("a view rebuilt without the AI group shows only the dataset's number", () => {
        const { primary, mirror, host } = countDom();
        setSearchAiResultsCount("tasks", 3, { isShown: () => host.isConnected });
        setResultsCount("tasks", 10);
        expect(primary.textContent).toBe("10 results in text search + 3 results in AI search");

        // The rebuild replaces the results surface, AI group included, and
        // writes the fresh listing's number before the group is placed again.
        host.remove();
        setResultsCount("tasks", 7);

        expect(primary.textContent).toBe("7 results");
        expect(mirror.textContent).toBe("7 results");
    });

    test("withdrawal redraws the number now on screen, not an older search's number", () => {
        const { primary, host } = countDom();
        setSearchAiResultsCount("tasks", 3, { isShown: () => host.isConnected });
        setResultsCount("tasks", 10);
        host.remove();
        // A rebuild committed an empty listing before the search learned of it.
        setResultsCount("tasks", 0);

        expect(withdrawSearchAiResultsCount("tasks")).toBe(true);

        expect(primary.textContent).toBe("0 results");
    });

    test("an AI group that is hidden but still in the page is not counted", () => {
        const { primary } = countDom();
        let shown = true;
        setSearchAiResultsCount("tasks", 3, { isShown: () => shown });
        setResultsCount("tasks", 5);
        expect(primary.textContent).toBe("5 results in text search + 3 results in AI search");

        shown = false;
        setResultsCount("tasks", 5);
        expect(primary.textContent).toBe("5 results");
    });
});
