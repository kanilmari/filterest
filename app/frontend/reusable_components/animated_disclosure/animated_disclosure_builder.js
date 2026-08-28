// animated_disclosure_builder.js
// Builds reusable animated disclosure sections with a persistent header and measured content height.
// Bridges header/title/icon DOM, arbitrary content containers, and the shared collapsible height controller.
// Exists to make accordion-style show/hide behavior consistent across filterbar and reusable UI sections.

import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";
import { createCollapsibleHeightController } from "../collapsible_height/collapsible_height_controller.js";

const CHEVRON_ICON_PATH = "/frontend/icons/general/chevron-down-icon.svg";

let disclosureIdCounter = 0;

function normalizeClassNames(classNames = []) {
    if (typeof classNames === "string") {
        return classNames.trim() ? [classNames.trim()] : [];
    }
    if (!Array.isArray(classNames)) {
        return [];
    }
    return classNames
        .flatMap((className) => normalizeClassNames(className))
        .map((className) => className.trim())
        .filter(Boolean);
}

function buildDisclosureTitle({ iconPath, iconClassName, titleLangKey, titleText }) {
    const titleGroup = document.createElement("span");
    titleGroup.classList.add("animated-disclosure-title-group");

    if (iconPath) {
        const icon = createMaskIconSpan(iconPath, [
            "animated-disclosure-icon",
            ...normalizeClassNames(iconClassName),
        ]);
        icon.setAttribute("aria-hidden", "true");
        titleGroup.appendChild(icon);
    }

    const label = document.createElement("span");
    label.classList.add("animated-disclosure-title");
    if (titleLangKey) {
        label.dataset.langKey = titleLangKey;
    }
    label.textContent = titleText ?? "";
    titleGroup.appendChild(label);

    return titleGroup;
}

/**
 * Build a header-persistent animated disclosure section around arbitrary content.
 * Between caller-owned content elements and createCollapsibleHeightController.
 * Exists so collapsed sections leave only their header visible while expanded
 * sections return to natural full height.
 *
 * @param {{
 *   titleLangKey?: string,
 *   titleText?: string,
 *   iconPath?: string,
 *   iconClassName?: string|string[],
 *   contentElement: HTMLElement,
 *   sectionElement?: HTMLElement,
 *   startOpen?: boolean,
 *   sectionClassNames?: string|string[],
 *   headerClassNames?: string|string[],
 *   contentClassNames?: string|string[],
 *   collapsedHeaderClassName?: string,
 *   collapsedContentClassName?: string,
 *   durationMs?: number|string,
 *   easing?: string,
 *   observeResize?: boolean,
 * }} options
 * @returns {HTMLElement & {
 *   expand: (animationOptions?: object) => Promise<unknown>,
 *   collapse: (animationOptions?: object) => Promise<unknown>,
 *   toggle: (animationOptions?: object) => Promise<unknown>,
 *   sync: (animationOptions?: object) => Promise<unknown>,
 *   destroy: () => void,
 * }}
 */
export function createAnimatedDisclosureSection(options = {}) {
    const {
        titleLangKey = "",
        titleText = "",
        iconPath = "",
        iconClassName = [],
        contentElement,
        sectionElement = document.createElement("section"),
        startOpen = true,
        sectionClassNames = [],
        headerClassNames = [],
        contentClassNames = [],
        collapsedHeaderClassName = "",
        collapsedContentClassName = "",
        durationMs,
        easing,
        observeResize = true,
    } = options;

    if (!(sectionElement instanceof HTMLElement)) {
        throw new TypeError("createAnimatedDisclosureSection expects sectionElement to be an HTMLElement");
    }
    if (!(contentElement instanceof HTMLElement)) {
        throw new TypeError("createAnimatedDisclosureSection expects contentElement to be an HTMLElement");
    }

    const contentId = `animated-disclosure-content-${++disclosureIdCounter}`;
    const section = sectionElement;
    section.classList.add("animated-disclosure-section", ...normalizeClassNames(sectionClassNames));

    const header = document.createElement("button");
    header.type = "button";
    header.classList.add("animated-disclosure-header", ...normalizeClassNames(headerClassNames));
    header.setAttribute("aria-controls", contentId);

    const chevron = createMaskIconSpan(CHEVRON_ICON_PATH, ["animated-disclosure-chevron"]);
    chevron.setAttribute("aria-hidden", "true");

    header.append(
        buildDisclosureTitle({ iconPath, iconClassName, titleLangKey, titleText }),
        chevron,
    );

    const contentShell = document.createElement("div");
    contentShell.classList.add("animated-disclosure-content-shell");
    contentShell.id = contentId;

    contentElement.classList.add("animated-disclosure-content", ...normalizeClassNames(contentClassNames));
    contentShell.appendChild(contentElement);

    section.append(header, contentShell);

    const heightController = createCollapsibleHeightController(contentShell, {
        startExpanded: Boolean(startOpen),
        hiddenWhenCollapsed: true,
        observeResize,
        durationMs,
        easing,
    });

    function setStateAttributes(isExpanded) {
        section.dataset.disclosureState = isExpanded ? "expanded" : "collapsed";
        section.classList.toggle("is-expanded", isExpanded);
        section.classList.toggle("is-collapsed", !isExpanded);
        header.setAttribute("aria-expanded", String(isExpanded));
        contentShell.classList.toggle("is-expanded", isExpanded);
        contentShell.classList.toggle("is-collapsed", !isExpanded);
        if (collapsedHeaderClassName) {
            header.classList.toggle(collapsedHeaderClassName, !isExpanded);
        }
        if (collapsedContentClassName) {
            contentElement.classList.toggle(collapsedContentClassName, !isExpanded);
        }
    }

    function emitToggle(isExpanded) {
        section.dispatchEvent(new CustomEvent("animated-disclosure-toggle", {
            bubbles: true,
            detail: {
                expanded: isExpanded,
                section,
            },
        }));
    }

    function setExpanded(nextExpanded, animationOptions = {}) {
        const isExpanded = Boolean(nextExpanded);
        setStateAttributes(isExpanded);
        const operation = isExpanded
            ? heightController.expand(animationOptions)
            : heightController.collapse(animationOptions);
        return operation.then(() => {
            emitToggle(isExpanded);
        });
    }

    header.addEventListener("click", () => {
        void setExpanded(!heightController.isExpanded());
    });

    section.expand = (animationOptions = {}) => setExpanded(true, animationOptions);
    section.collapse = (animationOptions = {}) => setExpanded(false, animationOptions);
    section.toggle = (animationOptions = {}) => setExpanded(!heightController.isExpanded(), animationOptions);
    section.sync = (animationOptions = {}) => heightController.sync(animationOptions);
    section.destroy = () => {
        heightController.destroy();
    };

    setStateAttributes(Boolean(startOpen));

    return section;
}
