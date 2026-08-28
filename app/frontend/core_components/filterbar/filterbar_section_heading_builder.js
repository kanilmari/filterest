// filterbar_section_heading_builder.js
// Builds compact titled headings for sections inside the filterbar.
// Bridges icon-mask assets, language-key spans, and filterbar section containers.
// Exists so tools, filters, and related filterbar groups share one heading pattern.

import { createMaskIconSpan } from "../../icons/icon_mask_builder.js";
import { createAnimatedDisclosureSection } from "../../reusable_components/animated_disclosure/animated_disclosure_builder.js";

export function buildFilterbarSectionHeading({ iconPath, iconClassName, langKey, fallbackText }) {
    const heading = document.createElement("div");
    heading.classList.add("filterbar-section-heading");

    const icon = createMaskIconSpan(iconPath, [
        "filterbar-section-heading-icon",
        iconClassName,
    ]);
    icon.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.dataset.langKey = langKey;
    label.textContent = fallbackText;

    heading.append(icon, label);
    return heading;
}

export function buildFilterbarDisclosureSection({
    iconPath,
    iconClassName,
    langKey,
    fallbackText,
    contentElement,
    sectionElement,
    sectionClassNames = [],
    contentClassNames = [],
    startOpen = false,
}) {
    return createAnimatedDisclosureSection({
        titleLangKey: langKey,
        titleText: fallbackText,
        iconPath,
        iconClassName: [
            "filterbar-section-heading-icon",
            iconClassName,
        ],
        contentElement,
        sectionElement,
        startOpen,
        sectionClassNames: [
            "filterbar-disclosure-section",
            ...(
                Array.isArray(sectionClassNames)
                    ? sectionClassNames
                    : [sectionClassNames]
            ),
        ],
        headerClassNames: ["filterbar-section-heading"],
        contentClassNames: [
            "filterbar-disclosure-content",
            ...(
                Array.isArray(contentClassNames)
                    ? contentClassNames
                    : [contentClassNames]
            ),
        ],
        observeResize: false,
    });
}
