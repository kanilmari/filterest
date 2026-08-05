// card_element_builder.js
// Builds individual card DOM elements from row data for the card view.
// Bridges raw row objects and the card DOM structure, including avatars, maps, and modals.
// Exists to centralise card element construction so card layout logic stays out of the view printer.

import { createImageElement, create_seeded_avatar } from "./card_avatar_builder.js";
import { openRowArticleView } from "./row_article_opener.js";
import { openImageModal } from "./card_image_modal.js";
import { createKeyValueElement } from "./card_field_formatter.js";
import { count_this_function } from "../../dev_tools/function_counter.js";
import {
    show_more_button_on_cards,
    resolveCardMediaFolder,
} from "../../../ui_config.js";
import { extractLangValue } from "../../../reusable_components/lang_value_reader.js";
import { setElementSvgContent } from "../../../icons/icon_loader.js";
import { getLanguageWithBrowserFallback } from "../../state_stores/lang_preference_reader.js";
import { buildGoogleMapsEmbedUrl, resolveImagePaths } from "./card_element_builder_helpers.js";
import { createDatasetIconElement } from "./dataset_icon_builder.js";

/* ----------------------------------------------------------- */
/** Palauttaa Google Maps -Embed-iframe-src-osoitteen. */
function generateGoogleMapsEmbedSrcFromRow(rowItem) {
    count_this_function("generateGoogleMapsEmbedSrcFromRow");
    return buildGoogleMapsEmbedUrl(rowItem);
}

function addHeaderElement(
    val_str,
    label,
    column,
    hasLangKey,
    row_item,
    table_name,
    container,
    storedRawValue = val_str,
    columnMeta = {}
) {
    const headerDiv = document.createElement("div");
    headerDiv.classList.add("card_header", "card_header--with-dataset-icon");
    headerDiv.dataset.testid = 'card-item-header';

    const kvElem = createKeyValueElement(
        label, // näkyy vain jos show_key_on_card === true
        storedRawValue, // tallennetaan muokkausta varten
        column,
        hasLangKey, // jos true → data-lang-key attribuutti, ei tekstisisältöä
        "header_value", // css‑luokka arvolle
        val_str,
        columnMeta
    );

    // Header needs the value wrapper directly so title width is governed by
    // the header container, not by an extra generic card_pair layer.
    headerDiv.appendChild(
        createDatasetIconElement(table_name, "card_header_dataset_icon")
    );
    headerDiv.appendChild(kvElem);
    headerDiv.title = val_str;

    // --- klikillä isompi kortti ----------------
    headerDiv.addEventListener("click", (e) => {
        e.preventDefault();
        openRowArticleView(row_item, table_name, headerDiv.closest(".card"));
    });

    // liitetään korttiin ja palautetaan ref, jotta username voidaan liittää
    container.appendChild(headerDiv);
    return headerDiv;
}
/**
 * Lisää username-elementin korttiin (username-roolia vastaava).
 */
function addUsernameElement(val_str, label, column, hasLangKey) {
    const username_div = document.createElement("div");
    username_div.classList.add("card_username");

    const iconContainer = document.createElement("span");
    iconContainer.classList.add("card_username_icon");
    void setElementSvgContent(iconContainer, '/frontend/icons/general/user-person-icon.svg');

    const textSpan = document.createElement("span");
    textSpan.classList.add("card_username_text");

    if (hasLangKey) {
        textSpan.dataset.langKey = val_str;
    } else {
        textSpan.textContent = val_str;
    }

    username_div.appendChild(iconContainer);
    username_div.appendChild(textSpan);
    return username_div;
}

/**
 * Lisää kuvan tai avatarin. Klikattaessa kuvaa avautuu isompana modaalissa.
 */
async function addImageOrAvatar(
    val_str,
    tableHasImageRole,
    creation_seed,
    header_first_letter,
    imageContainer,
    table_name = "",
    row_label = "",
    image_render_options = {}
) {
    let foundImage = false;
    const elem_div = document.createElement("div");
    elem_div.classList.add("card_image");

    const useLargeSize = tableHasImageRole;
    // Defensive: resolve multilingual JSON that may have slipped through
    const resolvedVal = extractLangValue(val_str, getLanguageWithBrowserFallback());
    if (resolvedVal.trim()) {
        foundImage = true;
        const mediaFolder = resolveCardMediaFolder();
        const { displaySrc: display_src, originalSrc: original_src } =
            resolveImagePaths(resolvedVal.trim(), mediaFolder);

        // Luodaan kuva
        const blurredImageElement = createImageElement(display_src, useLargeSize, {
            tableName: table_name,
            rowLabel: row_label,
            ...image_render_options,
        });
        // Lisätään klikkauskuuntelija, joka avaa modaalin
        blurredImageElement.addEventListener("click", () => {
            openImageModal(original_src);
        });

        elem_div.appendChild(blurredImageElement);
        imageContainer.classList.add("card_image_content--clickable");
    } else {
        // Avatar
        const avatar = await create_seeded_avatar(
            creation_seed,
            header_first_letter,
            useLargeSize
        );

        // Lisätään silti klikkauskuuntelija, jos halutaan avata avatar isompana (valinnainen)
        // avatar.addEventListener("click", () => {
        //     openImageModal(someAvatarSrcIfWanted);
        // });

        elem_div.appendChild(avatar);
    }

    imageContainer.appendChild(elem_div);
    return foundImage;
}

