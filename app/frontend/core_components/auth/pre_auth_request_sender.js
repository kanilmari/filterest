// pre_auth_request_sender.js
// Sends the sign-in page's and sign-in modal's own requests: credentials, verification code and password reset.
// Bridges those forms and the session's CSRF token, reusing the API pipeline's token fetch and failure test.
// Exists so a form whose token went stale recovers by itself instead of telling the person to reload the page.
// PIPELINE_EXCEPTION: these requests run before a signed-in session exists, so they cannot go through
// runApiPipeline; see docs/instructions_and_documentation/PIPELINE_EXCEPTIONS.md.
import { ensureCsrfToken } from "../pipeline/api_pipeline.js";
import { isCsrfFailureResponse } from "../pipeline/api_pipeline_helpers.js";

/**
 * Posts one JSON request with the CSRF token kept in the form's hidden field.
 *
 * When the service answers that the token does not match the session -- a page
 * the browser restored from its cache, or a session cookie the server had to
 * replace after the page was loaded -- the session's current token is fetched,
 * written into the field, and the request is sent once more. The typed fields
 * are untouched, so the person does not start over. It retries even when the
 * fetched token equals the old one, because the first refusal may itself have
 * cleared a stray session cookie, after which the same token matches. The token
 * comes from this application's own address and no other site can read it, so
 * the second attempt gives a forged request nothing.
 *
 * @param {string} url - same-origin pre-sign-in endpoint
 * @param {HTMLInputElement|null} tokenField - the form's hidden csrf_token field
 * @param {(csrfToken: string) => object} buildBody - builds the JSON body around a token
 * @returns {Promise<Response>} the last response received
 */
export async function postPreAuthJson(url, tokenField, buildBody) {
    const send = (csrfToken) => fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(buildBody(csrfToken)),
    });

    const firstResponse = await send(tokenField?.value || "");
    if (firstResponse.status !== 403) {
        return firstResponse;
    }

    let refusal = "";
    try {
        refusal = await firstResponse.clone().text();
    } catch {
        return firstResponse;
    }
    if (!isCsrfFailureResponse(refusal)) {
        return firstResponse;
    }

    const sessionToken = await ensureCsrfToken({ forceRefresh: true });
    if (!sessionToken) {
        return firstResponse;
    }
    if (tokenField) {
        tokenField.value = sessionToken;
    }
    return send(sessionToken);
}
