// card_image_modal.js
// Opens a shared on-demand image modal for card and article thumbnails.
// Bridges card media clicks with the reusable modal builder.
// Exists so article-view image galleries do not need a persistent large preview.

import {
    createModal,
    hideModal,
    showModal,
} from "../../../reusable_components/modal/modal_builder.js";
import {
    activateImageFirstStageTransitionMedia,
    settleImageFirstStageTransitionMedia,
} from "./row_article_image_first_stage.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';
const IMAGE_MODAL_CONTROL_IDLE_DELAY_MS = 1200;
const IMAGE_MODAL_SCROLL_HINT_HIDE_THRESHOLD_PX = 70;
const IMAGE_FIRST_VIEW_CLOSE_DURATION_MS = 300;
const IMAGE_FIRST_RECORD_TRANSITION_DURATION_MS = 300;
const imageFirstRecordTransitionStates = new WeakMap();
const IMAGE_MODAL_TRANSIENT_CONTROL_SELECTOR = [
    ".modal_close_button",
    ".row_article_image_first_arrow",
    ".row_article_row_navigation_button",
    ".row_article_image_first_scroll_hint",
].join(", ");
const imageModalControlTimers = new WeakMap();
const imageModalFocusHandlers = new WeakMap();
const imageModalScrollHandlers = new WeakMap();

function isTransientImageControl(target) {
    return target instanceof Element
        && Boolean(target.closest(IMAGE_MODAL_TRANSIENT_CONTROL_SELECTOR));
}

function setImageModalTopControls(modal, topControlElements = []) {
    const modalHeader = modal?.querySelector(":scope > .modal_header");
    if (!modalHeader) return null;

    const closeButton = modalHeader.querySelector(
        ":scope > .modal_close_button, "
        + ":scope > .image_modal_top_controls > .modal_close_button",
    );
    if (!closeButton) return null;

    let topControls = modalHeader.querySelector(":scope > .image_modal_top_controls");
    if (!topControls) {
        topControls = document.createElement("div");
        topControls.classList.add("image_modal_top_controls");
        topControls.dataset.testid = "image-modal-top-controls";
        modalHeader.appendChild(topControls);
    }
    const validTopControls = Array.isArray(topControlElements)
        ? topControlElements.filter((element) => element instanceof HTMLElement)
        : [];
    topControls.replaceChildren(...validTopControls, closeButton);
    return topControls;
}

function teardownImageFirstRecordTransition(modalOverlay) {
    const state = imageFirstRecordTransitionStates.get(modalOverlay);
    if (!state) return;
    window.clearTimeout(state.backdropSwapTimer);
    window.clearTimeout(state.finishTimer);
    modalOverlay.classList.remove("image-first-record-transitioning");
    state.outgoingView?.classList.remove("image_first_view--outgoing");
    state.incomingView?.classList.remove("image_first_view--incoming");
    if (state.outgoingView instanceof HTMLElement) {
        state.outgoingView.inert = false;
    }
    if (state.incomingView instanceof HTMLElement) {
        state.incomingView.inert = false;
    }
    state.restoreIncomingControls?.();
    state.modalBody?.removeAttribute("aria-busy");
    imageFirstRecordTransitionStates.delete(modalOverlay);
}

function lockImageFirstRecordControls(topControlElements) {
    const navigationElements = Array.isArray(topControlElements)
        ? topControlElements.filter((element) => element instanceof HTMLElement)
        : [];
    navigationElements.forEach((element) => element.setAttribute("aria-busy", "true"));
    return () => {
        navigationElements.forEach((element) => element.removeAttribute("aria-busy"));
    };
}

function clearImageModalControlTimer(modalOverlay) {
    const existingTimer = imageModalControlTimers.get(modalOverlay);
    if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        imageModalControlTimers.delete(modalOverlay);
    }
}

