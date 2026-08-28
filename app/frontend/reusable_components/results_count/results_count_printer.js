// results_count_printer.js
// Prints and updates the visible results-count indicator above dataset results.
// Bridges row-count values with the localized count label shown in list and search views.
// Exists to keep results-count rendering consistent across result containers.

const SEARCH_BREAKDOWN_MODE = "search-breakdown";
const BREAKDOWN_FALLBACKS = {
    result: {
        fi: "tulos",
        en: "result",
        ch: "result",
    },
    results: {
        fi: "tulosta",
        en: "results",
        ch: "results",
    },
    result_in_text_search: {
        fi: "tulos tekstihaulla",
        en: "result in text search",
        ch: "text search result",
    },
    results_in_text_search: {
        fi: "tulosta tekstihaulla",
        en: "results in text search",
        ch: "text search results",
    },
    result_in_ai_search: {
        fi: "tulos tekoälyhaulla",
        en: "result in AI search",
        ch: "AI search result",
    },
    results_in_ai_search: {
        fi: "tulosta tekoälyhaulla",
        en: "results in AI search",
        ch: "AI search results",
    },
};

function getResultsCountLanguage() {
    const lang = String(document.documentElement?.lang || "")
        .trim()
        .toLowerCase();

    if (lang.startsWith("fi")) return "fi";
    if (lang.startsWith("ch") || lang.startsWith("zh")) return "ch";
    return "en";
}

function getFallbackText(langKey, fallbackText = "") {
    const preferredLanguage = getResultsCountLanguage();
    return (
        BREAKDOWN_FALLBACKS[langKey]?.[preferredLanguage] ||
        BREAKDOWN_FALLBACKS[langKey]?.en ||
        fallbackText
    );
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
    label.textContent = getFallbackText(langKey, fallbackText);

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
            "result_in_text_search",
            "results_in_text_search",
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
            "result_in_ai_search",
            "results_in_ai_search",
            "result in AI search",
            "results in AI search"
        )
    );

    el.appendChild(breakdown);
}

function renderLegacyResultsCountIntoElement(el, count) {
    const countValue = typeof count === "number" ? count : "?";
    const labelKey = count === 1 ? "result" : "results";
    el.textContent = "";
    el.classList.remove("results-count--search-breakdown");
    el.append(`${countValue} `);
    const label = document.createElement("span");
    label.textContent = getFallbackText(labelKey, labelKey);
    el.appendChild(label);
}

function renderResultsCountIntoElement(el, count) {
    if (!el) return;
    if (isSearchBreakdownCount(count)) {
        renderSearchBreakdownIntoElement(el, count);
        return;
    }

    renderLegacyResultsCountIntoElement(el, count);
}

export function setResultsCount(tableName, count) {
    const primaryEl = document.getElementById(`${tableName}_results_count`);
    renderResultsCountIntoElement(primaryEl, count);

    const mirrorEls = document.querySelectorAll(
        `[data-results-count-for="${tableName}"]`
    );
    mirrorEls.forEach((el) => renderResultsCountIntoElement(el, count));
}
