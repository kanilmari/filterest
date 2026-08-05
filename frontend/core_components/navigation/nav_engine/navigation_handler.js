// navigation_handler.js
// Orchestrates core navigation: URL updates, view rendering, and dataset state changes.
// Bridges navigation events and view/dataset state via the declarative navigation pipeline.
// Exists to serve as the single entry point for all in-app navigation so every path runs the same pipeline stages.

import { refreshTableUnified } from '../../general_tables/gt_1_row_crud/gt_1_2_row_read/table_refresh_unified.js';
import { applyViewStyling } from '../../table_views/view_selector_printer.js';
import { setSelectedDataset, getSelectedDataset } from '../../state_stores/dataset_selection_saver.js';
import { getParams, DATASET_PREFIX, useStorageParams, useUrlParams } from './query_params.js';
import { update_recently_viewed_list, update_recently_viewed_status } from './recent_tab_saver.js';
import { update_active_heading } from './active_heading_updater.js';
import { runNavigationPipeline } from '../../pipeline/navigation_pipeline.js';
import { destroy_chat } from '../../ai_features/table_chat/table_chat_printer.js';
import { clearSSEActiveDataset, setSSEActiveDataset } from '../../endpoints/sse_subscriber.js';
import { setSidebarGroupExpandedState } from '../database_tree/nav_collapsible_state.js';
import {
    applyMainTabActiveState,
    clearMainTabActiveState,
} from '../main_tabs/main_tab_active_state.js';
import { ensure_private_custom_views_loaded } from '../admin_and_user_tools/custom_view_reader.js';

export async function handle_all_navigation(name, customViews, options = {}) {
    const { skipUrlUpdate = false, forceReload = false } = options;
    await ensure_private_custom_views_loaded();
    const arrayOfViews = customViews || [];

    // 1) Selvitetään, onko kyseessä custom_view vai normaali taulu
    const { loadFunction, containerId, isCustomView } = get_load_info(name, arrayOfViews);

    // 2) Etsitään ryhmä navigaationapeille
    let groupName = null;
    const foundView = arrayOfViews.find(v => v.name === name);
    if (foundView && foundView.group) {
        groupName = foundView.group;
    }

    useStorageParams();
    const params = getParams(name);
    const prefix = groupName === 'admin_tools' ? '/admin/' : DATASET_PREFIX;

    // 3) Pipeline: dirtyCheck → urlUpdate → viewRender
    // _performNavigationCore is injected to avoid circular import with navigation_pipeline.js
    const context = {
        name,
        containerId,
        loadFunction,
        groupName,
        isCustomView,
        params,
        prefix,
        skip: skipUrlUpdate ? ['urlUpdate'] : [],
        _performNavigationCore: (
            targetName,
            targetContainerId,
            targetLoadFunction,
            targetGroupName,
            targetIsCustomView
        ) => _performNavigationCore(
            targetName,
            targetContainerId,
            targetLoadFunction,
            targetGroupName,
            targetIsCustomView,
            forceReload
        ),
    };

    try {
        await runNavigationPipeline(context);
    } finally {
        // 4) Palautetaan URL-parametrien käyttö (runs even if pipeline aborts)
        useUrlParams();
    }
}

// performNavigation — public API for direct navigation without the full pipeline.
// Kept for backwards compatibility. Includes an inline dirty check for callers
// that bypass handle_all_navigation.
export async function performNavigation(data_lang_key, container_id, load_function, groupName, isCustomView = false) {
    if (typeof window.check_manage_permissions_dirty === 'function') {
        const ok = await window.check_manage_permissions_dirty();
        if (!ok) return;
    }
    await _performNavigationCore(data_lang_key, container_id, load_function, groupName, isCustomView);
}

