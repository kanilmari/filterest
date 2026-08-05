// history_navigation_handler.js
// Responds to browser popstate events and restores the correct table or view state.
// Bridges the History API with the navigation engine (handle_all_navigation, setUnifiedTableState).
// Exists to decouple history restoration logic from the main navigation entry point.

import { custom_views } from '../admin_and_user_tools/custom_view_reader.js';
import { setParams, DATASET_PREFIX, parseTableQueryString } from './query_params.js';
import { handle_all_navigation } from './navigation_handler.js';
import {
    getUnifiedTableState,
    setUnifiedTableState,
} from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { closeBigCard } from '../../table_views/card_view/row_article_ui_handler.js';
import {
    ARTICLE_VIEW_KEY,
    resolveDatasetViewSelectionTarget,
} from '../../table_views/dataset_view_registry.js';
import {
    getPrefixFromPathname,
    parseDeepLink,
    buildParamsFromParsed,
    isDatasetBasePath,
} from './history_navigation_handler_helpers.js';

function applyParsedUrlState(datasetName, parsed) {
    const params = buildParamsFromParsed(parsed);
    setParams(datasetName, params);

    if (parsed.view) {
        localStorage.setItem(
            `${datasetName}_view`,
            resolveDatasetViewSelectionTarget(parsed.view)
        );
    }

    return params;
}

function clearClosedArticleState(datasetName) {
    setUnifiedTableState(datasetName, {
        cardView: {
            collapsed: false,
            expandedId: null,
            pendingAutoOpenFirstRenderedResult: false,
            pendingAutoOpenFirstSearchResult: false,
        },
    });
}

async function restoreDatasetBasePathState(datasetName) {
    const parsed = parseTableQueryString(window.location.search);
    applyParsedUrlState(datasetName, parsed);

    if (await restoreArticleReturnView(datasetName)) {
        return true;
    }

    clearClosedArticleState(datasetName);
    if (parsed.view && parsed.view !== ARTICLE_VIEW_KEY) {
        await handle_all_navigation(datasetName, custom_views, {
            skipUrlUpdate: true,
            forceReload: true,
        });
        return true;
    }

    return false;
}

function getArticleReturnView(datasetName) {
    const returnView = getUnifiedTableState(datasetName)?.cardView?.returnView;
    return typeof returnView === 'string' && returnView && returnView !== 'card'
        ? returnView
        : null;
}

async function restoreArticleReturnView(datasetName) {
    const returnView = getArticleReturnView(datasetName);
    if (!returnView) {
        return false;
    }

    localStorage.setItem(`${datasetName}_view`, returnView);
    setUnifiedTableState(datasetName, {
        cardView: {
            collapsed: false,
            expandedId: null,
            returnView: null,
        },
    });
    await handle_all_navigation(datasetName, custom_views, {
        skipUrlUpdate: true,
        forceReload: true,
    });
    return true;
}

window.addEventListener('popstate', async () => {
    // If a big card is open, close it first to clean up DOM and restore scroll
    const openCardWrapper = document.querySelector('.card_view_wrapper.big-card-open');
    if (openCardWrapper) {
        const activeBigCard = openCardWrapper.querySelector('.active_row_article, .active_big_card');
        const cardContainer = openCardWrapper.querySelector('.card_container');
        const baseDataset =
            openCardWrapper.dataset?.tableName ||
            activeBigCard?._table_name ||
            null;

        if (activeBigCard && cardContainer) {
            // skipHistoryBack avoids an extra history.back() because popstate already moved history
            closeBigCard(openCardWrapper, cardContainer, activeBigCard, null, baseDataset, true);
        } else {
            // Fallback: ensure wrapper isn't stuck in open state
            openCardWrapper.classList.remove('big-card-open');
        }

        // If we navigated back within the same dataset, no further navigation is needed
        const pathAfterPop = window.location.pathname;
        if (baseDataset && isDatasetBasePath(pathAfterPop, DATASET_PREFIX, baseDataset)) {
            window.__bigCardClosing = false; // ensure flag reset if it was set elsewhere
            if (await restoreDatasetBasePathState(baseDataset)) {
                return;
            }
            return;
        }
    }
    // If closeBigCard triggered history.back(), skip re-navigation
    // because the card DOM is already cleaned up.
    if (window.__bigCardClosing) {
        window.__bigCardClosing = false;
        const pathAfterClose = window.location.pathname;
        const closePrefix = getPrefixFromPathname(pathAfterClose, DATASET_PREFIX);
        if (closePrefix) {
            const { name: closedDatasetName } = parseDeepLink(pathAfterClose.slice(closePrefix.length));
            if (
                closedDatasetName
                && isDatasetBasePath(pathAfterClose, DATASET_PREFIX, closedDatasetName)
                && await restoreDatasetBasePathState(closedDatasetName)
            ) {
                return;
            }
        }
        return;
    }
    const path = window.location.pathname;
    const prefix = getPrefixFromPathname(path, DATASET_PREFIX);
    if (!prefix) return;

    const rawName = path.slice(prefix.length);
    const { name, deepLinkedRowId } = parseDeepLink(rawName);

    const parsed = parseTableQueryString(window.location.search);
    applyParsedUrlState(name, parsed);

    // Pre-set cardView state to auto-open big card after data loads
    if (deepLinkedRowId) {
        setUnifiedTableState(name, {
            cardView: { collapsed: true, expandedId: deepLinkedRowId }
        });
    } else {
        clearClosedArticleState(name);
    }

    await handle_all_navigation(name, custom_views, {
        skipUrlUpdate: true,
        forceReload: Boolean(deepLinkedRowId),
    });
});
