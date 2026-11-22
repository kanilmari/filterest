// results_count_printer.js
// Prints and updates the visible results-count indicator above dataset results.
// Bridges row-count values with the localized count label shown in list and search views.
// Exists to keep results-count rendering consistent across result containers.

const SEARCH_BREAKDOWN_MODE = "search-breakdown";
// While a search is showing a group of AI results under the dataset's own
// matches, the counter describes two different things at once. The dataset's
// listing knows the true number of matches and the search knows how many AI
// rows it put on screen, and both of them update the counter at their own
// moments. Registering the AI part here lets either one publish without
// erasing the other's number, so the counter never contradicts the page.
const searchAiResultCounts = new Map();
// The dataset's own number that each counter shows now. Every writer passes it
// once the rows it describes are on screen, so it is the number that matches
// the visible rows when the AI part has to leave without a new listing.
const shownDatasetCounts = new Map();

/**
 * Register, or with a null or zero value withdraw, the AI part of a dataset's
 * counter. Only a search sets this; clearing the search withdraws it.
 * With `isShown`, the part counts only while that check says its AI group is
 * what the reader sees: a view rebuilt or switched without the group shows the
 * dataset's own number, never AI rows that are gone or hidden.
 */
export function setSearchAiResultsCount(tableName, aiCount, { isShown = null } = {}) {
    if (Number.isFinite(aiCount) && aiCount > 0) {
        searchAiResultCounts.set(tableName, { aiCount, isShown });
        return;
    }
    searchAiResultCounts.delete(tableName);
}

/**
 * Withdraw the AI part together with the AI group that just left the screen,
 * and show the counter again with the dataset's own number. The dataset's rows
 * stay until a new listing replaces them, so their number stays with them.
 * @returns {boolean} whether an AI part was withdrawn and the counter redrawn.
 */
export function withdrawSearchAiResultsCount(tableName) {
    if (!searchAiResultCounts.delete(tableName)) return false;
    if (shownDatasetCounts.has(tableName)) {
        setResultsCount(tableName, shownDatasetCounts.get(tableName));
    }
    return true;
}

function composeResultsCount(tableName, count) {
    const part = searchAiResultCounts.get(tableName);
    if (!part || typeof count !== "number" || (part.isShown && !part.isShown())) {
        return count;
    }

    return { mode: SEARCH_BREAKDOWN_MODE, textCount: count, aiCount: part.aiCount };
}

function isSearchBreakdownCount(count) {
    return (
        count &&
        typeof count === "object" &&
        count.mode === SEARCH_BREAKDOWN_MODE
    );
}

function createBreakdownItem(
    countValue,
    singularLangKey,
    pluralLangKey,
    singularFallbackText,
    pluralFallbackText
) {
    const isSingular = countValue === 1;
    const langKey = isSingular ? singularLangKey : pluralLangKey;
    const fallbackText = isSingular ? singularFallbackText : pluralFallbackText;

    const item = document.createElement("span");
    item.classList.add("results-count-breakdown-item");

    const value = document.createElement("span");
    value.classList.add("results-count-breakdown-value");
    value.textContent = String(countValue);

    const label = document.createElement("span");
    label.classList.add("results-count-breakdown-label");
    label.dataset.langKey = langKey;
    label.textContent = fallbackText;

    item.appendChild(value);
    item.append(" ");
    item.appendChild(label);
    return item;
}

function renderSearchBreakdownIntoElement(el, count) {
    const textCount = Number.isFinite(count?.textCount) ? count.textCount : 0;
    const aiCount = Number.isFinite(count?.aiCount) ? count.aiCount : 0;

    el.textContent = "";
    el.classList.add("results-count--search-breakdown");

    const breakdown = document.createElement("span");
    breakdown.classList.add("results-count-breakdown");
    breakdown.appendChild(
        createBreakdownItem(
            textCount,
            "results_count_text_search_singular",
            "results_count_text_search_plural",
            "result in text search",
            "results in text search"
        )
    );

    const separator = document.createElement("span");
    separator.classList.add("results-count-breakdown-separator");
    separator.textContent = " + ";
    breakdown.appendChild(separator);

    breakdown.appendChild(
        createBreakdownItem(
            aiCount,
            "results_count_ai_search_singular",
            "results_count_ai_search_plural",
            "result in AI search",
            "results in AI search"
        )
    );

    el.appendChild(breakdown);
}

function renderLegacyResultsCountIntoElement(el, count) {
    const countValue = typeof count === "number" ? count : "?";
    // Generic result/results keys may describe site headings rather than counts.
    const labelKey = count === 1 ? "results_count_singular" : "results_count_plural";
    el.textContent = "";
    el.classList.remove("results-count--search-breakdown");
    el.append(`${countValue} `);
    const label = document.createElement("span");
    label.dataset.langKey = labelKey;
    label.textContent = count === 1 ? "result" : "results";
    el.appendChild(label);
}

function renderResultsCountIntoElement(el, count) {
    if (!el) return;
    if (isSearchBreakdownCount(count)) {
        renderSearchBreakdownIntoElement(el, count);
    } else {
        renderLegacyResultsCountIntoElement(el, count);
    }
    const total = isSearchBreakdownCount(count)
        ? (count.textCount || 0) + (count.aiCount || 0) : count;
    el.dataset.resultCount = typeof total === "number" ? String(total) : "";
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    // Consumers such as empty-state guidance read this count instead of
    // parsing localized text or making a second listing request.
    el.dispatchEvent(new CustomEvent("results-count-updated", { bubbles: true }));
}

export function setResultsCount(tableName, count) {
    shownDatasetCounts.set(tableName, count);
    const composedCount = composeResultsCount(tableName, count);
    const primaryEl = document.getElementById(`${tableName}_results_count`);
    renderResultsCountIntoElement(primaryEl, composedCount);

    const mirrorEls = document.querySelectorAll(
        `[data-results-count-for="${tableName}"]`
    );
    mirrorEls.forEach((el) => renderResultsCountIntoElement(el, composedCount));
}
