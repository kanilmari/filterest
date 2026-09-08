// kv_pair_builder.js
// Builds key/value pair DOM while preserving existing text, link and icon handling.
// Connects the responsive KV container to optional shared column layout settings.
// Keeps pair composition separate from resize observation and automatic measurement.
import { resolveSafeExternalHttpUrl } from "../safe_external_http_url.js";
import { appendTextWithHttpLinks } from "../http_text_linkifier.js";
import { applyLabelValueLayout } from "./label_value_layout.js";

function isEmptyValue(value) {
    return value === "" || value === null || value === undefined;
}

const OPEN_IN_NEW_TAB_LANG_KEY = "open_in_new_tab";
const OPEN_IN_NEW_TAB_FALLBACK = "Avaa uudessa välilehdessä";
const OPEN_IN_NEW_TAB_ICON_PATHS = [
    "M14 3h7v7",
    "M10 14 21 3",
    "M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5",
];
function appendOpenInNewTabIcon(linkElement) {
    linkElement.classList.add("open-in-new-tab-icon-button");
    linkElement.dataset.titleLangKey = OPEN_IN_NEW_TAB_LANG_KEY;
    linkElement.dataset.ariaLabelLangKey = OPEN_IN_NEW_TAB_LANG_KEY;
    linkElement.title = OPEN_IN_NEW_TAB_FALLBACK;
    linkElement.setAttribute("aria-label", OPEN_IN_NEW_TAB_FALLBACK);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add("open-in-new-tab-icon");

    OPEN_IN_NEW_TAB_ICON_PATHS.forEach((pathData) => {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        svg.appendChild(path);
    });

    linkElement.appendChild(svg);
}


/** Build one renderer's pair factories with its localized copy and key decoration. */
export function createKvPairBuilders({ translate, decorateKeyElement }) {
    /* --------------------------------------------------
       YLEINEN ARVON RENDERÖINTI: teksti vs linkki
       -------------------------------------------------- */
    function fillValueElement(dest, pairObj) {

        const empty = isEmptyValue(pairObj?.value);
        const isExternalLinkField = pairObj?.isLink === true && !pairObj?.href;
        const requestedHref = String(
            pairObj?.href || (isExternalLinkField ? pairObj?.value : "") || ""
        ).trim();
        const href = isExternalLinkField
            ? resolveSafeExternalHttpUrl(requestedHref)
            : requestedHref;
        const linkText = String(pairObj?.value ?? "");
        const requestedOpenInNewTabHref = String(pairObj?.openInNewTabHref || "").trim();
        const openInNewTabHref = isExternalLinkField
            ? resolveSafeExternalHttpUrl(requestedOpenInNewTabHref)
            : requestedOpenInNewTabHref;
        const titleText = String(pairObj?.titleValue || "").trim();
        if (titleText) {
            dest.title = titleText;
        }

        if (href && !empty) {
            const linkGroup = document.createElement("span");
            linkGroup.className = "kv-link-group";

            const a = document.createElement("a");
            a.href = href;
            a.textContent = linkText;
            if (isExternalLinkField) {
                a.target = "_blank";
                a.rel = "noopener noreferrer";
            }
            linkGroup.appendChild(a);

            if (openInNewTabHref) {
                const openLink = document.createElement("a");
                openLink.href = openInNewTabHref;
                openLink.target = "_blank";
                openLink.rel = "noopener noreferrer";
                openLink.className = "kv-open-in-new-tab";
                appendOpenInNewTabIcon(openLink);
                linkGroup.appendChild(openLink);
            }

            dest.appendChild(linkGroup);
        } else if (empty) {
            dest.textContent = "—";
            dest.classList.add("kv-empty");
            const unknown = translate("unknown");
            dest.setAttribute("title", unknown);
        } else {
            appendTextWithHttpLinks(dest, pairObj.value);
        }
    }

    function decorateRenderedKey(keyElement, pairObj) {
        if (typeof decorateKeyElement === "function") {
            decorateKeyElement(keyElement, pairObj);
        }
    }

    function applyPairColumnClass(pairElement, pairObj) {
        const columnClass = String(pairObj?.columnClass || "").trim();
        if (columnClass) {
            pairElement.classList.add(columnClass);
        }
    }

    function createInlineElements(pairObj) {

        const keySp = document.createElement("span");
        keySp.className = "kv-key";
        keySp.textContent = pairObj.labelText || pairObj.key;
        keySp.dataset.langKey = pairObj.labelKey || pairObj.key;

        const valSp = document.createElement("span");
        valSp.className = "kv-value";
        fillValueElement(valSp, pairObj);

        if (isEmptyValue(pairObj?.value)) {
            keySp.classList.add("kv-empty");
        }

        decorateRenderedKey(keySp, pairObj);

        return [keySp, valSp];
    }

    function createStackedElement(pairObj) {

        const wrap = document.createElement("div");
        wrap.className = "kv-pair-stacked";
        applyPairColumnClass(wrap, pairObj);

        const keyDiv = document.createElement("div");
        keyDiv.className = "kv-key";
        keyDiv.textContent = pairObj.labelText || pairObj.key;
        keyDiv.dataset.langKey = pairObj.labelKey || pairObj.key;

        const valDiv = document.createElement("div");
        valDiv.className = "kv-value";
        fillValueElement(valDiv, pairObj);

        if (isEmptyValue(pairObj?.value)) {
            keyDiv.classList.add("kv-empty");
        }

        decorateRenderedKey(keyDiv, pairObj);

        wrap.appendChild(keyDiv);
        wrap.appendChild(valDiv);
        applyLabelValueLayout(wrap, keyDiv, valDiv, pairObj?.labelMeta?.label_value_layout);
        return wrap;
    }

    /**
     * Luo "conditional"-tyyppisen elementin, joka käyttää älykästä rivityslogiikkaa.
     * Tämä perustuu docs/design_ideas/2025-11-30--container-text-cutter-query.html -demoon.
     * Arvo sijoitetaan avaimen viereen jos mahtuu, muuten pudotetaan omalle rivilleen.
     */
    function createConditionalElement(pairObj) {

        const wrap = document.createElement("div");
        wrap.className = "kv-pair-conditional kv-smart-row";
        applyPairColumnClass(wrap, pairObj);

        const keyDiv = document.createElement("div");
        keyDiv.className = "kv-key kv-conditional-key";
        keyDiv.textContent = pairObj.labelText || pairObj.key;
        keyDiv.dataset.langKey = pairObj.labelKey || pairObj.key;

        const valDiv = document.createElement("span");
        valDiv.className = "kv-value kv-conditional-value";
        fillValueElement(valDiv, pairObj);

        if (isEmptyValue(pairObj?.value)) {
            keyDiv.classList.add("kv-empty");
        }

        decorateRenderedKey(keyDiv, pairObj);

        wrap.appendChild(keyDiv);
        wrap.appendChild(valDiv);
        wrap._kvKeyElement = keyDiv;
        wrap._kvValueElement = valDiv;
        wrap._kvValueText = pairObj?.value ?? "";
        wrap._kvHasLink = pairObj?.isLink === true && !isEmptyValue(pairObj?.value);
        applyLabelValueLayout(wrap, keyDiv, valDiv, pairObj?.labelMeta?.label_value_layout);
        return wrap;
    }


    return { createInlineElements, createStackedElement, createConditionalElement, applyPairColumnClass };
}