function teardownTransientImageControls(modalOverlay) {
    clearImageModalControlTimer(modalOverlay);
    modalOverlay.onpointermove = null;
    modalOverlay.onpointerover = null;
    modalOverlay.onpointerout = null;
    modalOverlay.onpointerleave = null;

    const focusHandler = imageModalFocusHandlers.get(modalOverlay);
    if (focusHandler) {
        modalOverlay.removeEventListener("focusin", focusHandler);
        imageModalFocusHandlers.delete(modalOverlay);
    }

    const scrollBinding = imageModalScrollHandlers.get(modalOverlay);
    if (scrollBinding) {
        scrollBinding.element.removeEventListener("scroll", scrollBinding.handler);
        imageModalScrollHandlers.delete(modalOverlay);
    }

    modalOverlay.classList.remove(
        "image-modal-controls-active",
        "image-modal-content-scrolled",
    );
}

/**
 * Shows image controls after pointer or focus activity and pauses their idle
 * timer while the pointer remains over an actionable control. This bridges the
 * shared modal overlay with image-first controls so hovered actions stay usable.
 */
function installTransientImageControls(modalOverlay) {
    teardownTransientImageControls(modalOverlay);
    const hideControls = () => {
        clearImageModalControlTimer(modalOverlay);
        modalOverlay.classList.remove("image-modal-controls-active");
    };
    const scheduleControlsHide = () => {
        clearImageModalControlTimer(modalOverlay);
        imageModalControlTimers.set(
            modalOverlay,
            window.setTimeout(hideControls, IMAGE_MODAL_CONTROL_IDLE_DELAY_MS)
        );
    };
    const revealControls = ({ keepVisible = false } = {}) => {
        modalOverlay.classList.add("image-modal-controls-active");
        if (keepVisible) {
            clearImageModalControlTimer(modalOverlay);
        } else {
            scheduleControlsHide();
        }
    };
    modalOverlay.onpointermove = (event) => {
        revealControls({ keepVisible: isTransientImageControl(event.target) });
    };
    modalOverlay.onpointerover = (event) => {
        if (isTransientImageControl(event.target)) {
            revealControls({ keepVisible: true });
        }
    };
    modalOverlay.onpointerout = (event) => {
        if (isTransientImageControl(event.target)
            && !isTransientImageControl(event.relatedTarget)) {
            scheduleControlsHide();
        }
    };
    modalOverlay.onpointerleave = scheduleControlsHide;
    const previousFocusHandler = imageModalFocusHandlers.get(modalOverlay);
    if (previousFocusHandler) {
        modalOverlay.removeEventListener("focusin", previousFocusHandler);
    }
    const focusHandler = () => revealControls();
    modalOverlay.addEventListener("focusin", focusHandler);
    imageModalFocusHandlers.set(modalOverlay, focusHandler);

    const previousScrollBinding = imageModalScrollHandlers.get(modalOverlay);
    if (previousScrollBinding) {
        previousScrollBinding.element.removeEventListener(
            "scroll",
            previousScrollBinding.handler,
        );
    }
    const scrollContainer = modalOverlay.querySelector(
        ".image_modal.image_first_view_modal .modal_body",
    );
    if (scrollContainer) {
        const syncScrollHintVisibility = () => {
            modalOverlay.classList.toggle(
                "image-modal-content-scrolled",
                scrollContainer.scrollTop > IMAGE_MODAL_SCROLL_HINT_HIDE_THRESHOLD_PX,
            );
        };
        scrollContainer.addEventListener("scroll", syncScrollHintVisibility, {
            passive: true,
        });
        imageModalScrollHandlers.set(modalOverlay, {
            element: scrollContainer,
            handler: syncScrollHintVisibility,
        });
        syncScrollHintVisibility();
    } else {
        modalOverlay.classList.remove("image-modal-content-scrolled");
        imageModalScrollHandlers.delete(modalOverlay);
    }
    revealControls();
    return () => teardownTransientImageControls(modalOverlay);
}

/**
 * Replaces one already-open image-first record without closing its modal.
 * Both record surfaces coexist for the short handoff, while the outgoing
 * backdrop remains the sole full-viewport background throughout the swap.
 */
