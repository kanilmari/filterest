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
import { ARTICLE_VIEW_KEY } from "../dataset_view_registry.js";
import {
    ROW_PRESENTATION_MENU_LANG_KEY,
    beginRowPresentationRequest,
    getRowPresentationLabel,
    getRowPresentationLangKey,
    getRowPresentationMenuLabel,
    listPermittedRowPresentations,
    resolveRowPresentationChoice,
    setRowPresentationChoice,
    showRowPresentationFailed,
} from "./row_presentation_choice.js";

const CHEVRON_ICON = "/frontend/icons/general/chevron-down-icon.svg";

async function openPresentationLazily(options) {
    const { openChosenRowPresentation } = await import("./row_presentation_opener.js");
    return openChosenRowPresentation(options);
}

function applyChoiceToPrimary(primary, viewKey) {
    primary.dataset.presentation = viewKey;
    primary.dataset.langKey = getRowPresentationLangKey(viewKey);
    primary.textContent = getRowPresentationLabel(viewKey);
}

/** Every split button of the dataset shows the new choice (several toolbars may coexist). */
function syncDatasetSplitButtons(tableName, viewKey) {
    document.querySelectorAll(".row-presentation-split").forEach((wrapper) => {
        if (wrapper.dataset.tableName !== tableName) return;
        const primary = wrapper.querySelector(".row-presentation-split__primary");
        if (primary) applyChoiceToPrimary(primary, viewKey);
    });
}

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

    const permitted = listPermittedRowPresentations(tableName);
    applyChoiceToPrimary(primary, resolveRowPresentationChoice(tableName, permitted) || ARTICLE_VIEW_KEY);
    if (permitted.length === 0) {
        // Same outcome as the picker's applyPermission for an ungranted view.
        wrapper.style.display = "none";
        wrapper.classList.add("permission-hidden");
        return wrapper;
    }

    let pendingActivation = null;
    const activate = (viewKey) => {
        // Issued synchronously, before Article's classic path or any lazy
        // import: the newest activation, Article included, cancels an earlier
        // IFAV or Page that has not committed. An Article that is already open
        // changes no address, so the address guard alone would not.
        const isRequestCurrent = beginRowPresentationRequest(tableName);
        pendingActivation = isRequestCurrent;
        if (viewKey === ARTICLE_VIEW_KEY) {
            wrapper.removeAttribute("aria-busy");
            selectArticle?.();
            return;
        }
        wrapper.setAttribute("aria-busy", "true");
        Promise.resolve()
            .then(() => openPresentation({ tableName, viewKey, isRequestCurrent }))
            .catch((error) => {
                // Only a failed opener import reaches here; the opener reports its own outcomes.
                console.warn("row presentation failed", error?.message || error);
                if (isRequestCurrent()) showRowPresentationFailed();
            })
            // A committed open changes the address, ending its navigation guard.
            // Busy cleanup belongs to the latest activation of this button.
            .finally(() => { if (pendingActivation === isRequestCurrent) wrapper.removeAttribute("aria-busy"); });
    };
    primary.addEventListener("click", () => activate(primary.dataset.presentation));

    if (permitted.length < 2) return wrapper;

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
    wrapper.append(toggle);

    const menu = createAnchoredActionMenu({
        trigger: toggle,
        anchor: wrapper,
        owner: wrapper,
        menuLabel,
        menuLabelLangKey: ROW_PRESENTATION_MENU_LANG_KEY,
        testid: "row-presentation-menu",
        // Grants are read again at every opening.
        buildItems: () => listPermittedRowPresentations(tableName).map((viewKey) => ({
            value: viewKey,
            label: getRowPresentationLabel(viewKey),
            langKey: getRowPresentationLangKey(viewKey),
            checked: viewKey === primary.dataset.presentation,
        })),
        onSelect: (viewKey) => {
            setRowPresentationChoice(tableName, viewKey);
            syncDatasetSplitButtons(tableName, viewKey);
            // A presentation that opens a modal returns focus here when it closes.
            // The filterbar panel stays open for a choice in this body-mounted
            // menu (filterbar_outside_panel_close.js), so the primary stays rendered.
            primary.focus({ preventScroll: true });
            activate(viewKey);
        },
    });
    wrapper.__rowPresentationMenu = menu;
    return wrapper;
}
