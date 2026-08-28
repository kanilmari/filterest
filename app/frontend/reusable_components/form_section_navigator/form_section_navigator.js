// form_section_navigator.js
// Builds reusable, validation-aware navigation for multi-section HTML forms.
// Bridges declarative form sections with accessible previous/next and section controls.
// Exists so multi-part forms can share one keyboard, focus, and validation contract.

import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";

const FORM_SELECTOR = "form[data-form-section-navigator]";
const SECTION_SELECTOR = ":scope > section[data-form-section]";
const controllerByForm = new WeakMap();

function sectionLabel(section) {
    return section.dataset.sectionLabel || section.dataset.sectionKey || "Section";
}

function buildDirectionButton(direction) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `form-section-navigator__arrow form-section-navigator__arrow--${direction}`;
    button.dataset.formSectionDirection = direction;
    button.dataset.ariaLabelLangKey = direction === "previous" ? "previous" : "next";
    button.setAttribute("aria-label", direction === "previous" ? "Previous" : "Next");
    button.appendChild(createMaskIconSpan(
        direction === "previous"
            ? "/frontend/icons/navigation/nav-history-back-icon.svg"
            : "/frontend/icons/navigation/nav-history-forward-icon.svg",
        ["form-section-navigator__arrow-icon"]
    ));
    return button;
}

function buildFooterButton(direction, form) {
    const button = document.createElement("button");
    const movesBack = direction === "previous";
    const nextLangKey = form.dataset.formSectionNextLangKey || "proceed";
    const nextLabel = form.dataset.formSectionNextLabel || "Proceed";
    button.type = "button";
    button.className = `form-section-navigator__footer-button form-section-navigator__footer-button--${direction}`;
    button.dataset.formSectionFooterDirection = direction;
    button.dataset.langKey = movesBack ? "back" : nextLangKey;
    button.textContent = movesBack ? "Back" : nextLabel;
    return button;
}

function buildFooterControls(form) {
    const footer = document.createElement("div");
    footer.className = "form-section-navigator__footer";
    footer.dataset.formSectionNavigatorFooter = "";

    const previousButton = buildFooterButton("previous", form);
    const nextButton = buildFooterButton("next", form);
    footer.append(previousButton, nextButton);
    return { footer, previousButton, nextButton };
}

function buildNavigator(sections) {
    const nav = document.createElement("nav");
    nav.className = "form-section-navigator";
    nav.dataset.formSectionNavigatorControls = "";
    nav.dataset.ariaLabelLangKey = "form_sections";
    nav.setAttribute("aria-label", "Form sections");

    const previousButton = buildDirectionButton("previous");
    const steps = document.createElement("ol");
    steps.className = "form-section-navigator__steps";

    const stepButtons = sections.map((section) => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "form-section-navigator__step";
        button.dataset.formSectionTarget = section.dataset.sectionKey;
        button.dataset.langKey = section.dataset.sectionLabelLangKey || "";
        button.setAttribute("aria-controls", section.id);
        button.textContent = sectionLabel(section);
        item.appendChild(button);
        steps.appendChild(item);
        return button;
    });

    const nextButton = buildDirectionButton("next");
    nav.append(previousButton, steps, nextButton);
    return { nav, previousButton, nextButton, stepButtons };
}

function setSectionAvailability(section, active) {
    section.hidden = !active;
    section.toggleAttribute("inert", !active);
    section.setAttribute("aria-hidden", String(!active));
}

function validateSection(section) {
    const fields = Array.from(section.querySelectorAll("input, select, textarea"));
    const invalidField = fields.find((field) => !field.disabled && !field.checkValidity());
    if (!invalidField) return true;
    invalidField.reportValidity();
    invalidField.focus();
    return false;
}

/**
 * Initializes a form marked with data-form-section-navigator.
 *
 * @param {HTMLFormElement} form
 * @returns {{goTo: Function, next: Function, previous: Function, destroy: Function}|null}
 */
