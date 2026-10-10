// card_row_builder.js
// Builds the existing standard data card from row and column metadata.
// Bridges existing card assembly with shared selection and presentation contracts.
// Exists to keep one card implementation within the source size limit.
import { datasetAppearanceState } from '../dataset_appearance_state.js';
import { readAppearanceAttribute } from '../../../reusable_components/appearance_scope_reader.js';
import { update_card_selection } from "../table_view/row_selection_handler.js";
import { create_seeded_avatar } from "./card_avatar_builder.js";
import { openRowArticleView } from "./row_article_opener.js";
import { addKeywordsSection } from "./card_keyword_builder.js";
import { generateGoogleMapsEmbedSrcFromRow, addHeaderElement, addUsernameElement, addImageOrAvatar, addDescriptionSection } from "./card_element_builder.js";
import { parseRoleString, createKeyValueElement, format_column_name, createTicketStatusBadge } from "./card_field_formatter.js";
import { isTicketStatusField, resolveCardFieldDisplayValue } from "./card_field_formatter_helpers.js";
import { expandForeignKeyDetailEntries } from "./relation_detail_helpers.js";
import { isEmptyCardFieldValue, mountCardFieldGroup, selectCardFieldEntries } from "./card_field_presentation.js";
import { count_this_function } from "../../dev_tools/function_counter.js";
import { makeColumnClass } from "../../filterbar/filter_list/column_visibility_handler.js";
import { always_show_empty_fields_on_cards, show_more_button_on_cards } from "../../../ui_config.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { hasFallbackCardImageColumn, resolveFallbackCardImageValue } from "./card_element_builder_helpers.js";
import { buildCardImageRenderOptions, CARD_IMAGE_RENDER_SLOTS } from "./card_image_render_options.js";
import { formatCardDetailEntriesForCardDisplay } from "./card_detail_value_formatter.js";
import { CARD_STYLE_VARIANT_VALUES, normalizeCardDetailColumnOverride, resolveClientCardStyleVariant } from "./card_detail_layout_options.js";
import { isDatasetRowSelected } from "../dataset_row_selection_store.js";
import { hasLocalizedCardValue, getTableMetaFromStorage, getCardDetailsLayout, getMetadataCardStyleVariant, isTaskTodoStatusField, createTaskTodoStatusChip, renderCardDetailsSection, getCardPostEntranceDelay, appendSmallCardSummary } from './card_row_presentation.js';
import { resolveCardRenderContext, updateMassDeleteBar } from './card_selection_action_bar.js';

