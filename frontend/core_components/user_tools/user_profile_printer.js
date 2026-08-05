// user_profile_printer.js
// Renders the user profile and password update view.
// Bridges profile API responses and form controls in the account settings UI.
// Exists to provide one place for users to review and update their account details.

import { endpoint_router } from '../endpoints/endpoint_router.js';
import {
    showErrorToast,
    showInfoToast,
    showSuccessToast,
    showWarningToast,
} from '../../reusable_components/notifications/toast_notification_printer.js';
import { showInputModal } from '../../reusable_components/modal/confirm_modal_builder.js';
import { getTranslationForKey } from '../lang/translation_handler.js';
import {
    buildPasswordUpdateBody,
    buildProfileUpdateBody,
} from './user_profile_printer_builder.js';

async function requestCurrentPassword() {
    return showInputModal({
        titlePlainText: translatedText('confirm_password_title', 'Confirm password'),
        messagePlainText: translatedText('confirm_current_password_message', 'Enter your current password to confirm this change.'),
        labelPlainText: translatedText('current_password', 'Current Password'),
        inputType: 'password',
        autocomplete: 'current-password',
        confirmLangKey: 'continue',
        confirmText: translatedText('continue', 'Continue'),
        cancelLangKey: 'cancel',
        cancelText: translatedText('cancel', 'Cancel'),
    });
}

function translatedText(langKey, fallback) {
    return getTranslationForKey(langKey, { fallback }) || fallback;
}

function applyTextLangKey(element, langKey, fallback) {
    element.dataset.langKey = langKey;
    element.textContent = fallback;
}

/**
 * generate_user_view — renders the profile and password update form.
 * Operates between account API responses and form controls in the UI.
 * Exists to provide one place for user profile and password changes.
 *
 * @param {HTMLElement} container
 */
