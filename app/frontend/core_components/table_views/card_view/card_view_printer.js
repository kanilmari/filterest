// card_view_printer.js
// Renders individual data cards into the card grid container.
// Bridges row data, column roles, and UI config with fully constructed card DOM elements.
// Exists to orchestrate card assembly by combining avatars, field sections, keywords, and big-card open events.

import { openRowArticleView } from "./row_article_opener.js";
import { updateCardImageSources } from "./card_element_builder.js";
import { getUnifiedTableState } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { getChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";
import { always_show_empty_fields_on_cards } from "../../../ui_config.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { createExperimentalFreeLayoutCard, createExperimentalFreeLayoutToolbar, rebuildExperimentalFreeLayoutCard } from "../experimental_free_layout_card/experimental_free_layout_card_view.js";
import { EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT, getEffectiveCardStyleVariant } from "../experimental_free_layout_card/experimental_free_layout_card_store.js";
import { createSingleCard } from './card_row_builder.js';
import { CARD_ENTRANCE_ANIMATION_MS, CARD_ENTRANCE_STAGGER_MS } from './card_row_presentation.js';
import { resolveCardRenderContext, updateMassDeleteBar, createCardSelectionActionBar } from './card_selection_action_bar.js';
export { updateMassDeleteBar };

localStorage.setItem(
    "hide_fields_on_cards",
    always_show_empty_fields_on_cards ? "false" : "true"
);

// Debounced 150ms — image source swap only matters after resize settles
let _cardImageResizeTimer = null;
window.addEventListener("resize", () => {
    clearTimeout(_cardImageResizeTimer);
    _cardImageResizeTimer = setTimeout(updateCardImageSources, 150);
});

const CARD_MOUNT_EVENT = "easelect:card-mounted";

function isExperimentalFreeLayoutStyleActive(tableName) {
    return (
        getEffectiveCardStyleVariant(tableName) ===
        EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT
    );
}

function applyCardEntranceAnimation(card, index = 0) {
    if (!(card instanceof HTMLElement)) {
        return;
    }

    card.classList.add("card--entering");
    card.style.setProperty("--card-enter-delay", `${index * CARD_ENTRANCE_STAGGER_MS}ms`);
    card.addEventListener("animationend", () => {
        card.classList.remove("card--entering");
        card.style.removeProperty("--card-enter-delay");
    }, { once: true });
}

function notifyCardMounted(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    // A palette preview may have changed while this card was built off-DOM.
    card._refreshFieldPresentation?.forEach((refresh) => refresh());
    card.dispatchEvent(new CustomEvent(CARD_MOUNT_EVENT));
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(updateCardImageSources);
    } else {
        setTimeout(updateCardImageSources, 0);
    }
    setTimeout(updateCardImageSources, CARD_ENTRANCE_ANIMATION_MS + 50);
}

function ensureSmallSummaryMedia(card) {
    if (!(card instanceof HTMLElement)) {
        return;
    }
    void card._ensureSmallSummaryMedia?.();
}

