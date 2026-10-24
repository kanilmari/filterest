// compact_dataset_group.js
// Renders compact, localized matches from other permitted main-tab datasets.
// Reuses canonical dataset/row URLs and navigation approval before changing target query state.
// Keeps result copy as text and reuses card thumbnails without mounting article controls.

import { applyArticleViewAffordance, requireArticleViewAccess } from './card_view/article_view_access.js';
import { CARD_IMAGE_RENDER_SLOTS } from './card_view/card_image_render_options.js';
import { getTranslationForKey } from "../lang/translation_handler.js";
import {
    bindDatasetLanguageRenderer,
    resolveDatasetDisplayValue,
    setLocalizedDatasetText,
} from "./dataset_value_localizer.js";
import { buildDatasetPath } from "../navigation/nav_engine/dataset_aliases.js";
import { buildCardUrl } from "./card_view/row_article_opener_helpers.js";
import { getUnifiedTableState, setUnifiedTableState } from "../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView, forgetChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import { getParams, setParams } from "../navigation/nav_engine/query_params.js";
import { getSelectedDataset } from "../state_stores/dataset_selection_saver.js";

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

/** Write an extract into an element with the searched words marked.
 *
 * The extract is built from stored text, so it is never inserted as markup:
 * each piece goes in as text and only the marks are elements this code made.
 */
