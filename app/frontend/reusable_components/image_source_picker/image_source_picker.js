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
    open_source_page: { fi: "Avaa lähdesivu", en: "Open source page", ch: "打开来源页面", yue: "開啟來源頁面" },
    use_image: { fi: "Käytä kuvaa", en: "Use image", ch: "使用图片", yue: "使用相片" },
    available: { fi: "käytettävissä", en: "available", ch: "可用", yue: "可用" },
    not_configured: { fi: "ei määritetty", en: "not configured", ch: "未配置", yue: "未設定" },
    provider_status_unavailable: { fi: "Kuvapalvelujen tilaa ei saatu.", en: "Provider status is unavailable.", ch: "无法获取图片服务状态。", yue: "攞唔到圖片服務狀態。" },
    image_ready: { fi: "Kuva on valmis valittavaksi.", en: "Image is ready to use.", ch: "图片可以使用。", yue: "相片可以使用。" },
    image_preview: { fi: "Kuvan esikatselu", en: "Image preview", ch: "图片预览", yue: "相片預覽" },
    image_load_failed: { fi: "Kuvaa ei voitu ladata.", en: "The image could not be loaded.", ch: "无法加载图片。", yue: "載入唔到相片。" },
    image_import_failed: { fi: "Kuvaa ei voitu tuoda.", en: "The image could not be imported.", ch: "无法导入图片。", yue: "匯入唔到相片。" },
    preview: { fi: "Esikatsele", en: "Preview", ch: "预览", yue: "預覽" },
    cancel: { fi: "Peruuta", en: "Cancel", ch: "取消", yue: "取消" },
    loading: { fi: "Ladataan…", en: "Loading…", ch: "正在加载…", yue: "載入緊…" },
});

export function getImageSourcePickerText(key, fallback = "", {
    getTranslation = () => "",
    getLanguage = () => "en",
} = {}) {
    const serverTranslation = getTranslation(key);
    if (serverTranslation && serverTranslation !== key) return serverTranslation;
    const language = getLanguage();
    return LOCALIZED_FALLBACK_COPY[key]?.[language]
        || LOCALIZED_FALLBACK_COPY[key]?.en
        || fallback;
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
        sourceLink.textContent = getText("open_source_page", "Open source page");
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
    const sourceLabel = document.createElement("label");
    sourceLabel.htmlFor = "image-source-picker-url";
    sourceLabel.textContent = getText("image_source_url", "Image page URL");
    const sourceRow = document.createElement("div");
    sourceRow.classList.add("image-source-picker__source-row");
    const sourceInput = document.createElement("input");
    sourceInput.id = "image-source-picker-url";
    sourceInput.type = "url";
    sourceInput.inputMode = "url";
    sourceInput.required = true;
    sourceInput.placeholder = "https://unsplash.com/photos/…";
    sourceInput.autocomplete = "off";
    sourceInput.dataset.testid = "image-source-picker-url";
    const resolveButton = document.createElement("button");
    resolveButton.type = "submit";
    resolveButton.classList.add("fw-btn", "fw-btn--primary");
    resolveButton.textContent = getText("preview", "Preview");
    sourceRow.append(sourceInput, resolveButton);
    form.append(sourceLabel, sourceRow);

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
    let previewObjectUrl = "";
    const revokePreview = () => {
        if (!previewObjectUrl) return;
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = "";
    };
    const stacked = createStackedModal({
        titlePlainText: getText("pick_image_from_web", "Pick image from web"),
        contentElements: [root],
        width: "min(1180px, 96vw)",
        maxWidth: "96vw",
        maxHeight: "97dvh",
        cleanupCallback: revokePreview,
    });

    cancelButton.addEventListener("click", stacked.hide);

    void endpointRouter("imageSourcePickerProviders")
        .then((payload) => {
            const providers = Array.isArray(payload?.providers) ? payload.providers : [];
            providerList.replaceChildren(...providers.map((provider) => {
                const item = document.createElement("span");
                item.classList.add("image-source-picker__provider");
                item.dataset.testid = "image-source-picker-provider";
                item.classList.toggle("is-unavailable", provider?.configured !== true);
                item.textContent = `${provider?.name || provider?.key}: ${provider?.configured === true
                    ? getText("available", "available")
                    : getText("not_configured", "not configured")}`;
                return item;
            }));
        })
        .catch(() => {
            providerList.textContent = getText("provider_status_unavailable", "Provider status is unavailable.");
        });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const sourceUrl = sourceInput.value.trim();
        if (!sourceUrl) return;
        resolveButton.disabled = true;
        selectButton.disabled = true;
        status.textContent = getText("loading", "Loading…");
        resolvedSelection = null;
        preview.hidden = true;
        revokePreview();
        try {
            const payload = await endpointRouter("imageSourcePickerResolve", {
                method: "POST",
                body_data: { source_url: sourceUrl },
            });
            resolvedSelection = payload?.selection || null;
            if (!resolvedSelection) throw new Error("Image provider returned no selection.");
            const response = await fetchImageResponse(sourceUrl, "preview", endpointRouter);
            const blob = await response.blob();
            previewObjectUrl = URL.createObjectURL(blob);
            previewImage.src = previewObjectUrl;
            previewImage.alt = resolvedSelection?.image?.alt_text
                || resolvedSelection?.description
                || getText("image_preview", "Image preview");
            appendAttribution(attribution, resolvedSelection, getText);
            preview.hidden = false;
            selectButton.disabled = false;
            status.textContent = getText("image_ready", "Image is ready to use.");
        } catch (error) {
            status.textContent = error?.message || getText("image_load_failed", "The image could not be loaded.");
            showErrorToast(status.textContent);
        } finally {
            resolveButton.disabled = false;
        }
    });

    selectButton.addEventListener("click", async () => {
        if (!resolvedSelection) return;
        selectButton.disabled = true;
        status.textContent = getText("loading", "Loading…");
        try {
            const response = await fetchImageResponse(sourceInput.value.trim(), "select", endpointRouter);
            const blob = await response.blob();
            const file = new File([blob], parseFilename(response, resolvedSelection), {
                type: blob.type || response.headers.get("Content-Type") || "image/jpeg",
                lastModified: Date.now(),
            });
            await onSelect({
                file,
                selection: resolvedSelection,
                captions: buildCaptionMap(resolvedSelection),
            });
            stacked.hide();
        } catch (error) {
            status.textContent = error?.message || getText("image_import_failed", "The image could not be imported.");
            showErrorToast(status.textContent);
            selectButton.disabled = false;
        }
    });

    stacked.show();
    return stacked;
}

export { buildCaptionMap, parseFilename };
