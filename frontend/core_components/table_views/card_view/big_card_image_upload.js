// big_card_image_upload.js
// Reusable drag-and-drop / click-to-upload placeholder for image uploads.
// Bridges file selection UI with the caller's onFileSelected callback.
// Exists to provide a consistent upload affordance for both hero and thumbnail slots.

/**
 * Creates a clickable, drag-and-drop image upload placeholder.
 *
 * @param {Object} options
 * @param {"large"|"small"} options.size - "large" for hero area, "small" for thumbnail slot
 * @param {(file: File) => void} [options.onFileSelected] - callback when user selects one file
 * @param {(files: File[]) => void} [options.onFilesSelected] - callback when user selects one or more files
 * @param {boolean} [options.multiple] - whether the picker/dropzone accepts multiple files
 * @returns {HTMLElement}
 */
export function createImageUploadPlaceholder({ size, onFileSelected, onFilesSelected, multiple = false }) {
    const el = document.createElement("div");
    el.classList.add("image_upload_placeholder", size);

    const icon = document.createElement("span");
    icon.classList.add("upload_icon");
    icon.textContent = size === "large" ? "+" : "+";
    el.appendChild(icon);

    // Hidden file input
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = multiple === true;
    input.style.display = "none";
    // Programmatic input activation dispatches its own bubbling click event.
    // Keep that event inside the input so it cannot re-enter the placeholder
    // listener and interfere with the browser's native file picker.
    input.addEventListener("click", (event) => {
        event.stopPropagation();
    });
    input.addEventListener("change", () => {
        const files = normalizeImageFiles(input.files, multiple);
        if (files.length > 0) {
            emitSelectedImageFiles(files, onFileSelected, onFilesSelected);
            input.value = "";
        }
    });
    el.appendChild(input);

    // Click to open file picker
    el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.click();
    });

    // Drag-and-drop
    el.addEventListener("dragenter", (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.add("drag_over");
    });
    el.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = "copy";
        }
        el.classList.add("drag_over");
    });
    el.addEventListener("dragleave", (e) => {
        e.stopPropagation();
        el.classList.remove("drag_over");
    });
    el.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        el.classList.remove("drag_over");
        const files = normalizeImageFiles(e.dataTransfer?.files, multiple);
        if (files.length > 0) {
            emitSelectedImageFiles(files, onFileSelected, onFilesSelected);
        }
    });

    return el;
}

function normalizeImageFiles(fileListLike, multiple) {
    const files = Array.from(fileListLike || []).filter((file) => file?.type?.startsWith("image/"));
    if (files.length === 0) {
        return [];
    }
    return multiple === true ? files : [files[0]];
}

function emitSelectedImageFiles(files, onFileSelected, onFilesSelected) {
    if (typeof onFilesSelected === "function") {
        onFilesSelected(files);
        return;
    }
    if (typeof onFileSelected === "function") {
        files.forEach((file) => onFileSelected(file));
    }
}
