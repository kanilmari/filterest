// article_view_opener.js
// Opens the full-detail article-view overlay for a given row.
// Bridges row data, column roles, and permission state with the legacy big-card UI shell.
// Exists to be the single orchestration point for launching, populating, and managing the row article view.

import { createArticleLanguageEditor } from "../article_view/article_language_editor.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import { rebaseSavedCardDraftFields } from "./card_edit_reconciler.js";
import {
    parseRoleString,
    cancelEditing,
    collectCardUpdates,
    disableEditing,
    enableEditing,
    sendCardUpdates,
} from "./card_field_formatter.js";
import { resolveRowArticleParentImageRows } from "./row_article_asset_resolver.js";
import { count_this_function } from "../../dev_tools/function_counter.js";
import { setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { DATASET_PREFIX } from "../../navigation/nav_engine/query_params.js";
import {
    hasRoutePermission,
    hasDatasetPermission,
    primeDatasetPermissions,
} from "../../route_permission_checker.js";
import {
    buildSlug,
    buildCreationSeed,
    extractRowId,
    sortColumnsByRole,
    buildCardUrl,
} from "./row_article_opener_helpers.js";
import { resolveRowArticleDataTypes } from "./row_article_data_types_resolver.js";
import { show_related_items_on_big_cards } from "../../../ui_config.js";
import { buildRowArticleContent } from "./row_article_content_builder.js";
import { hydrateRowArticleTaskProgressSection } from "./row_article_task_progress_hydrator.js";
import {
    closeRowArticle,
    dispatchCardArticleToggle,
    updateHighlightedCard,
    saveScrollBeforeRowArticle,
} from "./row_article_ui_handler.js";
import { showConfirmModal } from "../../../reusable_components/modal/confirm_modal_builder.js";
import { showSuccessToast } from "../../../reusable_components/notifications/toast_notification_printer.js";
import { refreshTableUnified } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { buildConfirmationMessage } from "../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover_helpers.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { resolveDatasetDisplayValue } from "../dataset_value_localizer.js";
import { createRowArticleLoadSession } from "./row_article_load_session.js";
import { createRowArticleMediaHydrator } from "./row_article_media_hydrator.js";
import { fetchCurrentUserProfile } from "../../user_tools/current_user_profile_fetcher.js";
import { buildRowArticleQueryString } from "./row_article_url_state.js";
import { fetchPermittedRowArticleData } from "./row_article_data_fetcher.js";

function resolveVisibleResultCard(tableName, rowId) {
    if (rowId == null) {
        return null;
    }
    const container = document.getElementById(`${tableName}_article_view_container`);
    return Array.from(container?.querySelectorAll?.(".card[data-id]") || [])
        .find((card) => String(card.dataset.id) === String(rowId)) || null;
}

/**
 * Opens the article-view overlay for one dataset row.
 * Bridges row data, card metadata, and overlay UI so the expanded row can render all field roles.
 * Exists as the single orchestration entry point for row_article launch and legacy big-card composition.
 */
const articleOpenGenerations = new Map();

export async function openRowArticleView(row_item, table_name, selectedCard = null, { isCurrent = () => true } = {}) {
    if (!isCurrent()) return;
    const generation = (articleOpenGenerations.get(table_name) || 0) + 1;
    articleOpenGenerations.set(table_name, generation);
    const canCommit = () => isCurrent()
        && articleOpenGenerations.get(table_name) === generation
        && localStorage.getItem(`${table_name}_view`) === "article_view";
    // Keep the legacy counter key stable until analytics naming is migrated separately.
    count_this_function("open_big_card_view"); // 🔢

    try {
        const activeView = localStorage.getItem(`${table_name}_view`) || "card";
        if (activeView !== "article_view") {
            setUnifiedTableState(table_name, {
                articleView: {
                    collapsed: true,
                    expandedId: row_item?.id ?? null,
                    returnView: activeView,
                    pendingAutoOpenFirstRenderedResult: row_item?.id == null,
                    pendingAutoOpenFirstSearchResult: false,
                },
            });
            localStorage.setItem(`${table_name}_view`, "article_view");
            const { refreshTableUnified } = await import(
                "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js"
            );
            if (!isCurrent()) return;
            await refreshTableUnified(table_name, { skipUrlParams: true });
            return;
        }
        /* -------------------------------------------------- *
         * 1. METADATA & PERUSSETUP
         * -------------------------------------------------- */
        row_item = await fetchPermittedRowArticleData({ tableName: table_name, rowItem: row_item });
        if (!canCommit()) return;
        // Direct article URLs and non-card entry points may not pass the
        // selected card explicitly. Resolve it before composing article media
        // so image-first receives the same bounded result-set context as a
        // thumbnail opened directly from card view.
        selectedCard = selectedCard instanceof HTMLElement
            ? selectedCard
            : resolveVisibleResultCard(table_name, row_item.id);
        const data_types = resolveRowArticleDataTypes(table_name, selectedCard);

        const columns = row_item.__articleColumns || Object.keys(row_item);
        const sorted_columns = row_item.__articleColumns ? columns : sortColumnsByRole(columns, data_types);

        /* -------------------------------------------------- *
         * 2. MODAALIN RUNKO  (<article> for semantic SEO)
         * -------------------------------------------------- */
        const rowArticleElement = document.createElement("article");
        rowArticleElement.classList.add(
            "article_view",
            "big_card_container",
            "row_article_container",
            "active_big_card",
            "active_row_article",
        );
        rowArticleElement.dataset.testid = 'big-card-container';
        // Store data for dynamic language refresh
        rowArticleElement._row = row_item;
        rowArticleElement._table_name = table_name;

        /* -------------------------------------------------- *
         * 3. AVATAR / KUVA PRE-CALC
         * -------------------------------------------------- */
        let header_first_letter = "";
        let row_presentation_label = "";
        for (const col of sorted_columns) {
            const { baseRoles } = parseRoleString(data_types[col]?.card_element || "");
            if (baseRoles.includes("header")) {
                const txt = resolveDatasetDisplayValue(row_item[col], data_types?.[col] || null).trim();
                if (txt) {
                    header_first_letter = txt[0];
                    if (!row_presentation_label) row_presentation_label = txt;
                }
            }
        }

        const creation_seed = buildCreationSeed(row_item);

        const image_role_columns = sorted_columns.filter((col) =>
            parseRoleString(
                data_types[col]?.card_element || ""
            ).baseRoles.includes("image")
        );
        const table_has_image_role = image_role_columns.length > 0;
        const parent_row_image_rows = resolveRowArticleParentImageRows(
            row_item,
            image_role_columns,
        );

        /* -------------------------------------------------- *
         * 4. BUILD CONTENT
         * -------------------------------------------------- */
        let current_user_id = null;
        try {
            const profile = await fetchCurrentUserProfile();
            current_user_id = profile?.user_id ?? null;
        } catch (err) {
            console.warn('openRowArticleView: could not fetch user_id', err);
        }

        if (!canCommit()) return;
        const { rowArticleContentElement } = await buildRowArticleContent(
            row_item,
            table_name,
            data_types,
            sorted_columns,
            creation_seed,
            header_first_letter,
            table_has_image_role,
            current_user_id,
            { selectedCard },
        );

        if (!canCommit()) return;
        const rowArticleLoadSession = createRowArticleLoadSession({
            tableName: table_name,
            rowId: row_item.id,
            canFetchLinkingStatus: hasRoutePermission("/api/asset-linking/status"),
        });

        let linkedTaskChildCount = 0;
        const { hydrateRelatedSections, refreshMediaSections } = createRowArticleMediaHydrator({
            rowArticleElement,
            rowArticleContentElement,
            rowArticleLoadSession,
            rowItem: row_item,
            tableName: table_name,
            selectedCard,
            rowLabel: row_presentation_label,
            parentImageRows: parent_row_image_rows,
            tableHasImageRole: table_has_image_role,
            currentUserId: current_user_id,
            showRelatedItems: show_related_items_on_big_cards,
            canCommit,
            onLinkedTaskChildCountChange: (count) => { linkedTaskChildCount = count; },
        });

        /* -------------------------------------------------- *
         * 8. RESOLVE WRAPPER & CARD CONTAINER (needed by action bar)
         * -------------------------------------------------- */
        rowArticleElement.appendChild(rowArticleContentElement);

        const container = document.getElementById(
            `${table_name}_article_view_container`
        );
        const wrappers = container
            ? container.querySelectorAll(".card_view_wrapper")
            : [];
        if (wrappers.length > 1) {
            Array.from(wrappers).forEach((w, idx) => {
                if (idx > 0) w.remove();
            });
        }
        const selectedCardWrapper = selectedCard instanceof HTMLElement
            ? selectedCard.closest(".card_view_wrapper")
            : null;
        let wrapper = selectedCardWrapper || wrappers[0];
        let card_container = wrapper?.querySelector(".card_container");
        let placeholder = wrapper?.querySelector(".row_article_placeholder, .big_card_placeholder");

        if (!wrapper || !card_container || !placeholder) {
            console.warn("could not find card container");
            return;
        }

        void primeDatasetPermissions(table_name, [
            "/api/delete-rows",
            "/api/update-row",
        ]);
        const [
            canUpdateRow,
            hasDeleteRight,
        ] = await Promise.all([
            hasDatasetPermission("/api/update-row", table_name),
            hasDatasetPermission("/api/delete-rows", table_name),
        ]);

        /* -------------------------------------------------- *
         * 8b. ACTION TOOLBAR (edit, checkbox, delete)
         * -------------------------------------------------- */
        const actionBar = document.createElement("div");
        actionBar.classList.add("big_card_action_bar");
        if (canUpdateRow) {
            let edit = false;
            let languageEditor = null;
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.classList.add("fw-btn", "big_card_edit_button");
            editButton.dataset.langKey = 'edit';
            editButton.dataset.testid = 'big-card-edit-button';

            const cancelButton = document.createElement("button");
            cancelButton.type = "button";
            cancelButton.classList.add("fw-btn", "fw-btn--ghost", "big_card_cancel_button");
            cancelButton.dataset.langKey = 'cancel';
            cancelButton.dataset.testid = 'big-card-cancel-button';
            cancelButton.hidden = true;
            cancelButton.style.display = 'none';
            const syncEditUi = (isEditing) => {
                edit = isEditing;
                languageEditor?.setDisabled(isEditing);
                editButton.dataset.langKey = isEditing ? 'save' : 'edit';
                editButton.classList.toggle('fw-btn--primary', isEditing);
                cancelButton.hidden = !isEditing;
                cancelButton.style.display = isEditing ? '' : 'none';
            };
            editButton.addEventListener("click", async () => {
                if (!edit) {
                    enableEditing(rowArticleContentElement, table_name);
                    syncEditUi(true);
                    return;
                }
                editButton.disabled = true;
                cancelButton.disabled = true;
                try {
                    const updates = collectCardUpdates(rowArticleContentElement);
                    if (Object.keys(updates).length > 0 && row_item.id === undefined) {
                        console.warn('article save skipped because the row has no stable identifier');
                        return;
                    }
                    if (row_item.id !== undefined) {
                        await sendCardUpdates(table_name, row_item.id, updates);
                    }
                    disableEditing(rowArticleContentElement);
                    syncEditUi(false);
                    await refreshMediaSections();
                } catch (err) {
                    rebaseSavedCardDraftFields(rowArticleContentElement, err?.successfulFields);
                    console.warn(edit
                        ? 'article save failed; edit mode and draft were preserved'
                        : 'article fields were saved, but refreshed media could not be loaded', err);
                } finally {
                    editButton.disabled = false;
                    cancelButton.disabled = false;
                }
            });
            cancelButton.addEventListener("click", () => {
                if (!edit) {
                    return;
                }
                cancelEditing(rowArticleContentElement);
                syncEditUi(false);
            });
            actionBar.append(editButton, cancelButton);
            languageEditor = createArticleLanguageEditor({
                row: row_item, columns: sorted_columns, dataTypes: data_types,
                tableName: table_name, canUpdateRow, isCurrent: canCommit,
                onActiveChange: (active) => { editButton.disabled = active; },
                onSaved: async () => openRowArticleView(row_item, table_name, selectedCard, { isCurrent }),
            });
            if (languageEditor) {
                actionBar.append(languageEditor.button);
                rowArticleElement.insertBefore(languageEditor.panel, rowArticleContentElement);
            }
        }
        let _selectedCard = null;

        const closeOpenedRowArticle = () => {
            closeRowArticle(
                wrapper,
                card_container,
                rowArticleElement,
                _selectedCard,
                table_name
            );
        };

        if (hasDeleteRight && row_item.id != null) {
            const deleteBtn = document.createElement("button");
            deleteBtn.classList.add("big_card_delete");
            deleteBtn.dataset.langKey = "delete";
            deleteBtn.dataset.testid = "big-card-delete";

            deleteBtn.addEventListener("click", async () => {
                const { messageLangKey, messagePlainText } =
                    buildConfirmationMessage(1, true, {
                        tableName: table_name,
                        selectedRows: [row_item],
                        linkedChildCount: linkedTaskChildCount,
                        language: getLanguageWithBrowserFallback(),
                    });

                // Find header text for the confirmation dialog
                let headerText = "";
                for (const col of sorted_columns) {
                    const { baseRoles } = parseRoleString(
                        data_types[col]?.card_element || ""
                    );
                    if (baseRoles.includes("header")) {
                        headerText = resolveDatasetDisplayValue(
                            row_item[col],
                            data_types?.[col] || null
                        ).trim();
                        break;
                    }
                }

                const ok = await showConfirmModal({
                    titleLangKey: "delete_confirm_title",
                    titlePlainText: "Vahvista poisto",
                    messageLangKey,
                    messagePlainText,
                    confirmLangKey: "delete",
                    confirmText: "Poista",
                    cancelLangKey: "dont_delete",
                    cancelText: "Älä poista",
                    isDanger: true,
                    itemNames: headerText ? [headerText] : null,
                });
                if (!ok) return;

                try {
                    await endpoint_router("deleteRows", {
                        method: "POST",
                        url_params: `?dataset=${table_name}`,
                        body_data: { ids: [row_item.id] },
                    });

                    showSuccessToast("Kohde poistettu onnistuneesti! ☺");

                    // Find the next card to navigate to
                    const allCards = Array.from(
                        card_container.querySelectorAll(".card[data-id]")
                    );
                    const currentIdx = _selectedCard
                        ? allCards.indexOf(_selectedCard)
                        : -1;
                    // Pick next card, or previous, or null
                    const nextCard =
                        allCards[currentIdx + 1] ||
                        allCards[currentIdx - 1] ||
                        null;

                    closeOpenedRowArticle();

                    await refreshTableUnified(table_name, {
                        skipUrlParams: true,
                    });

                    // Open the next big card if one exists
                    if (nextCard) {
                        const nextId = nextCard.dataset.id;
                        const nextRow = nextCard._row;
                        if (nextRow) {
                            // Small delay so the DOM settles after refresh
                            setTimeout(() => {
                                const freshCard =
                                    document.querySelector(
                                        `.card[data-id="${nextId}"]`
                                    ) || null;
                                openRowArticleView(
                                    nextRow,
                                    table_name,
                                    freshCard
                                );
                            }, 100);
                        }
                    }
                } catch (err) {
                    console.warn("delete error:", err.message);
                }
            });
            actionBar.appendChild(deleteBtn);
        }

        rowArticleElement.appendChild(actionBar);

        if (!canCommit() || !wrapper.isConnected) return;
        wrapper.classList.add("big-card-open");
        saveScrollBeforeRowArticle();

        // Push unique URL for this big card (SEO + deep linking)
        const rowId = extractRowId(row_item);
        if (rowId) {
            // Build SEO-friendly slug from the header column value
            let slug = "";
            for (const col of sorted_columns) {
                const { baseRoles } = parseRoleString(data_types[col]?.card_element || "");
                if (baseRoles.includes("header")) {
                    const txt = resolveDatasetDisplayValue(
                        row_item[col],
                        data_types?.[col] || null
                    ).trim();
                    if (txt) {
                        slug = buildSlug(txt);
                    }
                    break;
                }
            }
            const cardUrl = buildCardUrl(
                DATASET_PREFIX,
                table_name,
                rowId,
                slug
            ) + buildRowArticleQueryString(table_name);
            const currentUrl = window.location.pathname + window.location.search;
            const historyRowId = String(rowId);
            const historyState = { bigCard: true, dataset: table_name, rowId: historyRowId };
            const rowPathRoot = buildCardUrl(DATASET_PREFIX, table_name, historyRowId, "");
            const currentPath = window.location.pathname;
            const currentPathIsSameRow =
                currentPath === rowPathRoot || currentPath.startsWith(`${rowPathRoot}-`);
            const currentHistoryState = history.state || {};
            historyState.articleReturnAvailable = !currentPathIsSameRow || currentHistoryState.articleReturnAvailable === true;
            const currentHistoryStateMatches =
                currentHistoryState.bigCard === true
                && currentHistoryState.dataset === table_name
                && String(currentHistoryState.rowId) === historyRowId;
            if (currentUrl === cardUrl && currentHistoryStateMatches) {
                // The current history entry already describes this article.
            } else if (currentUrl === cardUrl) {
                history.replaceState(historyState, "", cardUrl);
            } else if (currentPathIsSameRow) {
                history.replaceState(historyState, "", cardUrl);
            } else {
                history.pushState(
                    historyState,
                    "",
                    cardUrl
                );
            }
        }
        dispatchCardArticleToggle(table_name, true);
        Array.from(card_container.children).forEach((c) => {
            if (c !== rowArticleElement && !c.classList.contains("results_count")) {
                c.classList.add("small-card");
                void c._ensureSmallSummaryMedia?.();
            }
        });
        setUnifiedTableState(table_name, {
            articleView: {
                collapsed: true,
                expandedId: row_item.id ?? null,
                pendingAutoOpenFirstRenderedResult: false,
                pendingAutoOpenFirstSearchResult: false,
            },
        });

        // Auto-find the matching small card when selectedCard wasn't passed
        if (!selectedCard && row_item.id != null) {
            selectedCard = resolveVisibleResultCard(table_name, row_item.id);
        }
        // Expose to closures created before card_container was resolved
        _selectedCard = selectedCard;
        if (selectedCard) {
            updateHighlightedCard(selectedCard);
            selectedCard.scrollIntoView?.({
                behavior: "smooth",
                block: "center",
            });
        }

        const closeBtn = document.createElement("button");
        closeBtn.classList.add("big_card_close");
        closeBtn.dataset.testid = 'big-card-close';
        closeBtn.textContent = "×";
        closeBtn.addEventListener("click", () => {
            _selectedCard = selectedCard;
            closeOpenedRowArticle();
        });

        rowArticleElement.prepend(closeBtn);
        placeholder.replaceChildren(rowArticleElement);
        window.requestAnimationFrame(() => {
            void (async () => {
                if (!canCommit() || !rowArticleElement.isConnected) return;
                await hydrateRowArticleTaskProgressSection({
                    rowArticleElement,
                    rowArticleContentElement,
                    tableName: table_name,
                    rowId: row_item.id,
                });
                await hydrateRelatedSections();
            })();
        });
    } catch (err) {
        console.warn("virhe: %s", err.message);
    }
}

export { openRowArticleView as open_big_card_view };
