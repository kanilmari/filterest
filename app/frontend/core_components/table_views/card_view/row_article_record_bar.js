// row_article_record_bar.js
// Places previous, next and close above the ordinary article title on every screen.
// Uses only neighbours in the displayed result list and the existing article dismissal path.
import { buildRowArticleRowNavigation } from "./row_article_presentation.js";
import { buildSharedTopBarArticleCloseButton } from "../../filterbar/filterbar_heading_builder.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";
import { createMaskIconSpan } from "../../../icons/icon_mask_builder.js";

const controllers = new WeakMap();

/** Mounts or refreshes one article's bar after its scrolling content is connected. */
export function syncRowArticleRecordBar(content, context = {}) {
    if (!(content instanceof HTMLElement) || !content.isConnected) return;
    let controller = controllers.get(content);
    if (!controller) {
        controller = createRecordBar(content, context);
        controllers.set(content, controller);
    }
    controller.update(context);
}

/** Releases viewport and result-list observation before an article is discarded. */
export function disposeRowArticleRecordBar(content) {
    controllers.get(content)?.dispose();
    controllers.delete(content);
}

function createRecordBar(content, initialContext) {
    let context = initialContext, navigation = null, resultCards = [], disposed = false;
    const bar = document.createElement("nav");
    bar.className = "row_article_record_bar";
    bar.dataset.testid = "row-article-record-bar";
    bar.dataset.ariaLabelLangKey = "article_records";
    bar.setAttribute("aria-label", getTranslationForKey("article_records"));
    // Keep the top bar's long close meaning and its existing dismissal path.
    const close = buildSharedTopBarArticleCloseButton(() => {
        const article = content.closest(".active_row_article, .active_big_card");
        const legacyClose = article?.querySelector(".big_card_close");
        const sharedClose = document.getElementById(`${context.tableName}_container`)
            ?.querySelector('[data-testid="shared-topbar-article-close"]');
        (legacyClose || sharedClose)?.click();
    });
    close.className = "row_article_record_bar_cell";
    close.dataset.testid = "row-article-record-bar-close";
    close.removeAttribute("aria-hidden");
    // The shared builder keeps the top-bar button out of the tab order; this Close is a normal tab stop.
    close.tabIndex = 0;
    close.hidden = false;
    close.replaceChildren(createMaskIconSpan("/frontend/icons/general/modal-close-icon.svg", ["row_article_record_bar_icon"]));
    const closeLabel = document.createElement("span");
    closeLabel.dataset.langKey = "close";
    closeLabel.textContent = getTranslationForKey("close");
    close.append(closeLabel);
    bar.append(close);
    content.prepend(bar);

    const canInteract = () => !disposed && content.isConnected && context.canCommit?.() !== false;
    async function navigate(row, card) {
        if (!canInteract() || navigation.getAttribute("aria-busy") === "true") return;
        const activeNavigation = navigation;
        activeNavigation.setAttribute("aria-busy", "true");
        try {
            const { openRowArticleView } = await import("./row_article_opener.js");
            if (canInteract()) await openRowArticleView(row, context.tableName, card);
        } catch (error) {
            console.warn("Article record navigation failed:", error?.message || error);
        } finally { activeNavigation.removeAttribute("aria-busy"); }
    }

    let cardContainer = null;
    let currentRowId;
    const listObserver = new MutationObserver(refreshNavigation);
    function refreshNavigation() {
        const cards = Array.from(cardContainer?.querySelectorAll(":scope > .card[data-id]") || []);
        const rowId = context.rowItem?.id;
        if (navigation && currentRowId === rowId && cards.length === resultCards.length
            && cards.every((card, index) => card === resultCards[index])) return;
        currentRowId = rowId;
        resultCards = cards;
        const updated = buildRowArticleRowNavigation({
            cardContainer, currentRowId: rowId, onNavigate: navigate,
            allowUnavailable: true, showLabels: true,
        });
        if (!navigation) {
            navigation = updated;
            // The bar is the landmark; its row buttons form a plain group with their own
            // test id, so IFAV's navigation stays the only row-article-row-navigation.
            navigation.setAttribute("role", "group");
            navigation.removeAttribute("aria-label");
            delete navigation.dataset.ariaLabelLangKey;
            navigation.dataset.testid = "row-article-record-bar-rows";
            close.before(navigation);
            return;
        }
        const focusedId = navigation.contains(document.activeElement) ? document.activeElement.dataset.testid : null;
        navigation.replaceChildren(...updated.childNodes);
        if (focusedId) navigation.querySelector(`[data-testid="${focusedId}"]`)?.focus({ preventScroll: true });
    }
    // A dataset can be removed as a whole without a final hydration callback.
    const connectionObserver = new MutationObserver(() => {
        if (!content.isConnected) disposeRowArticleRecordBar(content);
    });
    for (let node = content; node; node = node.parentNode) connectionObserver.observe(node, { childList: true });
    return {
        update(nextContext) {
            context = nextContext;
            const nextContainer = context.selectedCard?.closest?.(".card_container") || null;
            if (nextContainer !== cardContainer) {
                listObserver.disconnect();
                cardContainer = nextContainer;
                if (cardContainer) listObserver.observe(cardContainer, { childList: true });
            }
            refreshNavigation();
        },
        dispose() {
            disposed = true;
            listObserver.disconnect();
            connectionObserver.disconnect();
            navigation?.remove();
            bar.remove();
        },
    };
}
