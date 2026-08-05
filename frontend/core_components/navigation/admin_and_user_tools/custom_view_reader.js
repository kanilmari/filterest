// custom_view_reader.js
// Defines and exports the list of custom navigation views with their loader functions.
// Bridges admin/user tool view generators and the navigation system's view-dispatch logic.
// Exists to centralise custom view registration so navigation can discover non-table views by name.

import { loadManagementView } from '../../../reusable_components/dom_container_builder.js';
import { endpoint_router } from '../../endpoints/endpoint_router.js';

// Tuodaan generaattorifunktiot, jotka rakentavat varsinaisen sisällön.
// Nämä funktiot voivat sijaita esim. eri tiedostoissa:

import { generate_foreign_keys_view } from '../../admin_tools/foreign_keys_view.js';
import { generate_permissions_form } from '../../admin_tools/permission_editor.js';
import { generate_notification_trigger_view } from '../../admin_tools/notification_triggers.js';
import { generate_table_creation_view } from '../../general_tables/gt_3_table_crud/gt_3_1_table_create/table_creator.js';
import { load_empty_rows_view } from '../../admin_tools/empty_rows_view.js';
import { generate_refresh_lang_embeddings_view } from '../../../custom_views/refresh_lang_embeddings_view.js';
import { generate_translation_helper_view } from "../../../custom_views/translation_helper_view.js";
import { generate_search_vector_maintenance_view } from '../../../custom_views/search_vector_maintenance_view.js';
import { generate_check_json_columns_view } from '../../admin_tools/json_column_checker.js';
import { generate_database_consistency_view } from '../../admin_tools/database_consistency_view.js';
import { generate_fix_media_subfolders_view } from '../../admin_tools/fix_media_subfolders_view.js';
import { generate_fk_cache_triggers_view } from '../../admin_tools/fk_cache_triggers_view.js';
import { generate_card_visibility_form } from '../../admin_tools/card_visibility_view.js';
import { generate_child_tab_config_form } from '../../admin_tools/child_tab_config_view.js';
import { generate_dataset_alias_management_view } from '../../admin_tools/dataset_alias_management_view.js';
import { generate_dataset_header_config_view } from '../../admin_tools/dataset_header_config_view.js';
import { generate_service_catalog_moderation_view } from '../../admin_tools/service_catalog_moderation_view.js';
import { generate_queen_chat_view } from '../../admin_tools/queen_chat_view.js';
import { generate_asset_linking_view } from '../../admin_tools/asset_linking/asset_linking_view.js';

// Nämä user_tools-näkymät:
import { generate_register_view } from '../../user_tools/register_tab_printer.js';
import { generate_user_view } from '../../user_tools/user_profile_printer.js';
import { generate_create_view } from '../../user_tools/asset_tab_printer.js';

/**
 * Kaikki custom-view -määrittelyt samassa listassa.
 * Jos 'name' matchaa userin klikkaamaan tabiin, handle_all_navigation
 * kutsuu alla olevaa loadFunction:ia,
 * eikä refreshTableUnified -funktiota.
 */