export function renderExcerptWithMatchesMarked(element, excerpt, query) {
    element.replaceChildren();
    if (!excerpt) return;

    let remaining = excerpt;
    // findSearchMatch reports the best match in what is left, so repeating it
    // walks the extract without needing a second idea of what a term is.
    for (let guard = 0; guard < 20; guard += 1) {
        const match = findSearchMatch(remaining, query);
        if (!match) break;
        if (match.index > 0) {
            element.append(remaining.slice(0, match.index));
        }
        const marked = document.createElement("mark");
        marked.textContent = remaining.slice(match.index, match.index + match.length);
        element.append(marked);
        remaining = remaining.slice(match.index + match.length);
        if (!remaining) return;
    }
    if (remaining) element.append(remaining);
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

/** Home row state is set before loading, just as for a deep link, so a remembered
 * article cannot open instead. Only the article opener writes an entry.
 * Ordinary show-all links keep the collection's existing navigation behavior.
 */
export function bindQueryNavigation(link, dataset, query, rowID = null, options = {}) {
    if (rowID !== null) applyArticleViewAffordance(link);
    link.addEventListener('keydown', event => {
        if (rowID !== null && link.dataset.articleAccess === 'denied' && ['Enter', ' '].includes(event.key)) {
            event.preventDefault();
            requireArticleViewAccess();
        }
    });
    link.addEventListener("click", async event => {
        if (rowID !== null && !requireArticleViewAccess()) { event.preventDefault(); return; }
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        let previousView;
        let previousState;
        let previousParams;
        const restoreState = () => {
            if (!previousState) return;
            if (previousView) setChosenDatasetView(dataset, previousView);
            else forgetChosenDatasetView(dataset);
            setUnifiedTableState(dataset, previousState);
            setParams(dataset, previousParams);
        };
        try {
            const { openNavTab } = await import("../navigation/main_tabs/main_tab_printer.js");
            const replacementParams = options.replacementParams || { search: query };
            // Search keeps its established dataset-then-article transition.
            // Only Home opts into an article directly from the root entry.
            if (!options.preselectArticle) {
                const result = await openNavTab(dataset, { forceReload: true, replacementParams });
                if (result?.abort || rowID === null || getSelectedDataset() !== dataset) return;
                const { openRowArticleView } = await import("./card_view/row_article_opener.js");
                await openRowArticleView({ id: rowID }, dataset, null, {
                    isCurrent: () => getSelectedDataset() === dataset,
                });
                return;
            }
            const targetView = rowID !== null ? "article_view" : replacementParams.view;
            if (targetView) {
                previousView = getChosenDatasetView(dataset);
                previousState = getUnifiedTableState(dataset);
                previousParams = { ...getParams(dataset) };
                setChosenDatasetView(dataset, targetView);
                setUnifiedTableState(dataset, {
                    articleView: { collapsed: rowID !== null, expandedId: rowID, returnView: "card",
                        pendingAutoOpenFirstRenderedResult: false, pendingAutoOpenFirstSearchResult: false },
                    ...(rowID === null ? { cardView: { collapsed: false, expandedId: null } } : {}),
                });
                // Skipping the URL stage also skips its parameter-cache write.
                // Prime the target query without changing the origin history entry.
                if (rowID !== null) setParams(dataset, { ...replacementParams, view: targetView });
            }
            const result = await openNavTab(dataset, {
                forceReload: true,
                ...(rowID !== null ? { skipUrlUpdate: true } : {}),
                replacementParams: { ...replacementParams, ...(rowID !== null ? { view: "article_view" } : {}) },
            });
            if (result?.abort) restoreState();
        } catch (error) {
            restoreState();
            console.warn("Compact result navigation failed:", error);
        }
    });
}

/** Reuse the card's lazy media and seeded fallback, without its article activation. */
function createSupplementalThumbnail(row, dataset, columns, types, titleColumn) {
    const host = document.createElement('div');
    host.className = 'supplemental-dataset-thumbnail';
    host.setAttribute('aria-hidden', 'true');
    const reserved = document.createElement('div');
    reserved.className = 'card_small_image';
    host.append(reserved);
    async function loadMedia() {
        // Home also imports this group: load article/card tools only for opted-in
        // thumbnails, after reserving geometry and before starting any media work.
        const [{ appendSmallCardSummary }, { resolveFallbackCardImageCandidate }] = await Promise.all([
            import('./card_view/card_row_presentation.js'),
            import('./card_view/card_element_builder_helpers.js'),
        ]);
        // The section may be cached off-DOM while the primary view changes.
        // Skip replaced rows, but still hydrate rows in that retained section.
        if (!host.closest('.supplemental-dataset-group')) return;
        const imageColumn = roleColumn(columns, types, 'image');
        const fallback = resolveFallbackCardImageCandidate({ cached_image: row.cached_image });
        const created = ['created', 'created_at', 'luontiaika'].map(column => row[column]).find(Boolean) || '';
        const label = plainText(resolveDatasetDisplayValue(row[titleColumn], types[titleColumn]));
        appendSmallCardSummary({
            card: host, row_item: row, table_name: dataset, setFieldHideAttribute: () => {},
            image_value_small: row[imageColumn] || fallback?.value || '',
            image_column_small: row[imageColumn] ? imageColumn : fallback?.column,
            // Opt compact results into the same raster presentation as full cards;
            // collapsed-card summaries and article media retain their existing slots.
            image_render_slot_small: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            preferred_image_alt_label: label,
            creation_seed: `${row.id ?? 'x'}_${created}`, header_first_letter: Array.from(label)[0] || '?',
            data_types: types,
        });
        // Move only media out of the summary; its link listener stays detached.
        host.replaceChildren(host.querySelector('.card_small_summary .card_small_image'));
        await host._ensureSmallSummaryMedia();
        // The adjacent link already names the row; keep media decorative even
        // after the shared image's missing-picture handler or a language change.
        // The shared error handler (registered first) sets data-lang-key="picture_missing"; the translation
        // observer would then refill alt from it, so every error clears the key and its context again (gate 254a).
        const keepDecorative = image => {
            image.alt = '';
            delete image.dataset.langKey;
            delete image.dataset.langAltContext;
        };
        host.querySelectorAll('img').forEach(image => {
            keepDecorative(image);
            image.addEventListener('error', () => keepDecorative(image));
        });
    }
    void loadMedia().catch(() => { host.dataset.thumbnailState = 'unavailable'; });
    return host;
}

/** One stable group per dataset; order comes solely from the accepted main-tab list. */
export function createSupplementalDatasetGroup(tab, query, {
    rowCap = 3, headingTag = 'h3', showAllKey = null, emptyKey = null, replacementParams,
    preselectArticle = false, includeThumbnails = false,
} = {}) {
    const element = document.createElement("section");
    element.className = "supplemental-dataset-group";
    element.dataset.dataset = tab.dataset;
    element.hidden = true;
    const heading = document.createElement(headingTag);
    bindDatasetLanguageRenderer(heading, () => {
        heading.textContent = plainText(getTranslationForKey(tab.langKey, {
            fallback: tab.text || tab.dataset, countUsage: false,
        }), 100);
    });
    const list = document.createElement("ul");
    const showAll = document.createElement("a");
    showAll.className = "supplemental-dataset-show-all";
    const linkParams = replacementParams || { search: query };
    const queryString = new URLSearchParams(linkParams).toString();
    const querySuffix = queryString ? "?" + queryString : "";
    showAll.href = buildDatasetPath(tab.dataset) + querySuffix;
    bindDatasetLanguageRenderer(showAll, language => {
        showAll.textContent = showAllKey
            ? getTranslationForKey(showAllKey, { countUsage: false })
            : getSupplementalSearchCopy(language).showAll;
    });
    bindQueryNavigation(showAll, tab.dataset, query, null, { replacementParams, preselectArticle });
    const empty = document.createElement("p");
    empty.hidden = true;
    if (emptyKey) bindDatasetLanguageRenderer(empty, () => {
        empty.textContent = getTranslationForKey(emptyKey, { countUsage: false });
    });
    element.append(heading, list, ...(emptyKey ? [empty] : []), showAll);

    return {
        element,
        render(rows, columns, types) {
            list.replaceChildren();
            const titleColumn = roleColumn(columns, types, "header");
            const extractColumns = snippetColumns(columns, types, titleColumn);
            for (const row of rows.slice(0, rowCap)) {
                const item = document.createElement("li");
                const text = includeThumbnails ? document.createElement('div') : item;
                if (includeThumbnails) {
                    item.className = 'supplemental-dataset-result';
                    text.className = 'supplemental-dataset-result-text';
                    item.append(createSupplementalThumbnail(row, tab.dataset, columns, types, titleColumn));
                }
                const title = document.createElement("a");
                title.href = buildCardUrl("/", tab.dataset, row.id, "") + querySuffix;
                title.dataset.rowId = String(row.id);
                setLocalizedDatasetText(title, titleColumn ? row[titleColumn] : row.id, types[titleColumn], {
                    transform: value => plainText(value, 140) || String(row.id),
                });
                bindQueryNavigation(title, tab.dataset, query, row.id, { replacementParams, preselectArticle });
                text.append(title);
                if (extractColumns.length) {
                    const description = document.createElement("p");
                    bindDatasetLanguageRenderer(description, language => {
                        const candidates = extractColumns.map(column => ({
                            value: resolveDatasetDisplayValue(row[column], types[column], language),
                        })).filter(candidate => plainText(candidate.value));
                        const matchingCandidate = candidates.find(candidate => findSearchMatch(
                            plainText(candidate.value), query
                        ));
                        const excerpt = buildSupplementalSearchExcerpt(
                            (matchingCandidate || candidates[0])?.value || "",
                            query
                        );
                        renderExcerptWithMatchesMarked(description, excerpt, query);
                        description.hidden = !excerpt;
                    });
                    text.append(description);
                }
                if (includeThumbnails) item.append(text);
                list.append(item);
            }
            empty.hidden = !emptyKey || rows.length > 0;
            element.hidden = !emptyKey && rows.length === 0;
        },
    };
}
