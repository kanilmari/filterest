// first_run_admin_page.js
// Initializes the first-run form's shared preferences, section navigation, and factor fields.
// Bridges server-rendered choices with reusable standalone-auth and form-navigation components.
// Exists so First Run owns only its method-specific visibility rules.

import "./auth_preference_controls.js";
import { initializeFormSectionNavigators } from "../../reusable_components/form_section_navigator/form_section_navigator.js";

function updateVerificationFields(form) {
    const method = form.querySelector('input[name="verification_method"]:checked')?.value || "";
    form.querySelectorAll("[data-verification-fields]").forEach((container) => {
        const active = container.dataset.verificationFields === method;
        container.hidden = !active;
        container.toggleAttribute("inert", !active);
        container.querySelectorAll("input").forEach((input) => {
            input.required = active;
            input.disabled = !active;
        });
    });
}

export function initializeFirstRunAdminPage(root = document) {
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