export const custom_views = [
    // --- ADMIN_TOOLS RYHMÄ ---
    {
        name: 'permissions',
        loadFunction: async () => {
            return loadManagementView('permissions_container', generate_permissions_form);
        },
        containerId: 'permissions_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/permissions',
    },
    {
        name: 'add_notification_trigger',
        loadFunction: async () => {
            return loadManagementView('trigger_management_container', generate_notification_trigger_view);
        },
        containerId: 'trigger_management_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/notification_triggers',
    },
    {
        name: 'foreign_keys',
        loadFunction: async () => {
            return loadManagementView('foreign_keys_container', generate_foreign_keys_view);
        },
        containerId: 'foreign_keys_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/foreign_keys',
    },
    {
        name: 'create_table',
        loadFunction: async () => {
            return loadManagementView('table_creation_container', generate_table_creation_view);
        },
        containerId: 'table_creation_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/create_table',
    },
    {
        name: 'empty_rows',
        loadFunction: async () => {
            await load_empty_rows_view();
        },
        containerId: 'empty_rows_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/empty_rows',
    },
    {
        name: 'refresh_embeddings',
        loadFunction: async () => {
            return loadManagementView('refresh_embeddings_container', generate_refresh_lang_embeddings_view);
        },
        containerId: 'refresh_embeddings_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/refresh_embeddings',
    },
    {
        name: 'translation_helper',
        loadFunction: async () => {
            return loadManagementView('translation_helper_container', generate_translation_helper_view);
        },
        containerId: 'translation_helper_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/translation_helper',
    },
    {
        name: 'text_index_maintenance',
        loadFunction: async () => {
            return loadManagementView('text_index_maintenance_container', generate_search_vector_maintenance_view);
        },
        containerId: 'text_index_maintenance_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/text_index_maintenance',
    },
    {
        name: 'check_json_columns',
        loadFunction: async () => {
            return loadManagementView('check_json_columns_container', generate_check_json_columns_view);
        },
        containerId: 'check_json_columns_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/check_json_columns',
    },
    {
        name: 'database_consistency',
        loadFunction: async () => {
            return loadManagementView('database_consistency_container', generate_database_consistency_view);
        },
        containerId: 'database_consistency_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/database_consistency',
    },
    {
        name: 'fix_media_subfolders',
        loadFunction: async () => {
            return loadManagementView('fix_media_subfolders_container', generate_fix_media_subfolders_view);
        },
        containerId: 'fix_media_subfolders_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/fix_media_subfolders',
    },
    {
        name: 'fk_cache_triggers',
        loadFunction: async () => {
            return loadManagementView('fk_cache_triggers_container', generate_fk_cache_triggers_view);
        },
        containerId: 'fk_cache_triggers_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/fk_cache_triggers',
    },
    {
        name: 'card_visibility',
        loadFunction: async () => {
            return loadManagementView('card_visibility_container', generate_card_visibility_form);
        },
        containerId: 'card_visibility_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/card_visibility',
    },
    {
        name: 'asset_linking',
        loadFunction: async () => {
            return loadManagementView('asset_linking_container', generate_asset_linking_view);
        },
        containerId: 'asset_linking_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/asset_linking',
    },
    {
        name: 'child_tab_config',
        loadFunction: async () => {
            return loadManagementView('child_tab_config_container', generate_child_tab_config_form);
        },
        containerId: 'child_tab_config_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/child_tab_config',
    },
    {
        name: 'dataset_alias_management',
        loadFunction: async () => {
            return loadManagementView('dataset_alias_management_container', generate_dataset_alias_management_view);
        },
        containerId: 'dataset_alias_management_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/dataset_alias_management',
    },
    {
        name: 'dataset_header_config',
        loadFunction: async () => {
            return loadManagementView('dataset_header_config_container', generate_dataset_header_config_view);
        },
        containerId: 'dataset_header_config_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/dataset_header_config',
    },
    {
        name: 'service_catalog_moderation',
        loadFunction: async () => {
            return loadManagementView('service_catalog_moderation_container', generate_service_catalog_moderation_view);
        },
        containerId: 'service_catalog_moderation_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/service_catalog_moderation',
    },
    {
        name: 'queen_chat',
        loadFunction: async () => {
            return loadManagementView('queen_chat_container', generate_queen_chat_view);
        },
        containerId: 'queen_chat_container',
        group: 'admin_tools',
        requiredPermission: '/ui/admin/queen_chat',
    },

    // --- user_tools -ryhmä ---
    {
        name: 'create',
        loadFunction: async () => {
            return loadManagementView('create_container', generate_create_view);
        },
        containerId: 'create_container',
        group: 'user_tools'
    },
    {
        name: 'user',
        loadFunction: async () => {
            return loadManagementView('user_container', generate_user_view);
        },
        containerId: 'user_container',
        group: 'user_tools'
    },
    {
        name: 'register',
        loadFunction: async () => {
            return loadManagementView('register_container', generate_register_view);
        },
        containerId: 'register_container',
        group: 'user_tools'
    }
];

let privateCustomViewsReadyPromise = null;

// ensure_private_custom_views_loaded loads optional private view registrations once.
// Between product identity and custom_views consumers, it keeps Filterest from
// importing private modules while Easelect can add private admin tooling at runtime.
export function ensure_private_custom_views_loaded() {
    if (!privateCustomViewsReadyPromise) {
        privateCustomViewsReadyPromise = load_private_custom_views();
    }
    return privateCustomViewsReadyPromise;
}

export const custom_views_ready = ensure_private_custom_views_loaded();

async function load_private_custom_views() {
    let identity;
    try {
        identity = await endpoint_router('productIdentity', { suppressAuthRedirect: true });
    } catch (error) {
        console.warn('product identity lookup failed; skipping private custom views', error);
        return;
    }

    const moduleUrl = identity?.private_frontend_extension_module_url;
    if (!identity?.private_upstream || !moduleUrl) {
        return;
    }

    try {
        const module = await import(/* @vite-ignore */ moduleUrl);
        const privateViews = typeof module.getPrivateCustomViews === 'function'
            ? await module.getPrivateCustomViews()
            : module.private_custom_views;
        append_private_custom_views(privateViews);
    } catch (error) {
        console.warn('private custom view registration failed', error);
    }
}

function append_private_custom_views(privateViews) {
    if (!Array.isArray(privateViews)) {
        return;
    }
    const existingNames = new Set(custom_views.map((view) => view.name));
    privateViews.forEach((view) => {
        if (!view?.name || existingNames.has(view.name)) {
            return;
        }
        custom_views.push(view);
        existingNames.add(view.name);
    });
}