export async function generate_user_view(container) {
    try {
        container.replaceChildren();

        const heading = document.createElement('h2');
        applyTextLangKey(heading, 'user_profile_title', 'User Profile');
        container.appendChild(heading);

        const infoDiv = document.createElement('div');
        infoDiv.id = 'user_info';
        container.appendChild(infoDiv);

        // Two separate forms to prevent Firefox from pairing username + password
        // fields for autofill. When they share a <form>, clicking a password
        // field causes Firefox to autofill the username field too.

        const profileForm = document.createElement('form');
        profileForm.id = 'user_profile_form';
        profileForm.autocomplete = 'off';

        const profileFieldset = document.createElement('fieldset');
        const profileLegend = document.createElement('legend');
        applyTextLangKey(profileLegend, 'profile', 'Profile');
        profileFieldset.appendChild(profileLegend);

        const usernameField = createLabeledInput({
            labelText: 'Username',
            labelLangKey: 'username',
            inputType: 'text',
            inputId: 'edit_username',
            inputName: 'username',
            autocomplete: 'off',
        });
        profileFieldset.appendChild(usernameField.label);
        profileFieldset.appendChild(usernameField.input);

        const emailField = createLabeledInput({
            labelText: 'Email',
            labelLangKey: 'email',
            inputType: 'email',
            inputId: 'edit_email',
            inputName: 'email',
            autocomplete: 'off',
        });
        profileFieldset.appendChild(emailField.label);
        profileFieldset.appendChild(emailField.input);

        const confirmEmailField = createLabeledInput({
            labelText: 'Confirm Email',
            labelLangKey: 'confirm_email',
            inputType: 'email',
            inputId: 'confirm_email',
            inputName: 'confirm_email',
            autocomplete: 'off',
        });
        profileFieldset.appendChild(confirmEmailField.label);
        profileFieldset.appendChild(confirmEmailField.input);

        // Email change OTP section
        const emailOtpSection = document.createElement('div');
        emailOtpSection.id = 'email_otp_section';
        emailOtpSection.style.display = 'none';

        const emailOtpSendBtn = document.createElement('button');
        emailOtpSendBtn.type = 'button';
        emailOtpSendBtn.classList.add('user_profile_action_button');
        applyTextLangKey(emailOtpSendBtn, 'send_verification_code', 'Send verification code');
        emailOtpSendBtn.id = 'email_otp_send_btn';
        emailOtpSection.appendChild(emailOtpSendBtn);

        const emailOtpMessage = document.createElement('div');
        emailOtpMessage.id = 'email_otp_message';
        emailOtpMessage.style.cssText = 'font-size:0.85em;margin:4px 0;color:#666;';
        emailOtpSection.appendChild(emailOtpMessage);

        const emailOtpField = createLabeledInput({
            labelText: 'Verification code',
            labelLangKey: 'otp',
            inputType: 'text',
            inputId: 'email_otp',
            inputName: 'email_otp',
            autocomplete: 'off',
        });
        emailOtpField.label.style.display = 'none';
        emailOtpField.input.style.display = 'none';
        emailOtpSection.appendChild(emailOtpField.label);
        emailOtpSection.appendChild(emailOtpField.input);

        profileFieldset.appendChild(emailOtpSection);

        const profileSubmitButton = document.createElement('button');
        profileSubmitButton.type = 'submit';
        profileSubmitButton.classList.add('user_profile_action_button');
        applyTextLangKey(profileSubmitButton, 'save_profile', 'Save Profile');

        profileForm.appendChild(profileFieldset);
        profileForm.appendChild(profileSubmitButton);
        container.appendChild(profileForm);

        const passwordForm = document.createElement('form');
        passwordForm.id = 'user_password_form';
        passwordForm.autocomplete = 'off';

        // Decoy fields absorb Firefox autofill — Firefox aggressively ignores
        // autocomplete="off" for password fields and fills the first
        // username+password pair it finds. These hidden decoys receive
        // the autofill so the real fields stay clean.
        const decoyContainer = document.createElement('div');
        decoyContainer.setAttribute('aria-hidden', 'true');
        decoyContainer.style.cssText = 'position:absolute;opacity:0;height:0;width:0;overflow:hidden;pointer-events:none;';
        const decoyUser = document.createElement('input');
        decoyUser.type = 'text';
        decoyUser.name = 'decoy_username_trap';
        decoyUser.tabIndex = -1;
        decoyUser.autocomplete = 'username';
        const decoyPass = document.createElement('input');
        decoyPass.type = 'password';
        decoyPass.name = 'decoy_password_trap';
        decoyPass.tabIndex = -1;
        decoyPass.autocomplete = 'current-password';
        decoyContainer.appendChild(decoyUser);
        decoyContainer.appendChild(decoyPass);
        passwordForm.appendChild(decoyContainer);

        const passwordFieldset = document.createElement('fieldset');
        const passwordLegend = document.createElement('legend');
        applyTextLangKey(passwordLegend, 'change_password', 'Change Password');
        passwordFieldset.appendChild(passwordLegend);

        const currentPasswordField = createLabeledInput({
            labelText: 'Current Password',
            labelLangKey: 'current_password',
            inputType: 'password',
            inputId: 'current_password',
            inputName: 'current_password',
            autocomplete: 'off',
        });
        passwordFieldset.appendChild(currentPasswordField.label);
        passwordFieldset.appendChild(currentPasswordField.input);

        const newPasswordField = createLabeledInput({
            labelText: 'New Password',
            labelLangKey: 'new_password',
            inputType: 'password',
            inputId: 'new_password',
            inputName: 'new_password',
            autocomplete: 'off',
        });
        passwordFieldset.appendChild(newPasswordField.label);
        passwordFieldset.appendChild(newPasswordField.input);

        const confirmPasswordField = createLabeledInput({
            labelText: 'Confirm New Password',
            labelLangKey: 'confirm_new_password',
            inputType: 'password',
            inputId: 'confirm_password',
            inputName: 'confirm_password',
            autocomplete: 'off',
        });
        passwordFieldset.appendChild(confirmPasswordField.label);
        passwordFieldset.appendChild(confirmPasswordField.input);

        // Password change OTP section
        const passwordOtpSection = document.createElement('div');
        passwordOtpSection.id = 'password_otp_section';
        passwordOtpSection.style.display = 'none';

        const passwordOtpSendBtn = document.createElement('button');
        passwordOtpSendBtn.type = 'button';
        passwordOtpSendBtn.classList.add('user_profile_action_button');
        applyTextLangKey(passwordOtpSendBtn, 'send_verification_code', 'Send verification code');
        passwordOtpSendBtn.id = 'password_otp_send_btn';
        passwordOtpSection.appendChild(passwordOtpSendBtn);

        const passwordOtpMessage = document.createElement('div');
        passwordOtpMessage.id = 'password_otp_message';
        passwordOtpMessage.style.cssText = 'font-size:0.85em;margin:4px 0;color:#666;';
        passwordOtpSection.appendChild(passwordOtpMessage);

        const passwordOtpField = createLabeledInput({
            labelText: 'Verification code',
            labelLangKey: 'otp',
            inputType: 'text',
            inputId: 'password_otp',
            inputName: 'password_otp',
            autocomplete: 'off',
        });
        passwordOtpField.label.style.display = 'none';
        passwordOtpField.input.style.display = 'none';
        passwordOtpSection.appendChild(passwordOtpField.label);
        passwordOtpSection.appendChild(passwordOtpField.input);

        passwordFieldset.appendChild(passwordOtpSection);

        const passwordSubmitButton = document.createElement('button');
        passwordSubmitButton.type = 'submit';
        passwordSubmitButton.classList.add('user_profile_action_button');
        applyTextLangKey(passwordSubmitButton, 'change_password', 'Change Password');

        passwordForm.appendChild(passwordFieldset);
        passwordForm.appendChild(passwordSubmitButton);
        container.appendChild(passwordForm);

        let originalUsername = '';
        let originalEmail = '';
        let profileCurrentPassword = '';

        const refreshProfileData = async () => {
            const profileData = await loadInitialData(usernameField.input, emailField.input, infoDiv);
            originalUsername = profileData.username;
            originalEmail = profileData.email;
            confirmEmailField.input.value = '';
            confirmEmailField.label.style.display = 'none';
            confirmEmailField.input.style.display = 'none';
        };

        // Show/hide confirm email based on whether email changed
        confirmEmailField.label.style.display = 'none';
        confirmEmailField.input.style.display = 'none';

        emailField.input.addEventListener('input', () => {
            const emailChanged = emailField.input.value.trim() !== originalEmail;
            confirmEmailField.label.style.display = emailChanged ? '' : 'none';
            confirmEmailField.input.style.display = emailChanged ? '' : 'none';
            emailOtpSection.style.display = emailChanged ? '' : 'none';
            if (!emailChanged) {
                confirmEmailField.input.value = '';
                emailOtpField.input.value = '';
                emailOtpField.label.style.display = 'none';
                emailOtpField.input.style.display = 'none';
                emailOtpMessage.textContent = '';
                if (usernameField.input.value.trim() === originalUsername) {
                    profileCurrentPassword = '';
                }
            }
        });

        // Email OTP send button
        emailOtpSendBtn.addEventListener('click', async () => {
            const newEmail = emailField.input.value.trim();
            if (!newEmail || !newEmail.includes('@')) {
                showWarningToast(translatedText('enter_new_email_first', 'Enter a new email address first.'));
                return;
            }
            const currentPassword = await requestCurrentPassword();
            if (!currentPassword) return;

            emailOtpSendBtn.disabled = true;
            try {
                const result = await endpoint_router('requestEmailChangeOTP', {
                    method: 'POST',
                    body_data: { new_email: newEmail, current_password: currentPassword },
                });
                emailOtpMessage.textContent = `${translatedText('verification_code_sent', 'Verification code sent')}: ${result.masked_email || newEmail}`;
                emailOtpField.label.style.display = '';
                emailOtpField.input.style.display = '';
                emailOtpField.input.focus();
                profileCurrentPassword = currentPassword;
            } catch (error) {
                showErrorToast(extractErrorMessage(error));
            } finally {
                emailOtpSendBtn.disabled = false;
            }
        });

        // Password OTP send button
        passwordOtpSendBtn.addEventListener('click', async () => {
            const currentPassword = currentPasswordField.input.value;
            if (!currentPassword) {
                showWarningToast(translatedText('enter_current_password_first', 'Enter your current password first.'));
                return;
            }
            passwordOtpSendBtn.disabled = true;
            try {
                const result = await endpoint_router('requestPasswordChangeOTP', {
                    method: 'POST',
                    body_data: { current_password: currentPassword },
                });
                passwordOtpMessage.textContent = `${translatedText('verification_code_sent', 'Verification code sent')}: ${result.masked_email || ''}`;
                passwordOtpField.label.style.display = '';
                passwordOtpField.input.style.display = '';
                passwordOtpField.input.focus();
            } catch (error) {
                showErrorToast(extractErrorMessage(error));
            } finally {
                passwordOtpSendBtn.disabled = false;
            }
        });

        // Show password OTP section when password fields have content
        const showPasswordOtpIfNeeded = () => {
            const hasNewPassword = newPasswordField.input.value.length > 0;
            passwordOtpSection.style.display = hasNewPassword ? '' : 'none';
        };
        newPasswordField.input.addEventListener('input', showPasswordOtpIfNeeded);

        profileForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const username = usernameField.input.value.trim();
            const email = emailField.input.value.trim();

            if (email !== originalEmail && email && !email.includes('@')) {
                showWarningToast(translatedText('email_must_contain_at', 'Email must contain "@".'));
                return;
            }

            if (email !== originalEmail && email !== confirmEmailField.input.value.trim()) {
                showWarningToast(translatedText('email_confirm_email_must_match', 'Email and confirm email must match.'));
                return;
            }

            const hasIdentifierChanges = username !== originalUsername || email !== originalEmail;
            let currentPassword = profileCurrentPassword || currentPasswordField.input.value;
            if (hasIdentifierChanges && !currentPassword) {
                currentPassword = await requestCurrentPassword() || '';
                if (!currentPassword) return;
                profileCurrentPassword = currentPassword;
            }

            const body = buildProfileUpdateBody({
                originalUsername,
                originalEmail,
                username,
                email,
                emailOtp: emailOtpField.input.value,
                currentPassword,
            });

            if (Object.keys(body).length === 0) {
                showInfoToast(translatedText('no_profile_changes_to_save', 'No changes to save.'));
                return;
            }

            profileSubmitButton.disabled = true;
            try {
                await endpoint_router('updateUserProfile', {
                    method: 'POST',
                    body_data: body,
                });
                showSuccessToast(translatedText('profile_updated_successfully', 'Profile updated successfully.'));
                emailOtpField.input.value = '';
                emailOtpField.label.style.display = 'none';
                emailOtpField.input.style.display = 'none';
                emailOtpMessage.textContent = '';
                emailOtpSection.style.display = 'none';
                profileCurrentPassword = '';
                await refreshProfileData();
            } catch (error) {
                const errorMessage = extractErrorMessage(error);
                if (errorMessage.includes('current_password')) {
                    profileCurrentPassword = '';
                }
                showErrorToast(errorMessage);
            } finally {
                profileSubmitButton.disabled = false;
            }
        });

        passwordForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const currentPassword = currentPasswordField.input.value;
            const newPassword = newPasswordField.input.value;
            const confirmPassword = confirmPasswordField.input.value;

            if (!currentPassword) {
                showWarningToast(translatedText('profile_current_password_required', 'Current password is required.'));
                return;
            }

            if (!newPassword) {
                showWarningToast(translatedText('profile_new_password_required', 'New password is required.'));
                return;
            }

            if (newPassword !== confirmPassword) {
                showWarningToast(translatedText('profile_new_password_confirm_mismatch', 'New password and confirm password must match.'));
                return;
            }

            const body = buildPasswordUpdateBody({
                currentPassword,
                newPassword,
                passwordOtp: passwordOtpField.input.value,
            });

            passwordSubmitButton.disabled = true;
            try {
                await endpoint_router('updateUserProfile', {
                    method: 'POST',
                    body_data: body,
                });
                showSuccessToast(translatedText('password_changed_successfully', 'Password changed successfully.'));
                clearPasswordInputs(currentPasswordField.input, newPasswordField.input, confirmPasswordField.input);
                passwordOtpField.input.value = '';
                passwordOtpField.label.style.display = 'none';
                passwordOtpField.input.style.display = 'none';
                passwordOtpMessage.textContent = '';
                passwordOtpSection.style.display = 'none';
            } catch (error) {
                showErrorToast(extractErrorMessage(error));
            } finally {
                passwordSubmitButton.disabled = false;
            }
        });

        await refreshProfileData();
    } catch (error) {
        console.warn('Error in generate_user_view:', error);
    }
}

