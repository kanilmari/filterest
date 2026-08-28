// svg_image_presentation.js
// Builds the shared framed mark-and-label presentation for record-owned SVG images.
// Bridges cached/storage/URL image references with card, article, gallery, and image-first renderers.
// Exists so every image surface applies one safe SVG-logo policy while raster images stay unchanged.

function parseMetadata(value) {
    if (!value) {
        return null;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    if (typeof value !== "string") {
        return null;
    }
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    } catch {
        return null;
    }
}

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function pathHasSvgExtension(value) {
    const source = String(value || "").trim();
    if (!source) {
        return false;
    }
    if (/^data:image\/svg\+xml(?:[;,]|$)/i.test(source)) {
        return true;
    }

    let pathname = source.split(/[?#]/, 1)[0];
    try {
        pathname = new URL(source, "https://filterest.invalid").pathname;
    } catch {
        // Relative storage and cache paths are valid candidates as-is.
    }
    return safeDecodeURIComponent(pathname).trim().toLowerCase().endsWith(".svg");
}

/**
 * Identifies SVG media without fetching or parsing image contents.
 * Accepts URL/path extensions plus trusted asset metadata, and never injects SVG markup.
 */
export function isSvgImageAsset({
    imageSrc = "",
    imageMimeType = "",
    imageOriginalName = "",
    imageMetadata = null,
} = {}) {
    const metadata = parseMetadata(imageMetadata);
    const mimeCandidates = [
        imageMimeType,
        metadata?.mime_type,
        metadata?.content_type,
    ];
    if (mimeCandidates.some((value) =>
        String(value || "").trim().toLowerCase().split(";", 1)[0] === "image/svg+xml"
    )) {
        return true;
    }

    return [
        imageSrc,
        imageOriginalName,
        metadata?.original_name,
        metadata?.filename,
        metadata?.source_url,
        metadata?.cached_url,
    ].some(pathHasSvgExtension);
}

function filenameLabel(value) {
    const source = String(value || "").trim();
    if (!source) {
        return "";
    }
    const path = safeDecodeURIComponent(source.split(/[?#]/, 1)[0]);
    const basename = path.split("/").pop() || "";
    return basename.replace(/\.svg$/i, "").replace(/[_-]+/g, " ").trim();
}

export function resolveSvgImageLabel({
    rowLabel = "",
    imageTitle = "",
    imageOriginalName = "",
    imageSrc = "",
} = {}) {
    return String(rowLabel || "").trim()
        || String(imageTitle || "").trim()
        || filenameLabel(imageOriginalName)
        || filenameLabel(imageSrc);
}

/**
 * Creates the shared SVG mark presentation around an already-created image element.
 * Text is assigned only through textContent and the SVG remains an ordinary img source.
 */
export function createSvgImagePresentation(imageElement, {
    imageSrc = "",
    imageMimeType = "",
    imageOriginalName = "",
    imageTitle = "",
    imageMetadata = null,
    rowLabel = "",
    altText = "",
    renderSlot = "standalone",
} = {}) {
    if (!(imageElement instanceof HTMLImageElement) || !isSvgImageAsset({
        imageSrc,
        imageMimeType,
        imageOriginalName,
        imageMetadata,
    })) {
        return null;
    }

    const label = resolveSvgImageLabel({
        rowLabel,
        imageTitle,
        imageOriginalName,
        imageSrc,
    });
    const presentation = document.createElement("div");
    presentation.classList.add(
        "record_image_logo_presentation",
        "record_svg_image_presentation",
        `record_svg_image_presentation--${String(renderSlot || "standalone").replace(/[^a-z0-9_-]/gi, "-")}`,
    );
    presentation.dataset.imagePresentationKind = "svg-logo";
    presentation.setAttribute("role", "img");
    presentation.setAttribute("aria-label", String(altText || label || "Picture").trim());

    imageElement.classList.add(
        "record_image_logo_presentation__mark",
        "record_svg_image_presentation__mark",
    );
    imageElement.alt = "";
    imageElement.setAttribute("aria-hidden", "true");
    presentation.appendChild(imageElement);

    if (label) {
        presentation.classList.add("record_image_logo_presentation--mark-title");
        const labelElement = document.createElement("span");
        labelElement.classList.add(
            "record_image_logo_presentation__label",
            "record_svg_image_presentation__label",
        );
        labelElement.textContent = label;
        labelElement.title = label;
        labelElement.style.setProperty(
            "--record-image-logo-label-length",
            String(Math.max(1, label.length)),
        );
        labelElement.style.setProperty(
            "--record-svg-label-length",
            String(Math.max(1, label.length)),
        );
        presentation.appendChild(labelElement);
    } else {
        presentation.classList.add(
            "record_image_logo_presentation--mark-only",
            "record_svg_image_presentation--mark-only",
        );
    }

    return presentation;
}

/**
 * Appends either the shared SVG presentation or the original raster image to a host.
 * The return value lets consumers retain their existing image events and lazy-loading setup.
 */
export function appendImageWithSvgPresentation(hostElement, imageElement, options = {}) {
    if (!(hostElement instanceof HTMLElement)) {
        return { image: imageElement, isSvg: false, presentation: null };
    }

    const presentation = createSvgImagePresentation(imageElement, options);
    if (!presentation) {
        hostElement.dataset.imagePresentationKind = "raster";
        hostElement.appendChild(imageElement);
        return { image: imageElement, isSvg: false, presentation: null };
    }

    hostElement.classList.add(
        "card_image_contrast_frame",
        "record_svg_image_frame",
    );
    hostElement.dataset.imagePresentationKind = "svg-logo";
    hostElement.appendChild(presentation);
    return { image: imageElement, isSvg: true, presentation };
}
