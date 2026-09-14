// site_article_image_control.js
// Builds the site-wide article caption selector in the appearance palette.
// Reuses localized, themed controls and the shared preview/save lifecycle.
// Article caption placement is independent of card and dataset overrides.

const OPTIONS = Object.freeze([
    ['below', 'articleImageCaptionBelow'],
    ['overlay', 'articleImageCaptionOverlay'],
]);

export function buildArticleImageCaptionControl(copy, onChange) {
    const element = document.createElement('label');
    element.className = 'dataset-cover-test-palette__select';
    const title = document.createElement('span');
    const select = document.createElement('select');
    select.dataset.testid = 'dataset-cover-test-palette-article-image-caption-position';
    const hint = document.createElement('small');
    const choices = OPTIONS.map(([value, key]) => {
        const option = document.createElement('option');
        option.value = value;
        select.append(option);
        return { option, key };
    });
    function setCopy(nextCopy) {
        title.textContent = nextCopy.articleImageCaptionPosition;
        hint.textContent = nextCopy.articleImageCaptionPositionHint;
        select.setAttribute('aria-label', nextCopy.articleImageCaptionPosition);
        select.setAttribute('aria-description', nextCopy.articleImageCaptionPositionHint);
        choices.forEach(({ option, key }) => { option.textContent = nextCopy[key]; });
    }
    select.addEventListener('change', () => onChange(select.value));
    element.append(title, select, hint);
    setCopy(copy);
    return { element, setCopy, setValue(value) { select.value = value; } };
}
