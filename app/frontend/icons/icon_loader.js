// icon_loader.js
// Loads and caches SVG icon files as inline markup strings for reuse across the UI.
// Bridges fetch requests with an in-memory Map cache to avoid duplicate network calls.
// Exists to provide a single async accessor for all SVG icons without duplicating fetch logic.
// PIPELINE_EXCEPTION: Static SVG asset fetches do not target API routes; endpoint_router
// cannot load arbitrary same-origin asset paths.

const svg_icon_cache = new Map();

function isSvgMarkup(markup) {
    return /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(markup);
}

export async function loadSvgIcon(iconPath) {
    if (!svg_icon_cache.has(iconPath)) {
        const loadPromise = fetch(iconPath, { credentials: "same-origin" })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(
                        `failed to load icon '${iconPath}' (status ${response.status})`
                    );
                }
                const contentType = response.headers.get("content-type") || "";
                const body = (await response.text()).trim();

                if (!contentType.includes("image/svg+xml") || !isSvgMarkup(body)) {
                    throw new Error(
                        `icon '${iconPath}' returned non-SVG content-type '${contentType || "unknown"}'`
                    );
                }

                return body;
            })
            .catch((error) => {
                svg_icon_cache.delete(iconPath);
                throw error;
            });
        svg_icon_cache.set(iconPath, loadPromise);
    }

    return svg_icon_cache.get(iconPath);
}

export async function setElementSvgContent(element, iconPath) {
    if (!element) return;
    try {
        element.innerHTML = await loadSvgIcon(iconPath);
    } catch (error) {
        console.warn(`[icon_loader] ${error.message}`);
    }
}