export async function appendDataToCardView(
    card_container,
    columns,
    data,
    table_name,
    { viewKey, dataTypes, isCurrent = () => true } = {}
) {
    if (!isCurrent()) return;
    const existingIds = new Set(Array.from(card_container.querySelectorAll(".card[data-id]"),
        card => String(card.dataset.id)));
    data = data.filter(row => {
        if (row?.id == null) return true;
        const key = String(row.id);
        if (existingIds.has(key)) return false;
        existingIds.add(key);
        return true;
    });
    const storedTypes =
        JSON.parse(localStorage.getItem(`${table_name}_dataTypes`)) || {};
    const data_types = { ...storedTypes, ...dataTypes };
    // Detached search batches pass their presentation explicitly; ordinary
    // appends inherit the owning wrapper before consulting the active view.
    const renderView = viewKey
        ?? card_container.closest('.card_view_wrapper')?.dataset.viewKey
        ?? getChosenDatasetView(table_name);
    const stateKey = renderView === 'article_view' ? 'articleView' : 'cardView';
    const collapsed = getUnifiedTableState(table_name)?.[stateKey]?.collapsed;
    const renderContext = await resolveCardRenderContext(
        table_name,
        columns,
        data_types
    );
    const useExperimentalStyle = isExperimentalFreeLayoutStyleActive(table_name);

    // Batch-fetch comment counts for all rows
    const counts = await fetchCommentCountsForRows(table_name, data);
    if (!isCurrent()) return;

    const frag = document.createDocumentFragment();
    const createdCards = [];
    for (const [index, item] of data.entries()) {
        if (!isCurrent()) return;
        const card = useExperimentalStyle
            ? await createExperimentalFreeLayoutCard({
                rowItem: item,
                columns,
                tableName: table_name,
                dataTypes: data_types,
                renderContext,
                onSelectionChange: updateMassDeleteBar,
            })
            : await createSingleCard(
                item,
                columns,
                table_name,
                data_types,
                renderContext,
                index,
                null,
                renderView || "card"
            );
        if (!isCurrent()) return;
        if (collapsed) {
            card.classList.add("small-card");
            if (!useExperimentalStyle) {
                ensureSmallSummaryMedia(card);
            }
        }
        applyCardEntranceAnimation(card, index);
        addCommentBadge(card, counts[String(item.id)] || 0);
        frag.appendChild(card);
        createdCards.push(card);
    }
    if (!isCurrent()) return;
    const sentinel = card_container.querySelector(
        `#${table_name}_infinite_scroll_sentinel`
    );
    if (sentinel) {
        card_container.insertBefore(frag, sentinel);
    } else {
        card_container.appendChild(frag);
    }
    createdCards.forEach(notifyCardMounted);
}

/* ----------------------------------------------------------- */

export async function create_card_view(columns, data, table_name,
    { viewKey = "card", stateKey = "cardView", isCurrent = () => true } = {}) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("card_view_wrapper");
    wrapper.dataset.tableName = table_name;
    wrapper.dataset.viewKey = viewKey;
    const useExperimentalStyle = isExperimentalFreeLayoutStyleActive(table_name);

    const card_sidebar_panel = document.createElement("div");
    card_sidebar_panel.classList.add("card_sidebar_panel");

    const card_sidebar_header = document.createElement("div");
    card_sidebar_header.classList.add("card_sidebar_header");

    const sidebarResultsCount = document.createElement("div");
    sidebarResultsCount.classList.add("results_count", "card_sidebar_results_count");
    sidebarResultsCount.dataset.resultsCountFor = table_name;
    card_sidebar_header.appendChild(sidebarResultsCount);

    const primaryResultsCount = document.getElementById(`${table_name}_results_count`);
    if (primaryResultsCount) {
        primaryResultsCount.childNodes.forEach((node) => {
            sidebarResultsCount.appendChild(node.cloneNode(true));
        });
    }

    const sidebarActiveFilters = document.createElement("div");
    sidebarActiveFilters.classList.add("card_sidebar_active_filters");

    const card_container = document.createElement("div");
    card_container.classList.add("card_container");

    const rowArticlePlaceholder = document.createElement("div");
    rowArticlePlaceholder.classList.add("big_card_placeholder", "row_article_placeholder");

    let data_types =
        JSON.parse(localStorage.getItem(`${table_name}_dataTypes`)) || {};

    const collapsed = getUnifiedTableState(table_name)?.[stateKey]?.collapsed;
    const renderContext = await resolveCardRenderContext(
        table_name,
        columns,
        data_types
    );

    // Batch-fetch comment counts for all rows
    const counts = await fetchCommentCountsForRows(table_name, data);
    if (!isCurrent()) return wrapper;

    const frag = document.createDocumentFragment();
    const createdCards = [];
    for (const [index, row_item] of data.entries()) {
        if (!isCurrent()) return wrapper;
        const card = useExperimentalStyle
            ? await createExperimentalFreeLayoutCard({
                rowItem: row_item,
                columns,
                tableName: table_name,
                dataTypes: data_types,
                renderContext,
                onSelectionChange: updateMassDeleteBar,
            })
            : await createSingleCard(
                row_item,
                columns,
                table_name,
                data_types,
                renderContext,
                index,
                null,
                viewKey
            );
        if (!isCurrent()) return wrapper;
        if (collapsed) {
            card.classList.add("small-card");
            if (!useExperimentalStyle) {
                ensureSmallSummaryMedia(card);
            }
        }
        applyCardEntranceAnimation(card, index);
        addCommentBadge(card, counts[String(row_item.id)] || 0);
        frag.appendChild(card);
        createdCards.push(card);
    }
    card_container.appendChild(frag);
    createdCards.forEach(notifyCardMounted);

    card_sidebar_panel.appendChild(card_sidebar_header);
    card_sidebar_panel.appendChild(sidebarActiveFilters);
    if (useExperimentalStyle) {
        card_sidebar_panel.appendChild(
            createExperimentalFreeLayoutToolbar(table_name)
        );
    }
    card_sidebar_panel.appendChild(card_container);

    wrapper.appendChild(card_sidebar_panel);
    wrapper.appendChild(rowArticlePlaceholder);

    const actionBar = createCardSelectionActionBar(table_name, renderContext);
    if (actionBar) { wrapper.prepend(actionBar); setTimeout(updateMassDeleteBar, 0); }

    if (collapsed) {
        wrapper.classList.add("big-card-open");
    }

    return wrapper;
}

