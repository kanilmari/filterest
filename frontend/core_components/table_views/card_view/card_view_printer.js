// card_view_printer.js
// Renders individual data cards into the card grid container.
// Bridges row data, column roles, and UI config with fully constructed card DOM elements.
// Exists to orchestrate card assembly by combining avatars, field sections, keywords, and big-card open events.

import { update_card_selection } from "../table_view/row_selection_handler.js";
import { createImageElement, create_seeded_avatar } from "./card_avatar_builder.js";
import { openRowArticleView } from "./row_article_opener.js";
import { addKeywordsSection } from "./card_keyword_builder.js";
import {
    generateGoogleMapsEmbedSrcFromRow,
    addHeaderElement,
    addUsernameElement,
    addImageOrAvatar,
    addDescriptionSection,
    updateCardImageSources,
} from "./card_element_builder.js";
import {
    parseRoleString,
    createKeyValueElement,
    format_column_name,
    createTicketStatusBadge,
} from "./card_field_formatter.js";
import {
    isTicketStatusField,
    resolveCardFieldDisplayValue,
} from "./card_field_formatter_helpers.js";
import { expandForeignKeyDetailEntries } from "./relation_detail_helpers.js";
import { count_this_function } from "../../dev_tools/function_counter.js";
import { makeColumnClass } from "../../filterbar/filter_list/column_visibility_handler.js";
import { renderKeyValuePairs } from "../../../reusable_components/key_value_container/kv_container_printer.js";
import { kvDefaultOptions } from "../../../reusable_components/key_value_container/kv_config.js";
import { getUnifiedTableState } from "../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js";
import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";
import { hasDatasetPermission } from "../../route_permission_checker.js";
import {
    always_show_empty_fields_on_cards,
    resolveCardMediaFolder,
    show_more_button_on_cards,
} from "../../../ui_config.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { endpoint_router } from "../../endpoints/endpoint_router.js";
import {
    createExperimentalFreeLayoutCard,
    createExperimentalFreeLayoutToolbar,
    rebuildExperimentalFreeLayoutCard,
} from "../experimental_free_layout_card/experimental_free_layout_card_view.js";
import {
    EXPERIMENTAL_FREE_LAYOUT_CARD_STYLE_VARIANT,
    getEffectiveCardStyleVariant,
} from "../experimental_free_layout_card/experimental_free_layout_card_store.js";
import {
    hasFallbackCardImageColumn,
    resolveFallbackCardImageValue,
} from "./card_element_builder_helpers.js";
import {
    buildCardImageRenderOptions,
    CARD_IMAGE_RENDER_SLOTS,
} from "./card_image_render_options.js";
import {
    renderSingleLineCardDetails,
} from "./card_detail_single_line_helpers.js";
import { renderModernCardDetails } from "./card_detail_tile_builder.js";
import {
    formatCardDetailEntriesForCardDisplay,
} from "./card_detail_value_formatter.js";
import {
    CARD_DETAILS_LAYOUT_VALUES,
    CARD_STYLE_VARIANT_VALUES,
    normalizeClientCardDetailsLayout,
    normalizeClientCardStyleVariant,
    resolveKvLayoutModeForCardDetails,
} from "./card_detail_layout_options.js";
import { createDatasetIconElement } from "./dataset_icon_builder.js";
import { decorateStandardCardDetailKey } from "./card_detail_standard_key_decorator.js";

/** Update all mass-delete bars to reflect current selection count. */
export function updateMassDeleteBar() {
    document.querySelectorAll('.card_mass_delete_bar').forEach(bar => {
        const w = bar.closest('.card_view_wrapper');
        if (!w) return;
        const count = w.querySelectorAll('.card.selected').length;
        if (count > 0) {
            bar.style.display = 'flex';
            const btn = bar.querySelector('.mass_delete_button');
            if (btn) {
                btn.dataset.langKey = 'delete_selected';
                btn.textContent = `Poista valitut (${count})`;
            }
        } else {
            bar.style.display = 'none';
        }
    });
}

localStorage.setItem(
    "hide_fields_on_cards",
    always_show_empty_fields_on_cards ? "false" : "true"
);

// Debounced 150ms — image source swap only matters after resize settles
let _cardImageResizeTimer = null;
const CARD_ENTRANCE_ANIMATION_MS = 420;
const CARD_ENTRANCE_STAGGER_MS = 22;
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

