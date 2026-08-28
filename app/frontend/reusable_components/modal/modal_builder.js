// modal_builder.js
// Builds and controls the shared application modal dialog system.
// Bridges feature-specific modal content with shared chrome, sizing, and close behavior.
// Exists to keep modal structure and lifecycle logic centralized across the frontend.

import { setElementSvgContent } from "../../icons/icon_loader.js";

let modal_previous_focus_element = null;
let modal_current_cleanup_callback = null;
let modal_current_close_transition = null;
let modal_pending_hide_timer = null;

function normalizeCloseTransition(closeTransition) {
    const className = closeTransition?.className;
    const durationMs = Number(closeTransition?.durationMs);
    if (typeof className !== "string" || !className.trim()) return null;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
    return {
        className: className.trim(),
        durationMs,
        beforeStart: typeof closeTransition?.beforeStart === "function"
            ? closeTransition.beforeStart
            : null,
    };
}

function cancelPendingModalHide() {
    if (modal_pending_hide_timer !== null) {
        window.clearTimeout(modal_pending_hide_timer);
        modal_pending_hide_timer = null;
    }
    const modalOverlay = document.getElementById("custom_modal_overlay");
    const transitionClassName = modal_current_close_transition?.className;
    if (modalOverlay && transitionClassName) {
        modalOverlay.classList.remove(transitionClassName);
        modalOverlay.removeAttribute("aria-busy");
    }
}

function runCurrentModalCleanup() {
    const cleanupCallback = modal_current_cleanup_callback;
    modal_current_cleanup_callback = null;
    if (typeof cleanupCallback !== "function") {
        return;
    }

    try {
        cleanupCallback();
    } catch (error) {
        console.warn("modal cleanup failed", error);
    }
}

function applyVisuallyHiddenStyles(element) {
    Object.assign(element.style, {
        position: "absolute",
        width: "1px",
        height: "1px",
        padding: "0",
        margin: "-1px",
        overflow: "hidden",
        clipPath: "inset(50%)",
        whiteSpace: "nowrap",
        border: "0",
    });
}

function focusElement(element) {
    if (!element || typeof element.focus !== "function") return;
    try {
        element.focus({ preventScroll: true });
    } catch {
        element.focus();
    }
}

function isElementRendered(element) {
    if (!(element instanceof HTMLElement)) return false;

    let currentElement = element;
    while (currentElement) {
        if (currentElement.hidden) return false;
        if (currentElement.getAttribute("aria-hidden") === "true") return false;
        if (currentElement.hasAttribute("inert")) return false;

        const computedStyle = window.getComputedStyle(currentElement);
        if (computedStyle.display === "none") return false;
        if (computedStyle.visibility === "hidden") return false;

        currentElement = currentElement.parentElement;
    }

    return true;
}

function getFocusableModalElements(modal) {
    if (!modal) return [];

    return Array.from(modal.querySelectorAll(
        'input:not([type="hidden"]), textarea, select, button, a[href], [tabindex]:not([tabindex="-1"])'
    )).filter((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if ("disabled" in element && element.disabled) return false;
        return isElementRendered(element);
    });
}

function focusModalSurface(modal) {
    if (!modal) return;
    const focusableElements = getFocusableModalElements(modal);
    const preferredTextInput = focusableElements.find((element) => {
        if (!(element instanceof HTMLElement)) return false;
        if (element.tagName === "TEXTAREA") return true;
        if (element.tagName !== "INPUT") return false;
        const inputType = (element.getAttribute("type") || "text").toLowerCase();
        return ["text", "email", "password", "search", "tel", "url"].includes(inputType);
    });
    const focusTarget =
        preferredTextInput
        || focusableElements[0]
        || modal;

    setTimeout(() => {
        focusElement(focusTarget);
    }, 0);
}

function applyModalButtonHoverSaturation(scope) {
    scope.querySelectorAll(
        ".form-actions .cancel-button, .form-actions .submit-button, .form-actions .danger-button, .modal-button"
    ).forEach((button) => {
        button.classList.add("saturate_on_hover");
    });
}

function restoreFocusAfterModalClose() {
    const previousFocus = modal_previous_focus_element;
    modal_previous_focus_element = null;

    if (!(previousFocus instanceof HTMLElement)) return;
    if (!document.contains(previousFocus)) return;
    if ("disabled" in previousFocus && previousFocus.disabled) return;
    if (!isElementRendered(previousFocus)) return;

    setTimeout(() => {
        focusElement(previousFocus);
    }, 0);
}