function resolveCardImageFolderForElement(imageElement) {
    const card = imageElement?.closest?.(".card");
    const cardWidth = card?.getBoundingClientRect?.().width || 0;
    if (cardWidth > 0) {
        return resolveCardMediaFolder(cardWidth);
    }

    const cardContainer = imageElement?.closest?.(".card_container, .card_view_wrapper");
    const cardContainerWidth = cardContainer?.getBoundingClientRect?.().width || 0;
    if (cardContainerWidth > 0) {
        return resolveCardMediaFolder(cardContainerWidth);
    }

    return resolveCardMediaFolder();
}

/**
 * Päivittää korttien kuvien polut kortin käytettävissä olevan leveyden mukaan.
 * Kapealla kortilla käytetään 1000-kansion kuvia ja leveällä 300-kansion.
 */
function updateCardImageSources() {
    document
        .querySelectorAll(".card_image img, .card_small_image_inner img")
        .forEach((img) => {
            const newFolder = resolveCardImageFolderForElement(img);
            const url = new URL(img.src, window.location.origin);
            const match = url.pathname.match(
                /(\/storage\/\d+\/\d+)\/(300|1000)\/(.+)/
            );
            if (match && match[2] !== newFolder) {
                url.pathname = `${match[1]}/${newFolder}/${match[3]}`;
                img.src = url.href;
            }
        });
}

/**
 * Lisää kortille kuvausosion.
 * Jokaiselle luodulle elementille asetetaan data-hide-field-on-card
 * merkkijonoksi "true" tai "false" riippuen siitä, löytyykö localStoragesta
 * hide_fields_on_cards === "true".
 */
function addDescriptionSection(
    description_entries,
    row_item,
    table_name,
    container
) {
    count_this_function("addDescriptionSection");

    if (description_entries.length === 0) return;

    /* Luetaan käyttäjän asetus kerran. */
    const hideFieldsOnCardsString =
        localStorage.getItem("hide_fields_on_cards") === "true"
            ? "true"
            : "false";

    /** Asettaa data-attribuutin elementille aina ("true" tai "false"). */
    function setFieldHideAttribute(targetElement) {
        targetElement.dataset.hideFieldOnCard = hideFieldsOnCardsString;
    }

    // Järjestys numeron mukaan
    description_entries.sort((a, b) => a.suffix_number - b.suffix_number);

    const desc_container = document.createElement("div");
    desc_container.classList.add("card_description_container");
    setFieldHideAttribute(desc_container);

    // Koko description-container klikattava -> avaa ison kortin
    desc_container.addEventListener("click", () => {
        openRowArticleView(row_item, table_name, container.closest(".card"));
    });

    container.appendChild(desc_container);

    for (const descObj of description_entries) {
        const outerDiv = document.createElement("div");
        outerDiv.classList.add("single_description_item", descObj.columnClass); // ★
        setFieldHideAttribute(outerDiv);

        // Itse key/value-elementti
        const wrapper = createKeyValueElement(
            descObj.label,
            descObj.rawValue,
            descObj.column,
            descObj.hasLangKey,
            "description_value",
            descObj.rawValue,
            descObj.columnMeta || {}
        );
        wrapper.classList.add(descObj.columnClass); // ★
        setFieldHideAttribute(wrapper);

        // "Näytä enemmän" + rivinvaihdot
        const valueDiv = wrapper.querySelector(
            `[data-column="${descObj.column}"]`
        );
        if (valueDiv) {
            valueDiv.style.whiteSpace = "pre-wrap";
            // Estetään klikkauksen kupliminen, jotta tekstin valinta toimii
            valueDiv.addEventListener("click", (e) => e.stopPropagation());
            if (show_more_button_on_cards) {
                valueDiv.appendChild(document.createTextNode(" "));
                const showMoreLink = createShowMoreLink(row_item, table_name);
                showMoreLink.style.display = "none";
                valueDiv.appendChild(showMoreLink);
            }
        }

        outerDiv.appendChild(wrapper);
        desc_container.appendChild(outerDiv);
    }
}

