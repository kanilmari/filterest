// embedding_provider_key_form.js
// Lets an administrator install the embedding provider's API key from the embeddings admin page.
// Bridges the read-only embedding status panel and the protected provider-key admin endpoint.
// Exists so a missing key is fixed in the interface instead of by editing a settings file on each server.

import { endpoint_router } from '../core_components/endpoints/endpoint_router.js';
import { englishEmbeddingAdminCopy, keyedElement } from './embedding_status_translation_fallbacks.js';

// Where each provider hands out a key. A provider that is not listed here still
// gets the form; only the link is left out, because a wrong address is worse
// than none.
const PROVIDER_KEY_PAGES = Object.freeze({
    google: 'https://aistudio.google.com/app/apikey',
    openai: 'https://platform.openai.com/api-keys',
});

// The endpoint answers 409 when this installation reads its settings from
// somewhere the running application cannot write, such as a container that is
// given its environment by the host. That is a configuration fact the
// administrator must see, not a failure to retry.
const SETTINGS_NOT_WRITABLE_STATUS = 409;
const KEY_REFUSED_STATUS = 400;

/**
 * Picks the message for a failed save, so the page never reports a success it
 * did not achieve.
 *
 * @param {unknown} error - The error thrown by the endpoint pipeline.
 * @returns {string} A language key of this page.
 */
export function describeKeySaveFailure(error) {
    const status = Number(error?.status);
    if (status === SETTINGS_NOT_WRITABLE_STATUS) return 'embedding_key_setup_not_writable';
    if (status === KEY_REFUSED_STATUS) return 'embedding_key_setup_rejected';
    return 'embedding_key_setup_failed';
}

function setStatusLine(statusLine, langKey) {
    statusLine.dataset.langKey = langKey;
    statusLine.textContent = englishEmbeddingAdminCopy(langKey);
}

/**
 * Renders the key form for one provider. The form is shown only while no key is
 * configured; a stored key is never read back, displayed or logged, and the
 * submitted value leaves the page only inside the save request.
 *
 * @param {object} options
 * @param {string} options.provider - The site's embedding provider identifier.
 * @param {() => (void | Promise<void>)} [options.onSaved] - Runs after a successful save.
 * @returns {HTMLFormElement}
 */
export function renderEmbeddingProviderKeyForm({ provider, onSaved } = {}) {
    const form = document.createElement('form');
    form.classList.add('embedding-key-setup');
    form.dataset.provider = provider || '';

    const title = keyedElement('h4', 'embedding_key_setup_title');
    title.classList.add('embedding-key-setup__title');

    const explanation = keyedElement('p', 'embedding_key_setup_explanation');
    const privacy = keyedElement('p', 'embedding_key_setup_privacy');
    privacy.classList.add('embedding-status-muted');

    const label = document.createElement('label');
    label.classList.add('embedding-key-setup__field');
    const labelText = keyedElement('span', 'embedding_key_setup_field_label');
    const input = document.createElement('input');
    input.type = 'password';
    input.name = 'provider_api_key';
    input.autocomplete = 'new-password';
    input.spellcheck = false;
    input.required = true;
    input.maxLength = 4096;
    input.classList.add('embedding-key-setup__input');
    label.append(labelText, input);

    const actions = document.createElement('div');
    actions.classList.add('embedding-key-setup__actions');
    const saveButton = keyedElement('button', 'embedding_key_setup_save');
    saveButton.type = 'submit';
    saveButton.classList.add('embedding-key-setup__save');
    actions.appendChild(saveButton);

    const keyPage = PROVIDER_KEY_PAGES[provider];
    if (keyPage) {
        const link = keyedElement('a', 'embedding_key_setup_where');
        link.href = keyPage;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.appendChild(link);
    }

    const statusLine = document.createElement('p');
    statusLine.classList.add('embedding-key-setup__status');
    statusLine.setAttribute('role', 'status');
    statusLine.setAttribute('aria-live', 'polite');

    const neverShown = keyedElement('p', 'embedding_key_setup_never_shown');
    neverShown.classList.add('embedding-status-muted');

    form.append(title, explanation, privacy, label, actions, statusLine, neverShown);

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const apiKey = input.value.trim();
        if (!apiKey) {
            setStatusLine(statusLine, 'embedding_key_setup_required');
            input.focus();
            return;
        }

        input.disabled = true;
        saveButton.disabled = true;
        setStatusLine(statusLine, 'embedding_key_setup_saving');
        try {
            await endpoint_router('saveProviderAPIKey', {
                method: 'POST',
                body_data: { provider, api_key: apiKey },
                // This form owns its own wording; a generic failure toast would
                // hide which of the three outcomes actually happened.
                suppressErrorToast: true,
            });
            input.value = '';
            setStatusLine(statusLine, 'embedding_key_setup_saved');
            await onSaved?.();
        } catch (error) {
            setStatusLine(statusLine, describeKeySaveFailure(error));
            input.disabled = false;
            saveButton.disabled = false;
            input.focus();
        }
    });

    return form;
}
