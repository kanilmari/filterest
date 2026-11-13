// compact_dataset_group.js
// Renders compact, localized matches from other permitted main-tab datasets.
// Reuses canonical dataset/row URLs and navigation approval before changing target query state.
// Keeps result copy as text and reuses card thumbnails without mounting article controls.

import { openArticleAfterListing, openExplicitRowListingTab } from './card_view/row_article_listing_navigation.js';
import { bindRowActivation, bindRowOpeningHref } from './card_view/default_row_affordance.js';
import { openDefaultRowPresentation } from './row_presentation/row_presentation_dispatcher.js';
import { isRecordTitleColumnVisible, resolveRecordTitle } from './record_title_resolver.js';
import { CARD_IMAGE_RENDER_SLOTS } from './card_view/card_image_render_options.js';
import { getTranslationForKey } from "../lang/translation_handler.js";
import {
    bindDatasetLanguageRenderer,
    resolveDatasetDisplayValue,
} from "./dataset_value_localizer.js";
import { buildDatasetPath } from "../navigation/nav_engine/dataset_aliases.js";
import { buildCardUrl } from "./card_view/row_article_opener_helpers.js";
import { getUnifiedTableState, setUnifiedTableState } from "../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView, forgetChosenDatasetView } from "../state_stores/dataset_view_choice_saver.js";
import { getParams, setParams } from "../navigation/nav_engine/query_params.js";

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

function truncateText(text, length) {
    return text.length > length ? text.slice(0, length - 1).trimEnd() + "…" : text;
}

function plainText(value, length = Number.POSITIVE_INFINITY) {
    const parsed = document.createElement("template");
    parsed.innerHTML = String(value ?? "");
    parsed.content.querySelectorAll("script,style").forEach(node => node.remove());
    const text = (parsed.content.textContent || "").replace(/\s+/g, " ").trim();
    return truncateText(text, length);
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

function columnsForRole(columns, types, role) {
    const pattern = new RegExp("^" + role + "\\d*(?:\\+lang_key)?$");
    return columns.filter(column => String(types[column].card_element || "")
        .split(",").some(item => pattern.test(item.trim())));
}

function snippetColumns(columns, types, firstHeader) {
    return columns.filter(column => column !== firstHeader && column !== "id").sort((left, right) => {
        const descriptionRole = column => String(types[column]?.card_element || "")
            .split(",")
            .some(role => /^description\d*(?:\+lang_key)?$/.test(role.trim()));
        return Number(descriptionRole(right)) - Number(descriptionRole(left));
    });
}

/** Clear remembered article intent before loading, then explicitly open the
 * requested row under its ticket. Only the article opener writes a row entry.
 * Ordinary show-all links keep the collection's existing navigation behavior.
 */
export function bindQueryNavigation(link, dataset, query, rowID = null, options = {}) {
    const replacementParams = options.replacementParams || { search: query };
    const click = event => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (rowID === null) return openClassicOrCollection();
        return openDefaultRowPresentation({ id: rowID }, dataset, null, {
            search: new URLSearchParams(replacementParams).toString(),
            openClassic: (_row, _table, _card, request) => openClassicOrCollection(request),
        });
    };
    if (rowID === null) link.addEventListener("click", click);
    else {
        bindRowOpeningHref(link, link.href, dataset);
        bindRowActivation(link, dataset, click);
    }

    async function openClassicOrCollection(request) {
        let restoreCollection = null;
        try {
            const { openNavTab } = await import("../navigation/main_tabs/main_tab_printer.js");
            if (request && !request.isCurrent()) return;
            const targetView = options.preselectArticle
                ? (rowID !== null ? "article_view" : replacementParams.view) : null;
            // Show all retains its established dirty-check state restoration.
            if (rowID === null && targetView) {
                const previousView = getChosenDatasetView(dataset);
                const previousState = getUnifiedTableState(dataset);
                const previousParams = { ...getParams(dataset) };
                restoreCollection = () => {
                    if (previousView) setChosenDatasetView(dataset, previousView);
                    else forgetChosenDatasetView(dataset);
                    setUnifiedTableState(dataset, previousState);
                    setParams(dataset, previousParams);
                };
            }
            if (targetView) setChosenDatasetView(dataset, targetView);
            if (rowID === null && targetView) {
                setUnifiedTableState(dataset, {
                    articleView: { collapsed: false, expandedId: null, returnView: "card",
                        pendingAutoOpenFirstRenderedResult: false, pendingAutoOpenFirstSearchResult: false },
                    cardView: { collapsed: false, expandedId: null },
                });
            }
            const directArticle = options.preselectArticle && rowID !== null;
            // Home retains its root history entry until the article opens.
            if (directArticle) setParams(dataset, { ...replacementParams, view: targetView });
            const openListing = rowID === null ? openNavTab : openExplicitRowListingTab;
            const navigate = () => openListing(dataset, {
                forceReload: true,
                ...(directArticle ? { skipUrlUpdate: true } : {}),
                replacementParams: { ...replacementParams, ...(directArticle ? { view: "article_view" } : {}) },
            });
            // Navigation owns its completion; its own writes belong to this
            // handoff, while a newer request still invalidates the ticket.
            if (rowID !== null) {
                await openArticleAfterListing({ id: rowID }, dataset, navigate, request);
            } else if ((await navigate())?.abort) {
                restoreCollection?.();
            }
        } catch (error) {
            restoreCollection?.();
            console.warn("Compact result navigation failed:", error);
        }
    }
}

