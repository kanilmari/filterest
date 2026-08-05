// big_card_content_builder.js
// Builds the content body for the expanded article-view row overlay.
// Bridges row values, column metadata, and card formatting helpers into the final detail DOM.
// Exists to keep article-view content composition separate from the legacy big-card UI state layer.

import {
    parseRoleString,
    format_column_name,
    createTicketStatusBadge,
} from "./card_field_formatter.js";
import {
    isGeneratedForeignDisplayColumn,
    isTicketStatusField,
    resolveCardFieldDisplayValue,
} from "./card_field_formatter_helpers.js";
import { makeColumnClass } from "../../filterbar/filter_list/column_visibility_handler.js";
import { addUsernameElement } from "./card_element_builder.js";
import { createImageElement } from "./card_avatar_builder.js";
import {
    always_show_empty_fields_on_cards,
    row_article_relation_details_mode,
} from "../../../ui_config.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import {
    createRowArticleKeyValueElement,
    createRowArticleNavigableElement,
    resolveRowArticleLocalizedValue,
} from "./row_article_ui_handler.js";
import {
    extractSuffixNumber,
    splitKeywords,
    resolveImagePath,
    classifyRole,
} from "./row_article_content_builder_helpers.js";
import {
    buildCardImageRenderOptions,
    CARD_IMAGE_RENDER_SLOTS,
} from "./card_image_render_options.js";
import { resolveRowArticleRelationDetailEntries } from "./relation_detail_helpers.js";
import { createDatasetIconElement } from "./dataset_icon_builder.js";
import { buildRowArticleDisclosureSection } from "./row_article_disclosure_section_builder.js";

const DETAILS_ICON_PATH = "/frontend/icons/general/visible-fields-icon.svg";

function resolveRowArticleLabelMetadata(dataTypes = {}, detailEntry = {}) {
    return dataTypes[
        detailEntry.sourceColumn
        || detailEntry.dataColumn
        || detailEntry.column
    ] || {};
}

function isCardImageCompanionColumn(columnName = "") {
    return String(columnName || "").startsWith("cached_image_");
}

/**
 * Builds the article-view content block for one expanded row.
 * Bridges row values, card metadata, and formatting helpers into the main overlay body.
 * Exists so callers can move toward row_article naming while legacy big-card callers still work.
 */
