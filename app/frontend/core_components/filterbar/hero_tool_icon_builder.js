// hero_tool_icon_builder.js
// Builds decorative icon shells for the shared dataset hero tools.
// Connects existing filesystem SVG artwork to current-colour CSS masks.
// Keeps translations on a separate text node so language changes retain icons.

export function createHeroToolIcon(name, className = '') {
    const icon = document.createElement('span');
    icon.className = `dataset-hero-tool-icon dataset-hero-tool-icon--${name}`;
    if (className) icon.classList.add(className);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

/** Retain the button's accessible text and translation key beside its decoration. */
export function appendHeroToolButtonIcon(button, name) {
    const label = document.createElement('span');
    label.dataset.langKey = button.dataset.langKey;
    label.textContent = button.textContent;
    delete button.dataset.langKey;
    button.replaceChildren(createHeroToolIcon(name), label);
}
