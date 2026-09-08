// image_source_picker.js
// Opens a protected web-image resolver inside Filterest's stacked modal layer.
// Bridges provider page URLs, same-origin previews, and add-row File objects.
// Exists so users can import credited images without exposing API keys or losing their row draft.

import { createStackedModal } from "../modal/modal_builder.js";
import { showErrorToast } from "../notifications/toast_notification_printer.js";

const LOCALIZED_FALLBACK_COPY = Object.freeze({
    pick_image_from_web: { fi: "Valitse kuva verkosta", en: "Pick image from web", ch: "从网络选择图片", yue: "由網上揀相" },
    image_source_picker_help: {
        fi: "Liitä Unsplash-, Pexels- tai Pixabay-kuvasivun osoite. Kuva ja sen lähdetieto tallennetaan vain tälle uudelle riville.",
        en: "Paste an Unsplash, Pexels, or Pixabay photo-page URL. The image and its credit will be saved only with this new row.",
        ch: "粘贴 Unsplash、Pexels 或 Pixabay 图片页面网址。图片及署名只会保存到这个新建行。",
        yue: "貼上 Unsplash、Pexels 或 Pixabay 相片頁面網址。相片同署名只會儲存喺呢個新行。",
    },
    image_source_url: { fi: "Kuvasivun osoite", en: "Image page URL", ch: "图片页面网址", yue: "相片頁面網址" },
    see_original_page: { fi: "Katso alkuperäinen sivu", en: "See original page", ch: "查看原始页面", yue: "睇原本頁面" },
    use_image: { fi: "Käytä kuvaa", en: "Use image", ch: "使用图片", yue: "使用相片" },
    available: { fi: "käytettävissä", en: "available", ch: "可用", yue: "可用" },
    not_configured: { fi: "ei määritetty", en: "not configured", ch: "未配置", yue: "未設定" },
    provider_status_unavailable: { fi: "Kuvapalvelujen tilaa ei saatu.", en: "Provider status is unavailable.", ch: "无法获取图片服务状态。", yue: "攞唔到圖片服務狀態。" },
    image_ready: { fi: "Kuva on valmis valittavaksi.", en: "Image is ready to use.", ch: "图片可以使用。", yue: "相片可以使用。" },
    image_preview: { fi: "Kuvan esikatselu", en: "Image preview", ch: "图片预览", yue: "相片預覽" },
    image_load_failed: { fi: "Kuvaa ei voitu ladata.", en: "The image could not be loaded.", ch: "无法加载图片。", yue: "載入唔到相片。" },
    image_import_failed: { fi: "Kuvaa ei voitu tuoda.", en: "The image could not be imported.", ch: "无法导入图片。", yue: "匯入唔到相片。" },
    paste_and_preview: { fi: "Liitä ja esikatsele", en: "Paste & preview" },
    image_clipboard_help: {
        fi: "Voit liittää osoitteen suoraan kenttään. Selain voi pyytää erillisen Liitä-vahvistuksen, kun käytät painiketta.",
        en: "You can paste the URL directly into the field. Your browser may ask for a separate Paste confirmation when using the button.",
    },
    image_clipboard_unavailable: {
        fi: "Leikepöytää ei voitu lukea. Liitä kuvasivun osoite kenttään ja valitse Esikatsele.",
        en: "The clipboard could not be read. Paste the photo-page URL into the field and choose Preview.",
    },
    image_clipboard_empty: { fi: "Leikepöydällä ei ole osoitetta. Kopioi kuvasivun osoite tai kirjoita se kenttään.", en: "The clipboard is empty. Copy a photo-page URL or enter it in the field." },
    image_source_url_invalid: { fi: "Anna kokonainen HTTPS-kuvasivun osoite.", en: "Enter a complete HTTPS photo-page URL." },
    image_preview_failed: { fi: "Kuvan esikatselu epäonnistui. Tarkista kuvasivun osoite ja yritä uudelleen.", en: "The image preview failed. Check the photo-page URL and try again." },
    image_provider_unsupported: { fi: "Tätä kuvapalvelua ei tueta. Käytä yllä mainittua kuvapalvelua.", en: "This image provider is not supported. Use one of the providers listed above." },
    image_provider_unavailable: { fi: "Kuvapalvelu ei ole juuri nyt käytettävissä. Voit yrittää myöhemmin uudelleen.", en: "The image provider is not available right now. Please try again later." },
    preview: { fi: "Esikatsele", en: "Preview", ch: "预览", yue: "預覽" },
    cancel: { fi: "Peruuta", en: "Cancel", ch: "取消", yue: "取消" },
    loading: { fi: "Ladataan…", en: "Loading…", ch: "正在加载…", yue: "載入緊…" },
});