export async function refreshCardLanguages(chosenLanguage = null) {
    const cards = document.querySelectorAll('.card');
    for (const card of cards) {
        if (card.classList.contains("experimental-free-layout-card")) {
            const newExperimentalCard = await rebuildExperimentalFreeLayoutCard(
                card,
                updateMassDeleteBar
            );
            card.replaceWith(newExperimentalCard);
            continue;
        }

        const row = card._row;
        const columns = card._columns;
        const tableName = card._table_name;
        const dataTypes = card._data_types;
        if (!row || !columns || !tableName || !dataTypes) continue;
        if (!card._hasLocalizedRowData) continue;

        const newCard = await createSingleCard(
            row,
            columns,
            tableName,
            dataTypes,
            null,
            0,
            chosenLanguage,
            card.dataset.cardPresentationView || "card"
        );
        if (card.classList.contains('small-card')) {
            newCard.classList.add('small-card');
            ensureSmallSummaryMedia(newCard);
        }
        newCard._row = row;
        newCard._columns = columns;
        newCard._table_name = tableName;
        newCard._data_types = dataTypes;
        newCard._hasLocalizedRowData = true;
        card.replaceWith(newCard);
        notifyCardMounted(newCard);
    }

    const big = document.querySelector('.active_row_article, .active_big_card');
    if (big && big._row && big._table_name) {
        const row = big._row;
        const tableName = big._table_name;
        const articleList = big.closest('.article_view_wrapper, .card_view_wrapper');
        const selected = row.id != null && articleList
            ? [...articleList.querySelectorAll('.card')].find((card) => card.dataset.id === String(row.id)) || null
            : null;
        await openRowArticleView(row, tableName, selected);
    }
}

async function fetchCommentCountsForRows(table_name, rows) {
    const row_ids = rows.map(r => r.id).filter(id => id != null);
    if (row_ids.length === 0) return {};

    // Skip the API call entirely if the user lacks permission for this route+table
    const allowed = await hasDatasetPermission('/api/comment-counts', table_name);
    if (!allowed) return {};

    try {
        const data = await endpoint_router('fetchCommentCounts', {
            method: 'POST',
            body_data: { dataset: table_name, row_ids },
        });
        return data?.counts || {};
    } catch {
        return {};
    }
}

function addCommentBadge(card, count) {
    if (count <= 0) return;
    const badge = document.createElement('span');
    badge.classList.add('comment_count_badge');
    badge.textContent = String(count);
    badge.title = `${count} comment${count !== 1 ? 's' : ''}`;
    // Add to the small summary area
    const summary = card.querySelector('.card_small_summary');
    if (summary) {
        summary.appendChild(badge);
    } else {
        // Fallback: add to the card itself
        card.appendChild(badge);
    }
}