export function transitionImageFirstModalContent({
    contentElement,
    ariaLabel = "Image preview",
    topControlElements = [],
} = {}) {
    if (!(contentElement instanceof HTMLElement)) {
        return null;
    }

    const modalOverlay = document.getElementById("custom_modal_overlay");
    const modal = document.getElementById("custom_modal");
    const modalBody = modal?.querySelector(":scope > .modal_body");
    const outgoingView = modalBody?.querySelector(":scope > .image_first_view");
    const isOpenImageFirstView = modalOverlay instanceof HTMLElement
        && modal instanceof HTMLElement
        && modalBody instanceof HTMLElement
        && outgoingView instanceof HTMLElement
        && modalOverlay.style.display !== "none"
        && modalOverlay.classList.contains("image_first_view_overlay")
        && modal.classList.contains("image_first_view_modal");
    if (!isOpenImageFirstView) {
        return null;
    }

    const activeTransition = imageFirstRecordTransitionStates.get(modalOverlay);
    if (activeTransition) {
        return { modalOverlay, modal, close: hideModal };
    }

    const incomingView = contentElement;
    const outgoingStage = outgoingView.querySelector(
        ":scope > .row_article_image_first_stage",
    );
    const incomingStage = incomingView.querySelector(
        ":scope > .row_article_image_first_stage",
    );
    if (!(outgoingStage instanceof HTMLElement)
        || !(incomingStage instanceof HTMLElement)) {
        return null;
    }

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")
        ?.matches === true;
    const restoreIncomingControls = lockImageFirstRecordControls(topControlElements);
    setImageModalTopControls(modal, topControlElements);
    modal.setAttribute("aria-label", ariaLabel);
    modalBody.scrollTop = 0;

    const settleIncomingView = () => {
        settleImageFirstStageTransitionMedia(incomingStage);
        modalBody.replaceChildren(incomingView);
        incomingView.classList.remove("image_first_view--incoming");
        incomingView.classList.add("image_first_view--settled");
        incomingView.inert = false;
        restoreIncomingControls();
        modalBody.removeAttribute("aria-busy");
        modalOverlay.classList.remove("image-first-record-transitioning");
        imageFirstRecordTransitionStates.delete(modalOverlay);
    };

    if (reduceMotion) {
        settleIncomingView();
        return { modalOverlay, modal, close: hideModal };
    }

    modalBody.setAttribute("aria-busy", "true");
    activateImageFirstStageTransitionMedia(outgoingStage);
    activateImageFirstStageTransitionMedia(incomingStage);
    modalOverlay.classList.add("image-first-record-transitioning");
    outgoingView.classList.remove("image_first_view--settled");
    outgoingView.classList.add("image_first_view--outgoing");
    incomingView.classList.add("image_first_view--incoming");
    outgoingView.inert = true;
    incomingView.inert = true;
    modalBody.appendChild(incomingView);

    const backdropSwapTimer = window.setTimeout(() => {
        const incomingBackdrop = incomingStage.style.getPropertyValue(
            "--row-article-image-first-backdrop",
        );
        if (incomingBackdrop) {
            outgoingStage.style.setProperty(
                "--row-article-image-first-backdrop",
                incomingBackdrop,
            );
        }
    }, IMAGE_FIRST_RECORD_TRANSITION_DURATION_MS / 2);
    const finishTimer = window.setTimeout(
        settleIncomingView,
        IMAGE_FIRST_RECORD_TRANSITION_DURATION_MS,
    );
    imageFirstRecordTransitionStates.set(modalOverlay, {
        backdropSwapTimer,
        finishTimer,
        incomingView,
        modalBody,
        outgoingView,
        restoreIncomingControls,
    });
    return { modalOverlay, modal, close: hideModal };
}

/**
 * Opens the edge-free image surface with caller-supplied content.
 * The standalone preview and image-first article share modal lifecycle and
 * transient controls without coupling ordinary row articles to this overlay.
 */
