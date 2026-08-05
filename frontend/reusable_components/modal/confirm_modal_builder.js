// confirm_modal_builder.js
// Builds the unified async confirm and choice modal on top of modal_builder.
// Bridges user-triggered risky actions and modal-gated yes-no decisions with i18n hooks.
// Exists to keep confirmation UX, danger styling, and resolve paths consistent across the app.

import { createModal, showModal, hideModal } from './modal_builder.js';

export function showConfirmModal({
    messageLangKey = '',
    messagePlainText = '',
    titleLangKey = '',
    titlePlainText = '',
    confirmLangKey = 'confirm',
    confirmText = 'OK',
    cancelLangKey = 'cancel',
    cancelText = 'Cancel',
    isDanger = false,
    itemNames = null,
} = {}) {
    return new Promise((resolve) => {
        let isSettled = false;
        let cleanup = () => {};

        const finish = (result) => {
            if (isSettled) return;
            isSettled = true;
            hideModal();
            cleanup();
            resolve(result);
        };

        const messageEl = document.createElement('p');
        messageEl.style.margin = '16px 0';
        messageEl.dataset.testid = 'confirm-modal-message';
        if (messageLangKey) {
            messageEl.dataset.langKey = messageLangKey;
        }
        messageEl.textContent = messagePlainText || messageLangKey || '';

        const contentElements = [messageEl];

        if (itemNames && itemNames.length > 0) {
            const ul = document.createElement('ul');
            ul.classList.add('delete-item-list');
            const MAX_SHOWN = 10;
            const shown = itemNames.slice(0, MAX_SHOWN);
            const remaining = itemNames.length - shown.length;
            shown.forEach(name => {
                const li = document.createElement('li');
                li.textContent = name;
                ul.appendChild(li);
            });
            if (remaining > 0) {
                const li = document.createElement('li');
                li.classList.add('delete-item-list-overflow');
                li.textContent = `...ja ${remaining} muuta`;
                ul.appendChild(li);
            }
            contentElements.push(ul);
        }

        const buttonRow = document.createElement('div');
        buttonRow.classList.add('form-actions');

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.classList.add('button', 'cancel-button');
        cancelBtn.dataset.testid = 'confirm-modal-cancel-button';
        if (cancelLangKey) cancelBtn.dataset.langKey = cancelLangKey;
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.classList.add('button', 'submit-button');
        confirmBtn.dataset.testid = 'confirm-modal-confirm-button';
        if (isDanger) confirmBtn.classList.add('danger-button');
        if (confirmLangKey) confirmBtn.dataset.langKey = confirmLangKey;
        confirmBtn.textContent = confirmText;

        buttonRow.append(cancelBtn, confirmBtn);

        const hasTitle = !!(titleLangKey || titlePlainText);
        const { modal_overlay, modal } = createModal({
            titleDataLangKey: titleLangKey || undefined,
            titlePlainText: titlePlainText || undefined,
            skipModalTitle: !hasTitle,
            contentElements,
            footerElements: [buttonRow],
            width: '440px',
        });

        function overlayHandler(event) {
            if (event.target === modal_overlay) {
                finish(false);
            }
        }

        function escapeHandler(event) {
            if (event.key === 'Escape') {
                finish(false);
            }
        }

        function cancelHandler() {
            finish(false);
        }

        function confirmHandler() {
            finish(true);
        }

        const closeButton = modal.querySelector('.modal_close_button');
        function closeHandler() {
            finish(false);
        }

        cleanup = () => {
            modal_overlay?.removeEventListener('click', overlayHandler);
            document.removeEventListener('keydown', escapeHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            confirmBtn.removeEventListener('click', confirmHandler);
            closeButton?.removeEventListener('click', closeHandler);
        };

        cancelBtn.addEventListener('click', cancelHandler);
        confirmBtn.addEventListener('click', confirmHandler);
        modal_overlay.addEventListener('click', overlayHandler);
        document.addEventListener('keydown', escapeHandler);
        closeButton?.addEventListener('click', closeHandler);

        showModal();
        setTimeout(() => confirmBtn.focus(), 40);
    });
}

export function showInputModal({
    messageLangKey = '',
    messagePlainText = '',
    titleLangKey = '',
    titlePlainText = '',
    labelLangKey = '',
    labelPlainText = '',
    initialValue = '',
    placeholder = '',
    inputType = 'text',
    autocomplete = '',
    confirmLangKey = 'confirm',
    confirmText = 'OK',
    cancelLangKey = 'cancel',
    cancelText = 'Cancel',
} = {}) {
    return new Promise((resolve) => {
        let isSettled = false;
        let cleanup = () => {};

        const finish = (result) => {
            if (isSettled) return;
            isSettled = true;
            hideModal();
            cleanup();
            resolve(result);
        };

        const contentElements = [];

        if (messageLangKey || messagePlainText) {
            const messageEl = document.createElement('p');
            messageEl.style.margin = '16px 0';
            messageEl.dataset.testid = 'input-modal-message';
            if (messageLangKey) messageEl.dataset.langKey = messageLangKey;
            messageEl.textContent = messagePlainText || messageLangKey;
            contentElements.push(messageEl);
        }

        const fieldWrapper = document.createElement('div');
        fieldWrapper.classList.add('form-group');

        const inputId = 'custom_modal_input';
        const labelEl = document.createElement('label');
        labelEl.htmlFor = inputId;
        if (labelLangKey) labelEl.dataset.langKey = labelLangKey;
        labelEl.textContent = labelPlainText || labelLangKey || '';

        const inputEl = document.createElement('input');
        inputEl.id = inputId;
        inputEl.type = inputType;
        inputEl.value = initialValue;
        inputEl.placeholder = placeholder;
        inputEl.dataset.testid = 'input-modal-input';
        if (autocomplete) inputEl.autocomplete = autocomplete;

        fieldWrapper.append(labelEl, inputEl);
        contentElements.push(fieldWrapper);

        const buttonRow = document.createElement('div');
        buttonRow.classList.add('form-actions');

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.classList.add('button', 'cancel-button');
        cancelBtn.dataset.testid = 'input-modal-cancel-button';
        if (cancelLangKey) cancelBtn.dataset.langKey = cancelLangKey;
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.classList.add('button', 'submit-button');
        confirmBtn.dataset.testid = 'input-modal-confirm-button';
        if (confirmLangKey) confirmBtn.dataset.langKey = confirmLangKey;
        confirmBtn.textContent = confirmText;

        buttonRow.append(cancelBtn, confirmBtn);

        const hasTitle = !!(titleLangKey || titlePlainText);
        const { modal_overlay, modal } = createModal({
            titleDataLangKey: titleLangKey || undefined,
            titlePlainText: titlePlainText || undefined,
            skipModalTitle: !hasTitle,
            contentElements,
            footerElements: [buttonRow],
            width: '440px',
        });

        function overlayHandler(event) {
            if (event.target === modal_overlay) {
                finish(null);
            }
        }

        function escapeHandler(event) {
            if (event.key === 'Escape') {
                finish(null);
            }
        }

        function cancelHandler() {
            finish(null);
        }

        function confirmHandler() {
            finish(inputEl.value);
        }

        function inputKeyHandler(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(inputEl.value);
            }
        }

        const closeButton = modal.querySelector('.modal_close_button');
        function closeHandler() {
            finish(null);
        }

        cleanup = () => {
            modal_overlay?.removeEventListener('click', overlayHandler);
            document.removeEventListener('keydown', escapeHandler);
            cancelBtn.removeEventListener('click', cancelHandler);
            confirmBtn.removeEventListener('click', confirmHandler);
            inputEl.removeEventListener('keydown', inputKeyHandler);
            closeButton?.removeEventListener('click', closeHandler);
        };

        cancelBtn.addEventListener('click', cancelHandler);
        confirmBtn.addEventListener('click', confirmHandler);
        inputEl.addEventListener('keydown', inputKeyHandler);
        modal_overlay.addEventListener('click', overlayHandler);
        document.addEventListener('keydown', escapeHandler);
        closeButton?.addEventListener('click', closeHandler);

        showModal();
        setTimeout(() => inputEl.focus(), 40);
    });
}
