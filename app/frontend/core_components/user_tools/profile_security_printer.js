// profile_security_printer.js
// Adds private-name change and other-device sign-out actions to the existing profile page.
// Bridges password confirmation with the profile's atomic account mutation endpoint.
// Exists so the account owner can revoke other devices without losing this sign-in.
import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import { showErrorToast, showSuccessToast, showInfoToast } from '../../reusable_components/notifications/toast_notification_printer.js';

const text = key => getTranslationForKey(key) || key;
function label(element, key) {
    element.dataset.langKey = key;
    element.textContent = text(key);
}

/** Uses existing form styling and application theme variables in both theme overrides. */
export function appendProfileSecurity(container, requestPassword) {
    const form = document.createElement('form');
    form.id = 'profile_security_form';
    const fields = document.createElement('fieldset');
    const legend = document.createElement('legend');
    label(legend, 'change_login_name');
    fields.append(legend);
    const help = document.createElement('p');
    label(help, 'login_name_change_help');
    const inputLabel = document.createElement('label');
    inputLabel.htmlFor = 'new_login_name';
    label(inputLabel, 'new_login_name');
    const input = document.createElement('input');
    input.id = 'new_login_name';
    input.name = 'username';
    input.autocomplete = 'username';
    input.minLength = 3;
    input.maxLength = 64;
    input.required = true;
    const change = document.createElement('button');
    change.type = 'submit';
    change.classList.add('user_profile_action_button');
    label(change, 'change_login_name');
    fields.append(help, inputLabel, input, change);
    form.append(fields);
    container.append(form);
    const signOut = document.createElement('button');
    signOut.type = 'button';
    signOut.id = 'sign_out_other_devices';
    signOut.classList.add('user_profile_action_button');
    label(signOut, 'sign_out_other_devices');
    const signOutHelp = document.createElement('p');
    label(signOutHelp, 'sign_out_other_devices_help');
    container.append(signOutHelp, signOut);

    async function act(body, button, successKey) {
        const password = await requestPassword();
        if (!password) return;
        button.disabled = true;
        try {
            const result = await endpoint_router('updateUserProfile', {
                method: 'POST', suppressErrorToast: true, body_data: { ...body, current_password: password },
            });
            input.value = '';
            showSuccessToast(text(successKey));
            if (result?.mail_status) showInfoToast(text(result.mail_status));
        } catch (error) {
            const key = error?.status === 429 && body.login_name !== undefined
                ? 'login_name_change_rate_limited'
                : error?.failureNotice?.langKey || error?.data?.error_lang_key || error?.data?.error || error?.error_lang_key || error?.message || 'login_name_change_failed';
            showErrorToast(text(key));
        } finally {
            button.disabled = false;
        }
    }
    form.addEventListener('submit', event => {
        event.preventDefault();
        void act({ login_name: input.value }, change, 'login_name_changed');
    });
    signOut.addEventListener('click', () => void act({ sign_out_other_devices: true }, signOut, 'other_devices_signed_out'));
}

/** Profile-owned public fields; no submitted id or permission flag is ever sent. */
export function appendPublicProfileFields(fieldset) {
    const fields = {};
    for (const key of ['website', 'bio_social_medias']) {
        const inputLabel = document.createElement('label');
        label(inputLabel, key);
        const input = document.createElement(key === 'website' ? 'input' : 'textarea');
        input.id = `edit_${key}`;
        input.name = key;
        inputLabel.htmlFor = input.id;
        fieldset.append(inputLabel, input);
        fields[key] = input;
    }
    return fields;
}
