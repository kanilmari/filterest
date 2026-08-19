// user_authentication_view.js
// Renders administrator-owned activation and login-verification settings for users.
// Bridges the protected user-authentication API with Admin → Site settings.
// Exists so account activation, admin provisioning, and verification policy stay explicit.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import { getTranslationForKey } from '../lang/translation_handler.js';

const VERIFICATION_METHODS = Object.freeze(['none', 'fixed_pin', 'email']);

function translatedText(langKey, fallback) {
    return getTranslationForKey(langKey, { fallback }) || fallback;
}

function normalizeVerificationMethod(value) {
    return VERIFICATION_METHODS.includes(value) ? value : null;
}

function createLabel(text, controlId) {
    const label = document.createElement('label');
    label.htmlFor = controlId;
    label.textContent = text;
    return label;
}

function createStatusItem(langKey, fallback, value) {
    const item = document.createElement('div');
    item.classList.add('user-authentication-status__item');

    const label = document.createElement('dt');
    label.dataset.langKey = langKey;
    label.textContent = translatedText(langKey, fallback);

    const detail = document.createElement('dd');
    detail.textContent = value;

    item.append(label, detail);
    return item;
}

function booleanStatus(value) {
    return value
        ? translatedText('yes', 'Yes')
        : translatedText('no', 'No');
}

function verificationMethodLabel(method) {
    if (method === 'totp') {
        return translatedText(
            'verification_method_totp_unmanaged',
            'Authenticator app (not managed by this tool)',
        );
    }
    return {
        none: translatedText('verification_method_none', 'No additional verification'),
        fixed_pin: translatedText('verification_method_fixed_pin', 'Fixed PIN'),
        email: translatedText('verification_method_email', 'Email code'),
    }[normalizeVerificationMethod(method)]
        || translatedText('verification_method_unavailable', 'Unavailable method');
}

function renderUserStatus(container, user) {
    container.replaceChildren(
        createStatusItem('user_status_enabled', 'Account enabled', booleanStatus(user.enabled)),
        createStatusItem('user_status_admin_group', 'Admins group member', booleanStatus(user.admin_group_member)),
        createStatusItem('user_status_admin_access', 'Administrator access allowed', booleanStatus(user.admin_access_allowed)),
        createStatusItem(
            'user_status_verification_method',
            'Additional verification',
            verificationMethodLabel(user.verification_method),
        ),
    );
}

function setFormControlsDisabled(form, disabled) {
    form.querySelectorAll('input, button').forEach((control) => {
        control.disabled = disabled;
    });
}

function clearPinInputs(pinInput, confirmationInput) {
    pinInput.value = '';
    confirmationInput.value = '';
}

/**
 * Generates Admin → Site settings → User authentication.
 * Between administrator actions and the protected API, it never reads back or retains PIN values.
 * The selected account becomes enabled and administrator-provisioned only on an explicit save.
 *
 * @param {HTMLElement} container - Management-view container supplied by navigation.
 */
