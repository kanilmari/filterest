// icon_mask_builder.js
// Creates CSS-mask-based icon spans from static SVG asset paths.
// Bridges SVG file URLs with lightweight DOM elements for decorative UI icons.
// Exists to avoid inline SVG/path DOM when a control only needs a themed icon shell.

export function createMaskIconSpan(iconPath, classNames = []) {
    const icon = document.createElement("span");
    const normalizedClassNames = Array.isArray(classNames)
        ? classNames.filter(Boolean)
        : [classNames].filter(Boolean);

    icon.setAttribute("aria-hidden", "true");
    if (normalizedClassNames.length > 0) {
        icon.classList.add(...normalizedClassNames);
    }

    const maskUrl = `url("${iconPath}")`;
    icon.style.display = "block";
    icon.style.webkitMaskImage = maskUrl;
    icon.style.maskImage = maskUrl;
    icon.style.webkitMaskPosition = "center";
    icon.style.maskPosition = "center";
    icon.style.webkitMaskRepeat = "no-repeat";
    icon.style.maskRepeat = "no-repeat";
    icon.style.webkitMaskSize = "contain";
    icon.style.maskSize = "contain";

    return icon;
}
