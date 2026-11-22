// dataset_search_runtime_state.test.js
// Verifies that a search's AI part of the results counter follows the AI group
// the active view shows, with the real counter renderer under jsdom.
// Bridges the card list kept for an article's return with the article's own groups.
// Exists so the counter never counts AI rows that are hidden or absent (#1039).
// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from "vitest";
import { setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { setResultsCount, setSearchAiResultsCount } from "../../../reusable_components/results_count/results_count_printer.js";
import { syncSearchResultsCount } from "./dataset_search_runtime_state.js";

const AI_GROUP = '<div id="tasks_search_ai_cards"><div class="card" data-id="99"></div></div>';

/** A card list kept hidden for the article's return, beside the article view. */
function cardAndArticleViews({ cardsHaveAiGroup, articleHasAiGroup }) {
    document.body.innerHTML = `
        <div id="tasks_results_count"></div>
        <div data-results-count-for="tasks"></div>
        <div id="tasks_card_view_container">
            <div class="card_sidebar_panel"><div class="card_container">${cardsHaveAiGroup ? AI_GROUP : ""}</div></div>
        </div>
        <div id="tasks_article_view_container">
            <div class="card_sidebar_panel"><div class="card_container">${articleHasAiGroup ? AI_GROUP : ""}</div></div>
        </div>
    `;
}

function searchWithThreeAiRows() {
    return {
        datasetMatchCount: 5,
        data: [],
        aiData: [{ id: 99 }, { id: 100 }, { id: 101 }],
        filters: {},
        types: {},
    };
}

const counterText = () => document.getElementById("tasks_results_count").textContent;
const mirrorText = () => document.querySelector('[data-results-count-for="tasks"]').textContent;

describe("the counter's AI part follows the active view's AI group", () => {
    beforeEach(() => {
        localStorage.clear();
        sessionStorage.clear();
        sessionStorage.setItem("user_permissions", JSON.stringify(["/api/get-intelligent-results"]));
        document.documentElement.lang = "fi";
        setSearchAiResultsCount("tasks", null);
    });

    test("opening an article does not count the AI group of the card list kept behind it", () => {
        cardAndArticleViews({ cardsHaveAiGroup: true, articleHasAiGroup: false });
        setChosenDatasetView("tasks", "card");
        syncSearchResultsCount("tasks", searchWithThreeAiRows());
        expect(counterText()).toBe("5 results in text search + 3 results in AI search");

        // The article view is built and writes its listing's number before the
        // search places the article's own AI group.
        setChosenDatasetView("tasks", "article_view");
        setResultsCount("tasks", 5);

        expect(counterText()).toBe("5 results");
        expect(mirrorText()).toBe("5 results");
    });

    test("returning to cards does not count AI rows that only the article shows", () => {
        cardAndArticleViews({ cardsHaveAiGroup: false, articleHasAiGroup: true });
        setChosenDatasetView("tasks", "card");

        syncSearchResultsCount("tasks", searchWithThreeAiRows());

        expect(counterText()).toBe("5 results");
        expect(mirrorText()).toBe("5 results");
    });

    test("the article's own AI group is counted while the article shows it", () => {
        cardAndArticleViews({ cardsHaveAiGroup: false, articleHasAiGroup: true });
        setChosenDatasetView("tasks", "article_view");

        syncSearchResultsCount("tasks", searchWithThreeAiRows());

        expect(counterText()).toBe("5 results in text search + 3 results in AI search");
    });
});
