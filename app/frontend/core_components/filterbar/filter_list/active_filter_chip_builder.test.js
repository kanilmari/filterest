// @vitest-environment jsdom
// active_filter_chip_builder.test.js
// Verifies the shared chip's native button, logical order and in-place previews.
// Connects owner-supplied labels and commands with the site presentation setting.
// Protects focus and label identity when saved settings or previews change side.

import { beforeEach, expect, test, vi } from 'vitest';
import { applyActiveFilterRemoveSide, buildActiveFilterChip } from './active_filter_chip_builder.js';

beforeEach(() => {
    document.body.innerHTML = '<div class="active_filters"></div>';
    delete document.documentElement.dataset.activeFilterRemoveSide;
});

test.each(['start', 'end'])('builds a removable excluded chip with real %s order', side => {
    applyActiveFilterRemoveSide(side);
    const label = document.createElement('span');
    label.textContent = 'Tila ≠ valmis';
    const onRemove = vi.fn();
    const { item, button } = buildActiveFilterChip({ label, onRemove, exclude: true });
    document.querySelector('.active_filters').append(item);
    button.setAttribute('aria-label', 'Poista: Tila ≠ valmis');
    expect([...item.children]).toEqual(side === 'start' ? [button, label] : [label, button]);
    expect(item.dataset.testid).toBe('active-filter-item');
    expect(item.classList.contains('active-filter-item--exclude')).toBe(true);
    expect(button.dataset.testid).toBe('active-filter-remove');
    expect(button.type).toBe('button');
    const parentClick = vi.fn();
    item.addEventListener('click', parentClick);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(parentClick).not.toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalledOnce();
});

test('preview and reset move only the label and preserve focus and the removal listener', () => {
    const label = document.createElement('span');
    const onRemove = vi.fn();
    const { item, button } = buildActiveFilterChip({ label, onRemove });
    document.querySelector('.active_filters').append(item);
    button.focus();
    for (const side of ['end', 'start', 'end', 'end']) {
        applyActiveFilterRemoveSide(side);
        expect(document.activeElement).toBe(button);
        expect(item.querySelector('.active-filter-label')).toBe(label);
        expect(item.firstElementChild).toBe(side === 'start' ? button : label);
    }
    button.click();
    expect(onRemove).toHaveBeenCalledOnce();
    applyActiveFilterRemoveSide('invalid');
    expect(item.firstElementChild).toBe(button);
});