// Clears presentation state owned by a previous feature before the singleton
// modal is reused. Image viewers deliberately add full-screen classes and
// inline size limits after createModal returns; those must never leak into the
// next ordinary dialog, such as the session-expired recovery prompt.
function resetModalPresentationState(modalOverlay, modal) {
    const trackedImageClasses = Array.isArray(modal?._imageModalClassNames)
        ? modal._imageModalClassNames
        : [];
    const trackedImageOverlayClasses = Array.isArray(
        modalOverlay?._imageModalOverlayClassNames,
    )
        ? modalOverlay._imageModalOverlayClassNames
        : [];

    modal?.classList.remove(
        "image_modal",
        "auth-tour-image-modal",
        ...trackedImageClasses,
    );
    if (modal) {
        modal._imageModalClassNames = [];
        modal.style.removeProperty("width");
        modal.style.removeProperty("max-width");
        modal.style.removeProperty("max-height");
    }

    modalOverlay?.classList.remove(
        "modal_overlay_blur",
        "image-modal-controls-active",
        "image-modal-content-scrolled",
        ...trackedImageOverlayClasses,
    );
    if (modalOverlay) {
        modalOverlay._imageModalOverlayClassNames = [];
    }
}

function handleModalKeyboardEvent(event) {
    const modal_overlay = document.getElementById("custom_modal_overlay");
    if (!modal_overlay || modal_overlay.style.display === "none") {
        return;
    }

    if (event.key === "Escape") {
        hideModal();
        return;
    }

    if (event.key !== "Tab") {
        return;
    }

    const modal = document.getElementById("custom_modal");
    if (!modal) {
        return;
    }

    const focusableElements = getFocusableModalElements(modal);
    if (focusableElements.length === 0) {
        event.preventDefault();
        focusElement(modal);
        return;
    }

    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (!modal.contains(activeElement)) {
        event.preventDefault();
        focusElement(firstFocusableElement);
        return;
    }

    if (event.shiftKey) {
        if (activeElement === firstFocusableElement || activeElement === modal) {
            event.preventDefault();
            focusElement(lastFocusableElement);
        }
        return;
    }

    if (activeElement === lastFocusableElement) {
        event.preventDefault();
        focusElement(firstFocusableElement);
    }
}

export function createModal({
    titleDataLangKey,
    titleDataLangKeyFallback,
    titlePlainText,
    tableName,
    contentElements,
    footerElements = null,
    width = '600px',
    maxWidth = null,
    maxHeight = null,
    skipModalTitle = false,
    cleanupCallback = null,
    closeTransition = null,
}) {
    // The modal is a singleton. Tear down the previous feature before its DOM
    // and presentation state are reused by the next dialog.
    cancelPendingModalHide();
    runCurrentModalCleanup();
    modal_current_close_transition = normalizeCloseTransition(closeTransition);

    // Luo modalin taustalla oleva overlay-elementti
    let modal_overlay = document.getElementById('custom_modal_overlay');
    if (!modal_overlay) {
        modal_overlay = document.createElement('div');
        modal_overlay.id = 'custom_modal_overlay';
        modal_overlay.classList.add('modal_overlay');

        // Lisää klikkauskuuntelija modaalin sulkemiseksi klikkaamalla ulkopuolelle
        modal_overlay.addEventListener('click', (event) => {
            if (event.target === modal_overlay) {
                hideModal();
            }
        });

        document.body.appendChild(modal_overlay);

        document.addEventListener('keydown', handleModalKeyboardEvent);
    }
    modal_overlay.dataset.testid = 'modal-overlay-container';

    // Luo modal-elementti
    let modal = document.getElementById('custom_modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'custom_modal';
        modal.classList.add('modal');
        modal_overlay.appendChild(modal);
    }
    modal.dataset.testid = 'modal-container';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.tabIndex = -1;
    modal.removeAttribute('aria-labelledby');
    modal.removeAttribute('aria-label');
    modal.removeAttribute('aria-describedby');
    resetModalPresentationState(modal_overlay, modal);

    // Tyhjennä modalin sisältö
    modal.replaceChildren();

    // Luo otsikkorivi ja sulkemispainike
    const header = document.createElement('div');
    header.classList.add('modal_header');
    const close_button = document.createElement('button'); // Changed from span to button for better semantics
    close_button.type = 'button';
    close_button.classList.add('modal_close_button');
    close_button.classList.add('fw-btn');
    close_button.dataset.testid = 'modal-close-button';
    const closeButtonIcon = document.createElement('span');
    closeButtonIcon.setAttribute('aria-hidden', 'true');
    const closeButtonLabel = document.createElement('span');
    closeButtonLabel.dataset.langKey = 'close';
    closeButtonLabel.textContent = 'Close';
    applyVisuallyHiddenStyles(closeButtonLabel);
    close_button.append(closeButtonIcon, closeButtonLabel);
    void setElementSvgContent(closeButtonIcon, '/frontend/icons/general/modal-close-icon.svg');
    close_button.addEventListener('click', hideModal);

    // Näytetään otsikko vain jos skipModalTitle ei ole päällä
    let modalTitleId = '';
    if (!skipModalTitle) {
        modal.classList.remove('no_title');
        if (titleDataLangKey) {
            const modal_title = document.createElement('h1');
            modal_title.id = 'custom_modal_title';
            let combined_key = titleDataLangKey;
            if (tableName) {
                combined_key += `+${tableName}`;
            }
            modal_title.dataset.langKey = combined_key;

            if (titleDataLangKeyFallback) {
                modal_title.dataset.langKeyFallback = titleDataLangKeyFallback;
            }
            header.appendChild(modal_title);
            modalTitleId = modal_title.id;

        } else if (titlePlainText) {
            const modal_title = document.createElement('h2');
            modal_title.id = 'custom_modal_title';
            modal_title.textContent = titlePlainText;
            header.appendChild(modal_title);
            modalTitleId = modal_title.id;
        }
    } else {
        modal.classList.add('no_title');
    }

    header.appendChild(close_button);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.id = 'custom_modal_body';
    body.classList.add('modal_body');
    modal.appendChild(body);

    contentElements.forEach((element) => {
        body.appendChild(element);
    });

    // Footer (napit yms.) — modal_bodyn ulkopuolella, ei leikkaa box-shadowia
    if (footerElements && footerElements.length > 0) {
        const footer = document.createElement('div');
        footer.classList.add('modal_footer');
        footerElements.forEach((element) => {
            footer.appendChild(element);
        });
        modal.appendChild(footer);
    }

    applyModalButtonHoverSaturation(modal);

    if (!modalTitleId) {
        const nestedHeading = body.querySelector('h1, h2, h3, h4, h5, h6');
        if (nestedHeading) {
            if (!nestedHeading.id) {
                nestedHeading.id = 'custom_modal_title';
            }
            modalTitleId = nestedHeading.id;
        }
    }

    if (modalTitleId) {
        modal.setAttribute('aria-labelledby', modalTitleId);
    } else {
        modal.setAttribute(
            'aria-label',
            titlePlainText || titleDataLangKeyFallback || titleDataLangKey || 'Dialog'
        );
    }
    modal.setAttribute('aria-describedby', body.id);

    // Aseta modaalin oletusleveys
    modal.style.width = width;
    if (maxWidth) {
        modal.style.maxWidth = maxWidth;
    }
    if (maxHeight) {
        modal.style.maxHeight = maxHeight;
    }

    modal_current_cleanup_callback = typeof cleanupCallback === "function"
        ? cleanupCallback
        : null;

    return { modal_overlay, modal };
}

