// card_image_modal.js
// Opens a shared on-demand image modal for card and article thumbnails.
// Bridges card media clicks with the reusable modal builder.
// Exists so article-view image galleries do not need a persistent large preview.

import {
    createModal,
    showModal,
} from "../../../reusable_components/modal/modal_builder.js";

const IS_DEV_MODE = document.querySelector('meta[name="app-env"]')?.content === 'dev';

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

    const { modal_overlay, modal } = createModal({
        skipModalTitle: true,
        contentElements: [wrapper],
        width: "auto",
        maxWidth: "100vw",
        maxHeight: "100vh",
    });

    modal.classList.add("image_modal");
    modal_overlay.classList.add("modal_overlay_blur");

    showModal();

    if (IS_DEV_MODE) console.log("modal avattu klikatulle kuvalle");
}