export function openImageModalContent({
    contentElement,
    classNames = [],
    overlayClassNames = [],
    ariaLabel = "Image preview",
    topControlElements = [],
} = {}) {
    if (!(contentElement instanceof HTMLElement)) {
        return null;
    }

    const validModalClassNames = Array.isArray(classNames)
        ? classNames.filter((className) => typeof className === "string" && className)
        : [];
    const validOverlayClassNames = Array.isArray(overlayClassNames)
        ? overlayClassNames.filter((className) => typeof className === "string" && className)
        : [];
    const usesImageFirstCloseTransition = validModalClassNames.includes(
        "image_first_view_modal",
    );
    let imageModalCleanup = () => {};
    const { modal_overlay, modal } = createModal({
        skipModalTitle: true,
        contentElements: [contentElement],
        width: "auto",
        maxWidth: "100vw",
        maxHeight: "100vh",
        cleanupCallback: () => imageModalCleanup(),
        closeTransition: usesImageFirstCloseTransition
            ? {
                className: "image-first-view-closing",
                durationMs: IMAGE_FIRST_VIEW_CLOSE_DURATION_MS,
                beforeStart: () => {
                    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
                        return;
                    }
                    const stage = document.querySelector(
                        "#custom_modal .image_first_view "
                        + "> .row_article_image_first_stage",
                    );
                    activateImageFirstStageTransitionMedia(stage);
                },
            }
            : null,
    });

    const previousClassNames = Array.isArray(modal._imageModalClassNames)
        ? modal._imageModalClassNames
        : [];
    modal.classList.remove(...previousClassNames);
    modal._imageModalClassNames = [...validModalClassNames];
    modal.classList.add("image_modal", ...validModalClassNames);
    modal.setAttribute("aria-label", ariaLabel);
    setImageModalTopControls(modal, topControlElements);
    modal_overlay.classList.add("modal_overlay_blur", ...validOverlayClassNames);
    modal_overlay._imageModalOverlayClassNames = [...validOverlayClassNames];
    const teardownControls = installTransientImageControls(modal_overlay);
    imageModalCleanup = () => {
        teardownImageFirstRecordTransition(modal_overlay);
        teardownControls();
        modal.classList.remove("image_modal", ...validModalClassNames);
        modal._imageModalClassNames = [];
        modal_overlay.classList.remove(
            "modal_overlay_blur",
            ...validOverlayClassNames,
        );
        modal_overlay._imageModalOverlayClassNames = [];
    };
    showModal();
    return { modalOverlay: modal_overlay, modal, close: hideModal };
}

/**
 * Creates and opens the shared large image modal.
 *
 * @param {string} image_src - image URL to display
 */
export function openImageModal(image_src) {
    const bigImage = document.createElement("img");
    bigImage.src = image_src;
    bigImage.style.maxWidth = "100vw";
    bigImage.style.maxHeight = "100vh";
    bigImage.style.objectFit = "contain";

    const wrapper = document.createElement("div");
    wrapper.classList.add("image_modal_wrapper");
    wrapper.appendChild(bigImage);

    bigImage.addEventListener("load", () => {
        const minSize = 200;
        const naturalWidth = bigImage.naturalWidth;
        const naturalHeight = bigImage.naturalHeight;
        if (naturalWidth < minSize && naturalHeight < minSize) {
            if (naturalWidth >= naturalHeight) {
                wrapper.style.minWidth = `${minSize}px`;
            } else {
                wrapper.style.minHeight = `${minSize}px`;
            }
        } else if (naturalWidth < minSize) {
            wrapper.style.minWidth = `${minSize}px`;
        } else if (naturalHeight < minSize) {
            wrapper.style.minHeight = `${minSize}px`;
        }
    });

    const modalResult = openImageModalContent({ contentElement: wrapper });

    if (IS_DEV_MODE) console.log("modal avattu klikatulle kuvalle");
    return modalResult;
}
