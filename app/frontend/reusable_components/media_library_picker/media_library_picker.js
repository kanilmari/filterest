// media_library_picker.js
// Shows a bounded existing-image selection inside the current row form.
// Between protected media APIs, pending row state, and the shared form styles.
// Exists to reuse a stored image without downloading and reuploading its bytes.
const COPY = {
    choose: ["Käytä olemassa olevaa kuvaa", "Use an existing image"],
    close: ["Sulje kuvalista", "Close image list"],
    clear: ["Poista valinta", "Clear selection"],
    next: ["Lisää kuvia", "More images"],
    loading: ["Ladataan kuvia…", "Loading images…"],
    scope: [
        "Valitse saman aineiston kuva. Kuva ja sen nykyiset kuvatekstit liitetään, kun tallennat rivin.",
        "Choose an image from this dataset. Its current captions are copied when you save the row.",
    ],
    unavailable: [
        "Kuvaa ei voi käyttää uudelleen näillä oikeuksilla.",
        "This image cannot be reused with these permissions.",
    ],
    empty: ["Uudelleenkäytettäviä kuvia ei löytynyt.", "No reusable images were found."],
    selected: ["Valittu kuva", "Selected image"],
};
export function mediaLibraryText(key, getLanguage = () => "en", getTranslation = () => "") {
    const translation = getTranslation(`media_library_${key}`);
    if (translation && translation !== `media_library_${key}`) return translation;
    return COPY[key]?.[String(getLanguage()).startsWith("fi") ? 0 : 1] || key;
}

/** Builds a local draft selector; server attachment happens only in row submission. */
export function appendMediaLibraryPicker(container, {
    relationId, state, fileInput, selectedFiles, endpointRouter,
    getLanguage = () => "en", getTranslation = () => "",
}) {
    const text = (key) => mediaLibraryText(key, getLanguage, getTranslation);
    const wrapper = document.createElement("div");
    wrapper.className = "shared_asset_media_library";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "fw-btn fw-btn--ghost";
    open.textContent = text("choose");
    open.dataset.testid = "existing-image-picker-open";
    const panel = document.createElement("div");
    panel.hidden = true;
    const help = document.createElement("p");
    help.textContent = text("scope");
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexWrap = "wrap";
    list.style.gap = "0.5rem";
    const more = document.createElement("button");
    more.type = "button";
    more.textContent = text("next");
    more.hidden = true;
    const chosen = document.createElement("p");
    chosen.dataset.testid = "existing-image-selected";
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = text("clear");
    clear.hidden = true;
    let generation = 0;
    let nextAfter = 0;

    const captionControls = [...(state._fieldControls?.values?.() || [])].flatMap((control) =>
        [control.input, control.hiddenInput, ...(control.textareas?.values?.() || [])].filter(Boolean));
    const originalDisabled = new Map(captionControls.map((input) => [input, input.disabled]));
    const reset = () => {
        for (const input of captionControls) input.disabled = originalDisabled.get(input);
        delete state._existingImage;
        chosen.textContent = "";
        clear.hidden = true;
        fileInput.required = state._fileRequiredWhenEmpty === true;
    };
    state._clearExistingImage = reset;
    clear.addEventListener("click", reset);
    async function load(after = 0) {
        const requestGeneration = ++generation;
        status.textContent = text("loading");
        more.disabled = true;
        try {
            const data = await endpointRouter("mediaLibraryList", {
                url_params: `?relation_id=${encodeURIComponent(relationId)}&after=${after}`,
                suppressErrorToast: true, suppressAuthRedirect: true,
            });
            if (requestGeneration !== generation || panel.hidden) return;
            if (!after) list.replaceChildren();
            for (const item of data.items || []) {
                if (!Number.isSafeInteger(item.source_row_id) || item.source_row_id <= 0 ||
                    typeof item.url !== "string" || !item.url.startsWith("/storage/")) continue;
                const button = document.createElement("button");
                button.type = "button";
                button.className = "fw-btn fw-btn--ghost";
                button.style.display = "flex";
                button.style.flexDirection = "column";
                const img = document.createElement("img");
                img.src = item.url;
                img.alt = "";
                img.loading = "lazy";
                img.style.width = "7rem";
                img.style.height = "5rem";
                img.style.objectFit = "contain";
                const label = document.createElement("span");
                label.textContent = item.name || text("selected");
                button.append(img, label);
                button.addEventListener("click", () => {
                    for (const input of captionControls) input.disabled = true;
                    state._existingImage = { relation_id: relationId, source_row_id: item.source_row_id };
                    delete state._actualFileObject;
                    state._actualFileObjects = [];
                    fileInput.value = "";
                    fileInput.required = false;
                    selectedFiles.replaceChildren();
                    chosen.textContent = `${text("selected")}: ${label.textContent}`;
                    clear.hidden = false;
                    panel.hidden = true;
                    open.textContent = text("choose");
                    generation++;
                });
                list.appendChild(button);
            }
            nextAfter = Number.isSafeInteger(data.next_after) ? data.next_after : 0;
            more.hidden = nextAfter <= 0;
            status.textContent = list.childElementCount ? "" : text("empty");
        } catch {
            if (requestGeneration === generation && !panel.hidden) status.textContent = text("unavailable");
        } finally {
            if (requestGeneration === generation) more.disabled = false;
        }
    }
    open.addEventListener("click", () => {
        panel.hidden = !panel.hidden;
        open.textContent = text(panel.hidden ? "choose" : "close");
        if (panel.hidden) generation++;
        else void load();
    });
    more.addEventListener("click", () => void load(nextAfter));
    panel.append(help, status, list, more);
    wrapper.append(open, panel, chosen, clear);
    container.appendChild(wrapper);
    return { reset, element: wrapper };
}
