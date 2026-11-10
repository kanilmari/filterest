// row_presentation_split_button.js
// Builds the view picker's joined Article split button: a primary action plus a chevron menu.
// Bridges the stored presentation choice, the classic Article view path and the image-first opener.
// Exists so the person chooses how a row opens without a new per-row button.
//
// The primary button keeps the Article button's identity (`view-btn-article_view`,
// `unified-view-button`, data-view-key) so the picker's active highlight and the
// existing helpers keep working. Its caption is the chosen presentation; a click
// opens that presentation. Article goes through the unchanged classic path
// (`selectArticle`); IFAV and Page open lazily through row_presentation_opener.js.

import { createMaskIconSpan } from "../../../icons/icon_mask_builder.js";
import { createAnchoredActionMenu } from "../../../reusable_components/action_menu/anchored_action_menu.js";
import { showArticleViewAccessDenied } from "../card_view/article_view_access.js";
import { ROW_OPENING_DEFAULTS_CHANGED } from "../dataset_appearance_state.js";
import { ARTICLE_VIEW_KEY } from "../dataset_view_registry.js";
import {
    ROW_PRESENTATION_MENU_LANG_KEY,
    beginRowPresentationRequest,
    getRowPresentationLabel,
    getRowPresentationLangKey,
    getRowPresentationMenuLabel,
    listPermittedRowPresentations,
    readRowOpeningChoice,
    getStoredRowPresentation,
    resetRowPresentationChoice,
    getUseRowPresentationDefaultLabel,
    setRowPresentationChoice,
    showRowPresentationFailed,
} from "./row_presentation_choice.js";

const CHEVRON_ICON = "/frontend/icons/general/chevron-down-icon.svg";

async function openPresentationLazily(options) {
    const { openChosenRowPresentation } = await import("./row_presentation_opener.js");
    return openChosenRowPresentation(options);
}

function syncDatasetSplitButtons(tableName) {
    document.querySelectorAll(".row-presentation-split").forEach(wrapper => {
        if (!tableName || wrapper.dataset.tableName === tableName) wrapper.refreshRowPresentation?.();
    });
}
document.addEventListener(ROW_OPENING_DEFAULTS_CHANGED, event => syncDatasetSplitButtons(event.detail?.name));

/**
 * @param {Object} options
 * @param {string} options.tableName
 * @param {boolean} [options.isActive] whether the Article view is the active dataset view.
 * @param {() => void} options.selectArticle the picker's existing classic Article selection.
 * @param {(options: {tableName: string, viewKey: string, isRequestCurrent: () => boolean}) => Promise<unknown>} [options.openPresentation]
 * @returns {HTMLDivElement}
 */
