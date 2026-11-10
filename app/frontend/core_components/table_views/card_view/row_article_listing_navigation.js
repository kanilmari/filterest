// row_article_listing_navigation.js
// Builds the target listing before an adapter opens its requested article.
// Uses the ordinary navigation pipeline, with row opening owned by the caller.
// Keeping this policy on the refresh lets concurrent same-table visits act independently.
import { deferFirstRowToRequest, keepExplicitRowListingCurrent } from './first_listed_row.js';
import { getSelectedDataset } from '../../state_stores/dataset_selection_saver.js';
import { setUnifiedTableState } from '../../state_stores/table_state_store.js';

/** Clear an old open row and leave the next ordinary visit ready to pick its first result. */
export async function navigateToExplicitRowListing(dataset, options) {
    setUnifiedTableState(dataset, {
        articleView: { collapsed: true, expandedId: null, returnView: 'card',
            pendingAutoOpenFirstRenderedResult: true, pendingAutoOpenFirstSearchResult: false },
    });
    const [{ handle_all_navigation }, { custom_views }] = await Promise.all([
        import('../../navigation/nav_engine/navigation_handler.js'),
        import('../../navigation/admin_and_user_tools/custom_view_reader.js'),
    ]);
    return handle_all_navigation(dataset, custom_views, { ...options, isCurrentNavigation: keepExplicitRowListingCurrent });
}

/** Compact links also select and focus the target tab after successful navigation. */
export async function openExplicitRowListingTab(dataset, options) {
    const result = await navigateToExplicitRowListing(dataset, options);
    if (!result?.abort) {
        const { openNavTab } = await import('../../navigation/main_tabs/main_tab_printer.js');
        await openNavTab(dataset, { skipNavigation: true });
    }
    return result;
}

/** Navigate normally, then let only the still-current activation open its row. */
export async function openArticleAfterListing(row, dataset, navigate, { isCurrent, isLatestRequest, withOwnAddressWrite }) {
    let navigating = true;
    const currentArticle = () => isCurrent() && getSelectedDataset() === dataset;
    const release = deferFirstRowToRequest(dataset, () => navigating ? isLatestRequest() : currentArticle());
    try {
        const result = await withOwnAddressWrite(navigate);
        navigating = false;
        if (result?.abort || !currentArticle()) return;
        const { openRowArticleView } = await import('./row_article_opener.js');
        if (currentArticle()) {
            await openRowArticleView(row, dataset, null, { isCurrent: currentArticle, withOwnAddressWrite });
        }
    } finally {
        release();
    }
}