/** Reuse the card's lazy media and seeded fallback, without its article activation. */
function createSupplementalThumbnail(row, dataset, types, imageColumn) {
    const host = document.createElement('div');
    host.className = 'supplemental-dataset-thumbnail';
    host.setAttribute('aria-hidden', 'true');
    const reserved = document.createElement('div');
    reserved.className = 'card_small_image';
    host.append(reserved);
    let latestLabel = '';
    let renderedInitial;
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
        const fallback = resolveFallbackCardImageCandidate({ cached_image: row.cached_image });
        const imageValue = row[imageColumn] || fallback?.value || '';
        const initial = imageValue ? null : Array.from(latestLabel)[0] || '?';
        // A language switch changes only an avatar whose visible initial actually changed.
        if (initial === renderedInitial) return;
        renderedInitial = initial;
        const created = ['created', 'created_at', 'luontiaika'].map(column => row[column]).find(Boolean) || '';
        appendSmallCardSummary({
            card: host, row_item: row, table_name: dataset, setFieldHideAttribute: () => {},
            image_value_small: imageValue,
            image_column_small: row[imageColumn] ? imageColumn : fallback?.column,
            // Opt compact results into the same raster presentation as full cards;
            // collapsed-card summaries and article media retain their existing slots.
            image_render_slot_small: CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA,
            preferred_image_alt_label: latestLabel,
            creation_seed: `${row.id ?? 'x'}_${created}`, header_first_letter: initial,
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
    return {
        element: host,
        updateLabel(label) {
            latestLabel = label;
            void loadMedia().catch(() => { host.dataset.thumbnailState = 'unavailable'; });
        },
    };
}

/** One stable group per dataset; order comes solely from the accepted main-tab list. */
export function createSupplementalDatasetGroup(tab, query, {
    rowCap = 3, headingTag = 'h3', showAllKey = null, emptyKey = null, replacementParams,
    preselectArticle = false, includeThumbnails = false, linkHeading = false,
} = {}) {
    const element = document.createElement("section");
    element.className = "supplemental-dataset-group";
    element.dataset.dataset = tab.dataset;
    element.hidden = true;
    const linkParams = replacementParams || { search: query };
    const queryString = new URLSearchParams(linkParams).toString();
    const querySuffix = queryString ? "?" + queryString : "";
    const collectionHref = buildDatasetPath(tab.dataset) + querySuffix;
    function createCollectionLink() {
        const link = document.createElement("a");
        link.href = collectionHref;
        bindQueryNavigation(link, tab.dataset, query, null, { replacementParams, preselectArticle });
        return link;
    }

    const heading = document.createElement(headingTag);
    const headingLabel = linkHeading ? createCollectionLink() : heading;
    if (linkHeading) heading.append(headingLabel);
    bindDatasetLanguageRenderer(headingLabel, () => {
        headingLabel.textContent = plainText(getTranslationForKey(tab.langKey, {
            fallback: tab.text || tab.dataset, countUsage: false,
        }), 100);
    });
    const list = document.createElement("ul");
    const showAll = createCollectionLink();
    showAll.className = "supplemental-dataset-show-all";
    bindDatasetLanguageRenderer(showAll, language => {
        showAll.textContent = showAllKey
            ? getTranslationForKey(showAllKey, { countUsage: false })
            : getSupplementalSearchCopy(language).showAll;
    });
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
            // Compact results require explicit opt-in even when a column can appear on a full card.
            const visibleColumns = columns.filter(column => types[column]?.show_value_on_card === true &&
                isRecordTitleColumnVisible(types[column], 'card', false));
            const headerColumns = columnsForRole(visibleColumns, types, "header");
            const extractColumns = snippetColumns(visibleColumns, types, headerColumns[0]);
            const imageColumn = includeThumbnails ? columnsForRole(visibleColumns, types, "image")[0] : null;
            for (const row of rows.slice(0, rowCap)) {
                const item = document.createElement("li");
                const text = includeThumbnails ? document.createElement('div') : item;
                const title = document.createElement("a");
                title.href = buildCardUrl("/", tab.dataset, row.id, "") + querySuffix;
                title.dataset.rowId = String(row.id);
                const description = extractColumns.length ? document.createElement("p") : null;
                const thumbnail = includeThumbnails ? createSupplementalThumbnail(row, tab.dataset, types, imageColumn) : null;
                bindDatasetLanguageRenderer(title, language => {
                    const resolved = headerColumns.length ? resolveRecordTitle({ rowItem: row, columns: visibleColumns,
                        dataTypes: types, tableName: tab.dataset, preferredLanguage: language, surface: 'compact', headerColumns }) : null;
                    const headingText = resolved?.column ? resolved.text : '';
                    thumbnail?.updateLabel(headingText);
                    title.textContent = truncateText(headingText.replace(/\s+/gu, " "), 140) || String(row.id);
                    if (!description) return;
                    const candidates = extractColumns.filter(column => column !== resolved?.column).map(column => ({
                        value: resolveDatasetDisplayValue(row[column], types[column], language),
                    })).filter(candidate => plainText(candidate.value));
                    const matchingCandidate = candidates.find(candidate => findSearchMatch(plainText(candidate.value), query));
                    const excerpt = buildSupplementalSearchExcerpt((matchingCandidate || candidates[0])?.value || "", query);
                    renderExcerptWithMatchesMarked(description, excerpt, query);
                    description.hidden = !excerpt;
                });
                bindQueryNavigation(title, tab.dataset, query, row.id, { replacementParams, preselectArticle });
                text.append(title);
                if (description) text.append(description);
                if (thumbnail) {
                    item.className = 'supplemental-dataset-result';
                    text.className = 'supplemental-dataset-result-text';
                    item.append(thumbnail.element, text);
                }
                list.append(item);
            }
            empty.hidden = !emptyKey || rows.length > 0;
            element.hidden = !emptyKey && rows.length === 0;
        },
    };
}
