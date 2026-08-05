// card_avatar_builder.js
// Builds card avatar and image wrappers for small-card, card, and big-card media slots.
// Bridges card view call sites and pure avatar/image helpers with the final DOM nodes.
// Exists to keep card media rendering and accessibility defaults in one reusable place.

import {
    buildImageAltContext,
    computeAvatarConfig,
    isPngImage,
} from "./card_avatar_builder_helpers.js";
import { CARD_IMAGE_RENDER_SLOTS } from "./card_image_render_options.js";
import { isCardStackViewport } from "../../../ui_config.js";

const SERVICE_CATALOG_TABLE_NAME = "app_service_catalog";
const SERVICE_CATALOG_ROUTE_ALIAS = "service_catalog";
const SERVICE_CATALOG_ICON_TYPE_ID = "1";
const SERVICE_CATALOG_LEGACY_LOGO_PATTERN = /^service_catalog_logos\/([a-z0-9_-]+)\.svg$/i;
const SERVICE_CATALOG_LOGO_RENDER_MODES = new Set([
    "css_logo",
    "framed_css_logo",
    "html_css_logo",
    "logo",
    "auto",
]);
const SERVICE_CATALOG_IMAGE_RENDER_MODES = new Set([
    "image",
    "normal_image",
    "asset_image",
    "jpg",
    "jpeg",
    "png",
]);
const SERVICE_CATALOG_STANDALONE_LOGO_EXTENSIONS = new Set([
    "png",
    "svg",
    "webp",
    "gif",
]);
const SERVICE_CATALOG_IMAGE_ONLY_LOGO_VARIANTS = new Set([
    "matrix",
]);

// The service catalog has three high-level logo presentation styles:
// full image, standalone mark, and CSS-assisted composed logo.
const SERVICE_CATALOG_LOGO_PRESENTATION_STYLES = Object.freeze({
    FULL_IMAGE: "image",
    STANDALONE_MARK: "standalone",
    CSS_ASSISTED: "css",
});
const SERVICE_CATALOG_LOGO_DEFAULTS = {
    firefox: { markText: "Fx", showLabel: true, useImageMark: true },
    thunderbird: { markText: "Tb", showLabel: true, useImageMark: true },
    wikipedia: { markText: "W", showLabel: true, useImageMark: true },
    openstreetmap: { markText: "OSM", showLabel: true, useImageMark: true },
};

/**
 * Luo SHA-256 -pohjainen "avatar" annetusta siemenarvosta.
 */
export async function create_seeded_avatar(seed_string, letter_for_avatar, useLargeSize = false) {
    // Lasketaan seed_string -> SHA-256 (hex)
    const msgUint8 = new TextEncoder().encode(seed_string);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const config = computeAvatarConfig(hashHex, letter_for_avatar, useLargeSize);

    // Container
    const container_div = document.createElement('div');
    container_div.style.width = config.containerSize + 'px';
    container_div.style.height = config.containerSize + 'px';
    container_div.style.display = 'flex';
    container_div.style.alignItems = 'center';
    container_div.style.justifyContent = 'center';
    container_div.style.overflow = 'hidden';

    // Avatar-elementti
    const avatar_div = document.createElement('div');
    avatar_div.textContent = config.text;
    avatar_div.style.display = 'flex';
    avatar_div.style.alignItems = 'center';
    avatar_div.style.justifyContent = 'center';
    avatar_div.style.width = config.avatarBoxSize + 'px';
    avatar_div.style.height = config.avatarBoxSize + 'px';
    avatar_div.style.backgroundColor = config.color;
    avatar_div.style.fontFamily = config.font;
    avatar_div.style.fontWeight = 'bold';
    avatar_div.style.fontSize = useLargeSize ? '7rem' : '4rem';
    avatar_div.style.color = '#fff';
    avatar_div.style.textShadow = '2px 2px 5px rgba(0, 0, 0, 0.5)';
    avatar_div.style.borderRadius = config.borderRadius;

    container_div.appendChild(avatar_div);
    return container_div;
}

