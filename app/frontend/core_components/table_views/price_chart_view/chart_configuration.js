// chart_configuration.js
// Loads and saves a dataset's chart axes through existing view field sets.
// Connects the SVG renderer to the permission-checked field-set API.
// Ordered shared members [time, numeric] avoid new storage, routes or schema.
import { getViewFieldSets, saveSiteViewFieldSet } from '../../endpoints/stable_endpoint_router.js';
import { create_price_chart_view } from './price_chart_view_printer.js';
import { datasetSupportsChartView } from './price_chart_data_reader.js';

export async function createConfiguredChartView(dataset, columns, rows, dataTypes, options = {}) {
    if (!datasetSupportsChartView(columns, dataTypes)) {
        return create_price_chart_view(dataset, columns, rows, dataTypes, options);
    }
    let response;
    let defaultLoadFailed = false;
    try {
        response = await getViewFieldSets(dataset, 'price_chart');
        if (response?.dataset !== dataset || response?.view_key !== 'price_chart') throw new Error('Unexpected chart settings');
    } catch {
        defaultLoadFailed = true;
    }
    const siteSet = response?.field_sets?.find(set => set.scope === 'shared'
        && set.id === response.site_default_field_set_id);
    return create_price_chart_view(dataset, columns, rows, dataTypes, {
        ...options,
        savedColumns: siteSet?.visible_columns || [],
        canSaveDefault: response?.can_edit_site_default === true,
        defaultLoadFailed,
        onSaveDefault: async axes => {
            // This endpoint retains its existing admin, dataset-read and field checks.
            // A chart-owned collection avoids overwriting another view's reusable set.
            const result = await saveSiteViewFieldSet({
                dataset, view_key: 'price_chart', name: 'price_chart_axes',
                visible_columns: [axes.timeColumn, axes.priceColumn], target_scope: 'site',
            });
            if (result?.status !== 'ok') throw new Error('Chart axes were not saved');
        },
    });
}