/**
 * createLabeledInput — builds a form label and input pair.
 * Operates between field metadata and concrete DOM elements.
 * Exists to keep profile form assembly consistent and concise.
 *
 * @param {{ labelText: string, labelLangKey?: string, inputType: string, inputId: string, inputName: string }} options
 * @returns {{ label: HTMLLabelElement, input: HTMLInputElement }}
 */
function createLabeledInput(options) {
    const label = document.createElement('label');
    label.textContent = options.labelText;
    if (options.labelLangKey) {
        label.dataset.langKey = options.labelLangKey;
    }
    label.setAttribute('for', options.inputId);

    const input = document.createElement('input');
    input.id = options.inputId;
    input.autocomplete = options.autocomplete || 'off';

    // Firefox ignores autocomplete="off" for password and username fields.
    // Workaround: create as readonly + text type, switch on focus.
    if (options.inputType === 'password') {
        input.type = 'text';
        input.readOnly = true;
        input.name = options.inputName + '_' + Date.now();
        input.addEventListener('focus', () => {
            input.readOnly = false;
            input.type = 'password';
            input.name = options.inputName;
        }, { once: true });
    } else {
        input.type = options.inputType;
        input.name = options.inputName;
        input.readOnly = true;
        input.addEventListener('focus', () => {
            input.readOnly = false;
        }, { once: true });
    }

    return { label, input };
}

