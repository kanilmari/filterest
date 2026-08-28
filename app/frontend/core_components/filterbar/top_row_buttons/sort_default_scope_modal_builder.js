// sort_default_scope_modal_builder.js
// Builds the two-scope choice shown after an administrator selects a sorting default.
// Bridges the shared sort option action with the common modal surface.
// Exists so dismissal is distinct from choosing a personal or site-wide scope.

import { createModal, hideModal, showModal } from "../../../reusable_components/modal/modal_builder.js";
import { getTranslationForKey } from "../../lang/translation_handler.js";

const t = (key, fallback) => getTranslationForKey(key, { fallback }) || fallback;

export function showSortDefaultScopeModal() {
    return new Promise((resolve) => {
        let settled = false;
        let cleanup = () => {};

        const finish = (scope) => {
            if (settled) return;
            settled = true;
            hideModal();
            cleanup();
            resolve(scope);
        };

        const message = document.createElement("p");
        message.dataset.langKey = "sort_default_scope_message";
        message.textContent = t(
            "sort_default_scope_message",
            "Who should use this sorting as their default?"
        );

        const actions = document.createElement("div");
        actions.classList.add("form-actions");

        const cancelButton = buildChoiceButton("cancel", "Cancel", "cancel-button", () => finish(null));
        const personalButton = buildChoiceButton(
            "sort_default_for_me",
            "Only me",
            "button",
            () => finish("user")
        );
        const siteButton = buildChoiceButton(
            "sort_default_for_everyone",
            "Everyone",
            "submit-button",
            () => finish("site")
        );
        actions.append(cancelButton, personalButton, siteButton);

        const { modal, modal_overlay: overlay } = createModal({
            titleDataLangKey: "sort_default_scope_title",
            titlePlainText: t("sort_default_scope_title", "Set sorting default"),
            contentElements: [message],
            footerElements: [actions],
            width: "480px",
        });

        const onOverlayClick = (event) => {
            if (event.target === overlay) finish(null);
        };
        const onEscape = (event) => {
            if (event.key === "Escape") finish(null);
        };
        const closeButton = modal.querySelector(".modal_close_button");
        const onClose = () => finish(null);

        cleanup = () => {
            overlay.removeEventListener("click", onOverlayClick);
            document.removeEventListener("keydown", onEscape);
            closeButton?.removeEventListener("click", onClose);
        };

        overlay.addEventListener("click", onOverlayClick);
        document.addEventListener("keydown", onEscape);
        closeButton?.addEventListener("click", onClose);
        showModal();
        setTimeout(() => personalButton.focus(), 40);
    });
}

function buildChoiceButton(langKey, fallback, className, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("button", className);
    button.dataset.langKey = langKey;
    button.textContent = t(langKey, fallback);
    button.addEventListener("click", onClick);
    return button;
}