export async function buildRowArticleContent(
    row_item,
    table_name,
    data_types,
    sorted_columns,
    creation_seed,
    header_first_letter,
    table_has_image_role,
    current_user_id = null
) {
    const rowArticleContentElement = document.createElement("div");
    rowArticleContentElement.classList.add("big_card_content", "row_article_content");

    const description_entries = [];
    const details_entries = [];
    const keywords_list = [];
    let usernameElement = null;
    let rowArticleHeaderText = "";
    let preferred_image_alt_header = "";
    let preferred_image_alt_username = "";
    let statusBadge = null;
    const rowArticleHeaderElements = [];
    const rowArticleHeaderValues = new Set();
    const chosenLang = getLanguageWithBrowserFallback();

    for (const column of sorted_columns) {
        if (isGeneratedForeignDisplayColumn(column, data_types)) {
            continue;
        }

        const { displayValue } = resolveCardFieldDisplayValue(
            row_item,
            column,
            data_types,
            chosenLang,
            table_name
        );
        const localizedVal = displayValue.trim();
        const { baseRoles, hasLangKey } = parseRoleString(
            data_types[column]?.card_element || ""
        );

        if (baseRoles.includes("header") && !hasLangKey && !preferred_image_alt_header && localizedVal) {
            preferred_image_alt_header = localizedVal;
        }

        if (baseRoles.includes("username") && !hasLangKey && !preferred_image_alt_username && localizedVal) {
            preferred_image_alt_username = localizedVal;
        }
    }

    const preferred_image_alt_label =
        preferred_image_alt_header || preferred_image_alt_username;

    /* -------------------------------------------------- *
     * 4. SARAKKEIDEN LOOPPI
     * -------------------------------------------------- */
    for (const column of sorted_columns) {
        if (isGeneratedForeignDisplayColumn(column, data_types)) {
            continue;
        }
        if (isCardImageCompanionColumn(column)) {
            continue;
        }

        const raw = row_item[column];
        const {
            rawValue: storedRawValue,
            displayValue: val,
            isMultilingual: resolvedIsMultilingual,
        } = resolveCardFieldDisplayValue(
            row_item,
            column,
            data_types,
            chosenLang,
            table_name
        );

        if (!always_show_empty_fields_on_cards && val.trim() === "") {
            continue;
        }

        const columnClass = makeColumnClass(table_name, column);
        const roleFull = data_types[column]?.card_element || "";
        const { baseRoles, hasLangKey } = parseRoleString(roleFull);
        const showKeyOnCard = data_types[column]?.show_key_on_card === true;
        const column_label = format_column_name(column);
        const colIsMultilingual = resolvedIsMultilingual;

        if (isTicketStatusField(table_name, column)) {
            statusBadge = createTicketStatusBadge(val);
            statusBadge.classList.add("ticket_status_badge--big");
            statusBadge.dataset.column = column;
            statusBadge.dataset.rawValue = storedRawValue ?? val;
            continue;
        }

        /* Piilota false/null isolla kortilla */
        if (data_types[column]?.hide_false_null_on_big_crd === true) {
            if (raw === null || raw === undefined || raw === false || val.trim() === '' || val.trim() === 'false') {
                continue;
            }
        }

        /* Piilota isolla kortilla jos ei oma rivi */
        if (data_types[column]?.hide_on_bg_crd_if_not_own === true && current_user_id) {
            const ownerCol = row_item.created_by ?? row_item.user_id ?? row_item.id;
            if (ownerCol && String(ownerCol) !== String(current_user_id)) {
                continue;
            }
        }

        /* --- Ei roolia → tavallinen avain–arvo --- */
        if (baseRoles.length === 0) {
            if (String(data_types[column]?.foreign_table || "").trim()) {
                details_entries.push({
                    suffix_number: Number.MAX_SAFE_INTEGER,
                    rawValue: val,
                    storedRawValue,
                    label: column_label,
                    hasLangKey,
                    column,
                    isLink: false,
                    showKeyOnCard,
                    isMultilingual: colIsMultilingual,
                });
                continue;
            }
            rowArticleContentElement.appendChild(
                createRowArticleKeyValueElement(
                    column_label,
                    val,
                    column,
                    hasLangKey,
                    "big_card_generic_field",
                    showKeyOnCard,
                    colIsMultilingual,
                    storedRawValue,
                    data_types[column]
                )
            );
            continue;
        }

        /* --- Roolikohtainen käsittely --- */
        const columnHasHeaderRole = baseRoles.some((role) =>
            classifyRole(role) === "header"
        );
        for (const r of baseRoles) {
            const category = classifyRole(r);

            if (category === "hidden") continue;
            if (columnHasHeaderRole && category !== "header") continue;

            /* details_link ---------------------------------------------------- */
            if (category === "details_link") {
                details_entries.push({
                    suffix_number: extractSuffixNumber(r),
                    rawValue: val,
                    storedRawValue,
                    label: column_label,
                    hasLangKey,
                    column,
                    isLink: true,
                    showKeyOnCard,
                    isMultilingual: colIsMultilingual,
                });
                continue;
            }

            /* details ---------------------------------------------------------- */
            if (category === "details") {
                details_entries.push({
                    suffix_number: extractSuffixNumber(r),
                    rawValue: val,
                    storedRawValue,
                    label: column_label,
                    hasLangKey,
                    column,
                    isLink: false,
                    showKeyOnCard,
                    isMultilingual: colIsMultilingual,
                });
                continue;
            }

            /* description ------------------------------------------------------ */
            if (category === "description") {
                description_entries.push({
                    suffix_number: extractSuffixNumber(r),
                    rawValue: val,
                    storedRawValue,
                    label: column_label,
                    hasLangKey,
                    column,
                    showKeyOnCard,
                    isMultilingual: colIsMultilingual,
                });
                continue;
            }

            /* keywords --------------------------------------------------------- */
            if (category === "keywords") {
                const localizedVal = resolveRowArticleLocalizedValue(val, colIsMultilingual);
                keywords_list.push({
                    column,
                    rawValue: localizedVal,
                    label: column_label,
                    hasLangKey,
                    showKeyOnCard,
                    columnClass,
                    isMultilingual: colIsMultilingual,
                });
                continue;
            }

            /* username --------------------------------------------------------- */
            if (category === "username") {
                usernameElement = addUsernameElement(
                    val,
                    column_label,
                    column,
                    hasLangKey
                );
                usernameElement.classList.add(columnClass);
                continue;
            }

            /* image ------------------------------------------------------------ */
            if (category === "image") {
                const imageVal = resolveRowArticleLocalizedValue(val, colIsMultilingual);
                if (!imageVal.trim()) {
                    continue;
                }

                const imgDiv = document.createElement("div");
                imgDiv.classList.add("big_card_image");
                imgDiv.dataset.rowArticleImageColumn = column;
                imgDiv.dataset.rowArticleImageSlot = CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE;

                const src = resolveImagePath(imageVal);
                const imageWrapper = createImageElement(src, true, {
                    ...buildCardImageRenderOptions(
                        row_item,
                        column,
                        table_name,
                        preferred_image_alt_label,
                        CARD_IMAGE_RENDER_SLOTS.ROW_ARTICLE_INLINE
                    ),
                });
                imgDiv.appendChild(imageWrapper);
                rowArticleContentElement.appendChild(imgDiv);
                continue;
            }

            /* header ----------------------------------------------------------- */
            if (category === "header") {
                const headerValue = String(val ?? "").trim();
                if (headerValue) {
                    rowArticleHeaderValues.add(headerValue);
                }
                rowArticleHeaderText = hasLangKey
                    ? val
                    : `${column_label}: ${val}`;

                const h = document.createElement("div");
                h.classList.add("big_card_header", "big_card_header--with-dataset-icon");
                h.style.whiteSpace = "pre-wrap";
                h.appendChild(
                    createDatasetIconElement(table_name, "big_card_header_dataset_icon")
                );
                if (hasLangKey) {
                    const translatedHeader = document.createElement("span");
                    translatedHeader.classList.add("big_card_header_value");
                    translatedHeader.dataset.langKey = val;
                    h.appendChild(translatedHeader);
                } else {
                    h.appendChild(
                        createRowArticleKeyValueElement(
                            column_label,
                            val,
                            column,
                            hasLangKey,
                            "big_card_header_value",
                            showKeyOnCard,
                            colIsMultilingual,
                            storedRawValue,
                            data_types[column]
                        )
                    );
                }
                rowArticleHeaderElements.push(h);
                continue;
            }

            /* creation_spec ---------------------------------------------------- */
            if (category === "creation_spec") {
                const c = document.createElement("div");
                c.classList.add("big_card_creation_spec");
                c.style.whiteSpace = "pre-wrap";
                if (hasLangKey) {
                    c.dataset.langKey = val;
                } else {
                    c.appendChild(
                        createRowArticleKeyValueElement(
                            column_label,
                            val,
                            column,
                            hasLangKey,
                            "big_card_creation_value",
                            showKeyOnCard,
                            colIsMultilingual,
                            storedRawValue,
                            data_types[column]
                        )
                    );
                }
                rowArticleContentElement.appendChild(c);
                continue;
            }

            /* fallback --------------------------------------------------------- */
            rowArticleContentElement.appendChild(
                createRowArticleKeyValueElement(
                    column_label,
                    val,
                    column,
                    hasLangKey,
                    "big_card_generic_field",
                    showKeyOnCard,
                    colIsMultilingual,
                    storedRawValue,
                    data_types[column]
                )
            );
        }
    }

    const firstRowArticleImage = rowArticleContentElement.querySelector(".big_card_image");
    for (const headerElement of rowArticleHeaderElements) {
        rowArticleContentElement.insertBefore(
            headerElement,
            firstRowArticleImage || rowArticleContentElement.firstChild
        );
    }

    if (statusBadge) {
        const headerElement = rowArticleHeaderElements.at(-1);
        if (headerElement) {
            headerElement.after(statusBadge);
        } else {
            rowArticleContentElement.prepend(statusBadge);
        }
    }

    if (usernameElement) {
        rowArticleContentElement.appendChild(usernameElement);
    }

    /* -------------------------------------------------- *
     * 6. KUVAUKSET, KEYWORDS & DETAILS
     * -------------------------------------------------- */
    description_entries.sort((a, b) => a.suffix_number - b.suffix_number);
    details_entries.sort((a, b) => a.suffix_number - b.suffix_number);
    const expandedDetailsEntries = resolveRowArticleRelationDetailEntries(
        details_entries,
        row_item,
        data_types,
        row_article_relation_details_mode
    );

    /* -- description ------------------------------- */
    const visibleDescriptionEntries = description_entries.filter((d) => {
        const descriptionValue = String(d.rawValue ?? "").trim();
        return !descriptionValue || !rowArticleHeaderValues.has(descriptionValue);
    });
    if (visibleDescriptionEntries.length) {
        const dc = document.createElement("div");
        dc.classList.add("big_card_description_container");
        visibleDescriptionEntries.forEach((d) => {
            // suoraan elementti ilman ylimääräistä käärettä
            dc.appendChild(
                createRowArticleKeyValueElement(
                    d.label,
                    d.rawValue,
                    d.column,
                    d.hasLangKey,
                    "big_description_value",
                    d.showKeyOnCard,
                    d.isMultilingual,
                    d.storedRawValue,
                    resolveRowArticleLabelMetadata(data_types, d)
                )
            );
        });
        rowArticleContentElement.appendChild(dc);
    }

    /* -- keywords ---------------------------------- */
    if (keywords_list.length) {
        const kc = document.createElement("div");
        kc.classList.add("big_card_keywords_container");

        keywords_list.forEach((k) => {
            splitKeywords(k.rawValue).forEach((word) => {
                    const tagDiv = document.createElement("div");
                    tagDiv.classList.add("keyword_tag", k.columnClass);

                    const contentElement = createRowArticleKeyValueElement(
                        k.label,
                        word,
                        k.column,
                        k.hasLangKey,
                        "keyword_value",
                        k.showKeyOnCard,
                        k.isMultilingual,
                        undefined,
                        resolveRowArticleLabelMetadata(data_types, k)
                    );
                    contentElement.classList.add(
                        "key_value_wrapper",
                        k.columnClass
                    );

                    tagDiv.appendChild(contentElement);
                    kc.appendChild(tagDiv);
                });
        });

        rowArticleContentElement.appendChild(kc);
    }

    /* -- details ----------------------------------- */
    if (expandedDetailsEntries.length) {
        const detailsContainer = document.createElement("div");
        detailsContainer.classList.add("big_card_details_container");

        expandedDetailsEntries.forEach((d) => {
            if (d.isLink) {
                const resolvedHref = String(d.href || d.rawValue || "").trim();
                detailsContainer.appendChild(
                    createRowArticleNavigableElement({
                        label: d.label,
                        labelKey: d.labelKey || d.column,
                        value: d.rawValue,
                        column: d.column,
                        dataColumn: Object.prototype.hasOwnProperty.call(d, "dataColumn")
                            ? d.dataColumn
                            : d.column,
                        showKey: d.showKeyOnCard,
                        href: resolvedHref,
                        openInNewTabHref: d.openInNewTabHref || resolvedHref,
                        openPrimaryInNewTab: !d.href,
                        storedRawValue: d.storedRawValue ?? d.rawValue,
                        labelMeta: resolveRowArticleLabelMetadata(data_types, d),
                    })
                );
                return;
            }

            detailsContainer.appendChild(
                createRowArticleKeyValueElement(
                    d.label,
                    d.rawValue,
                    d.column,
                    d.hasLangKey,
                    "big_card_detail_value",
                    d.showKeyOnCard,
                    d.isMultilingual,
                    d.storedRawValue,
                    resolveRowArticleLabelMetadata(data_types, d)
                )
            );
        });
        rowArticleContentElement.appendChild(
            buildRowArticleDisclosureSection({
                titleLangKey: "row_article_section_details",
                titleText: "Details",
                iconPath: DETAILS_ICON_PATH,
                contentElement: detailsContainer,
                startOpen: true,
                sectionClassNames: "row_article_details_section",
            })
        );
    }

    return {
        card_modal_content_div: rowArticleContentElement,
        modal_header_text: rowArticleHeaderText,
        rowArticleContentElement,
        rowArticleHeaderText,
    };
}

export { buildRowArticleContent as buildBigCardContent };