/**
 * loadInitialData — fetches user profile details and fills form fields.
 * Operates between /api/user-profile data and the rendered profile view.
 * Exists to keep initial load and post-save refresh behavior identical.
 *
 * @param {HTMLInputElement} userInput
 * @param {HTMLInputElement} emailInput
 * @param {HTMLDivElement} infoDiv
 * @returns {Promise<{username: string, email: string}>}
 */
async function loadInitialData(userInput, emailInput, infoDiv) {
    try {
        const data = await endpoint_router('fetchUserProfile');
        const username = typeof data?.username === 'string' ? data.username : '';
        const email = typeof data?.email === 'string' ? data.email : '';

        userInput.value = username;
        emailInput.value = email;
        renderLoggedInAs(infoDiv, username);

        return { username, email };
    } catch (error) {
        console.warn('loadInitialData', error);
        renderLoggedInAs(infoDiv);
        return { username: '', email: '' };
    }
}

/**
 * renderLoggedInAs — renders a translatable prefix beside the current username.
 * Operates between translation-aware label spans and dynamic profile data.
 * Exists so the fixed UI text can be localized without overwriting the username.
 *
 * @param {HTMLDivElement} infoDiv
 * @param {string} [username='']
 */
function renderLoggedInAs(infoDiv, username = '') {
    const label = document.createElement('span');
    applyTextLangKey(label, 'logged_in_as', 'Logged in as');
    infoDiv.replaceChildren(label);
    if (username) {
        infoDiv.append(` ${username}`);
    }
}

