// multiselect_dropdown_builder.test.js
// Verifies the multiselect dropdown renders its popup as a floating overlay.
// Bridges dropdown open/close behavior with viewport-aware positioning in jsdom.
// Exists to keep filterbar accordion overflow from clipping FK multiselect options again.
// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from 'vitest';

describe('createMultiselectDropdown', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = '';
        document.head.innerHTML = '';
    });

    test('opens the option list as a floating overlay attached to document.body', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);

        const rect = {
            width: 280,
            left: 24,
            top: 120,
            bottom: 160,
        };
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
            if (this === container.querySelector('.msd-dropdown-input-row')) {
                return {
                    ...rect,
                    right: rect.left + rect.width,
                    height: rect.bottom - rect.top,
                    x: rect.left,
                    y: rect.top,
                    toJSON: () => ({}),
                };
            }
            return {
                width: 0,
                height: 0,
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            };
        });

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [
                { value: 'archived', label: 'Archived' },
                { value: 'done', label: 'Done' },
            ],
        });

        dropdown.open();

        const listWrapper = document.body.querySelector('.msd-dropdown-list');
        expect(listWrapper).not.toBeNull();
        expect(listWrapper.parentElement).toBe(document.body);
        expect(listWrapper.style.display).toBe('flex');
        expect(listWrapper.style.position).toBe('');
        expect(listWrapper.style.left).toBe('24px');
        expect(listWrapper.style.top).toBe('164px');
        expect(listWrapper.style.width).toBe('280px');
        expect(listWrapper.style.maxHeight).toBe('400px');
        expect(dropdown.getLabelsForValues(['done', 'archived'])).toEqual(['Done', 'Archived']);
        const chevron = container.querySelector('.msd-dropdown-chevron');
        expect(chevron?.tagName).toBe('SPAN');
        expect(chevron?.querySelector('svg')).toBeNull();
        expect(chevron?.style.maskImage).toContain('chevron-down-icon.svg');
        expect(listWrapper.querySelector('.msd-dropdown-search')).not.toBeNull();
    });

    test('keeps the dropdown open when clicking inside the floating overlay and closes on outside click', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);

        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 240,
            height: 40,
            left: 32,
            right: 272,
            top: 96,
            bottom: 136,
            x: 32,
            y: 96,
            toJSON: () => ({}),
        });

        createMultiselectDropdown({
            containerElement: container,
            options: [{ value: 'archived', label: 'Archived' }],
        }).open();

        const listWrapper = /** @type {HTMLDivElement} */ (document.body.querySelector('.msd-dropdown-list'));
        listWrapper.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(listWrapper.style.display).toBe('flex');

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(listWrapper.style.display).toBe('none');
    });

    test('tracks tri-state include/exclude values and emits state objects to onChange', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onChange = vi.fn();

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [{ value: 'done', label: 'Done' }],
            onChange,
        });

        dropdown.setValue({ includeValues: ['done'], excludeValues: ['archived'] }, true);
        expect(dropdown.getState()).toEqual({
            includeValues: ['done'],
            excludeValues: ['archived'],
        });
        expect(onChange).toHaveBeenLastCalledWith({
            includeValues: ['done'],
            excludeValues: ['archived'],
        });
    });

    test('toggles checkbox between include and neutral without cycling into exclude', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 240,
            height: 40,
            left: 32,
            right: 272,
            top: 96,
            bottom: 136,
            x: 32,
            y: 96,
            toJSON: () => ({}),
        });

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [{ value: 'done', label: 'Done' }],
        });
        dropdown.open();

        const checkbox = /** @type {HTMLButtonElement} */ (document.body.querySelector('.msd-option-checkbox'));
        checkbox.click();
        expect(dropdown.getState()).toEqual({
            includeValues: ['done'],
            excludeValues: [],
        });

        checkbox.click();
        expect(dropdown.getState()).toEqual({
            includeValues: [],
            excludeValues: [],
        });
    });

    test('uses the per-row exclude action and restores reset state plus tooltips for excluded rows', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 240,
            height: 40,
            left: 32,
            right: 272,
            top: 96,
            bottom: 136,
            x: 32,
            y: 96,
            toJSON: () => ({}),
        });

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [{ value: 'done', label: 'Done' }],
            excludeTooltip: 'Exclude this value from results',
            resetTooltip: 'Remove the excluded state for this value',
        });
        dropdown.open();

        let actionButton = /** @type {HTMLButtonElement} */ (document.body.querySelector('.msd-option-action'));
        expect(actionButton.textContent).toBe('Exclude');
        expect(actionButton.title).toBe('Exclude this value from results');
        expect(actionButton.dataset.titleLangKey).toBe('exclude_filter_option');

        actionButton.click();
        expect(dropdown.getState()).toEqual({
            includeValues: [],
            excludeValues: ['done'],
        });

        actionButton = /** @type {HTMLButtonElement} */ (document.body.querySelector('.msd-option-action'));
        expect(actionButton.textContent).toBe('Reset');
        expect(actionButton.title).toBe('Remove the excluded state for this value');
        expect(actionButton.dataset.titleLangKey).toBe('reset_filter_option');

        actionButton.click();
        expect(dropdown.getState()).toEqual({
            includeValues: [],
            excludeValues: [],
        });

        actionButton = /** @type {HTMLButtonElement} */ (document.body.querySelector('.msd-option-action'));
        expect(actionButton.textContent).toBe('Exclude');

        let checkbox = /** @type {HTMLButtonElement} */ (document.body.querySelector('.msd-option-checkbox'));
        actionButton.click();
        checkbox = /** @type {HTMLButtonElement} */ (document.body.querySelector('.msd-option-checkbox'));
        checkbox.click();
        expect(dropdown.getState()).toEqual({
            includeValues: [],
            excludeValues: [],
        });

        actionButton = /** @type {HTMLButtonElement} */ (document.body.querySelector('.msd-option-action'));
        expect(actionButton.textContent).toBe('Exclude');
    });

    test('can render as include-only without per-row exclude actions', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 240,
            height: 40,
            left: 32,
            right: 272,
            top: 96,
            bottom: 136,
            x: 32,
            y: 96,
            toJSON: () => ({}),
        });

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [
                { value: 'title', label: 'Title' },
                { value: 'description', label: 'Description' },
                { value: 'created_at', label: 'Created' },
            ],
            allowExclude: false,
            selectedCountLabel: 'fields',
            initialState: { includeValues: ['title', 'description', 'created_at'] },
        });
        dropdown.open();

        expect(container.classList.contains('msd-dropdown--include-only')).toBe(true);
        expect(document.body.querySelector('.msd-option-action')).toBeNull();
        expect(container.querySelector('.msd-dropdown-input')?.value).toBe('3 fields');

        dropdown.destroy();
        expect(document.body.querySelector('.msd-dropdown-list')).toBeNull();
    });
});