export function showModal() {
    const modal_overlay = document.getElementById('custom_modal_overlay');
    if (modal_overlay) {
        const activeElement = document.activeElement;
        if (
            activeElement instanceof HTMLElement
            && !activeElement.closest('#custom_modal_overlay')
        ) {
            modal_previous_focus_element = activeElement;
        }
        modal_overlay.style.display = 'flex';
        modal_overlay.removeAttribute('aria-busy');
        modal_overlay.setAttribute('aria-hidden', 'false');
        focusModalSurface(document.getElementById('custom_modal'));
    }
}

function finishModalHide(modal_overlay) {
    const transitionClassName = modal_current_close_transition?.className;
    modal_pending_hide_timer = null;
    runCurrentModalCleanup();
    if (transitionClassName) {
        modal_overlay.classList.remove(transitionClassName);
    }
    modal_current_close_transition = null;
    modal_overlay.removeAttribute('aria-busy');
    modal_overlay.style.display = 'none';
    modal_overlay.classList.remove(
        'modal_overlay_blur',
        'image-modal-controls-active',
        'image-modal-content-scrolled',
    );
    modal_overlay.setAttribute('aria-hidden', 'true');
    restoreFocusAfterModalClose();
}

export function hideModal({ immediate = false } = {}) {
    const modal_overlay = document.getElementById('custom_modal_overlay');
    if (modal_overlay) {
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
            ?.matches === true;
        if (
            !immediate
            && !reduceMotion
            && modal_current_close_transition
            && modal_overlay.style.display !== 'none'
        ) {
            if (modal_pending_hide_timer !== null) return;
            try {
                modal_current_close_transition.beforeStart?.();
            } catch (error) {
                console.warn("modal close transition preparation failed", error);
            }
            modal_overlay.classList.add(modal_current_close_transition.className);
            modal_overlay.setAttribute('aria-busy', 'true');
            modal_pending_hide_timer = window.setTimeout(
                () => finishModalHide(modal_overlay),
                modal_current_close_transition.durationMs,
            );
            return;
        }
        cancelPendingModalHide();
        finishModalHide(modal_overlay);
    }
}
