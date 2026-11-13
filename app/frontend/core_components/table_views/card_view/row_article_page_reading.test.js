// @vitest-environment jsdom
// row_article_page_reading.test.js
// Verifies mounted-page language changes including stale loads, omitted content and picture identity.
import { expect, test, vi } from 'vitest';
import { bindPageArticleReading } from './row_article_page_reading.js';
import { registerCardResource } from './card_resource_lifecycle.js';
import { refreshLocalizedDatasetValues } from '../dataset_value_localizer.js';

function article(language, word) {
    const content = document.createElement('div');
    const title = document.createElement('h1');
    title.className = 'big_card_header_value';
    title.dataset.articleHeadingLanguage = language;
    title.textContent = word;
    content.append(title);
    return content;
}

test('the latest language keeps the same photograph and raw word through a slow superseded refresh', async () => {
    localStorage.setItem('chosen_language', 'fi');
    const shell = document.createElement('div');
    const first = article('fi', 'tietojenkäsittelyjärjestelmä');
    const photo = document.createElement('figure');
    photo.className = 'row_article_page_image';
    first.prepend(photo);
    shell.append(first);
    document.body.append(shell);
    let finish;
    const rebuild = vi.fn(language => language === 'sv' ? new Promise(resolve => { finish = resolve; })
        : Promise.resolve(article('en', 'internationalization')));
    await bindPageArticleReading(shell, first, rebuild, 'fi');
    await vi.waitFor(() => expect(first.querySelector('.reading-hyphen')).toBeTruthy());
    const slow = refreshLocalizedDatasetValues('sv');
    await refreshLocalizedDatasetValues('en');
    finish(article('sv', 'förvaltning'));
    await slow;
    await vi.waitFor(() => expect(shell.querySelector('.reading-hyphen')).toBeTruthy());
    expect(shell.querySelector('h1').textContent).toBe('internationalization');
    expect(shell.querySelector('h1').lang).toBe('en');
    expect(shell.querySelector('figure')).toBe(photo);
    shell.remove();
});

test.each(['expanded', 'collapsed'])('retains the %s disclosure and disposes only the replaced content', async state => {
    localStorage.setItem('chosen_language', 'fi');
    const shell = document.createElement('div');
    const first = article('fi', 'Vanha');
    const next = article('en', 'New');
    const oldDetails = document.createElement('section');
    oldDetails.className = 'row_article_details_section';
    oldDetails.dataset.disclosureState = state;
    first.append(oldDetails);
    const nextDetails = oldDetails.cloneNode(false);
    nextDetails.expand = vi.fn();
    nextDetails.collapse = vi.fn();
    next.append(nextDetails);
    const oldCleanup = vi.fn();
    const nextCleanup = vi.fn();
    registerCardResource(first, oldCleanup);
    registerCardResource(next, nextCleanup);
    shell.append(first);
    document.body.append(shell);
    await bindPageArticleReading(shell, first, () => next, 'fi');
    await refreshLocalizedDatasetValues('en', document);
    expect(shell.firstChild).toBe(next);
    expect(state === 'expanded' ? nextDetails.expand : nextDetails.collapse).toHaveBeenCalledExactlyOnceWith({ animate: false });
    expect(oldCleanup).toHaveBeenCalledOnce();
    expect(nextCleanup).not.toHaveBeenCalled();
    shell.remove();
});

test('a closed Page disposes the pending replacement and leaves the detached content alone', async () => {
    localStorage.setItem('chosen_language', 'fi');
    const shell = document.createElement('div');
    const first = article('fi', 'Vanha');
    const next = article('en', 'New');
    const disposePending = vi.fn();
    registerCardResource(next, disposePending);
    shell.append(first);
    document.body.append(shell);
    let finish;
    await bindPageArticleReading(shell, first, () => new Promise(resolve => { finish = resolve; }), 'fi');
    const pending = refreshLocalizedDatasetValues('en');
    shell.remove();
    finish(next);
    await pending;
    expect(disposePending).toHaveBeenCalledOnce();
    expect(shell.firstChild).toBe(first);
});