function getCardPostEntranceDelay(index = 0) {
    return CARD_ENTRANCE_ANIMATION_MS + index * CARD_ENTRANCE_STAGGER_MS;
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

async function resolveCardRenderContext(table_name, columns, data_types) {
    const hasDeleteRight = await hasDatasetPermission(
        "/api/delete-rows",
        table_name
    );
    const tableHasImageRole = columns.some((column) =>
        parseRoleString(data_types[column]?.card_element || "").baseRoles.includes(
            "image"
        )
    );

    return {
        hasDeleteRight,
        tableHasImageRole,
    };
}

function hasLocalizedCardValue(rawVal, isMultilingual) {
    if (rawVal == null) {
        return false;
    }

    if (isMultilingual === true) {
        return true;
    }

    const str = String(rawVal).trim();
    if (!(str.startsWith("{") && str.endsWith("}"))) {
        return false;
    }

    try {
        const parsed = JSON.parse(str);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return false;
        }

        const keys = Object.keys(parsed);
        return keys.length > 0 && keys.every((key) => /^[a-z]{2,5}$/i.test(key));
    } catch {
        return false;
    }
}

function getTableMetaFromStorage(tableName) {
    try {
        return JSON.parse(localStorage.getItem(`${tableName}_tableMeta`) || "{}") || {};
    } catch {
        return {};
    }
}

function getCardDetailsLayout(tableName) {
    return normalizeClientCardDetailsLayout(
        getTableMetaFromStorage(tableName)?.card_details_layout
    );
}

function getMetadataCardStyleVariant(tableName) {
    return normalizeClientCardStyleVariant(
        getTableMetaFromStorage(tableName)?.card_style_variant
    );
}

function isTaskTodoStatusField(tableName, columnName) {
    return tableName === "dev_agent_task_todos" && columnName === "status";
}