// _performNavigationCore — pure navigation renderer: button highlight, container switch,
// lazy load, session storage update, and view styling. No dirty check.
// Called by the navigation pipeline's viewRender stage via context injection.
async function _performNavigationCore(
    data_lang_key,
    container_id,
    load_function,
    groupName,
    isCustomView,
    forceReload = false
) {
    // Poistetaan vanhan aktiivisen napin korostus (sekä nav- että admin-puusta)
    const old_active_button = document.querySelector('.general_button_nav.active, .general_button_admin.active');
    if (old_active_button) {
        const old_key = old_active_button.dataset.langKey;
        update_recently_viewed_list(old_key);
        old_active_button.classList.remove('active');
    }

    update_recently_viewed_list(data_lang_key);

    // Korostetaan oikea nappi — sekä tietokanta- (.general_button_nav) että admin-puusta (.general_button_admin)
    const navigation_buttons = document.querySelectorAll('.general_button_nav, .general_button_admin');
    navigation_buttons.forEach(button => {
        if (button.dataset.langKey === data_lang_key) {
            button.classList.add('active');

            if (shouldAutoExpandNavigationBranch(button)) {
                _ensureAdminTreeBranchOpen(button);
            }
        } else {
            button.classList.remove('active');
        }
    });

    // Cleanup: close any active chat SSE connections for the previous dataset
    const previousDataset = getSelectedDataset();
    if (previousDataset && previousDataset !== data_lang_key) {
        destroy_chat(previousDataset);
    }

    // Cleanup: call __cleanupListeners on containers that define it (e.g. manage_permissions)
    const all_containers = document.querySelectorAll('#tabs_container > .content_div');
    all_containers.forEach(container_element => {
        if (typeof container_element.__cleanupListeners === 'function') {
            container_element.__cleanupListeners();
        }
        container_element.classList.add('hidden');
    });

    let container_element = document.getElementById(container_id);
    if (!container_element) {
        await load_function();
        container_element = document.getElementById(container_id);
    } else if (forceReload || !container_element.hasChildNodes()) {
        await load_function();
    }
    if (container_element) {
        container_element.classList.remove('hidden');
    }

    update_active_heading(groupName);

    if (!isCustomView) {
        setSelectedDataset(data_lang_key);
        setSSEActiveDataset(data_lang_key);
        applyMainTabActiveState(data_lang_key, { viewDatasetName: data_lang_key });
    } else {
        clearSSEActiveDataset();
        clearMainTabActiveState(data_lang_key);
    }
    applyViewStyling(data_lang_key);

    update_recently_viewed_status();
}

function shouldAutoExpandNavigationBranch(buttonEl) {
    if (buttonEl.closest('#admin_tools_tree')) {
        return true;
    }
    if (buttonEl.closest('#nav_tree')) {
        return window.easelectNavbarSettings?.autoExpandDatabaseTreeOnNavigation === true;
    }
    return false;
}

// _ensureAdminTreeBranchOpen — avataa admin-puun haara (ja collapsible-otsikko)
// jossa aktiivinen nappi sijaitsee, jotta käyttäjä näkee aktiivisen välilehden.
function _ensureAdminTreeBranchOpen(buttonEl) {
    // Open every ancestor tree branch through the shared tree toggle path so
    // the chevron direction always matches the actual expanded state.
    let ancestor = buttonEl.closest('.children');
    while (ancestor) {
        const parentNode = ancestor.closest('.node');
        const toggle = parentNode?.querySelector(':scope > .node-row > .toggle');
        const isExpanded = toggle?.getAttribute('aria-expanded') === 'true'
            || parentNode?.dataset.expanded === 'true'
            || ancestor.hidden === false;

        if (!isExpanded) {
            if (toggle instanceof HTMLElement) {
                toggle.click();
            } else if (ancestor instanceof HTMLElement && parentNode instanceof HTMLElement) {
                ancestor.hidden = false;
                ancestor.style.height = 'auto';
                ancestor.dataset.collapsibleState = 'expanded';
                parentNode.dataset.expanded = 'true';
            }
        }

        ancestor = parentNode?.parentElement?.closest('.children') || null;
    }

    // Avataan myös sidebar-ryhmäotsikko (admin_tools) jos kiinni.
    const adminTree = buttonEl.closest('#admin_tools_tree');
    if (adminTree) {
        const contentDiv = adminTree.closest('.navbar-disclosure-content, .content');
        if (contentDiv instanceof HTMLElement) {
            const disclosureSection = contentDiv.closest('.animated-disclosure-section');
            const disclosureHeader = disclosureSection?.querySelector(':scope > .animated-disclosure-header');
            const legacyCollapsible = contentDiv.previousElementSibling;
            const toggleButton = disclosureHeader instanceof HTMLElement
                ? disclosureHeader
                : legacyCollapsible;

            setSidebarGroupExpandedState(toggleButton, contentDiv, true);
        }
    }
}

export function get_load_info(name, custom_views) {
    const custom_view = custom_views.find(view => view.name === name);
    if (custom_view) {
        return {
            loadFunction: custom_view.loadFunction,
            containerId: custom_view.containerId,
            isCustomView: true
        };
    } else {
        return {
            loadFunction: () => {
                return refreshTableUnified(name);
            },
            containerId: `${name}_container`,
            isCustomView: false
        };
    }
}
