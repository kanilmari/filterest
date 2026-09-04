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

    test('mounts the floating list in a caller-owned overlay without learning its component type', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const overlay = document.createElement('div');
        const container = document.createElement('div');
        overlay.appendChild(container);
        document.body.appendChild(overlay);

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            portalElement: overlay,
            options: [{ value: 'user:7', label: 'Ava (#7)' }],
        });
        dropdown.open();

        const listWrapper = overlay.querySelector('.msd-dropdown-list');
        expect(listWrapper).not.toBeNull();
        expect(listWrapper?.parentElement).toBe(overlay);
        expect(document.body.children).toHaveLength(1);

        dropdown.destroy();
        expect(overlay.querySelector('.msd-dropdown-list')).toBeNull();
    });

    test('destroys a portalled list when SPA navigation removes its owning view', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const view = document.createElement('section');
        const container = document.createElement('div');
        view.appendChild(container);
        document.body.appendChild(view);

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [{ value: 'admins', label: 'Admins' }],
        });
        dropdown.open();
        expect(document.body.querySelector('.msd-dropdown-list')).not.toBeNull();

        view.remove();

        await vi.waitFor(() => {
            expect(document.body.querySelector('.msd-dropdown-list')).toBeNull();
        });
        expect(container.__dropdown).toBeUndefined();
    });

    test('closes its portalled list when the owner view is deactivated without destroying selection state', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const { VIEW_DEACTIVATE_EVENT } = await import('../view_lifecycle_events.js');
        document.body.innerHTML = `
            <div id="tabs_container">
                <section class="content_div" id="owner-view">
                    <div id="dropdown-anchor"></div>
                </section>
            </div>
        `;
        const container = document.getElementById('dropdown-anchor');
        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [{ value: 'admins', label: 'Admins' }],
            initialState: { includeValues: ['admins'] },
        });

        dropdown.open();
        const listWrapper = document.body.querySelector('.msd-dropdown-list');
        expect(listWrapper.style.display).toBe('flex');

        document.getElementById('owner-view').dispatchEvent(new CustomEvent(VIEW_DEACTIVATE_EVENT));

        expect(listWrapper.style.display).toBe('none');
        expect(dropdown.getValue()).toEqual(['admins']);
        dropdown.open();
        expect(listWrapper.style.display).toBe('flex');
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

    test('groups mixed option types and searches labels, IDs, and caller-owned metadata', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 300,
            height: 40,
            left: 32,
            right: 332,
            top: 96,
            bottom: 136,
            x: 32,
            y: 96,
            toJSON: () => ({}),
        });

        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [
                {
                    value: 'group:2',
                    label: 'Editors (#2)',
                    groupLabel: 'Groups',
                    searchTerms: ['editors', '2'],
                },
                {
                    value: 'user:7',
                    label: 'ava — Ääkkönen (#7)',
                    groupLabel: 'Users',
                    searchTerms: ['ava', 'Ääkkönen', '7'],
                },
            ],
            allowExclude: false,
            noResultsLabel: 'No matching principals',
        });
        dropdown.open();

        expect(Array.from(document.body.querySelectorAll('.msd-option-group-label'))
            .map((heading) => heading.textContent)).toEqual(['Groups', 'Users']);

        const search = /** @type {HTMLInputElement} */ (
            document.body.querySelector('.msd-dropdown-search-input')
        );
        search.value = 'aakkonen';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.body.querySelectorAll('.msd-option')).toHaveLength(1);
        expect(document.body.querySelector('.msd-option-label')?.textContent).toContain('Ääkkönen');

        search.value = 'group:2';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.body.querySelectorAll('.msd-option')).toHaveLength(1);
        expect(document.body.querySelector('.msd-option-label')?.textContent).toContain('Editors');

        search.value = 'missing';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        expect(document.body.querySelector('.msd-no-results')?.textContent)
            .toBe('No matching principals');
    });

    test('can be disabled while an owner completes an atomic save', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        const dropdown = createMultiselectDropdown({
            containerElement: container,
            options: [{ value: 'user:7', label: 'ava' }],
            allowExclude: false,
        });

        dropdown.open();
        dropdown.setDisabled(true);
        expect(container.classList.contains('msd-dropdown--disabled')).toBe(true);
        expect(container.querySelector('.msd-dropdown-input')?.disabled).toBe(true);
        expect(document.body.querySelector('.msd-dropdown-list')?.style.display).toBe('none');

        dropdown.setDisabled(false);
        dropdown.open();
        expect(container.querySelector('.msd-dropdown-input')?.disabled).toBe(false);
        expect(document.body.querySelector('.msd-dropdown-list')?.style.display).toBe('flex');
    });

    test('supports combobox opening, list navigation, and Escape focus return', async () => {
        const { createMultiselectDropdown } = await import('./multiselect_dropdown_builder.js');
        const container = document.createElement('div');
        document.body.appendChild(container);
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1024);
        vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(768);
        vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
            width: 260,
            height: 40,
            left: 32,
            right: 292,
            top: 96,
            bottom: 136,
            x: 32,
            y: 96,
            toJSON: () => ({}),
        });

        createMultiselectDropdown({
            containerElement: container,
            options: [
                { value: 'group:2', label: 'Editors' },
                { value: 'user:7', label: 'Ava' },
            ],
            allowExclude: false,
        });

        const trigger = /** @type {HTMLInputElement} */ (
            container.querySelector('.msd-dropdown-input')
        );
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(trigger.getAttribute('aria-expanded')).toBe('true');

        const search = /** @type {HTMLInputElement} */ (
            document.body.querySelector('.msd-dropdown-search-input')
        );
        expect(document.activeElement).toBe(search);
        search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        const renderedOptions = Array.from(document.body.querySelectorAll('.msd-option'));
        expect(document.activeElement).toBe(renderedOptions[0]);

        renderedOptions[0].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
        );
        expect(document.activeElement).toBe(renderedOptions[1]);
        renderedOptions[1].dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        );
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(trigger);
    });
});
