// card_style_palette_control.js
// Builds the reused card style choice for tab overrides and site defaults.
// Connects keyed copy and stable DOM controls to the selected draft owner.
// Keeps style selection separate from persistence and inheritance actions.

/** The selected owner handles persistence; this control only emits explicit styles. */
export function buildCardStyleControl(copy, onChange) {
    const label = document.createElement('label');
    label.className = 'dataset-cover-test-palette__select';
    const text = document.createElement('span');
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-card-style';
    const choices = ['modern', 'standard'].map(value => {
        const option = document.createElement('option'); option.value = value;
        select.appendChild(option); return option;
    });
    const hint = document.createElement('small');
    label.append(text, select, hint);
    select.addEventListener('change', () => onChange(select.value));
    const setCopy = next => {
        text.textContent = next.cardStyle; select.setAttribute('aria-label', next.cardStyle);
        hint.textContent = next.cardStyleHint;
        choices[0].textContent = next.cardStyleModern; choices[1].textContent = next.cardStyleStandard;
    };
    setCopy(copy);
    return { element: label, setCopy, setValue(value) { select.value = value; } };
}
