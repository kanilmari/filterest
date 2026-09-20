// supplemental_dataset_results.js
// Renders compact, localized matches from other permitted main-tab datasets.
// Reuses canonical dataset/row URLs and navigation approval before changing target query state.
// Keeps result content as text, with no editor or full article lifecycle inside a search group.

import { getTranslationForKey } from "../../lang/translation_handler.js";
import {
    bindDatasetLanguageRenderer,
    resolveDatasetDisplayValue,
    setLocalizedDatasetText,
} from "../../table_views/dataset_value_localizer.js";
import { buildDatasetPath } from "../../navigation/nav_engine/dataset_aliases.js";
import { buildCardUrl } from "../../table_views/card_view/row_article_opener_helpers.js";
import { getSelectedDataset } from "../../state_stores/dataset_selection_saver.js";

const COPY = Object.freeze({
    fi: { heading: "Muista aineistoista", showAll: "Näytä kaikki" },
    en: { heading: "From other datasets", showAll: "Show all" },
    ch: { heading: "其他数据集的结果", showAll: "显示全部" },
    yue: { heading: "其他資料集嘅結果", showAll: "顯示全部" },
});
const SEARCH_EXCERPT_MAX_LENGTH = 180;
export function getSupplementalSearchCopy(language) {
    const locale = String(language).toLowerCase();
    const key = locale.startsWith("zh-hk") || locale.startsWith("zh-hant") ? "yue"
        : locale.startsWith("zh") ? "ch" : locale.split("-")[0];
    return COPY[key] || COPY.en;
}

function plainText(value, length = Number.POSITIVE_INFINITY) {
    const parsed = document.createElement("template");
    parsed.innerHTML = String(value ?? "");
    parsed.content.querySelectorAll("script,style").forEach(node => node.remove());
    const text = (parsed.content.textContent || "").replace(/\s+/g, " ").trim();
    return text.length > length ? text.slice(0, length - 1).trimEnd() + "…" : text;
}

function findSearchMatch(text, query) {
    const searchableText = text.toLocaleLowerCase();
    const normalizedQuery = plainText(query).toLocaleLowerCase();
    const terms = [normalizedQuery, ...normalizedQuery.split(/\s+/u)]
        .filter((term, index, values) => term.length > 1 && values.indexOf(term) === index)
        .sort((left, right) => right.length - left.length);
    let bestMatch = null;
    for (const term of terms) {
        const index = searchableText.indexOf(term);
        if (index < 0) continue;
        if (!bestMatch || index < bestMatch.index) bestMatch = { index, length: term.length };
    }
    return bestMatch;
}