export async function createSingleCard(
    row_item,
    columns,
    table_name,
    data_types,
    renderContext = null,
    cardIndex = 0,
    chosenLanguage = null,
    viewKey = "card"
) {
count_this_function("createSingleCard");
    const appearanceToken = datasetAppearanceState.capture(table_name);
    const chosenLang = chosenLanguage || getLanguageWithBrowserFallback();
    const collectEmptyFields = viewKey === "card" || always_show_empty_fields_on_cards;
    const hideFieldsOnCardsString =
        localStorage.getItem("hide_fields_on_cards") === "true"
            ? "true"
            : "false";
    const setFieldHideAttribute = (el) =>
        (el.dataset.hideFieldOnCard = hideFieldsOnCardsString);

    const resolvedContext = renderContext ||
        await resolveCardRenderContext(
            table_name,
            columns,
            data_types,
            chosenLang
        );
    const {
        hasDeleteRight,
        canManageRowAccess,
        canManageRowGroups,
        tableHasImageRole,
        timestampDisplayOptions,
    } = resolvedContext;
    const fallbackImageValue = resolveFallbackCardImageValue(row_item);
    const usesLargeImageLayout =
        tableHasImageRole ||
        hasFallbackCardImageColumn(columns) ||
        Boolean(fallbackImageValue);
    const card = document.createElement("div");
    if (!datasetAppearanceState.isCurrent(appearanceToken)) return card;
    card.classList.add("card", "saturate_on_hover");
    card.dataset.testid = 'card-item';
    card.dataset.cardPresentationView = viewKey;
    card.dataset.datasetName = table_name;
    if (datasetAppearanceState.isCurrent(appearanceToken)) datasetAppearanceState.bind(card, table_name);
    setFieldHideAttribute(card);
    if (row_item.id != null) card.dataset.id = row_item.id;
    const styleOverride = getMetadataCardStyleVariant(table_name);
    const columnOverride = normalizeCardDetailColumnOverride(getTableMetaFromStorage(table_name)?.card_detail_columns);
    if (columnOverride !== null) card.dataset.cardColumnsOverride = String(columnOverride);
    if (styleOverride !== null) card.dataset.cardStyleOverride = styleOverride;
    const cardStyleVariant = resolveClientCardStyleVariant(styleOverride,
        viewKey === 'card' ? readAppearanceAttribute(card, 'cardStyleVariant') : CARD_STYLE_VARIANT_VALUES.STANDARD);
    const isModernCardStyle = cardStyleVariant === CARD_STYLE_VARIANT_VALUES.MODERN;
    card.dataset.cardStyleVariant = cardStyleVariant;
    if (isModernCardStyle) {
        card.classList.add("card--modern");
    }
    if (hasDeleteRight || canManageRowAccess || canManageRowGroups) {
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.classList.add("card_checkbox");
        cb.dataset.testid = 'card-select-checkbox';
        cb.checked = isDatasetRowSelected(table_name, row_item.id);
        card.classList.toggle("selected", cb.checked);

        if (row_item.id != null) {
            const checkboxId = `${table_name}_${viewKey === "article_view" ? "article_view" : "card"}_checkbox_${row_item.id}`;
            cb.id = checkboxId;
        }
        cb.dataset.ariaLabelLangKey = "select";
        cb.dataset.ariaLabelLangContext = String(row_item.id ?? "");
        cb.setAttribute(
            "aria-label",
            row_item.id == null ? "Select row" : `Select row: ${row_item.id}`
        );

        cb.addEventListener("change", () => {
            update_card_selection(card);
            updateMassDeleteBar();
        });
        setFieldHideAttribute(cb);
        card.appendChild(cb);
    }
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
    const description_entries = [];
    const details_entries = [];
    const keywords_list = [];
    let hasLocalizedRowData = false;
let header_first_letter = "";
    let preferred_image_alt_header = "";
    let preferred_image_alt_username = "";
    const creationDateColumn = ["created", "created_at", "luontiaika"]
        .find((column) => row_item[column] !== null
            && row_item[column] !== undefined
            && String(row_item[column]).trim() !== "");
    const creation_date_small = creationDateColumn
        ? row_item[creationDateColumn]
        : "";
    const creation_seed =
        String(row_item.id ?? "x") + "_" + creation_date_small;
    let header_text_small = "";
    let header_column_small = "";
    let username_text_small = "";
    let image_value_small = "";
    let image_column_small = "cached_image";
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
let usernameElement = null;
    let headerElement = null;
    let found_image_for_this_row = false;
    let statusBadge = null;
    let statusBadgeValue = "";
    let todoStatusChip = null;
    let todoStatusChipValue = "";
    for (const column of columns) {
        if (!datasetAppearanceState.isCurrent(appearanceToken)) return card;
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
    const columnClass = makeColumnClass(table_name, column);
    if (baseRoles.length === 0) {
            if (!collectEmptyFields && !val_str.trim()) {
                continue;
            }
            mountCardFieldGroup(card, card_text_content, viewKey, (parent, showAll) => {
                if (!showAll && isEmptyCardFieldValue(val_str, isMultilingual)) return;
                const wrap = document.createElement("div");
                wrap.classList.add("card_pair", columnClass);
                setFieldHideAttribute(wrap);
                wrap.appendChild(createKeyValueElement(
                    col_label, storedRawValue, column, hasLangKey,
                    "card_value", val_str, data_types[column]
                ));
                parent.appendChild(wrap);
            }, always_show_empty_fields_on_cards);
            continue;
        }
for (const role of baseRoles) {
            if (/^hidden\d*$/.test(role)) continue; // ohita hidden
    if (
                /^description\d*$/.test(role) &&
                (collectEmptyFields || val_str.trim())
            ) {
                description_entries.push({
                    suffix_number:
                        parseInt(role.replace("description", "")) ||
                        Number.MAX_SAFE_INTEGER,
                    rawValue: val_str,
                    isMultilingual,
                    label: col_label,
                    hasLangKey,
                    column,
                    columnClass,
                    columnMeta: data_types[column],
                });
                continue;
            }
    if (
                /^details_link\d*$/.test(role) &&
                (collectEmptyFields || val_str.trim())
            ) {
                details_entries.push({
                    suffix_number:
                        parseInt(role.replace("details_link", "")) ||
                        Number.MAX_SAFE_INTEGER,
                    rawValue: val_str,
                    isMultilingual,
                    label: col_label,
                    hasLangKey,
                    column,
                    columnClass,
                    isLink: true,
                });
                continue;
            }
    if (
                /^details\d*$/.test(role) &&
                (collectEmptyFields || val_str.trim())
            ) {
                details_entries.push({
                    suffix_number:
                        parseInt(role.replace("details", "")) ||
                        Number.MAX_SAFE_INTEGER,
                    rawValue: val_str,
                    isMultilingual,
                    label: col_label,
                    hasLangKey,
                    column,
                    columnClass,
                    isLink: false,
                });
                continue;
            }
    if (role === "keywords" && (collectEmptyFields || val_str.trim())) {
                keywords_list.push({
                    column,
                    rawValue: val_str,
                    isMultilingual,
                    preferredLang: chosenLang,
                    label: col_label,
                    hasLangKey,
                    columnClass,
                });
                continue;
            }
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
                    ),
                    row_item,
                    card
                );
                card_image_content.lastElementChild?.classList.add(columnClass);
                continue;
            }
    if (role === "header") {
                if (!header_text_small) {
                    header_text_small = val_str;
                    header_column_small = column;
                }
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
    if (val_str.trim() || collectEmptyFields) {
                mountCardFieldGroup(card, card_text_content, viewKey, (parent, showAll) => {
                    if (!showAll && isEmptyCardFieldValue(val_str, isMultilingual)) return;
                    const wrap = document.createElement("div");
                    wrap.classList.add("card_pair", columnClass);
                    setFieldHideAttribute(wrap);
                    wrap.appendChild(createKeyValueElement(
                        col_label, storedRawValue, column, hasLangKey,
                        "card_details", val_str, data_types[column]
                    ));
                    parent.appendChild(wrap);
                }, always_show_empty_fields_on_cards);
            }
        }
    } // for(column)
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
            ),
            row_item,
            card
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
    const deferResponsiveLayoutMs = getCardPostEntranceDelay(cardIndex);
    const cardDetailsLayout = getCardDetailsLayout(table_name);
    mountCardFieldGroup(card, card_text_content, viewKey, (parent, showAll, effectiveStyle, detailColumns) => {
        const isModernCardStyle = effectiveStyle === CARD_STYLE_VARIANT_VALUES.MODERN;
        const cardInfoSectionContainer = isModernCardStyle
            ? document.createElement("div") : parent;
        if (isModernCardStyle) {
            cardInfoSectionContainer.classList.add("card_modern_info_panel");
            setFieldHideAttribute(cardInfoSectionContainer);
            parent.appendChild(cardInfoSectionContainer);
        }
        addDescriptionSection(
            selectCardFieldEntries(description_entries, showAll, data_types),
            row_item, table_name, cardInfoSectionContainer
        );
        addKeywordsSection(
            selectCardFieldEntries(keywords_list, showAll, data_types),
            row_item, table_name, cardInfoSectionContainer, { deferResponsiveLayoutMs }
        );
        let disposeDetails;
        try {
            count_this_function("createSingleCard_renderKV");
            const expandedDetailsEntries = expandForeignKeyDetailEntries(
                details_entries.sort((a, b) => a.suffix_number - b.suffix_number),
                row_item, data_types
            );
            const formattedDetailsEntries = formatCardDetailEntriesForCardDisplay(
                selectCardFieldEntries(expandedDetailsEntries, showAll, data_types),
                data_types, timestampDisplayOptions
            );
            if (formattedDetailsEntries.length) {
                const kvContainerDiv = document.createElement("div");
                kvContainerDiv.classList.add("card_details_kv");
                setFieldHideAttribute(kvContainerDiv);
                cardInfoSectionContainer.appendChild(kvContainerDiv);
                disposeDetails = renderCardDetailsSection(
                    kvContainerDiv, formattedDetailsEntries, data_types,
                    cardDetailsLayout, effectiveStyle, { deferResponsiveLayoutMs, detailColumns }
                );
            }
        } catch (err) {
            console.warn("KV-display render failed", err);
        }
        if (isModernCardStyle && cardInfoSectionContainer.childElementCount === 0) {
            cardInfoSectionContainer.remove();
        }
        return () => {
            if (typeof disposeDetails === "function") disposeDetails();
            // Removing the keyword child first lets its existing observer release
            // timers/listeners even when the whole modern panel is then replaced.
            if (isModernCardStyle) {
                cardInfoSectionContainer.querySelectorAll('.card_keywords_container')
                    .forEach((element) => element.remove());
            }
        };
    }, always_show_empty_fields_on_cards);
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
card_text_content.appendChild(footer_div);
    card_body_div.appendChild(card_image_content);
    card_body_div.appendChild(card_text_content);
    card_content_div.appendChild(card_body_div);
    card.appendChild(card_content_div);

    appendSmallCardSummary({ card, row_item, table_name, setFieldHideAttribute, image_value_small, image_column_small, preferred_image_alt_label, creation_seed, header_first_letter, username_text_small, header_text_small, header_column_small, creation_date_small, creationDateColumn, data_types, timestampDisplayOptions, statusBadgeValue, todoStatusChipValue });

    // Store data for dynamic language refresh
    card._row = row_item;
    card._columns = columns;
    card._table_name = table_name;
    card._data_types = data_types;
    card._hasLocalizedRowData = hasLocalizedRowData;

    if (datasetAppearanceState.isCurrent(appearanceToken)) datasetAppearanceState.bind(card, table_name);
    return card;
}
