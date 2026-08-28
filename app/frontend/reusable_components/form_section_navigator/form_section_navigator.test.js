// Verifies reusable form-section navigation, validation, and accessibility state.

import { beforeEach, describe, expect, test } from "vitest";
import { initializeFormSectionNavigator } from "./form_section_navigator.js";

function buildForm() {
    document.body.innerHTML = `
        <form id="profile" data-form-section-navigator>
            <section data-form-section data-section-key="settings" data-section-label="Settings">
                <input id="required-setting" required value="ready">
            </section>
            <section data-form-section data-section-key="credentials" data-section-label="Credentials">
                <input id="username" value="owner">
            </section>
        </form>`;
    return document.querySelector("form");
}

beforeEach(() => {
    document.body.innerHTML = "";
});

describe("initializeFormSectionNavigator", () => {
    test("renders the first section and boundary controls", () => {
        const form = buildForm();
        initializeFormSectionNavigator(form);

        expect(form.querySelector('[data-section-key="settings"]').hidden).toBe(false);
        expect(form.querySelector('[data-section-key="credentials"]').hidden).toBe(true);
        expect(form.querySelector('[data-form-section-direction="previous"]').disabled).toBe(true);
        expect(form.querySelector('[data-form-section-direction="next"]').disabled).toBe(false);
        expect(form.querySelector('[data-form-section-footer-direction="previous"]').hidden).toBe(true);
        expect(form.querySelector('[data-form-section-footer-direction="next"]').hidden).toBe(false);
        expect(form.querySelector('[data-form-section-footer-direction="next"]').textContent).toBe("Proceed");
        expect(form.querySelector('[data-form-section-target="settings"]').getAttribute("aria-current")).toBe("step");
    });

    test("offers matching bottom controls on each section", () => {
        const form = buildForm();
        initializeFormSectionNavigator(form);
        const proceed = form.querySelector('[data-form-section-footer-direction="next"]');
        const back = form.querySelector('[data-form-section-footer-direction="previous"]');

        proceed.click();
        expect(form.querySelector('[data-section-key="credentials"]').hidden).toBe(false);
        expect(proceed.hidden).toBe(true);
        expect(back.hidden).toBe(false);
        expect(back.textContent).toBe("Back");

        back.click();
        expect(form.querySelector('[data-section-key="settings"]').hidden).toBe(false);
    });

    test("allows a form to request a translated Next footer action", () => {
        const form = buildForm();
        form.dataset.formSectionNextLangKey = "next";
        form.dataset.formSectionNextLabel = "Next";
        initializeFormSectionNavigator(form);

        const nextButton = form.querySelector('[data-form-section-footer-direction="next"]');
        expect(nextButton.dataset.langKey).toBe("next");
        expect(nextButton.textContent).toBe("Next");
    });

    test("shows both bottom controls on an intermediate section", () => {
        const form = buildForm();
        const finalSection = document.createElement("section");
        finalSection.dataset.formSection = "";
        finalSection.dataset.sectionKey = "confirmation";
        finalSection.dataset.sectionLabel = "Confirmation";
        form.append(finalSection);
        initializeFormSectionNavigator(form);

        const proceed = form.querySelector('[data-form-section-footer-direction="next"]');
        const back = form.querySelector('[data-form-section-footer-direction="previous"]');
        proceed.click();

        expect(form.querySelector('[data-section-key="credentials"]').hidden).toBe(false);
        expect(back.hidden).toBe(false);
        expect(proceed.hidden).toBe(false);
    });

    test("moves forward and back without losing field values", () => {
        const form = buildForm();
        const controller = initializeFormSectionNavigator(form);
        expect(controller.next()).toBe(true);
        expect(form.querySelector('[data-section-key="credentials"]').hidden).toBe(false);
        expect(form.querySelector('[data-form-section-direction="next"]').disabled).toBe(true);
        expect(document.getElementById("username").value).toBe("owner");
        expect(controller.previous()).toBe(true);
    });

    test("blocks forward navigation when the current section is invalid", () => {
        const form = buildForm();
        document.getElementById("required-setting").value = "";
        const controller = initializeFormSectionNavigator(form);
        expect(controller.next()).toBe(false);
        expect(form.querySelector('[data-section-key="settings"]').hidden).toBe(false);
    });

    test("honors a server-selected initial section and initializes once", () => {
        const form = buildForm();
        form.dataset.initialSection = "credentials";
        const first = initializeFormSectionNavigator(form);
        const second = initializeFormSectionNavigator(form);
        expect(first).toBe(second);
        expect(form.querySelectorAll(".form-section-navigator")).toHaveLength(1);
        expect(form.querySelector('[data-section-key="credentials"]').hidden).toBe(false);
    });

    test("destroy restores all sections", () => {
        const form = buildForm();
        const controller = initializeFormSectionNavigator(form);
        controller.destroy();
        expect(form.querySelector(".form-section-navigator")).toBeNull();
        expect(form.querySelector(".form-section-navigator__footer")).toBeNull();
        expect(Array.from(form.querySelectorAll("section")).every((section) => !section.hidden)).toBe(true);
    });
});
