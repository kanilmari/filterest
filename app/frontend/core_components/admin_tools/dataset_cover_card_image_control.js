// dataset_cover_card_image_control.js
// Builds the site-wide raster card image selector in the appearance palette.
// Connects accessible localized choices with the existing preview/save lifecycle.
// Updates copy and selection in place without replacing the active control.

const OPTIONS = Object.freeze([
    ['cover', 'cardImageCover'],
    ['contain', 'cardImageContain'],
    ['contain_blur', 'cardImageBlur'],
]);

export function buildCardImagePresentationControl(copy, onChange) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__select';
    const title = document.createElement('span');
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-card-image-presentation';
    const hint = document.createElement('small');
    const choices = OPTIONS.map(([value, key]) => {
        const option = document.createElement('option');
        option.value = value;
        select.append(option);
        return { option, key };
    });
    function setCopy(nextCopy) {
        title.textContent = nextCopy.cardImagePresentation;
        hint.textContent = nextCopy.cardImagePresentationHint;
        select.setAttribute('aria-label', nextCopy.cardImagePresentation);
        choices.forEach(({ option, key }) => { option.textContent = nextCopy[key]; });
    }
    select.addEventListener('change', () => onChange(select.value));
    element.append(title, select, hint);
    setCopy(copy);
    return { element, setCopy, setValue(value) { select.value = value; } };
}
