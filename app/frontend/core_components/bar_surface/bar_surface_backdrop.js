// bar_surface_backdrop.js
// Shows the displayed view's background picture beneath docked frosted bars (WL182, owner decision D2).
// Bridges the view's own picture layers (view_presentation_media_resolver.js) and the one window-sized
// layer that bar_surface_frosted.css paints on .body_content.
// Exists because a docked menu or filter rail stands on the bare page colour, where glass shows nothing;
// it runs only while the frosted look is on, so the solid bars gain no observer and no writes.

import { resolveViewPresentationBackdrop } from "../navigation/main_tabs/view_presentation_media_resolver.js";

/** Present on .body_content while a picture is published; the stylesheet draws the layer only then. */
export const BAR_BACKDROP_ATTRIBUTE = "data-bar-backdrop";
const PROPERTIES = {
    image: "--bar-backdrop-image",
    position: "--bar-backdrop-position",
    opacity: "--bar-backdrop-opacity",
    washColor: "--bar-backdrop-wash-color",
    wash: "--bar-backdrop-wash",
};
// Records that can change which picture is displayed: view switches, Home and dataset media edits,
// Home's mount, and the theme (Home's strength and wash differ between light and dark). A resize
// can too, without any record: Home's image switches between its 1000 px and 2160 px variants.
const WATCHED = ["content_div", "tab-content-area", "front-page-background"];

function bodyContent() {
    return document.querySelector(".body_content");
}

/** Publishes the displayed picture on the shell, or clears it. Returns what was published. */
export function syncBarBackdrop(target = bodyContent(), resolve = resolveViewPresentationBackdrop) {
    if (!target) return null;
    const backdrop = resolve();
    for (const [field, property] of Object.entries(PROPERTIES)) {
        if (backdrop) target.style.setProperty(property, backdrop[field]);
        else target.style.removeProperty(property);
    }
    target.toggleAttribute(BAR_BACKDROP_ATTRIBUTE, Boolean(backdrop));
    return backdrop;
}

function relevant({ target }) {
    return target === document.body || target.id === "front_page_container"
        || WATCHED.some(name => target.classList?.contains(name));
}

let observer = null;
let frame = 0;
let resolveBackdrop = resolveViewPresentationBackdrop;

function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        syncBarBackdrop(bodyContent(), resolveBackdrop);
    });
}

/** Follows the displayed view while the frosted look is on; turning it off removes the layer. */
export function followBarBackdrop(enabled, resolve = resolveViewPresentationBackdrop) {
    resolveBackdrop = resolve;
    if (!enabled) {
        observer?.disconnect();
        observer = null;
        window.removeEventListener("resize", schedule);
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        syncBarBackdrop(bodyContent(), () => null);
        return;
    }
    if (observer || !document.body) return;
    observer = new MutationObserver(records => {
        if (records.some(relevant)) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ["class", "style", "hidden"] });
    window.addEventListener("resize", schedule);
    schedule();
}