// Tarkistetaan DOMin latauksen jälkeen, onko teksti pidempi kuin kaksi riviä
document.addEventListener("DOMContentLoaded", function () {
    const descriptionValues = document.querySelectorAll(".description_value");
    descriptionValues.forEach(function (valueDiv) {
        const showMoreLink = valueDiv.querySelector(".show_more_link");
        if (showMoreLink) {
            const lineHeight = parseInt(
                window.getComputedStyle(valueDiv).lineHeight
            );
            const maxHeight = lineHeight * 2; // Kahden rivin korkeus
            if (valueDiv.scrollHeight > maxHeight) {
                showMoreLink.style.display = "inline"; // Näytä linkki, jos teksti on pidempi
            }
        }
    });
});

/**
 * Rakentaa avainsana-(keyword)-osion kortille.
 * Kaikkiin luotuihin elementteihin asetetaan data-hide-field-on-card:
 *  • "false" → saraketta EI saa piilottaa
 *  • "true"  → sarake voidaan piilottaa normaalisti
 */
function addDetailsSection(details_entries, row_item, table_name, container) {
    if (details_entries.length === 0) return;

    details_entries.sort((a, b) => a.suffix_number - b.suffix_number);

    const mid_point = Math.ceil(details_entries.length / 2);
    const left_details = details_entries.slice(0, mid_point);
    const right_details = details_entries.slice(mid_point);

    const details_container = document.createElement("div");
    details_container.classList.add("card_details_container");

    details_container.appendChild(
        createDetailsTable(left_details, row_item, table_name)
    );
    details_container.appendChild(
        createDetailsTable(right_details, row_item, table_name)
    );

    container.appendChild(details_container);
}

/**
 * Luo <table>-elementin riveineen.
 * data-hide-field-on-card saa arvon "true" tai "false" sen mukaan,
 * löytyykö localStoragesta avain hide_fields_on_cards ja onko se "true".
 */
function createDetailsTable(detailsList, row_item, table_name) {
    count_this_function("createDetailsTable");

    /** Luetaan käyttäjän asetus ja muutetaan se merkkijonoksi "true"/"false". */
    const hideFieldsOnCardsString =
        localStorage.getItem("hide_fields_on_cards") === "true"
            ? "true"
            : "false";

    /** Asettaa data-attribuutin elementille aina ("true" tai "false"). */
    function setFieldHideAttribute(targetElement) {
        targetElement.dataset.hideFieldOnCard = hideFieldsOnCardsString;
    }

    const table = document.createElement("table");
    table.classList.add("card_table");

    detailsList.forEach((detailObj) => {
        /* TR ------------------------------------------------------ */
        const row = document.createElement("tr");
        row.classList.add(detailObj.columnClass); // ★
        setFieldHideAttribute(row);

        /* KEY-solu ------------------------------------------------ */
        const key_cell = document.createElement("th");
        key_cell.dataset.langKey = detailObj.column;
        key_cell.classList.add(detailObj.columnClass); // ★
        setFieldHideAttribute(key_cell);

        /* VALUE-solu --------------------------------------------- */
        const value_cell = document.createElement("td");
        value_cell.classList.add(detailObj.columnClass); // ★
        setFieldHideAttribute(value_cell);

        /* ——— Arvon käsittely ——— */
        if (detailObj.isLink) {
            const linkValue = detailObj.rawValue.trim();
            if (linkValue.startsWith("<a ")) {
                const parser = new DOMParser();
                const doc = parser.parseFromString(linkValue, "text/html");
                const anchor = doc.querySelector("a");
                const newLink = document.createElement("a");
                newLink.href = anchor ? anchor.href : linkValue;
                newLink.target = "_blank";
                newLink.textContent = anchor
                    ? anchor.textContent || anchor.href
                    : linkValue;
                value_cell.appendChild(newLink);
            } else {
                const link = document.createElement("a");
                link.href = linkValue;
                link.target = "_blank";
                link.textContent = linkValue;
                value_cell.appendChild(link);
            }
        } else if (!detailObj.hasLangKey && detailObj.rawValue.length > 80) {
            value_cell.textContent = detailObj.rawValue.slice(0, 80) + "... ";
            if (show_more_button_on_cards) {
                value_cell.appendChild(createShowMoreLink(row_item, table_name));
            }
        } else {
            value_cell.textContent = detailObj.rawValue;
            if (detailObj.titleValue) {
                value_cell.title = detailObj.titleValue;
            }
        }

        row.appendChild(key_cell);
        row.appendChild(value_cell);
        table.appendChild(row);
    });

    return table;
}

function createShowMoreLink(row_item, table_name) {
    const link = document.createElement("a");
    link.href = "#";
    link.classList.add("show_more_link");
    link.dataset.langKey = "show_more";
    link.addEventListener("click", (e) => {
        e.preventDefault();
        openRowArticleView(row_item, table_name, link.closest(".card"));
    });
    return link;
}


export {
    generateGoogleMapsEmbedSrcFromRow,
    addHeaderElement,
    addUsernameElement,
    addImageOrAvatar,
    addDescriptionSection,
    addDetailsSection,
    createShowMoreLink,
    updateCardImageSources,
};