function getTaskTodoStatusTone(status) {
    const key = String(status ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_");

    switch (key) {
        case "done":
            return "done";
        case "partially_done":
            return "progress";
        case "needs_review":
            return "awaiting";
        case "not_applicable":
            return "archived";
        case "todo":
        default:
            return "new";
    }
}

function createTaskTodoStatusChip(status) {
    const normalized = String(status ?? "").trim();
    const chip = document.createElement("span");
    chip.classList.add("ticket_status_badge", "todo_status_chip");
    chip.dataset.statusTone = getTaskTodoStatusTone(normalized);
    chip.textContent = normalized;
    chip.title = normalized;
    return chip;
}

function renderCardDetailsSection(
    containerElement,
    detailEntries,
    dataTypes,
    cardDetailsLayout,
    cardStyleVariant,
    { deferResponsiveLayoutMs = 0 } = {}
) {
    const normalizedStyleVariant = normalizeClientCardStyleVariant(cardStyleVariant);
    if (normalizedStyleVariant === CARD_STYLE_VARIANT_VALUES.MODERN) {
        renderModernCardDetails(containerElement, detailEntries, dataTypes);
        return;
    }

    const normalizedLayout = normalizeClientCardDetailsLayout(cardDetailsLayout);
    if (normalizedLayout === CARD_DETAILS_LAYOUT_VALUES.SINGLE_LINE) {
        renderSingleLineCardDetails(containerElement, detailEntries, dataTypes);
        return;
    }

    const kvDataArray = detailEntries.map((entry) => ({
        key: entry.labelKey || entry.column,
        labelKey: entry.labelKey || entry.column,
        labelText: entry.label || entry.column,
        value: entry.rawValue,
        titleValue: entry.titleValue,
        isLink: entry.isLink,
        href: entry.href,
        openInNewTabHref: entry.openInNewTabHref,
        columnClass: entry.columnClass,
        column: entry.column,
        sourceColumn: entry.sourceColumn,
        dataColumn: entry.dataColumn,
        labelMeta: dataTypes[String(
            entry.sourceColumn || entry.dataColumn || entry.column || ""
        ).trim()] || {},
    }));

    renderKeyValuePairs(containerElement, kvDataArray, {
        ...kvDefaultOptions,
        layoutMode: resolveKvLayoutModeForCardDetails(normalizedLayout),
        animateHeight: true,
        deferResponsiveLayoutMs,
        decorateKeyElement: decorateStandardCardDetailKey,
    });
}

export async function appendDataToCardView(
    card_container,
    columns,
    data,
    table_name
) {
    let data_types =
        JSON.parse(localStorage.getItem(`${table_name}_dataTypes`)) || {};

    const collapsed = getUnifiedTableState(table_name)?.cardView?.collapsed;
    const renderContext = await resolveCardRenderContext(
        table_name,
        columns,
        data_types
    );
    const useExperimentalStyle = isExperimentalFreeLayoutStyleActive(table_name);

    // Batch-fetch comment counts for all rows
    const counts = await fetchCommentCountsForRows(table_name, data);

    const frag = document.createDocumentFragment();
    const createdCards = [];
    for (const [index, item] of data.entries()) {
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
                index
            );
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

/**
 * Luo yhden kortin annetun rivin datasta *ja* lisää column_visibility-yhteensopivat
 * luokat.  Korttiin tulostetaan details-data sekä vanhalla menetelmällä
 * (`addDetailsSection`) että uutena vertailuna `renderKeyValuePairs`-kirjastolla.
 */
async function createSingleCard(
    row_item,
    columns,
    table_name,
    data_types,
    renderContext = null,
    cardIndex = 0,
    chosenLanguage = null
) {
    /* --- FUNKTIOLASKURI ---------------------------------------- */
    count_this_function("createSingleCard");
    const chosenLang = chosenLanguage || getLanguageWithBrowserFallback();

    /* --- PIILOTUS-ASETUS --------------------------------------- */
    const hideFieldsOnCardsString =
        localStorage.getItem("hide_fields_on_cards") === "true"
            ? "true"
            : "false";
    const setFieldHideAttribute = (el) =>
        (el.dataset.hideFieldOnCard = hideFieldsOnCardsString);

    const resolvedContext = renderContext ||
        await resolveCardRenderContext(table_name, columns, data_types);
    const { hasDeleteRight, tableHasImageRole } = resolvedContext;
    const fallbackImageValue = resolveFallbackCardImageValue(row_item);
    const usesLargeImageLayout =
        tableHasImageRole ||
        hasFallbackCardImageColumn(columns) ||
        Boolean(fallbackImageValue);

    /* --- ULKOKUORI --------------------------------------------- */
    const card = document.createElement("div");
    card.classList.add("card", "saturate_on_hover");
    card.dataset.testid = 'card-item';
    setFieldHideAttribute(card);
    if (row_item.id != null) card.dataset.id = row_item.id;
    const cardStyleVariant = getMetadataCardStyleVariant(table_name);
    const isModernCardStyle =
        normalizeClientCardStyleVariant(cardStyleVariant) === CARD_STYLE_VARIANT_VALUES.MODERN;
    card.dataset.cardStyleVariant = cardStyleVariant;
    if (isModernCardStyle) {
        card.classList.add("card--modern");
    }

    /* --- VALINTARUUTU (jos poistoon oikeus) -------------------- */
    if (hasDeleteRight) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.classList.add("card_checkbox");
        cb.dataset.testid = 'card-select-checkbox';

        if (row_item.id != null) {
            const checkboxId = `${table_name}_card_checkbox_${row_item.id}`;
            cb.id = checkboxId;
        }

        cb.addEventListener("change", () => {
            update_card_selection(card);
            updateMassDeleteBar();
        });
        setFieldHideAttribute(cb);
        card.appendChild(cb);
    }

    /* --- SISÄISET RAKENTEET ----------------------------------- */
    const card_content_div = document.createElement("div");
    card_content_div.classList.add("card_content");
    setFieldHideAttribute(card_content_div);
    card_content_div.classList.add(
        usesLargeImageLayout ? "card_content_large" : "card_content_small"
    );

    const card_body_div = document.createElement("div");
    card_body_div.classList.add("card_body");
    setFieldHideAttribute(card_body_div);

    const card_image_content = document.createElement("div");
    card_image_content.classList.add("card_image_content");
    setFieldHideAttribute(card_image_content);

    const card_text_content = document.createElement("div");
    card_text_content.classList.add("card_text_content");
    setFieldHideAttribute(card_text_content);

    /* --- MUUTTUVIA APULISTOJA --------------------------------- */
    const description_entries = [];
    const details_entries = [];
    const keywords_list = [];
    let hasLocalizedRowData = false;
    /* ---------------------------------------------------------- */
    let header_first_letter = "";
    let preferred_image_alt_header = "";
    let preferred_image_alt_username = "";
    const creation_date_small =
        row_item.created || row_item.created_at || row_item.luontiaika || "";
    const creation_seed =
        String(row_item.id ?? "x") + "_" + creation_date_small;
    let header_text_small = "";
    let username_text_small = "";
    let image_value_small = "";
    let image_column_small = "cached_image";

    /* --- HEADERIN ENSIMMÄINEN KIRJAIN ------------------------- */
    columns.forEach((col) => {
        const { baseRoles, hasLangKey } = parseRoleString(
            data_types[col]?.card_element || ""
        );
        const { displayValue } = resolveCardFieldDisplayValue(
            row_item,
            col,
            data_types,
            chosenLang,
            table_name
        );
        const localizedValue = displayValue.trim();

        if (baseRoles.includes("header")) {
            const v = localizedValue;
            if (v) header_first_letter = String(v).trim()[0] || "";
            if (!hasLangKey && !preferred_image_alt_header && localizedValue) {
                preferred_image_alt_header = localizedValue;
            }
        }

        if (
            baseRoles.includes("username") &&
            !hasLangKey &&
            !preferred_image_alt_username &&
            localizedValue
        ) {
            preferred_image_alt_username = localizedValue;
        }
    });
    const preferred_image_alt_label =
        preferred_image_alt_header || preferred_image_alt_username;

    /* --- HEADER- & USERNAME-ELEMENTIT JÄLKIKÄS. VARTEN -------- */
    let usernameElement = null;
    let headerElement = null;
    let found_image_for_this_row = false;
    let statusBadge = null;
    let statusBadgeValue = "";
    let todoStatusChip = null;
    let todoStatusChipValue = "";

    /* ===========================================================
       LÄPITSE SARAKKEET
       =========================================================== */
    for (const column of columns) {
        const raw_val = row_item[column];
        const {
            rawValue: storedRawValue,
            displayValue: val_str,
            aliasColumn,
            isMultilingual,
        } = resolveCardFieldDisplayValue(
            row_item,
            column,
            data_types,
            chosenLang,
            table_name
        );

        if (!statusBadge && isTicketStatusField(table_name, column) && val_str.trim()) {
            statusBadge = createTicketStatusBadge(val_str);
            statusBadgeValue = val_str;
        }

        if (!todoStatusChip && isTaskTodoStatusField(table_name, column) && val_str.trim()) {
            todoStatusChip = createTaskTodoStatusChip(val_str);
            todoStatusChipValue = val_str;
        }

        if (data_types[column]?.show_value_on_card !== true) continue;

        // A foreign key can render through a generated alias such as
        // `queue_name (ln)`. Track that displayed source—not the numeric FK—so
        // changing the page language rebuilds the card when the alias is JSON.
        const localizedSourceValue = aliasColumn
            ? row_item[aliasColumn]
            : raw_val;
        if (
            !hasLocalizedRowData &&
            hasLocalizedCardValue(localizedSourceValue, isMultilingual)
        ) {
            hasLocalizedRowData = true;
        }

        /* --- Card-tason piilotusliput -------------------------- */
        if (data_types[column]?.hide_on_small_card === true) continue;

        const { baseRoles, hasLangKey } = parseRoleString(
            data_types[column]?.card_element || ""
        );
        const showKey = data_types[column]?.show_key_on_card === true;
        const col_label = showKey ? format_column_name(column) : "";

        if (isTicketStatusField(table_name, column)) {
            continue;
        }

        if (isTaskTodoStatusField(table_name, column)) {
            continue;
        }

        /* Piilota false/null pienellä kortilla */
        if (data_types[column]?.hide_false_null_on_sml_crd === true) {
            if (raw_val === null || raw_val === undefined || raw_val === false || val_str.trim() === '' || val_str.trim() === 'false') {
                continue;
            }
        }

        /* --- Sarakeluokka tälle kierrokselle ------------------- */
        const columnClass = makeColumnClass(table_name, column);

        /* --------------------------------------------------------
           0) ILMAN ROOLIA -> pelkkä key/value
           -------------------------------------------------------- */
        if (baseRoles.length === 0) {
            if (!always_show_empty_fields_on_cards && !val_str.trim()) {
                continue;
            }
            const wrap = document.createElement("div");
            wrap.classList.add("card_pair", columnClass);
            setFieldHideAttribute(wrap);
            wrap.appendChild(
                createKeyValueElement(
                    col_label,
                    storedRawValue,
                    column,
                    hasLangKey,
                    "card_value",
                    val_str,
                    data_types[column]
                )
            );
            card_text_content.appendChild(wrap);
            continue;
        }

        /* --------------------------------------------------------
           1) ROOLIKOHTAINEN KÄSITTELY
           -------------------------------------------------------- */
        for (const role of baseRoles) {
            if (/^hidden\d*$/.test(role)) continue; // ohita hidden

            /* --- DESCRIPTION ---------------------------------- */
            if (
                /^description\d*$/.test(role) &&
                (always_show_empty_fields_on_cards || val_str.trim())
            ) {
                description_entries.push({
                    suffix_number:
                        parseInt(role.replace("description", "")) ||
                        Number.MAX_SAFE_INTEGER,
                    rawValue: val_str,
                    label: col_label,
                    hasLangKey,
                    column,
                    columnClass,
                    columnMeta: data_types[column],
                });
                continue;
            }

            /* --- DETAILS LINK --------------------------------- */
            if (
                /^details_link\d*$/.test(role) &&
                (always_show_empty_fields_on_cards || val_str.trim())
            ) {
                details_entries.push({
                    suffix_number:
                        parseInt(role.replace("details_link", "")) ||
                        Number.MAX_SAFE_INTEGER,
                    rawValue: val_str,
                    label: col_label,
                    hasLangKey,
                    column,
                    columnClass,
                    isLink: true,
                });
                continue;
            }

            /* --- DETAILS (plain) ------------------------------ */
            if (
                /^details\d*$/.test(role) &&
                (always_show_empty_fields_on_cards || val_str.trim())
            ) {
                details_entries.push({
                    suffix_number:
                        parseInt(role.replace("details", "")) ||
                        Number.MAX_SAFE_INTEGER,
                    rawValue: val_str,
                    label: col_label,
                    hasLangKey,
                    column,
                    columnClass,
                    isLink: false,
                });
                continue;
            }

            /* --- KEYWORDS ------------------------------------- */
            if (role === "keywords" && (always_show_empty_fields_on_cards || val_str.trim())) {
                keywords_list.push({
                    column,
                    rawValue: val_str,
                    label: col_label,
                    hasLangKey,
                    columnClass,
                });
                continue;
            }

            /* --- IMAGE ---------------------------------------- */
            if (role === "image") {
                found_image_for_this_row = true;
                if (!image_value_small) {
                    image_value_small = val_str;
                    image_column_small = column;
                }
                await addImageOrAvatar(
                    val_str,
                    tableHasImageRole,
                    creation_seed,
                    header_first_letter,
                    card_image_content,
                    table_name,
                    preferred_image_alt_label,
                    buildCardImageRenderOptions(
                        row_item,
                        column,
                        table_name,
                        preferred_image_alt_label,
                        CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA
                    )
                );
                card_image_content.lastElementChild?.classList.add(columnClass);
                continue;
            }

            /* --- HEADER --------------------------------------- */
            if (role === "header") {
                if (!header_text_small) header_text_small = val_str;
                headerElement = addHeaderElement(
                    val_str,
                    col_label,
                    column,
                    hasLangKey,
                    row_item,
                    table_name,
                    card_content_div,
                    storedRawValue,
                    data_types[column]
                );
                headerElement.classList.add(columnClass);
                setFieldHideAttribute(headerElement);
                continue;
            }

            /* --- USERNAME ------------------------------------- */
            if (role === "username") {
                usernameElement = addUsernameElement(
                    val_str,
                    col_label,
                    column,
                    hasLangKey
                );
                usernameElement.classList.add(columnClass);
                setFieldHideAttribute(usernameElement);
                if (!username_text_small) username_text_small = val_str;
                continue;
            }

            /* --- MUUT (fallback) ------------------------------ */
            if (val_str.trim() || always_show_empty_fields_on_cards) {
                const wrap = document.createElement("div");
                wrap.classList.add("card_pair", columnClass);
                setFieldHideAttribute(wrap);
                wrap.appendChild(
                    createKeyValueElement(
                        col_label,
                        storedRawValue,
                        column,
                        hasLangKey,
                        "card_details",
                        val_str,
                        data_types[column]
                    )
                );
                card_text_content.appendChild(wrap);
            }
        }
    } // for(column)

    /* ===========================================================
       GOOGLE-MAPS – IF R A M E   (jos taulu päättyy "locations")
       =========================================================== */
    if (table_name.endsWith("locations")) {
        const addressCols = [
            "street",
            "house_number",
            "postal_code",
            "city",
            "country_name",
        ];
        const hasAllAddressCols = addressCols.every((c) => columns.includes(c));

        if (hasAllAddressCols) {
            const embedSrc = generateGoogleMapsEmbedSrcFromRow(row_item);
            if (embedSrc) {
                const wrap = document.createElement("div");
                wrap.classList.add(
                    "card_pair",
                    makeColumnClass(table_name, "gmaps_iframe")
                );
                setFieldHideAttribute(wrap);

                const iframe = document.createElement("iframe");
                iframe.src = embedSrc;
                iframe.width = "100%";
                iframe.height = "400";
                iframe.style.border = "0";
                iframe.loading = "lazy";
                iframe.referrerPolicy = "no-referrer";

                wrap.appendChild(iframe);
                card_text_content.appendChild(wrap);
            }
        }
    }

    /* ===========================================================
       KUVA-ROOLI PUUTTUU? -> AVATAR
       =========================================================== */
    if (!found_image_for_this_row && fallbackImageValue) {
        found_image_for_this_row = true;
        if (!image_value_small) {
            image_value_small = fallbackImageValue;
            image_column_small = "cached_image";
        }
        await addImageOrAvatar(
            fallbackImageValue,
            usesLargeImageLayout,
            creation_seed,
            header_first_letter,
            card_image_content,
            table_name,
            preferred_image_alt_label,
            buildCardImageRenderOptions(
                row_item,
                "cached_image",
                table_name,
                preferred_image_alt_label,
                CARD_IMAGE_RENDER_SLOTS.CARD_MEDIA
            )
        );
    }

    if (usesLargeImageLayout && !found_image_for_this_row) {
        const imgDiv = document.createElement("div");
        imgDiv.classList.add("card_image");
        setFieldHideAttribute(imgDiv);
        imgDiv.appendChild(
            await create_seeded_avatar(creation_seed, header_first_letter, true)
        );
        card_image_content.appendChild(imgDiv);
    }
    if (!usesLargeImageLayout) {
        const imgDiv = document.createElement("div");
        imgDiv.classList.add("card_image");
        setFieldHideAttribute(imgDiv);
        imgDiv.appendChild(
            await create_seeded_avatar(
                creation_seed,
                header_first_letter,
                false
            )
        );
        card_image_content.appendChild(imgDiv);
    }

    /* === TEKSTIOSIOT (description, keywords, details) ========== */
    const deferResponsiveLayoutMs = getCardPostEntranceDelay(cardIndex);
    const cardDetailsLayout = getCardDetailsLayout(table_name);
    const cardInfoSectionContainer = isModernCardStyle
        ? document.createElement("div")
        : card_text_content;

    if (isModernCardStyle) {
        cardInfoSectionContainer.classList.add("card_modern_info_panel");
        setFieldHideAttribute(cardInfoSectionContainer);
        card_text_content.appendChild(cardInfoSectionContainer);
    }

    addDescriptionSection(
        description_entries,
        row_item,
        table_name,
        cardInfoSectionContainer
    );
    addKeywordsSection(keywords_list, row_item, table_name, cardInfoSectionContainer, {
        deferResponsiveLayoutMs,
    });
    // addDetailsSection(details_entries, row_item, table_name, card_text_content);

    /* -----------------------------------------------------------
       UUSI TESTI: KV-DISPLAY-KIRJASTON KÄYTTÖ
       ----------------------------------------------------------- */
    try {
        count_this_function("createSingleCard_renderKV");

        const expandedDetailsEntries = expandForeignKeyDetailEntries(
            details_entries.sort((a, b) => a.suffix_number - b.suffix_number),
            row_item,
            data_types
        );
        const formattedDetailsEntries = formatCardDetailEntriesForCardDisplay(
            expandedDetailsEntries,
            data_types
        );

        if (formattedDetailsEntries.length) {
            const kvContainerDiv = document.createElement("div");
            kvContainerDiv.classList.add("card_details_kv");
            setFieldHideAttribute(kvContainerDiv);
            cardInfoSectionContainer.appendChild(kvContainerDiv);

            renderCardDetailsSection(
                kvContainerDiv,
                formattedDetailsEntries,
                data_types,
                cardDetailsLayout,
                cardStyleVariant,
                { deferResponsiveLayoutMs }
            );
        }
    } catch (err) {
        console.warn("KV-display render failed", err);
    }

    if (isModernCardStyle && cardInfoSectionContainer.childElementCount === 0) {
        cardInfoSectionContainer.remove();
    }

    /* --- FOOTER ----------------------------------------------- */
    const footer_div = document.createElement("div");
    footer_div.classList.add("card_footer");
    setFieldHideAttribute(footer_div);

    if (statusBadge) {
        statusBadge.classList.add("ticket_status_badge--card");
        if (headerElement) {
            headerElement.after(statusBadge);
        } else {
            card_text_content.prepend(statusBadge);
        }
    }

    if (todoStatusChip) {
        todoStatusChip.classList.add("todo_status_chip--card");
        if (headerElement) {
            headerElement.appendChild(todoStatusChip);
        } else {
            card_text_content.prepend(todoStatusChip);
        }
    }

    if (usernameElement) {
        if (headerElement) {
            headerElement.appendChild(usernameElement);
        } else {
            footer_div.appendChild(usernameElement);
        }
    }

    if (show_more_button_on_cards) {
        const moreBtn = document.createElement("button");
        moreBtn.dataset.langKey = "show_more";
        moreBtn.addEventListener("click", (e) => {
            e.preventDefault();
            openRowArticleView(row_item, table_name, card);
        });
        setFieldHideAttribute(moreBtn);
        footer_div.appendChild(moreBtn);
    }

    /* --- KOKOAMINEN ------------------------------------------- */
    card_text_content.appendChild(footer_div);
    card_body_div.appendChild(card_image_content);
    card_body_div.appendChild(card_text_content);
    card_content_div.appendChild(card_body_div);
    card.appendChild(card_content_div);

    /* --- SMALL SUMMARY FOR COLLAPSED MODE -------------------- */
    const summaryDiv = document.createElement("div");
    summaryDiv.classList.add("card_small_summary");
    setFieldHideAttribute(summaryDiv);

    const imgDivSmall = document.createElement("div");
    imgDivSmall.classList.add("card_small_image");

    async function ensureSmallSummaryMediaLoaded() {
        if (imgDivSmall.dataset.summaryMediaState === "ready") {
            return;
        }
        if (imgDivSmall.dataset.summaryMediaState === "loading") {
            return;
        }

        imgDivSmall.dataset.summaryMediaState = "loading";

        let mediaElement;
        if (image_value_small) {
            // Defensive: resolve multilingual JSON that may have slipped through
            let imgSrc = extractLangValue(image_value_small, getLanguageWithBrowserFallback()).trim();
            if (
                !/^https?:\/\//.test(imgSrc) &&
                !imgSrc.startsWith("./") &&
                !imgSrc.startsWith("/")
            ) {
                const mediaFolder = resolveCardMediaFolder();
                const pathMatch = imgSrc.match(/^(\d+)\/(\d+)\/(?:\d+|original)\/(.+)$/);
                if (pathMatch) {
                    const mainTableId = pathMatch[1];
                    const mainRowId = pathMatch[2];
                    const filename = pathMatch[3];
                    imgSrc = `/storage/${mainTableId}/${mainRowId}/${mediaFolder}/${filename}`;
                } else {
                    const m = imgSrc.match(/^(\d+)_(\d+)_(\d+)\.(\w+)$/);
                    imgSrc = m
                        ? `/storage/${m[1]}/${m[2]}/${mediaFolder}/${imgSrc}`
                        : `/storage/${imgSrc}`;
                }
            }
            mediaElement = createImageElement(imgSrc, false, {
                ...buildCardImageRenderOptions(
                    row_item,
                    image_column_small,
                    table_name,
                    preferred_image_alt_label,
                    CARD_IMAGE_RENDER_SLOTS.SMALL_THUMBNAIL
                ),
            });
        } else {
            mediaElement = await create_seeded_avatar(
                creation_seed,
                header_first_letter,
                false
            );
        }

        mediaElement.classList.add("card_small_image_inner");
        imgDivSmall.replaceChildren(mediaElement);
        imgDivSmall.dataset.summaryMediaState = "ready";
    }

    card._ensureSmallSummaryMedia = ensureSmallSummaryMediaLoaded;

    const textWrap = document.createElement("div");
    textWrap.classList.add("card_small_text");
    if (username_text_small) {
        const userEl = document.createElement("div");
        userEl.classList.add("small_card_username");
        userEl.textContent = username_text_small;
        textWrap.appendChild(userEl);
    }
    if (header_text_small) {
        const nameEl = document.createElement("div");
        nameEl.classList.add("small_card_name");
        nameEl.appendChild(
            createDatasetIconElement(table_name, "small_card_dataset_icon")
        );
        const nameText = document.createElement("span");
        nameText.classList.add("small_card_name_text");
        nameText.textContent = header_text_small;
        nameEl.appendChild(nameText);
        textWrap.appendChild(nameEl);
    }
    if (creation_date_small) {
        const dateEl = document.createElement("div");
        dateEl.classList.add("small_card_date");
        dateEl.textContent = creation_date_small;
        textWrap.appendChild(dateEl);
    }

    if (statusBadgeValue) {
        const summaryBadge = createTicketStatusBadge(statusBadgeValue);
        summaryBadge.classList.add("ticket_status_badge--small");
        textWrap.appendChild(summaryBadge);
    }

    if (todoStatusChipValue) {
        const summaryTodoChip = createTaskTodoStatusChip(todoStatusChipValue);
        summaryTodoChip.classList.add("ticket_status_badge--small");
        textWrap.appendChild(summaryTodoChip);
    }

    summaryDiv.appendChild(imgDivSmall);
    summaryDiv.appendChild(textWrap);
    summaryDiv.addEventListener("click", (e) => {
        e.preventDefault();
        openRowArticleView(row_item, table_name, card);
    });

    card.appendChild(summaryDiv);

    // Store data for dynamic language refresh
    card._row = row_item;
    card._columns = columns;
    card._table_name = table_name;
    card._data_types = data_types;
    card._hasLocalizedRowData = hasLocalizedRowData;

    return card;
}

/* ----------------------------------------------------------- */

export async function create_card_view(columns, data, table_name) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("card_view_wrapper");
    wrapper.dataset.tableName = table_name;
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

    const collapsed = getUnifiedTableState(table_name)?.cardView?.collapsed;
    const renderContext = await resolveCardRenderContext(
        table_name,
        columns,
        data_types
    );

    // Batch-fetch comment counts for all rows
    const counts = await fetchCommentCountsForRows(table_name, data);

    const frag = document.createDocumentFragment();
    const createdCards = [];
    for (const [index, row_item] of data.entries()) {
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
                index
            );
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

    // Mass delete bar — hidden until cards are selected
    const massDeleteBar = document.createElement("div");
    massDeleteBar.classList.add("card_mass_delete_bar");
    massDeleteBar.style.display = "none";

    const massDeleteBtn = document.createElement("button");
    massDeleteBtn.classList.add("button", "fw-btn", "mass_delete_button");
    massDeleteBtn.dataset.langKey = "delete_selected";
    massDeleteBtn.addEventListener("click", async () => {
        const { delete_selected_items } = await import("../../general_tables/gt_1_row_crud/gt_1_4_row_delete/row_remover.js");
        await delete_selected_items(table_name);
        updateMassDeleteBar();
    });
    massDeleteBar.appendChild(massDeleteBtn);
    wrapper.prepend(massDeleteBar);

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
            chosenLanguage
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
    }

    const big = document.querySelector('.active_row_article, .active_big_card');
    if (big && big._row && big._table_name) {
        const row = big._row;
        const tableName = big._table_name;
        const selected = row.id != null ? document.querySelector(`.card[data-id="${row.id}"]`) : null;
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
