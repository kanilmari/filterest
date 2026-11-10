// row_article_related_record_opener.js
// Hands a related-row activation from its parent article to the target dataset.
// Bridges ordinary navigation and the guarded classic article opener.
// Keeps row opening explicit so a stale request cannot open an article during listing load.

import { openDefaultRowPresentation } from "../row_presentation/row_presentation_dispatcher.js";
import { navigateToExplicitRowListing, openArticleAfterListing } from './row_article_listing_navigation.js';
import { setChosenDatasetView } from '../../state_stores/dataset_view_choice_saver.js';
import { closeRowArticle } from './row_article_ui_handler.js';

/** Open the exact related row after navigation, while its activation still owns the request. */
export async function openRelatedRecord({
    relatedDataset, relatedRow,
    parentDataset, parentRowId,
    relatedTabsContainer,
}) {
    const relatedId = relatedRow?.id;
    if (relatedId == null) return;

    await openDefaultRowPresentation(relatedRow, relatedDataset, null, {
        search: "",
        openClassic: async (_row, _table, _card, request) => {
            const { isCurrent, withOwnAddressWrite } = request;
            if (!isCurrent()) return;
            withOwnAddressWrite(() => closeCurrentBigCard(parentDataset, parentRowId, relatedTabsContainer));
            setChosenDatasetView(relatedDataset, "article_view");
            // The listing completes independently; only this explicit article
            // opening belongs to the original request ticket.
            await openArticleAfterListing(relatedRow, relatedDataset,
                () => navigateToExplicitRowListing(relatedDataset, { forceReload: true, skipUrlUpdate: true }), request);
        },
    });
}

/** Close the parent article before a related-row or related-collection navigation. */
export function closeCurrentBigCard(parentDataset, parentRowId, relatedTabsContainer) {
    const wrapper = relatedTabsContainer.closest('.card_view_wrapper');
    const bigCard = relatedTabsContainer.closest('.active_row_article, .active_big_card');
    const cardContainer = wrapper?.querySelector('.card_container');
    const selectedCard = cardContainer?.querySelector(`.card[data-id="${parentRowId}"]`) || null;

    if (wrapper && bigCard && cardContainer) {
        closeRowArticle(wrapper, cardContainer, bigCard, selectedCard, parentDataset, true);
    }
}