/**
 * Luo kuvaelementin. PNG-kuville ei lisätä varjoa eikä sumennusta.
 */
export function createImageElement(
    image_src,
    useLargeSize,
    {
        tableName = "",
        rowLabel = "",
        renderSlot = CARD_IMAGE_RENDER_SLOTS.STANDALONE,
        imageTypeId = undefined,
        imageMetadata = undefined,
    } = {}
) {
    const wrapper = document.createElement('div');
    const altContext = buildImageAltContext(tableName, rowLabel);
    const serviceCatalogLogoPlan = resolveServiceCatalogLogoPlan({
        tableName,
        imageTypeId,
        imageMetadata,
        imageSrc: image_src,
    });
    const useServiceCatalogCssLogo = Boolean(serviceCatalogLogoPlan?.variant);
    const cssOnlyServiceCatalogLogo = serviceCatalogLogoPlan?.cssOnly === true;
    const useServiceCatalogLogoFrame = isServiceCatalogTableName(tableName) && useLargeSize;
    if (useLargeSize) {
        if (isCardStackViewport()) {
            wrapper.style.width = '100%';
            wrapper.style.maxWidth = '1000px';
            wrapper.style.aspectRatio = '1 / 1';
        } else {
            wrapper.style.width = '300px';
            wrapper.style.height = '300px';
        }
    } else {
        wrapper.style.width = '140px';
        wrapper.style.height = '140px';
    }
    wrapper.style.position = 'relative';
    wrapper.style.overflow = 'hidden';
    wrapper.style.borderRadius = '7px';
    if (useServiceCatalogLogoFrame) {
        wrapper.classList.add(
            "service_catalog_logo_frame",
            "service_catalog_logo_frame--contrast-safe"
        );
        wrapper.dataset.serviceCatalogLogoRenderMode = useServiceCatalogCssLogo
            ? SERVICE_CATALOG_LOGO_PRESENTATION_STYLES.CSS_ASSISTED
            : SERVICE_CATALOG_LOGO_PRESENTATION_STYLES.FULL_IMAGE;
        wrapper.dataset.serviceCatalogLogoKind = resolveServiceCatalogLogoKind(
            image_src,
            serviceCatalogLogoPlan
        );
    }

    const foregroundImg = document.createElement('img');
    if (!isPngImage(image_src)) {
        // Muille kuin PNG-kuville lisätään pyöristys, varjo ja (halutessa) blur-tausta
        wrapper.style.background = 'var(--bg_color_2)';
        // wrapper.style.border = '1px solid var(--border_color)';
        wrapper.style.boxShadow = '2px 2px 4px rgba(0, 0, 0, 0.2)';
        
        wrapper.style.backdropFilter = 'blur(10px)';
        wrapper.style.webkitBackdropFilter = 'blur(10px)';
    }

    // Näytettävä kuva
    if (!cssOnlyServiceCatalogLogo) {
        foregroundImg.src = image_src;
    }
    foregroundImg.alt = altContext ? `Picture: ${altContext}` : 'Picture';
    foregroundImg.dataset.langKey = 'picture_of_target';
    if (altContext) {
        foregroundImg.dataset.langAltContext = altContext;
    }
    foregroundImg.addEventListener('error', () => {
        foregroundImg.alt = altContext ? `Picture missing: ${altContext}` : 'Picture missing';
        foregroundImg.dataset.langKey = 'picture_missing';
    });
    foregroundImg.style.position = 'relative';
    foregroundImg.style.width = '100%';
    foregroundImg.style.height = '100%';
    foregroundImg.style.objectFit = 'contain';  // pidetään kuva kokonaan näkyvissä
    foregroundImg.style.objectPosition = 'center';
    foregroundImg.style.borderRadius = '6px';

    if (!cssOnlyServiceCatalogLogo && !useServiceCatalogCssLogo) {
        wrapper.appendChild(foregroundImg);
    }
    maybeAppendServiceCatalogCssLogo(wrapper, null, image_src, {
        tableName,
        rowLabel,
        renderSlot,
        imageTypeId,
        imageMetadata,
        logoPlan: serviceCatalogLogoPlan,
    });
    wrapper.classList.add('wrapper');

    return wrapper;
}