export function initializeFormSectionNavigator(form) {
    if (!(form instanceof HTMLFormElement)) return null;
    if (controllerByForm.has(form)) return controllerByForm.get(form);

    const sections = Array.from(form.querySelectorAll(SECTION_SELECTOR));
    if (sections.length < 2) return null;

    sections.forEach((section, index) => {
        if (!section.dataset.sectionKey) section.dataset.sectionKey = `section-${index + 1}`;
        if (!section.id) section.id = `${form.id || "form"}-${section.dataset.sectionKey}`;
    });

    const controls = buildNavigator(sections);
    const footerControls = buildFooterControls(form);
    form.prepend(controls.nav);
    form.append(footerControls.footer);
    let currentIndex = Math.max(0, sections.findIndex(
        (section) => section.dataset.sectionKey === form.dataset.initialSection
    ));

    function render({ focusStep = false } = {}) {
        sections.forEach((section, index) => setSectionAvailability(section, index === currentIndex));
        controls.stepButtons.forEach((button, index) => {
            const active = index === currentIndex;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-current", active ? "step" : "false");
            button.tabIndex = active ? 0 : -1;
        });
        controls.previousButton.disabled = currentIndex === 0;
        controls.nextButton.disabled = currentIndex === sections.length - 1;
        footerControls.previousButton.hidden = currentIndex === 0;
        footerControls.nextButton.hidden = currentIndex === sections.length - 1;
        if (focusStep) controls.stepButtons[currentIndex].focus();
    }

    function goTo(target, options = {}) {
        const nextIndex = typeof target === "number"
            ? target
            : sections.findIndex((section) => section.dataset.sectionKey === target);
        if (nextIndex < 0 || nextIndex >= sections.length || nextIndex === currentIndex) return false;
        if (nextIndex > currentIndex && !validateSection(sections[currentIndex])) return false;

        const previousKey = sections[currentIndex].dataset.sectionKey;
        currentIndex = nextIndex;
        render(options);
        form.dispatchEvent(new CustomEvent("form-section-change", {
            bubbles: true,
            detail: {
                previous: previousKey,
                current: sections[currentIndex].dataset.sectionKey,
                index: currentIndex,
            },
        }));
        return true;
    }

    const handleInvalid = (event) => {
        const invalidSection = event.target.closest?.("section[data-form-section]");
        if (!invalidSection) return;
        const invalidIndex = sections.indexOf(invalidSection);
        if (invalidIndex >= 0 && invalidIndex !== currentIndex) {
            currentIndex = invalidIndex;
            render();
        }
    };

    const controller = {
        goTo,
        next: () => goTo(currentIndex + 1),
        previous: () => goTo(currentIndex - 1),
        destroy: () => {
            controls.nav.remove();
            footerControls.footer.remove();
            sections.forEach((section) => {
                section.hidden = false;
                section.removeAttribute("inert");
                section.removeAttribute("aria-hidden");
            });
            form.removeEventListener("invalid", handleInvalid, true);
            controllerByForm.delete(form);
        },
    };

    controls.previousButton.addEventListener("click", controller.previous);
    controls.nextButton.addEventListener("click", controller.next);
    footerControls.previousButton.addEventListener("click", controller.previous);
    footerControls.nextButton.addEventListener("click", controller.next);
    controls.stepButtons.forEach((button, index) => {
        button.addEventListener("click", () => goTo(index));
        button.addEventListener("keydown", (event) => {
            const targets = {
                ArrowLeft: currentIndex - 1,
                ArrowRight: currentIndex + 1,
                Home: 0,
                End: sections.length - 1,
            };
            if (!(event.key in targets)) return;
            event.preventDefault();
            goTo(targets[event.key], { focusStep: true });
        });
    });
    form.addEventListener("invalid", handleInvalid, true);

    controllerByForm.set(form, controller);
    render();
    return controller;
}

export function initializeFormSectionNavigators(root = document) {
    return Array.from(root.querySelectorAll(FORM_SELECTOR))
        .map((form) => initializeFormSectionNavigator(form))
        .filter(Boolean);
}
