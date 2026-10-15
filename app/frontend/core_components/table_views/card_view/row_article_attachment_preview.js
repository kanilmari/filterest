// row_article_attachment_preview.js
// Builds PDF thumbnails and the nested inline attachment preview.
// Connects attachment metadata and article controls to embedded PDF presentation.
// Keeps preview markup and heading hierarchy in one renderer.

import { getTranslationForKey } from "../../lang/translation_handler.js";
import {
    buildAttachmentMeta,
    resolveAttachmentDisplayName,
    resolveAttachmentDownloadName,
    resolveAttachmentKind,
} from "./row_article_attachment_metadata.js";

export function buildPdfThumbnail({ row, rowIndex, href, onPreviewRequested }) {
    const displayName = resolveAttachmentDisplayName(row);
    const thumbnail = document.createElement("button");
    thumbnail.type = "button";
    thumbnail.classList.add("big_card_attachment_thumbnail");
    thumbnail.dataset.testid = `big-card-pdf-thumbnail-${rowIndex}`;
    thumbnail.setAttribute("aria-label", `Esikatsele PDF: ${displayName}`);

    thumbnail.addEventListener("click", () => {
        onPreviewRequested?.({
            row,
            href,
            triggerButton: thumbnail,
        });
    });

    const badge = document.createElement("span");
    badge.classList.add("big_card_attachment_thumbnail_badge");
    badge.textContent = "PDF";
    thumbnail.appendChild(badge);

    const frame = document.createElement("iframe");
    frame.classList.add("big_card_attachment_thumbnail_frame");
    frame.dataset.testid = `big-card-pdf-thumbnail-frame-${rowIndex}`;
    frame.src = buildPdfThumbnailSrc(href);
    frame.title = `PDF thumbnail: ${displayName}`;
    frame.loading = "lazy";
    frame.tabIndex = -1;
    thumbnail.appendChild(frame);

    const label = document.createElement("span");
    label.classList.add("big_card_attachment_thumbnail_label");
    label.textContent = "Avaa esikatselu";
    thumbnail.appendChild(label);

    return thumbnail;
}

export function canPreviewAttachment(row = {}, href = "") {
    return Boolean(href) && resolveAttachmentKind(row) === "pdf";
}

export function buildPdfPreviewSrc(href = "") {
    const normalizedHref = String(href || "").trim();
    if (!normalizedHref) {
        return "";
    }

    if (!normalizedHref.includes("#")) {
        return `${normalizedHref}#toolbar=0&navpanes=0&view=FitH`;
    }

    if (normalizedHref.includes("toolbar=")) {
        return normalizedHref;
    }

    return `${normalizedHref}&toolbar=0&navpanes=0&view=FitH`;
}

export function buildPdfThumbnailSrc(href = "") {
    const previewSrc = buildPdfPreviewSrc(href);
    if (!previewSrc) {
        return "";
    }

    if (previewSrc.includes("#page=")) {
        return previewSrc;
    }

    if (previewSrc.includes("#")) {
        return `${previewSrc}&page=1`;
    }

    return `${previewSrc}#page=1`;
}

export function createAttachmentPreviewPanel() {
    const element = document.createElement("section");
    element.classList.add("big_card_attachment_preview_panel");
    element.dataset.testid = "big-card-pdf-preview";
    element.hidden = true;

    let activeHref = "";
    let activeTriggerButton = null;

    const setActiveButton = (button) => {
        if (activeTriggerButton) {
            activeTriggerButton.classList.remove("is-active");
            activeTriggerButton.setAttribute("aria-pressed", "false");
        }
        activeTriggerButton = button || null;
        if (activeTriggerButton) {
            activeTriggerButton.classList.add("is-active");
            activeTriggerButton.setAttribute("aria-pressed", "true");
        }
    };

    const hide = () => {
        element.hidden = true;
        element.replaceChildren();
        activeHref = "";
        setActiveButton(null);
    };

    const show = ({ row, href, triggerButton }) => {
        const displayName = resolveAttachmentDisplayName(row);
        const frameSrc = buildPdfPreviewSrc(href);

        element.hidden = false;
        element.replaceChildren();
        activeHref = href;
        setActiveButton(triggerButton);

        const header = document.createElement("div");
        header.classList.add("big_card_attachment_preview_header");

        const titleBlock = document.createElement("div");
        titleBlock.classList.add("big_card_attachment_preview_title_block");

        const title = document.createElement("h3");
        title.classList.add("big_card_attachment_preview_title");
        title.textContent = displayName;
        titleBlock.appendChild(title);

        const meta = document.createElement("div");
        meta.classList.add("big_card_attachment_preview_meta");
        meta.textContent = buildAttachmentMeta(row);
        titleBlock.appendChild(meta);
        header.appendChild(titleBlock);

        const headerActions = document.createElement("div");
        headerActions.classList.add("big_card_attachment_preview_actions");

        const open = document.createElement("a");
        open.classList.add("fw-btn", "big_card_attachment_preview_open");
        open.dataset.testid = "big-card-pdf-preview-open";
        open.textContent = getTranslationForKey("open") || "Avaa";
        open.href = href;
        open.target = "_blank";
        open.rel = "noopener";

        const download = document.createElement("a");
        download.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_preview_download");
        download.dataset.testid = "big-card-pdf-preview-download";
        download.textContent = getTranslationForKey("download") || "Lataa";
        download.href = href;
        download.download = resolveAttachmentDownloadName(row);

        const close = document.createElement("button");
        close.type = "button";
        close.classList.add("fw-btn", "fw-btn--ghost", "big_card_attachment_preview_close");
        close.dataset.testid = "big-card-pdf-preview-close";
        close.textContent = getTranslationForKey("close") || "Sulje";
        close.addEventListener("click", hide);

        headerActions.append(open, download, close);
        header.appendChild(headerActions);
        element.appendChild(header);

        const frame = document.createElement("iframe");
        frame.classList.add("big_card_attachment_preview_frame");
        frame.dataset.testid = "big-card-pdf-preview-frame";
        frame.src = frameSrc;
        frame.title = `PDF preview: ${displayName}`;
        frame.loading = "lazy";
        element.appendChild(frame);

        const hint = document.createElement("p");
        hint.classList.add("big_card_attachment_preview_hint");
        hint.textContent = "Jos esikatselu ei näy, avaa PDF uuteen välilehteen tai lataa se.";
        element.appendChild(hint);
    };

    return {
        element,
        hide,
        toggle({ row, href, triggerButton }) {
            if (!canPreviewAttachment(row, href)) {
                return;
            }
            if (!element.hidden && activeHref === href) {
                hide();
                return;
            }
            show({ row, href, triggerButton });
        },
    };
}