export function getImageSourcePickerText(key, fallback = "", {
    getTranslation = () => "",
    getLanguage = () => "en",
} = {}) {
    const language = String(getLanguage()).toLowerCase().split(/[-_]/)[0];
    const localFallback = LOCALIZED_FALLBACK_COPY[key]?.[language]
        || LOCALIZED_FALLBACK_COPY[key]?.en
        || fallback;
    // The shared translator humanizes missing keys unless given an explicit fallback.
    // Pass reviewed component copy so a missing catalog row cannot replace useful help.
    const serverTranslation = getTranslation(key, { fallback: localFallback });
    return serverTranslation && serverTranslation !== key ? serverTranslation : localFallback;
}

// Recognizes complete secure source URLs before preview work is scheduled.
// Provider metadata chooses only the timing; the server still authorizes every URL and image.
function parseSourceUrl(sourceUrl) {
    try {
        const parsed = new URL(sourceUrl);
        if (sourceUrl.length > 2048 || parsed.protocol !== "https:"
            || parsed.username || parsed.password || parsed.port) return null;
        return parsed;
    } catch (_error) {
        return null;
    }
}

// Turns provider failures into component-localized, non-technical preview feedback.
// Shared HTTP errors may wrap provider JSON; raw route names and configuration details stay hidden.
function getPreviewErrorText(error, getText) {
    let code = error?.code;
    const message = String(error?.message || "");
    try {
        const start = message.indexOf("{");
        if (start >= 0) code = JSON.parse(message.slice(start))?.error?.code || code;
    } catch (_error) {
        // A transport error has no provider payload; use ordinary retry guidance.
    }
    if (code === "invalid_source_url" || code === "invalid_provider_photo_url") {
        return getText("image_source_url_invalid");
    }
    if (code === "unsupported_provider") return getText("image_provider_unsupported");
    if (code === "provider_not_configured" || code === "provider_unavailable"
        || error?.isRateLimited || error?.isServiceUnavailable) {
        return getText("image_provider_unavailable");
    }
    return getText("image_preview_failed");
}

function buildCaptionMap(selection) {
    const creator = String(selection?.creator_name || "").trim();
    const provider = String(selection?.provider_name || "").trim();
    if (!creator || !provider) return { fi: "", en: "" };
    return {
        fi: `Kuva: ${creator} / ${provider}.`,
        en: `Photo: ${creator} / ${provider}.`,
    };
}

function parseFilename(response, selection) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (encodedMatch) {
        try {
            return decodeURIComponent(encodedMatch[1]);
        } catch (_error) {
            // Continue to the ordinary filename or deterministic fallback.
        }
    }
    const quotedMatch = disposition.match(/filename="([^"]+)"/i);
    if (quotedMatch) return quotedMatch[1];
    const plainMatch = disposition.match(/filename=([^;]+)/i);
    if (plainMatch) return plainMatch[1].trim();
    return `${selection?.provider || "web"}-${selection?.provider_asset_id || "image"}.jpg`;
}