/**
 * Adds the service-catalog CSS logo overlay for typed logo assets.
 *
 * @param {HTMLElement} wrapper - Existing image wrapper.
 * @param {HTMLImageElement} foregroundImg - The normal image element to hide.
 * @param {string} imageSrc - Source image path retained for the logo mark.
 * @param {object} options - Row/table media metadata.
 */
function maybeAppendServiceCatalogCssLogo(
    wrapper,
    foregroundImg,
    imageSrc,
    {
        tableName = "",
        rowLabel = "",
        renderSlot = CARD_IMAGE_RENDER_SLOTS.STANDALONE,
        imageTypeId = undefined,
        imageMetadata = undefined,
        logoPlan = null,
    } = {}
) {
    const resolvedLogoPlan = logoPlan || resolveServiceCatalogLogoPlan({
        tableName,
        imageTypeId,
        imageMetadata,
        imageSrc,
    });
    if (!resolvedLogoPlan?.variant) {
        return;
    }

    const label = String(rowLabel || "Service").trim() || "Service";
    wrapper.classList.add(
        "service_catalog_logo_frame",
        "service_catalog_logo_frame--contrast-safe"
    );
    wrapper.dataset.serviceCatalogLogoRenderMode = SERVICE_CATALOG_LOGO_PRESENTATION_STYLES.CSS_ASSISTED;
    wrapper.dataset.serviceCatalogLogoVariant = resolvedLogoPlan.variant;
    wrapper.dataset.serviceCatalogLogoSlot = renderSlot;
    if (foregroundImg) {
        foregroundImg.hidden = true;
    }

    const cssLogo = document.createElement("div");
    cssLogo.className = "service-catalog-css-logo";
    cssLogo.classList.add(`service-catalog-css-logo--${resolvedLogoPlan.variant}`);
    cssLogo.setAttribute("role", "img");
    cssLogo.setAttribute("aria-label", label);

    const showTitle = shouldShowServiceCatalogLogoTitle(renderSlot, resolvedLogoPlan);
    const logoMark = buildServiceCatalogLogoMark(imageSrc, resolvedLogoPlan, {
        forceTextMark: resolvedLogoPlan.useImageMark === false,
    });
    const presentation = showTitle ? "mark-title" : "mark-only";
    wrapper.dataset.serviceCatalogLogoPresentation = presentation;
    wrapper.dataset.serviceCatalogLogoShowLabel = showTitle ? "true" : "false";
    cssLogo.classList.add(`service-catalog-css-logo--${presentation}`);

    cssLogo.appendChild(logoMark);
    if (showTitle) {
        const logoTitle = document.createElement("span");
        logoTitle.className = "service-catalog-css-logo__title";
        logoTitle.textContent = label;
        logoTitle.style.setProperty(
            "--service-logo-title-length",
            String(resolveServiceCatalogLogoTitleLength(label))
        );
        cssLogo.appendChild(logoTitle);
    }
    wrapper.appendChild(cssLogo);
}

function buildServiceCatalogLogoMark(imageSrc, logoPlan, { forceTextMark = false } = {}) {
    if (!forceTextMark && logoPlan?.useImageMark !== false) {
        const logoMark = document.createElement("img");
        logoMark.className = "service-catalog-css-logo__mark";
        logoMark.src = imageSrc;
        logoMark.alt = "";
        logoMark.setAttribute("aria-hidden", "true");
        return logoMark;
    }

    const logoMark = document.createElement("span");
    logoMark.className = [
        "service-catalog-css-logo__mark",
        "service-catalog-css-logo__mark--text",
        `service-catalog-css-logo__mark--${logoPlan.variant}`,
    ].join(" ");
    logoMark.textContent = logoPlan.markText || logoPlan.variant.slice(0, 2).toUpperCase();
    logoMark.setAttribute("aria-hidden", "true");
    return logoMark;
}

