// register_page_builder.js
// Builds registration factor-field behavior and standalone-page translation.
// Bridges server-rendered factor choices with direct and SPA-mounted registration forms.
// Exists so every registration entry path applies the same explicit sign-in verification rules.

import { translatePage } from "../lang/translation_handler.js";
import { getPreferredAvailableLanguage } from "../state_stores/lang_preference_reader.js";

const initializedRegistrationForms = new WeakSet();

function updateRegistrationVerificationFields(form) {
    const selectedMethod = form.querySelector('input[name="verification_method"]:checked')?.value || "";
    form.querySelectorAll("[data-register-verification-fields]").forEach((container) => {
        const active = container.dataset.registerVerificationFields === selectedMethod;
        container.hidden = !active;
        container.toggleAttribute("inert", !active);
        container.querySelectorAll("input").forEach((input) => {
            input.required = active;
            input.disabled = !active;
        });
    });
}

// initializeRegistrationVerificationFields makes factor inputs follow the explicit radio selection.
// It bridges one server-rendered registration form with its browser-side required/disabled state.
// It is idempotent so standalone and SPA mounting paths can safely call the same initializer.
export function initializeRegistrationVerificationFields(root = document) {
    const form = root instanceof HTMLFormElement && root.matches('[data-testid="register-form"]')
        ? root
        : root.querySelector?.('[data-testid="register-form"]');
    if (!(form instanceof HTMLFormElement)) return null;

    if (!initializedRegistrationForms.has(form)) {
        form.querySelectorAll('input[name="verification_method"]').forEach((radio) => {
            radio.addEventListener("change", () => updateRegistrationVerificationFields(form));
        });
        initializedRegistrationForms.add(form);
    }
    updateRegistrationVerificationFields(form);
    return form;
}

const standaloneForm = initializeRegistrationVerificationFields(document);
if (standaloneForm) {
    const chosenLanguage = getPreferredAvailableLanguage(["en", "fi"]);
    translatePage(chosenLanguage);
}
