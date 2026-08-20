// card_image_modal.js
// Opens a shared on-demand image modal for card and article thumbnails.
// Bridges card media clicks with the reusable modal builder.
// Exists so article-view image galleries do not need a persistent large preview.

import {
    createModal,
    hideModal,
    showModal,
} from "../../../reusable_components/modal/modal_builder.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';
const IMAGE_MODAL_CONTROL_IDLE_DELAY_MS = 1200;
const IMAGE_MODAL_TRANSIENT_CONTROL_SELECTOR = [
    ".modal_close_button",
    ".row_article_image_first_arrow",
    ".row_article_row_navigation_button",
].join(", ");
const imageModalControlTimers = new WeakMap();
const imageModalFocusHandlers = new WeakMap();

function isTransientImageControl(target) {
    return target instanceof Element
        && Boolean(target.closest(IMAGE_MODAL_TRANSIENT_CONTROL_SELECTOR));
}

function clearImageModalControlTimer(modalOverlay) {
    const existingTimer = imageModalControlTimers.get(modalOverlay);
    if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
        imageModalControlTimers.delete(modalOverlay);
    }
}

/**
 * Shows image controls after pointer or focus activity and pauses their idle
 * timer while the pointer remains over an actionable control. This bridges the
 * shared modal overlay with image-first controls so hovered actions stay usable.
 */
function installTransientImageControls(modalOverlay) {
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
    revealControls();
}

/**
 * Opens the edge-free image surface with caller-supplied content.
 * The standalone preview and image-first article share modal lifecycle and
 * transient controls without coupling ordinary row articles to this overlay.
 */
export function openImageModalContent({
    contentElement,
    classNames = [],
    ariaLabel = "Image preview",
} = {}) {
    if (!(contentElement instanceof HTMLElement)) {
        return null;
    }

    const { modal_overlay, modal } = createModal({
        skipModalTitle: true,
        contentElements: [contentElement],
        width: "auto",
        maxWidth: "100vw",
        maxHeight: "100vh",
    });

    const previousClassNames = Array.isArray(modal._imageModalClassNames)
        ? modal._imageModalClassNames
        : [];
    modal.classList.remove(...previousClassNames);
    modal._imageModalClassNames = [...classNames];
    modal.classList.add("image_modal", ...classNames);
    modal.setAttribute("aria-label", ariaLabel);
    modal_overlay.classList.add("modal_overlay_blur");
    installTransientImageControls(modal_overlay);
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