function resolveServiceCatalogLogoPlan({
    tableName = "",
    imageTypeId = undefined,
    imageMetadata = undefined,
    imageSrc = "",
} = {}) {
    const typedPlan = resolveTypedServiceCatalogLogoPlan({
        tableName,
        imageTypeId,
        imageMetadata,
    });
    if (typedPlan) {
        return typedPlan;
    }

    const legacyVariant = resolveLegacyServiceCatalogLogoVariant({ tableName, imageSrc });
    if (legacyVariant) {
        if (isServiceCatalogImageOnlyLogoVariant(legacyVariant)) {
            return null;
        }
        return {
            variant: legacyVariant,
            useImageMark: false,
            cssOnly: true,
            markText: resolveServiceCatalogLogoMarkText(legacyVariant),
            showLabel: resolveServiceCatalogLogoDefault(legacyVariant).showLabel,
            hasExplicitShowLabel: false,
        };
    }

    return null;
}

/**
 * Reads typed service-catalog image metadata and returns the CSS logo rendering plan.
 *
 * @param {object} options - Table, image type, and metadata payload.
 * @returns {object|null}
 */
function resolveTypedServiceCatalogLogoPlan({
    tableName = "",
    imageTypeId = undefined,
    imageMetadata = undefined,
} = {}) {
    if (!isServiceCatalogTableName(tableName)) {
        return null;
    }
    if (String(imageTypeId ?? "").trim() !== SERVICE_CATALOG_ICON_TYPE_ID) {
        return null;
    }

    const metadata = parseImageMetadata(imageMetadata);
    const variant = String(metadata?.logo_variant || "").trim().toLowerCase();
    if (!variant || !/^[a-z0-9_-]{1,48}$/.test(variant)) {
        return null;
    }
    if (isServiceCatalogImageOnlyLogoVariant(variant)) {
        return null;
    }
    const renderMode = resolveServiceCatalogLogoRenderMode(metadata);
    if (SERVICE_CATALOG_IMAGE_RENDER_MODES.has(renderMode)) {
        return null;
    }
    if (!SERVICE_CATALOG_LOGO_RENDER_MODES.has(renderMode)) {
        return null;
    }

    const defaults = resolveServiceCatalogLogoDefault(variant);
    const explicitShowLabel = resolveServiceCatalogLogoLabelPreference(metadata);
    const explicitUseImageMark = resolveServiceCatalogLogoMarkPreference(metadata);
    return {
        variant,
        useImageMark: explicitUseImageMark ?? (defaults.useImageMark !== false),
        cssOnly: false,
        markText: resolveServiceCatalogLogoMarkText(variant),
        showLabel: explicitShowLabel ?? defaults.showLabel,
        hasExplicitShowLabel: explicitShowLabel !== null,
    };
}

