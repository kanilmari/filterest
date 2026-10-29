// first_run_admin_page.js
// Initializes the first-run form's shared preferences, section navigation, and factor fields.
// Bridges server-rendered choices with reusable standalone-auth and form-navigation components.
// Exists so First Run owns only its method-specific visibility rules.

import { mountPinSetup, mountEmbeddedSecondStep } from "./second_step_view.js";
import { translatePage } from "../lang/translation_handler.js";
import { getLanguageWithBrowserFallback } from "../state_stores/lang_preference_reader.js";
import { authPreferenceControlsReady } from "./auth_preference_controls.js";
import { initializeFormSectionNavigator, initializeFormSectionNavigators } from "../../reusable_components/form_section_navigator/form_section_navigator.js";

if (document.documentElement.dataset.shellBootProbe === '--filterest-auth-css-applied') {
    window.__filterestShellBoot?.evaluated();
}

function updateVerificationFields(form) {
    const method = form.querySelector('input[name="verification_method"]:checked')?.value || "";
    form.querySelectorAll("[data-verification-fields]").forEach((container) => {
        const active = container.dataset.verificationFields === method;
        container.hidden = !active;
        container.toggleAttribute("inert", !active);
        container.querySelectorAll("input, button").forEach((input) => {
            if (input instanceof HTMLInputElement) input.required = active;
            input.disabled = !active;
        });
    });
}

export function initializeFirstRunAdminPage(root = document) {
    root.querySelectorAll('[data-pin-setup]').forEach(fields => mountPinSetup(fields, {
        beforeErrorFocus: () => initializeFormSectionNavigator(fields.closest('form'))?.goTo('settings'),
    }));
    root.querySelectorAll('[data-totp-setup]').forEach(fields => {
        if (fields.classList.contains('auth-verify')) return;
        const view = mountEmbeddedSecondStep(fields, 'totp_setup');
        if (fields.dataset.setupError === 'first_run_totp_invalid') view.fieldError('first_run_totp_invalid', false);
        view.input.addEventListener('invalid', () => view.fieldError('verification_totp_format', false));
    });
    // Only field-owned errors replace the original general factor-error display.
    root.querySelectorAll('[data-factor-error]').forEach(error => {
        if (['first_run_fixed_pin_invalid', 'first_run_fixed_pin_mismatch', 'first_run_totp_invalid']
            .includes(error.dataset.langKey)) error.remove();
    });
    initializeFormSectionNavigators(root);
    const form = root.querySelector("#first-run-admin-form");
    if (!(form instanceof HTMLFormElement)) return null;

    form.querySelectorAll('input[name="verification_method"]').forEach((radio) => {
        radio.addEventListener("change", () => updateVerificationFields(form));
    });
    updateVerificationFields(form);
    return form;
}

initializeFirstRunAdminPage(document);
if (document.documentElement.dataset.shellBootProbe === "--filterest-auth-css-applied") {
    void authPreferenceControlsReady
        .then(() => translatePage(getLanguageWithBrowserFallback()))
        .then(() => window.__filterestShellBoot?.ready());
}
