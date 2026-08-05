// dark_overlay_handler.js
// Provides the reusable dark overlay used behind modals and mobile panels.
// Bridges overlay DOM creation and visibility control with components that need backdrop behavior.
// Exists to centralize backdrop handling instead of re-creating overlay logic in each feature.

/**
 * Yksinkertainen reusable-luokka tummennetulle overlay‐taustalle.
 * - Luo elementin automaattisesti konstruktorissa
 * - Ei vaadi valmista HTML-raken-netta
 * - API: showOverlay(), hideOverlay(), toggleOverlayVisibility(), destroyOverlay()
 */
export default class OverlayFilter {
    /**
     * @param {Object} userOptions -
     *        overlayId         : string   (oletus "mobileFilterOverlay")
     *        overlayClassName  : string   (oletus "mfo-overlay")
     *        overlayOpacity    : number   (0-1, oletus 0.4)
     *        overlayZIndex     : number   (oletus --z-overlay CSS variable)
     */
    constructor(userOptions = {}) {

        const {
            overlayId = "mobileFilterOverlay",
            overlayClassName = "mfo-overlay",
            overlayOpacity = 0.6,
            overlayZIndex = 100000,
        } = userOptions;

        this.overlayElementId = overlayId;
        this.overlayClassName = overlayClassName;
        this.overlayOpacity = overlayOpacity;
        this.overlayZIndex = overlayZIndex;

        this.overlayElementReference = null;

        this.#createOverlayElementIfNeeded();
    }

    /** Luo overlay-elementin, mikäli sitä ei vielä ole */
    #createOverlayElementIfNeeded() {

        const overlayHost =
            document.getElementById("tabs_container") ||
            document.querySelector(".body_content") ||
            document.body;

        // jos identtinen overlay on jo DOMissa, käytetään sitä
        const alreadyExisting = document.getElementById(this.overlayElementId);
        if (alreadyExisting) {
            alreadyExisting.classList.add(this.overlayClassName);
            // Ensure overlay stays CSS-driven (no inline styles).
            alreadyExisting.removeAttribute("style");
            if (alreadyExisting.parentElement !== overlayHost) {
                overlayHost.appendChild(alreadyExisting);
            }

            this.overlayElementReference = alreadyExisting;
            return;
        }

        // muuten luodaan uusi
        const freshlyCreatedOverlay = document.createElement("div");
        freshlyCreatedOverlay.id = this.overlayElementId;
        freshlyCreatedOverlay.className = this.overlayClassName;
        // freshlyCreatedOverlay.dataset.langKey = "overlay_background";

        // Keep the backdrop in the same app-shell stacking context as the
        // panel it belongs to. Filterbar panels live under #tabs_container, so
        // anchoring the default overlay there prevents it from covering the
        // drawer it is meant to sit behind.
        overlayHost.appendChild(freshlyCreatedOverlay);
        this.overlayElementReference = freshlyCreatedOverlay;
    }

    /** Näytä overlay */
    showOverlay() {
        if (this.overlayElementReference) {
            this.overlayElementReference.classList.add(
                `${this.overlayClassName}--visible`
            );
        }
    }

    /** Piilota overlay */
    hideOverlay() {
        if (this.overlayElementReference) {
            this.overlayElementReference.classList.remove(
                `${this.overlayClassName}--visible`
            );
        }
    }

    /** Vaihda näkyvyystila */
    toggleOverlayVisibility() {
        if (!this.overlayElementReference) return;

        const currentlyVisible = this.overlayElementReference.classList.contains(
            `${this.overlayClassName}--visible`
        );
        currentlyVisible ? this.hideOverlay() : this.showOverlay();
    }

    /** Poista overlay kokonaan DOMista */
    destroyOverlay() {
        if (this.overlayElementReference) {
            this.overlayElementReference.remove();
            this.overlayElementReference = null;
        }
    }
}
