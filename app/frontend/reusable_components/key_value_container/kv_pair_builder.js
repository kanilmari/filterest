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

/**
 * The arrangements a caller's key hook may state for one pair: leave the name
 * out, put it on the value's line, or keep it on its own line above the value.
 */
const STATED_LABEL_PLACEMENTS = new Set(["hidden", "inline", "stacked"]);
const HIDDEN_LABEL_PLACEMENT = "hidden";

/**
 * Read the arrangement the caller's key hook stated, if it stated one.
 * This component never decides the arrangement itself; without a stated one the
 * pair keeps the column's own setting and this renderer's existing behaviour.
 */
function readStatedLabelPlacement(decoration) {
    const stated = String(decoration?.labelPlacement || "").trim().toLowerCase();
    return STATED_LABEL_PLACEMENTS.has(stated) ? stated : null;
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


/**
 * Build one renderer's pair factories with its localized copy and key decoration.
 *
 * @param {object} options
 * @param {Function} options.translate - the caller's translation lookup
 * @param {Function|null} [options.decorateKeyElement] - the caller's key hook. It
 *   decorates the key element, and it may return `{labelPlacement}` — `hidden`,
 *   `inline` or `stacked` — to state where that field's name belongs. The caller
 *   owns that decision; these factories only apply it, and fall back to the
 *   column's own `label_value_layout` setting when nothing is stated. A stated
 *   placement is repeated on the pair as `data-card-label-placement`, which is
 *   the caller's own marker: its stylesheet is what dresses the arrangement.
 */
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
            return readStatedLabelPlacement(decorateKeyElement(keyElement, pairObj));
        }
        return null;
    }

    /**
     * The arrangement this pair is drawn with. A stated placement wins, because it
     * was read from the column; otherwise the column's own setting applies as before.
     * A hidden name leaves the value alone in the pair's single column.
     */
    function resolvePairLayout(statedPlacement, pairObj) {
        if (statedPlacement === HIDDEN_LABEL_PLACEMENT) return "inline";
        return statedPlacement || pairObj?.labelMeta?.label_value_layout;
    }

    function applyPairColumnClass(pairElement, pairObj) {
        const columnClass = String(pairObj?.columnClass || "").trim();
        if (columnClass) {
            pairElement.classList.add(columnClass);
        }
    }

    /** DEPRECATED inline mode: key and value share a 50/50 grid cell. */
    function createInlineElement(pairObj) {

        const wrap = document.createElement("div");
        wrap.className = "kv-pair-inline";
        applyPairColumnClass(wrap, pairObj);
        wrap.style.display = "grid";
        wrap.style.gridTemplateColumns = "1fr 1fr";

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

        const placement = decorateRenderedKey(keySp, pairObj);
        const showsName = placement !== HIDDEN_LABEL_PLACEMENT;

        if (placement) wrap.dataset.cardLabelPlacement = placement;
        if (showsName) wrap.appendChild(keySp);
        wrap.appendChild(valSp);
        applyLabelValueLayout(
            wrap, showsName ? keySp : null, valSp, resolvePairLayout(placement, pairObj)
        );
        return wrap;
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

        const placement = decorateRenderedKey(keyDiv, pairObj);
        const showsName = placement !== HIDDEN_LABEL_PLACEMENT;

        if (placement) wrap.dataset.cardLabelPlacement = placement;
        if (showsName) wrap.appendChild(keyDiv);
        wrap.appendChild(valDiv);
        applyLabelValueLayout(
            wrap, showsName ? keyDiv : null, valDiv, resolvePairLayout(placement, pairObj)
        );
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

        const placement = decorateRenderedKey(keyDiv, pairObj);
        const showsName = placement !== HIDDEN_LABEL_PLACEMENT;

        if (placement) wrap.dataset.cardLabelPlacement = placement;
        if (showsName) wrap.appendChild(keyDiv);
        wrap.appendChild(valDiv);
        // A pair whose arrangement the caller stated is not measured: the smart
        // wrap below reads one row's own text, and that must never move a name.
        wrap._kvKeyElement = showsName ? keyDiv : null;
        wrap._kvValueElement = valDiv;
        wrap._kvValueText = pairObj?.value ?? "";
        wrap._kvHasLink = pairObj?.isLink === true && !isEmptyValue(pairObj?.value);
        applyLabelValueLayout(
            wrap, showsName ? keyDiv : null, valDiv, resolvePairLayout(placement, pairObj)
        );
        return wrap;
    }


    return { createInlineElement, createStackedElement, createConditionalElement };
}