export function createRowPresentationSplitButton({
    tableName,
    isActive = false,
    selectArticle,
    openPresentation = openPresentationLazily,
    resolveDefaults = async (name, options) => (await import("./row_presentation_dispatcher.js")).resolveRowOpening(name, options),
} = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "row-presentation-split";
    wrapper.dataset.testid = "row-presentation-split";
    wrapper.dataset.tableName = tableName;

    const primary = document.createElement("button");
    primary.type = "button";
    primary.classList.add("unified-view-button", "fw-btn", "row-presentation-split__primary");
    primary.dataset.testid = `view-btn-${ARTICLE_VIEW_KEY}`;
    primary.dataset.tableName = tableName;
    primary.dataset.viewKey = ARTICLE_VIEW_KEY;
    primary.classList.toggle("active", isActive);
    primary.setAttribute("aria-pressed", isActive ? "true" : "false");
    wrapper.append(primary);

    let pendingActivation = null;
    const activate = (explicitView = null) => {
        const isRequestCurrent = beginRowPresentationRequest(tableName);
        pendingActivation = isRequestCurrent;
        const open = (choice) => {
            if (!isRequestCurrent()) return;
            if (choice.status !== "resolved") {
                if (choice.status === "failed") showRowPresentationFailed();
                if (choice.status === "denied") showArticleViewAccessDenied();
                return;
            }
            if (choice.viewKey === ARTICLE_VIEW_KEY) {
                selectArticle?.();
                return;
            }
            return openPresentation({ tableName, viewKey: choice.viewKey, isRequestCurrent });
        };
        const choice = readRowOpeningChoice(tableName, { viewKey: explicitView });
        if (choice.viewKey === ARTICLE_VIEW_KEY) {
            wrapper.removeAttribute("aria-busy");
            open(choice);
            return;
        }
        wrapper.setAttribute("aria-busy", "true");
        Promise.resolve().then(() => choice.status === "pending"
            ? resolveDefaults(tableName, { isCurrent: isRequestCurrent }) : choice)
            .then(open)
            .catch(error => {
                console.warn("row presentation failed", error?.message || error);
                if (isRequestCurrent()) showRowPresentationFailed();
            }).finally(() => {
                if (pendingActivation === isRequestCurrent) wrapper.removeAttribute("aria-busy");
            });
    };
    primary.addEventListener("click", () => activate());

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.classList.add("fw-btn", "row-presentation-split__toggle");
    toggle.dataset.testid = "row-presentation-toggle";
    toggle.dataset.tableName = tableName;
    const menuLabel = getRowPresentationMenuLabel();
    toggle.setAttribute("aria-label", menuLabel);
    toggle.dataset.ariaLabelLangKey = ROW_PRESENTATION_MENU_LANG_KEY;
    const icon = createMaskIconSpan(CHEVRON_ICON, ["row-presentation-split__chevron"]);
    icon.setAttribute("aria-hidden", "true");
    toggle.append(icon);
    const refresh = () => {
        const permitted = listPermittedRowPresentations(tableName);
        const choice = readRowOpeningChoice(tableName, { permitted });
        wrapper.style.display = permitted.length ? "" : "none";
        wrapper.classList.toggle("permission-hidden", !permitted.length);
        primary.dataset.presentation = choice.viewKey || "";
        primary.dataset.langKey = choice.viewKey ? getRowPresentationLangKey(choice.viewKey) : ROW_PRESENTATION_MENU_LANG_KEY;
        primary.textContent = choice.viewKey ? getRowPresentationLabel(choice.viewKey) : getRowPresentationMenuLabel();
        primary.disabled = choice.status === "denied";
        // A Page-only user may still select Page explicitly when every inherited candidate is denied.
        const needsMenu = permitted.length > 1 || (permitted.length && (getStoredRowPresentation(tableName) || !choice.viewKey));
        if (needsMenu && toggle.parentElement !== wrapper) wrapper.append(toggle);
        if (!needsMenu) toggle.remove();
    };
    wrapper.refreshRowPresentation = refresh;
    refresh();

    const menu = createAnchoredActionMenu({
        trigger: toggle,
        anchor: wrapper,
        owner: wrapper,
        menuLabel,
        menuLabelLangKey: ROW_PRESENTATION_MENU_LANG_KEY,
        testid: "row-presentation-menu",
        // Grants are read again at every opening.
        buildItems: () => {
            const stored = getStoredRowPresentation(tableName);
            const items = listPermittedRowPresentations(tableName).map(viewKey => ({
                value: viewKey, label: getRowPresentationLabel(viewKey),
                langKey: getRowPresentationLangKey(viewKey), checked: viewKey === stored,
            }));
            items.push({
                value: "inherit", label: getUseRowPresentationDefaultLabel(),
                langKey: "row_presentation_use_default", checked: !stored,
            });
            return items;
        },
        onSelect: (viewKey) => {
            if (viewKey === "inherit") resetRowPresentationChoice(tableName);
            else if (listPermittedRowPresentations(tableName).includes(viewKey)) setRowPresentationChoice(tableName, viewKey);
            syncDatasetSplitButtons(tableName);
            // A presentation that opens a modal returns focus here when it closes.
            // The filterbar panel stays open for a choice in this body-mounted
            // menu (filterbar_outside_panel_close.js), so the primary stays rendered.
            primary.focus({ preventScroll: true });
            activate(viewKey === "inherit" ? null : viewKey);
        },
    });
    wrapper.__rowPresentationMenu = menu;
    return wrapper;
}