function resolveLegacyServiceCatalogLogoVariant({
    tableName = "",
    imageSrc = "",
} = {}) {
    if (!isServiceCatalogTableName(tableName)) {
        return "";
    }

    const normalized = String(imageSrc || "")
        .trim()
        .replace(/^\/+/, "")
        .replace(/^storage\//, "");
    const match = SERVICE_CATALOG_LEGACY_LOGO_PATTERN.exec(normalized);
    const variant = String(match?.[1] || "").trim().toLowerCase();
    if (!variant || !/^[a-z0-9_-]{1,48}$/.test(variant)) {
        return "";
    }
    return variant;
}

function isServiceCatalogTableName(tableName = "") {
    const normalized = String(tableName || "").trim();
    return normalized === SERVICE_CATALOG_TABLE_NAME || normalized === SERVICE_CATALOG_ROUTE_ALIAS;
}

function resolveServiceCatalogLogoKind(imageSrc = "", logoPlan = null) {
    if (logoPlan?.variant) {
        return SERVICE_CATALOG_LOGO_PRESENTATION_STYLES.CSS_ASSISTED;
    }

    const extensionMatch = String(imageSrc || "")
        .trim()
        .toLowerCase()
        .match(/\.([a-z0-9]+)(?:[?#].*)?$/);
    const extension = extensionMatch?.[1] || "";
    return SERVICE_CATALOG_STANDALONE_LOGO_EXTENSIONS.has(extension)
        ? SERVICE_CATALOG_LOGO_PRESENTATION_STYLES.STANDALONE_MARK
        : SERVICE_CATALOG_LOGO_PRESENTATION_STYLES.FULL_IMAGE;
}

function resolveServiceCatalogLogoMarkText(variant = "") {
    const normalizedVariant = String(variant || "").trim().toLowerCase();
    return resolveServiceCatalogLogoDefault(normalizedVariant).markText
        || normalizedVariant.slice(0, 2).toUpperCase()
        || "S";
}

function resolveServiceCatalogLogoDefault(variant = "") {
    const normalizedVariant = String(variant || "").trim().toLowerCase();
    return SERVICE_CATALOG_LOGO_DEFAULTS[normalizedVariant] || {
        markText: "",
        showLabel: true,
        useImageMark: true,
    };
}

function resolveServiceCatalogLogoRenderMode(metadata = null) {
    const rawValue = String(
        metadata?.logo_render_mode
        || metadata?.logo_presentation
        || metadata?.render_mode
        || "css_logo"
    ).trim().toLowerCase();
    return rawValue || "css_logo";
}

function resolveServiceCatalogLogoLabelPreference(metadata = null) {
    for (const key of ["logo_show_label", "logo_show_title", "show_label", "logo_label_visible"]) {
        if (!Object.prototype.hasOwnProperty.call(metadata || {}, key)) {
            continue;
        }
        const value = metadata[key];
        if (typeof value === "boolean") {
            return value;
        }
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (["true", "1", "yes", "show", "visible"].includes(normalized)) {
                return true;
            }
            if (["false", "0", "no", "hide", "hidden"].includes(normalized)) {
                return false;
            }
        }
    }
    return null;
}

function resolveServiceCatalogLogoMarkPreference(metadata = null) {
    for (const key of ["logo_mark_mode", "mark_mode", "logo_mark_renderer"]) {
        if (!Object.prototype.hasOwnProperty.call(metadata || {}, key)) {
            continue;
        }
        const normalized = String(metadata[key] ?? "").trim().toLowerCase();
        if (["image", "asset", "svg", "imported_image"].includes(normalized)) {
            return true;
        }
        if (["text", "wordmark", "css_text", "css_wordmark", "fallback_text"].includes(normalized)) {
            return false;
        }
    }
    return null;
}

function isServiceCatalogImageOnlyLogoVariant(variant = "") {
    return SERVICE_CATALOG_IMAGE_ONLY_LOGO_VARIANTS.has(
        String(variant || "").trim().toLowerCase()
    );
}

function shouldShowServiceCatalogLogoTitle(
    renderSlot = CARD_IMAGE_RENDER_SLOTS.STANDALONE,
    logoPlan = null
) {
    if (renderSlot === CARD_IMAGE_RENDER_SLOTS.SMALL_THUMBNAIL) {
        return false;
    }
    if (logoPlan?.showLabel === false) {
        return false;
    }
    return true;
}

/**
 * Parses optional image metadata from JSON strings or plain objects.
 *
 * @param {unknown} imageMetadata - Metadata from row companion fields.
 * @returns {object|null}
 */
function parseImageMetadata(imageMetadata) {
    if (!imageMetadata) {
        return null;
    }
    if (typeof imageMetadata === "object" && !Array.isArray(imageMetadata)) {
        return imageMetadata;
    }
    if (typeof imageMetadata !== "string") {
        return null;
    }
    try {
        const parsed = JSON.parse(imageMetadata);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

/**
 * Returns the visible title length used by CSS for container-based text fitting.
 *
 * @param {string} label - Service label shown under the logo mark.
 * @returns {number}
 */
function resolveServiceCatalogLogoTitleLength(label) {
    const length = String(label || "").trim().length;
    return Math.max(1, length);
}
