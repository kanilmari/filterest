// dataset_ui_visibility.js
// Uses the administrator visibility API and verifies the exact dataset readback.
import { endpoint_router } from '../../endpoints/endpoint_router.js';

function validateVisibility(response, datasetName, expected) {
    if (response?.dataset_name !== datasetName || typeof response.ui_hidden !== 'boolean'
        || (typeof expected === 'boolean' && response.ui_hidden !== expected)) {
        throw new Error('Dataset visibility readback did not match the requested target');
    }
    return response;
}

export async function getDatasetUIVisibility(datasetName) {
    const response = await endpoint_router('adminDatasetUiVisibility', {
        url_params: '?' + new URLSearchParams({ dataset_name: datasetName }).toString(),
        suppressErrorToast: true,
    });
    return validateVisibility(response, datasetName);
}

export async function setDatasetUIVisibility(datasetName, uiHidden) {
    const response = await endpoint_router('adminDatasetUiVisibility', {
        method: 'POST',
        body_data: { dataset_name: datasetName, ui_hidden: uiHidden },
        suppressErrorToast: true,
    });
    validateVisibility(response, datasetName, uiHidden);
    return validateVisibility(await getDatasetUIVisibility(datasetName), datasetName, uiHidden);
}