/** Build a short web-search-style extract around the first matching words. */
export function buildSupplementalSearchExcerpt(
    value,
    query,
    maxLength = SEARCH_EXCERPT_MAX_LENGTH
) {
    const text = plainText(value);
    if (text.length <= maxLength) return text;
    const match = findSearchMatch(text, query);
    if (!match) return plainText(text, maxLength);

    const contentBudget = Math.max(1, maxLength - 2);
    let start = Math.max(
        0,
        match.index - Math.floor((contentBudget - match.length) / 2)
    );
    let end = Math.min(text.length, start + contentBudget);
    if (end === text.length) start = Math.max(0, end - contentBudget);

    if (start > 0) {
        const nextWord = text.indexOf(" ", start);
        if (nextWord >= 0 && nextWord < match.index) start = nextWord + 1;
    }
    if (end < text.length) {
        const previousWord = text.lastIndexOf(" ", end);
        if (previousWord > match.index + match.length) end = previousWord;
    }

    const prefix = start > 0 ? "…" : "";
    const suffix = end < text.length ? "…" : "";
    return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function roleColumn(columns, types, role) {
    return columns.find(column => {
        const metadata = types[column];
        if (metadata?.show_value_on_card !== true || metadata.hide_everywhere === true || metadata.hide_on_small_card === true) return false;
        const roles = String(metadata.card_element || "").split(",").map(item => item.trim());
        if (roles.includes("hidden")) return false;
        return roles.some(item => new RegExp("^" + role + "\\d*(?:\\+lang_key)?$").test(item.trim()));
    });
}

function snippetColumns(columns, types, titleColumn) {
    const visibleColumns = columns.filter(column => {
        if (column === titleColumn || column === "id") return false;
        const metadata = types[column];
        if (metadata?.show_value_on_card !== true || metadata.hide_everywhere === true || metadata.hide_on_small_card === true) return false;
        const roles = String(metadata.card_element || "").split(",").map(item => item.trim());
        return !roles.includes("hidden");
    });
    return visibleColumns.sort((left, right) => {
        const descriptionRole = column => String(types[column]?.card_element || "")
            .split(",")
            .some(role => /^description\d*(?:\+lang_key)?$/.test(role.trim()));
        return Number(descriptionRole(right)) - Number(descriptionRole(left));
    });
}

function bindQueryNavigation(link, dataset, query, rowID = null) {
    link.addEventListener("click", async event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        try {
            const { openNavTab } = await import("../../navigation/main_tabs/main_tab_printer.js");
            const result = await openNavTab(dataset, {
                forceReload: true, replacementParams: { search: query },
            });
            if (result?.abort || rowID === null || getSelectedDataset() !== dataset) return;
            const { openRowArticleView } = await import("../../table_views/card_view/row_article_opener.js");
            await openRowArticleView({ id: rowID }, dataset, null, {
                isCurrent: () => getSelectedDataset() === dataset,
            });
        } catch (error) {
            console.warn("Supplemental result navigation failed:", error);
        }
    });
}

/** One stable group per dataset; order comes solely from the accepted main-tab list. */
export function createSupplementalDatasetGroup(tab, query) {
    const element = document.createElement("section");
    element.className = "supplemental-dataset-group";
    element.dataset.dataset = tab.dataset;
    element.hidden = true;
    const heading = document.createElement("h3");
    bindDatasetLanguageRenderer(heading, () => {
        heading.textContent = plainText(getTranslationForKey(tab.langKey, {
            fallback: tab.text || tab.dataset, countUsage: false,
        }), 100);
    });
    const list = document.createElement("ul");
    const showAll = document.createElement("a");
    showAll.className = "supplemental-dataset-show-all";
    showAll.href = buildDatasetPath(tab.dataset) + "?" + new URLSearchParams({ search: query });
    bindDatasetLanguageRenderer(showAll, language => {
        showAll.textContent = getSupplementalSearchCopy(language).showAll;
    });
    bindQueryNavigation(showAll, tab.dataset, query);
    element.append(heading, list, showAll);

    return {
        element,
        render(rows, columns, types) {
            list.replaceChildren();
            const titleColumn = roleColumn(columns, types, "header");
            const extractColumns = snippetColumns(columns, types, titleColumn);
            for (const row of rows.slice(0, 3)) {
                const item = document.createElement("li");
                const title = document.createElement("a");
                title.href = buildCardUrl("/", tab.dataset, row.id, "") + "?" + new URLSearchParams({ search: query });
                title.dataset.rowId = String(row.id);
                setLocalizedDatasetText(title, titleColumn ? row[titleColumn] : row.id, types[titleColumn], {
                    transform: value => plainText(value, 140) || String(row.id),
                });
                bindQueryNavigation(title, tab.dataset, query, row.id);
                item.append(title);
                if (extractColumns.length) {
                    const description = document.createElement("p");
                    bindDatasetLanguageRenderer(description, language => {
                        const candidates = extractColumns.map(column => ({
                            value: resolveDatasetDisplayValue(row[column], types[column], language),
                        })).filter(candidate => plainText(candidate.value));
                        const matchingCandidate = candidates.find(candidate => findSearchMatch(
                            plainText(candidate.value), query
                        ));
                        description.textContent = buildSupplementalSearchExcerpt(
                            (matchingCandidate || candidates[0])?.value || "",
                            query
                        );
                        description.hidden = !description.textContent;
                    });
                    item.append(description);
                }
                list.append(item);
            }
            element.hidden = rows.length === 0;
        },
    };
}
