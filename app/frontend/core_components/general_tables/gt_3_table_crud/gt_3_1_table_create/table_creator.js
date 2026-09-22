// table_creator.js
// Hosts the dataset form in its creation mode on the "Create table" admin page.
// Bridges the form with the page around it: the admin navigation tree and the
// main dataset tabs, both refreshed once a dataset exists, and opening the new
// dataset from the form's result.
// Exists as a thin host: the form and its creation adapter live in
// dataset_form/, shared with the dataset's Manage table dialog.
import { loadManagementView } from '../../../../reusable_components/dom_container_builder.js';
import { initializeTreeCallAdmin } from '../../../vanilla_tree/van_tr_components/admin_tree_builder.js';
import { initTabs, openNavTab } from '../../../navigation/main_tabs/main_tab_printer.js';
import { buildDatasetForm } from '../../dataset_form/dataset_form.js';
import { createDatasetCreateSource } from '../../dataset_form/dataset_create_source.js';

const mountedForms = new WeakMap();

export function load_table_creation() {
    return loadManagementView('table_creation_container', generate_table_creation_view);
}

/**
 * A new dataset appears at once wherever the navigation lists datasets: the
 * admin tree, and the main tabs when it sits directly in the current project.
 * The tabs are redrawn as for a page whose content is already shown, so the
 * person stays on this page instead of being taken to the first tab.
 */
async function refreshNavigationAfterCreation() {
    const results = await Promise.allSettled([
        initializeTreeCallAdmin({ forceRefresh: true }),
        initTabs({ dataAlreadyLoaded: true }),
    ]);
    for (const outcome of results) {
        if (outcome.status === 'rejected') console.warn('Navigation refresh after dataset creation failed:', outcome.reason);
    }
}

export async function generate_table_creation_view(container) {
    mountedForms.get(container)?.dispose();
    container.replaceChildren();

    const form = buildDatasetForm({
        mode: 'create',
        source: createDatasetCreateSource(),
        host: {
            afterSave: refreshNavigationAfterCreation,
            openDataset: (datasetName) => openNavTab(datasetName),
        },
    });
    mountedForms.set(container, form);
    container.appendChild(form.element);
    await form.ready;
}