/**
 * clearPasswordInputs — clears all password fields after save.
 * Operates between save completion and password form controls.
 * Exists to avoid keeping sensitive values in the UI.
 *
 * @param {HTMLInputElement} currentPasswordInput
 * @param {HTMLInputElement} newPasswordInput
 * @param {HTMLInputElement} confirmPasswordInput
 */
function clearPasswordInputs(currentPasswordInput, newPasswordInput, confirmPasswordInput) {
    currentPasswordInput.value = '';
    newPasswordInput.value = '';
    confirmPasswordInput.value = '';
}

/**
 * extractErrorMessage — normalizes thrown API errors into user-facing text.
 * Operates between endpoint_router error format and UI messaging.
 * Exists to avoid exposing route prefixes or raw JSON blobs when possible.
 *
 * @param {unknown} error
 * @returns {string}
 */
function extractErrorMessage(error) {
    const fallbackMessage = translatedText('unable_to_save_profile_changes', 'Unable to save profile changes.');
    if (!error) return fallbackMessage;

    if (typeof error === 'string' && error.trim()) {
        return error.trim();
    }

    const rawMessage = typeof error.message === 'string' ? error.message : '';
    if (!rawMessage.trim()) {
        return fallbackMessage;
    }

    const cleanedMessage = rawMessage.replace(/^Virhe pyynnössä \([^)]*\):\s*/, '').trim();
    const parsedMessage = extractMessageFromJson(cleanedMessage);

    return parsedMessage || cleanedMessage || fallbackMessage;
}

/**
 * extractMessageFromJson — extracts message-like values from JSON error strings.
 * Operates between serialized backend error objects and displayable text.
 * Exists to keep profile errors readable without duplicating pipeline logic.
 *
 * @param {string} text
 * @returns {string}
 */
function extractMessageFromJson(text) {
    if (!text) return '';

    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'string' && parsed.trim()) {
            return parsed.trim();
        }

        if (!parsed || typeof parsed !== 'object') {
            return '';
        }

        const keys = ['error', 'message', 'detail', 'reason'];
        for (const key of keys) {
            const value = parsed[key];
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
    } catch {
        return '';
    }

    return '';
}