export async function generate_user_authentication_view(container) {
    if (!(container instanceof HTMLElement)) return;
    container.replaceChildren();
    container.classList.add('user-authentication-view');

    const heading = document.createElement('h2');
    heading.dataset.langKey = 'user_authentication';
    heading.textContent = translatedText('user_authentication', 'User authentication');

    const description = document.createElement('p');
    description.dataset.langKey = 'user_authentication_description';
    description.textContent = translatedText(
        'user_authentication_description',
        'Select a user, review the current status, and choose whether sign-in needs no additional verification, a fixed PIN, or an email code.',
    );

    const feedback = document.createElement('p');
    feedback.classList.add('user-authentication-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');

    const userField = document.createElement('div');
    userField.classList.add('user-authentication-field');
    const userSelect = document.createElement('select');
    userSelect.id = 'user-authentication-user';
    userSelect.dataset.testid = 'user-authentication-user';
    userSelect.appendChild(new Option(
        translatedText('select_user', 'Select a user'),
        '',
        true,
        true,
    ));
    userField.append(
        createLabel(translatedText('user', 'User'), userSelect.id),
        userSelect,
    );

    const editor = document.createElement('section');
    editor.classList.add('user-authentication-editor');
    editor.hidden = true;

    const statusHeading = document.createElement('h3');
    statusHeading.dataset.langKey = 'current_status';
    statusHeading.textContent = translatedText('current_status', 'Current status');
    const statusList = document.createElement('dl');
    statusList.classList.add('user-authentication-status');
    statusList.dataset.testid = 'user-authentication-status';

    const form = document.createElement('form');
    form.classList.add('user-authentication-form');
    form.noValidate = true;

    const methodGroup = document.createElement('fieldset');
    const methodLegend = document.createElement('legend');
    methodLegend.dataset.langKey = 'login_verification_method';
    methodLegend.textContent = translatedText('login_verification_method', 'Sign-in verification method');
    methodGroup.appendChild(methodLegend);

    const methodDescriptions = {
        none: translatedText('verification_method_none_description', 'Password only; no second verification step.'),
        fixed_pin: translatedText('verification_method_fixed_pin_description', 'Ask for a private 4–8 digit PIN after the password.'),
        email: translatedText('verification_method_email_description', 'Send a one-time code to the user’s email address.'),
    };
    const methodInputs = new Map();
    VERIFICATION_METHODS.forEach((method) => {
        const option = document.createElement('label');
        option.classList.add('user-authentication-method');
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'verification_method';
        input.value = method;
        input.dataset.testid = `verification-method-${method}`;
        const text = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = verificationMethodLabel(method);
        const explanation = document.createElement('small');
        explanation.textContent = methodDescriptions[method];
        text.append(title, explanation);
        option.append(input, text);
        methodGroup.appendChild(option);
        methodInputs.set(method, input);
    });

    const pinFields = document.createElement('div');
    pinFields.classList.add('user-authentication-pin-fields');
    pinFields.hidden = true;
    const pinInput = document.createElement('input');
    pinInput.id = 'user-authentication-fixed-pin';
    pinInput.type = 'password';
    pinInput.inputMode = 'numeric';
    pinInput.autocomplete = 'new-password';
    pinInput.minLength = 4;
    pinInput.maxLength = 8;
    pinInput.pattern = '[0-9]{4,8}';
    pinInput.dataset.testid = 'user-authentication-fixed-pin';
    const confirmationInput = pinInput.cloneNode();
    confirmationInput.id = 'user-authentication-fixed-pin-confirmation';
    confirmationInput.dataset.testid = 'user-authentication-fixed-pin-confirmation';
    pinFields.append(
        createLabel(translatedText('fixed_pin', 'New fixed PIN'), pinInput.id),
        pinInput,
        createLabel(translatedText('confirm_fixed_pin', 'Confirm fixed PIN'), confirmationInput.id),
        confirmationInput,
    );

    const activationNotice = document.createElement('p');
    activationNotice.classList.add('user-authentication-activation-notice');
    activationNotice.dataset.langKey = 'user_authentication_activation_notice';
    activationNotice.textContent = translatedText(
        'user_authentication_activation_notice',
        'Saving also enables this account, adds it to the admins group, and allows administrator access.',
    );

    const saveButton = document.createElement('button');
    saveButton.type = 'submit';
    saveButton.classList.add('fw-btn', 'fw-btn--primary');
    saveButton.dataset.testid = 'user-authentication-save';
    saveButton.dataset.langKey = 'save_and_activate_admin';
    saveButton.textContent = translatedText('save_and_activate_admin', 'Save and activate administrator');
    form.append(methodGroup, pinFields, activationNotice, saveButton);
    editor.append(statusHeading, statusList, form);
    container.append(heading, description, userField, editor, feedback);

    let usersById = new Map();
    let selectedUser = null;

    function syncPinFields() {
        const selectedMethod = form.elements.verification_method?.value || '';
        const isFixedPin = selectedMethod === 'fixed_pin';
        pinFields.hidden = !isFixedPin;
        pinInput.required = isFixedPin;
        confirmationInput.required = isFixedPin;
        if (!isFixedPin) clearPinInputs(pinInput, confirmationInput);
    }

    function selectUser(user) {
        selectedUser = user;
        editor.hidden = !user;
        clearPinInputs(pinInput, confirmationInput);
        feedback.textContent = '';
        if (!user) return;
        renderUserStatus(statusList, user);
        const method = normalizeVerificationMethod(user.verification_method);
        methodInputs.forEach((input) => {
            input.checked = input === methodInputs.get(method);
        });
        syncPinFields();
    }

    methodGroup.addEventListener('change', syncPinFields);
    userSelect.addEventListener('change', () => {
        selectUser(usersById.get(userSelect.value) || null);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!selectedUser) return;

        const verificationMethod = normalizeVerificationMethod(form.elements.verification_method?.value);
        if (!verificationMethod) {
            feedback.textContent = translatedText(
                'select_supported_verification_method',
                'Select one of the available verification methods before saving.',
            );
            return;
        }
        const fixedPin = pinInput.value;
        if (verificationMethod === 'fixed_pin') {
            if (!/^\d{4,8}$/.test(fixedPin)) {
                feedback.textContent = translatedText('fixed_pin_format_error', 'PIN must contain 4–8 digits.');
                pinInput.focus();
                return;
            }
            if (fixedPin !== confirmationInput.value) {
                feedback.textContent = translatedText('fixed_pin_mismatch', 'The PIN entries do not match.');
                confirmationInput.focus();
                return;
            }
        }

        const bodyData = {
            user_id: selectedUser.user_id,
            verification_method: verificationMethod,
        };
        if (verificationMethod === 'fixed_pin') bodyData.fixed_pin = fixedPin;

        setFormControlsDisabled(form, true);
        feedback.textContent = translatedText('saving', 'Saving…');
        try {
            const savedUser = await endpoint_router('adminUserAuthentication', {
                method: 'POST',
                body_data: bodyData,
            });
            usersById.set(String(savedUser.user_id), savedUser);
            selectedUser = savedUser;
            renderUserStatus(statusList, savedUser);
            const savedMethod = normalizeVerificationMethod(savedUser.verification_method);
            methodInputs.forEach((input) => {
                input.checked = input === methodInputs.get(savedMethod);
            });
            feedback.textContent = savedMethod
                ? translatedText(
                    'user_authentication_saved',
                    'Authentication settings saved and administrator access activated.',
                )
                : translatedText(
                    'user_authentication_unavailable_readback',
                    'The account was updated, but the server returned a verification method this tool cannot manage.',
                );
        } catch (error) {
            console.warn('user_authentication_view: save failed', error);
            feedback.textContent = error?.message || translatedText('save_failed', 'Save failed.');
        } finally {
            clearPinInputs(pinInput, confirmationInput);
            setFormControlsDisabled(form, false);
            syncPinFields();
        }
    });

    try {
        feedback.textContent = translatedText('loading', 'Loading…');
        const response = await endpoint_router('adminUserAuthentication');
        const users = Array.isArray(response?.users) ? response.users : [];
        usersById = new Map(users.map((user) => [String(user.user_id), user]));
        users
            .slice()
            .sort((left, right) => String(left.username).localeCompare(String(right.username)))
            .forEach((user) => {
                userSelect.appendChild(new Option(user.username, String(user.user_id)));
            });
        feedback.textContent = users.length === 0
            ? translatedText('no_users_found', 'No users found.')
            : '';
    } catch (error) {
        console.warn('user_authentication_view: load failed', error);
        userSelect.disabled = true;
        feedback.textContent = error?.message || translatedText('load_failed', 'Loading failed.');
    }
}