async function fetchImageResponse(sourceUrl, purpose, endpointRouter) {
    return endpointRouter("imageSourcePickerFile", {
        method: "POST",
        body_data: { source_url: sourceUrl, purpose },
        returnResponse: true,
        suppressErrorToast: true,
    });
}

function appendAttribution(container, selection, getText) {
    container.replaceChildren();
    const text = document.createElement("span");
    text.textContent = selection?.attribution?.text || "";
    container.appendChild(text);

    const sourcePage = String(selection?.source_page_url || "").trim();
    if (sourcePage) {
        const sourceLink = document.createElement("a");
        sourceLink.href = sourcePage;
        sourceLink.target = "_blank";
        sourceLink.rel = "noopener noreferrer";
        sourceLink.textContent = getText("see_original_page", "See original page");
        container.appendChild(sourceLink);
    }
}

/**
 * Opens the shared web-image picker and returns its controller.
 * onSelect receives a local File plus provider metadata and FI/EN credits.
 */
export function openImageSourcePicker({
    onSelect = () => {},
    endpointRouter,
    getTranslation = () => "",
    getLanguage = () => "en",
} = {}) {
    if (typeof endpointRouter !== "function") {
        throw new TypeError("openImageSourcePicker requires an endpoint router");
    }
    const getText = (key, fallback = "") => getImageSourcePickerText(key, fallback, {
        getTranslation,
        getLanguage,
    });
    const root = document.createElement("div");
    root.classList.add("image-source-picker");
    root.dataset.testid = "image-source-picker";

    const intro = document.createElement("p");
    intro.classList.add("image-source-picker__intro");
    intro.textContent = getText(
        "image_source_picker_help",
        "Paste an Unsplash, Pexels, or Pixabay photo-page URL. The image and its credit will be saved with this new row.",
    );

    const providerList = document.createElement("div");
    providerList.classList.add("image-source-picker__providers");
    providerList.dataset.testid = "image-source-picker-providers";
    providerList.setAttribute("aria-live", "polite");

    const form = document.createElement("form");
    form.classList.add("image-source-picker__form");
    form.noValidate = true; // Empty submissions read the clipboard; failures use localized feedback.
    const sourceLabel = document.createElement("label");
    sourceLabel.htmlFor = "image-source-picker-url";
    sourceLabel.textContent = getText("image_source_url", "Image page URL");
    const sourceRow = document.createElement("div");
    sourceRow.classList.add("image-source-picker__source-row");
    const sourceInput = document.createElement("input");
    sourceInput.id = "image-source-picker-url";
    sourceInput.type = "url";
    sourceInput.inputMode = "url";
    sourceInput.placeholder = "https://unsplash.com/photos/…";
    sourceInput.autocomplete = "off";
    sourceInput.dataset.testid = "image-source-picker-url";
    const resolveButton = document.createElement("button");
    resolveButton.type = "submit";
    resolveButton.classList.add("fw-btn", "fw-btn--primary");
    resolveButton.dataset.testid = "image-source-picker-preview-button";
    resolveButton.textContent = getText("paste_and_preview", "Paste & preview");
    sourceRow.append(sourceInput, resolveButton);
    const clipboardHelp = document.createElement("p");
    clipboardHelp.id = "image-source-picker-clipboard-help";
    clipboardHelp.textContent = getText("image_clipboard_help");
    resolveButton.setAttribute("aria-describedby", clipboardHelp.id);
    form.append(sourceLabel, sourceRow, clipboardHelp);

    const status = document.createElement("p");
    status.classList.add("image-source-picker__status");
    status.dataset.testid = "image-source-picker-status";
    status.setAttribute("aria-live", "polite");

    const preview = document.createElement("figure");
    preview.classList.add("image-source-picker__preview");
    preview.hidden = true;
    const previewImage = document.createElement("img");
    previewImage.dataset.testid = "image-source-picker-preview";
    const attribution = document.createElement("figcaption");
    attribution.classList.add("image-source-picker__attribution");
    preview.append(previewImage, attribution);

    const actions = document.createElement("div");
    actions.classList.add("form-actions", "image-source-picker__actions");
    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.classList.add("cancel-button", "fw-btn", "fw-btn--ghost");
    cancelButton.textContent = getText("cancel", "Cancel");
    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.classList.add("submit-button", "fw-btn", "fw-btn--primary");
    selectButton.dataset.testid = "image-source-picker-select";
    selectButton.textContent = getText("use_image", "Use image");
    selectButton.disabled = true;
    actions.append(cancelButton, selectButton);

    root.append(intro, providerList, form, status, preview, actions);

    let resolvedSelection = null;
    let resolvedSourceUrl = "";
    let previewObjectUrl = "";
    let requestRevision = 0;
    let attemptedSourceUrl = "";
    let debounceTimer = null;
    let closed = false;
    let providerHosts = new Set();
    const revokePreview = () => {
        if (!previewObjectUrl) return;
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = "";
    };
    const cancelScheduledPreview = () => {
        clearTimeout(debounceTimer);
        debounceTimer = null;
    };
    const resetPreview = () => {
        resolvedSelection = null;
        resolvedSourceUrl = "";
        selectButton.disabled = true;
        preview.hidden = true;
        previewImage.removeAttribute("src");
        revokePreview();
    };
    const updateActionLabel = () => {
        resolveButton.textContent = sourceInput.value.trim()
            ? getText("preview", "Preview")
            : getText("paste_and_preview", "Paste & preview");
    };
    const setError = (message) => {
        status.setAttribute("role", "alert");
        status.textContent = message;
        showErrorToast(message);
    };
    const cleanup = () => {
        closed = true;
        requestRevision += 1;
        cancelScheduledPreview();
        revokePreview();
    };
    const stacked = createStackedModal({
        titlePlainText: getText("pick_image_from_web", "Pick image from web"),
        contentElements: [root],
        width: "min(1180px, 96vw)",
        maxWidth: "96vw",
        maxHeight: "97dvh",
        cleanupCallback: cleanup,
    });

    cancelButton.addEventListener("click", stacked.hide);

    // Only the current URL and open modal may receive an asynchronous preview.
    // Manual attempts report errors; debounced attempts remain quiet until the user asks.
    const resolvePreview = async ({ silent = false } = {}) => {
        cancelScheduledPreview();
        const sourceUrl = sourceInput.value.trim();
        const revision = ++requestRevision;
        attemptedSourceUrl = sourceUrl;
        const isCurrent = () => !closed && revision === requestRevision
            && sourceInput.value.trim() === sourceUrl;
        resetPreview();
        status.setAttribute("role", "status");
        status.textContent = silent ? "" : getText("loading", "Loading…");
        if (!parseSourceUrl(sourceUrl)) {
            status.textContent = "";
            if (!silent) setError(getText("image_source_url_invalid"));
            return;
        }
        resolveButton.disabled = !silent;
        try {
            const payload = await endpointRouter("imageSourcePickerResolve", {
                method: "POST",
                body_data: { source_url: sourceUrl },
                suppressErrorToast: true,
            });
            if (!isCurrent()) return;
            const selection = payload?.selection;
            if (!selection) throw new Error("Image provider returned no selection.");
            const response = await fetchImageResponse(sourceUrl, "preview", endpointRouter);
            if (!isCurrent()) return;
            const blob = await response.blob();
            if (!isCurrent()) return;
            previewObjectUrl = URL.createObjectURL(blob);
            previewImage.src = previewObjectUrl;
            previewImage.alt = selection?.image?.alt_text
                || selection?.description
                || getText("image_preview", "Image preview");
            appendAttribution(attribution, selection, getText);
            resolvedSelection = selection;
            resolvedSourceUrl = sourceUrl;
            preview.hidden = false;
            selectButton.disabled = false;
            status.textContent = getText("image_ready", "Image is ready to use.");
        } catch (error) {
            if (!isCurrent()) return;
            status.textContent = "";
            if (!silent) setError(getPreviewErrorText(error, getText));
        } finally {
            if (isCurrent()) resolveButton.disabled = false;
        }
    };

    const schedulePreview = () => {
        cancelScheduledPreview();
        const parsed = parseSourceUrl(sourceInput.value.trim());
        if (!parsed || !providerHosts.has(parsed.hostname.toLowerCase().replace(/^www\./, ""))) return;
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            void resolvePreview({ silent: true });
        }, 500);
    };

    sourceInput.addEventListener("input", () => {
        requestRevision += 1;
        attemptedSourceUrl = "";
        resetPreview();
        status.textContent = "";
        resolveButton.disabled = false;
        updateActionLabel();
        schedulePreview();
    });

    void endpointRouter("imageSourcePickerProviders")
        .then((payload) => {
            if (closed) return;
            const providers = Array.isArray(payload?.providers) ? payload.providers : [];
            providerHosts = new Set(providers.map((provider) => (
                parseSourceUrl(String(provider?.homepage_url || ""))?.hostname.toLowerCase().replace(/^www\./, "")
            )).filter(Boolean));
            providerList.replaceChildren(...providers.map((provider) => {
                const item = document.createElement("span");
                item.classList.add("image-source-picker__provider");
                item.dataset.testid = "image-source-picker-provider";
                item.classList.toggle("is-unavailable", provider?.configured !== true);
                item.textContent = (provider?.name || provider?.key) + ": " + (provider?.configured === true
                    ? getText("available", "available")
                    : getText("not_configured", "not configured"));
                return item;
            }));
            if (!resolvedSelection && !attemptedSourceUrl) schedulePreview();
        })
        .catch(() => {
            if (!closed) providerList.textContent = getText("provider_status_unavailable", "Provider status is unavailable.");
        });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (closed || resolveButton.disabled) return;
        cancelScheduledPreview();
        if (!sourceInput.value.trim()) {
            const revision = ++requestRevision;
            resolveButton.disabled = true;
            try {
                // Clipboard reads happen only in this explicit user gesture, never while typing.
                const text = await navigator.clipboard.readText();
                if (closed || revision !== requestRevision) return;
                sourceInput.value = String(text || "").trim();
                updateActionLabel();
                if (!sourceInput.value) {
                    setError(getText("image_clipboard_empty"));
                    return;
                }
            } catch (_error) {
                if (!closed && revision === requestRevision) setError(getText("image_clipboard_unavailable"));
                return;
            } finally {
                if (!closed && revision === requestRevision) resolveButton.disabled = false;
            }
        }
        await resolvePreview();
    });

    selectButton.addEventListener("click", async () => {
        if (!resolvedSelection || sourceInput.value.trim() !== resolvedSourceUrl) return;
        const selection = resolvedSelection;
        const sourceUrl = resolvedSourceUrl;
        selectButton.disabled = true;
        resolveButton.disabled = true;
        sourceInput.disabled = true;
        status.textContent = getText("loading", "Loading…");
        try {
            const response = await fetchImageResponse(sourceUrl, "select", endpointRouter);
            if (closed) return;
            const blob = await response.blob();
            if (closed) return;
            const file = new File([blob], parseFilename(response, selection), {
                type: blob.type || response.headers.get("Content-Type") || "image/jpeg",
                lastModified: Date.now(),
            });
            await onSelect({
                file,
                selection,
                captions: buildCaptionMap(selection),
            });
            stacked.hide();
        } catch (error) {
            if (closed) return;
            status.textContent = error?.message || getText("image_import_failed", "The image could not be imported.");
            showErrorToast(status.textContent);
            selectButton.disabled = false;
        } finally {
            if (!closed) {
                sourceInput.disabled = false;
                resolveButton.disabled = false;
            }
        }
    });

    stacked.show();
    return stacked;
}

export { buildCaptionMap, parseFilename };
