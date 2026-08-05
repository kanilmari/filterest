// collapsible_section_builder.js
// Builds reusable collapsible-section wrappers for frontend views.
// Bridges translated section titles and arbitrary content elements into an expandable UI container.
// Exists to keep collapsible section behavior standardized across feature modules.

import { createAnimatedDisclosureSection } from "../animated_disclosure/animated_disclosure_builder.js";

export function create_collapsible_section(title_translation_key, content_element, start_open = false, _translate = () => undefined) {
    const wrapper = createAnimatedDisclosureSection({
        titleLangKey: title_translation_key,
        titleText: "",
        contentElement: content_element,
        startOpen: start_open,
        sectionElement: document.createElement("div"),
        sectionClassNames: ["collapsible-section"],
        headerClassNames: ["collapsible-header"],
        contentClassNames: ["collapsible-content"],
        collapsedHeaderClassName: "collapsed",
        collapsedContentClassName: "hidden",
    });

    const isChatSection = title_translation_key.includes("Chat");
    function syncChatBlur(isOpen) {
        if (!isChatSection) return;
        const filter_bar = wrapper.closest(".dataset-filter-panel");
        if (!filter_bar) return;
        filter_bar.classList.toggle("filter-blur", isOpen);
    }

    if (start_open) {
        setTimeout(() => syncChatBlur(true), 0);
    }
    wrapper.addEventListener("animated-disclosure-toggle", (event) => {
        syncChatBlur(Boolean(event.detail?.expanded));
    });

    return wrapper;
}
