// navigation.js
// Provides the public navigation API and wires table-selection events to the navigation engine.
// Bridges UI event handlers and the underlying navigation_handler, re-exporting its key functions.
// Exists to be the single import point for navigation so consumers avoid direct engine coupling.

import { custom_views } from '../admin_and_user_tools/custom_view_reader.js';
import { handle_all_navigation } from './navigation_handler.js';
import { setSelectedDataset } from '../../state_stores/dataset_selection_saver.js';
import './history_navigation_handler.js';
import '../top_bar/nav_history_buttons.js';
export { create_navigation_buttons } from '../database_tree/nav_builder.js';
export { update_active_heading } from './active_heading_updater.js';
export { handle_all_navigation, performNavigation, get_load_info } from './navigation_handler.js';

export async function on_table_selected(event) {
    const selected_table_name = event.detail.tableName;
    setSelectedDataset(selected_table_name);
    await handle_all_navigation(selected_table_name, custom_views);
}
