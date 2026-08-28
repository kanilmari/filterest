// endpoint_router.js
// Thin wrapper that routes logical endpoint names to backend calls via the API request pipeline.
// Bridges feature-level callers and the backend by delegating CSRF, auth, rate limiting, and parsing to api_pipeline.js.
// Exists to give every API call a single, consistent entry point so cross-cutting concerns stay out of feature code.

import { runApiPipeline, getEndpointUrl } from '../pipeline/api_pipeline.js';

/**
 * Returns the URL for a given route name.
 * Re-exported from api_pipeline for callers that need raw URLs (e.g. SSE streams).
 *
 * @param {string} routeName
 * @returns {string}
 */
export function get_endpoint_url(routeName) {
    return getEndpointUrl(routeName);
}

/**
 * endpoint_router — sends an API request through the full request pipeline.
 * Handles CSRF, auth redirects, rate limiting, and response parsing automatically.
 *
 * @param {string} route_name          - Key from the endpoint_map in api_pipeline.js
 * @param {Object} [options]
 * @param {string} [options.method]         - HTTP method (default: 'GET')
 * @param {any}    [options.body_data]      - Request payload (object or FormData)
 * @param {string} [options.url_params]     - URL query string appended to endpoint
 * @param {Object} [options.headers]        - Additional request headers
 * @param {boolean}[options.stream]         - Return raw Response (for SSE streams)
 * @param {boolean}[options.returnResponse] - Return raw Response object
 * @param {boolean}[options.suppressAuthRedirect] - Don't navigate to /login on 401/403; throw instead
 * @returns {Promise<any>} Parsed response data, or raw Response if stream/returnResponse
 */
export async function endpoint_router(route_name, {
    method = 'GET',
    body_data = null,
    url_params = '',
    headers = {},
    stream = false,
    returnResponse = false,
    suppressAuthRedirect = false,
} = {}) {
    const context = {
        routeName: route_name,
        method,
        bodyData: body_data,
        urlParams: url_params,
        headers,
        stream,
        returnResponse,
        suppressAuthRedirect,
    };

    const result = await runApiPipeline(context);

    // Pipeline aborted (e.g. auth redirect) — throw to prevent callers
    // from treating undefined as a successful response.
    if (result && result.abort) {
        throw result.error || new Error(`Request aborted: ${result.reason}`);
    }

    return result.parsedData;
}
