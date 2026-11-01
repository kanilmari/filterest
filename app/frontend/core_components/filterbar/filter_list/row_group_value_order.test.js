// row_group_value_order.test.js
// Verifies count ordering and the per-opening category value sequence.
// Connects server-order ties, zero hits and arrivals to the popup's lifecycle.
// Protects source arrays and prevents count refreshes from moving known options.
import { expect, test } from 'vitest';
import { createRowGroupValueOrder, orderRowGroupValues } from './row_group_value_order.js';

const value = (slug, row_count) => Object.freeze({ slug, row_count });
const slugs = values => values.map(item => item.slug);

test('largest count first, ties retain server order, zeros last, without mutating input', () => {
    const values = Object.freeze([value('zero', 0), value('tie-first', 7), value('largest', 61), value('tie-second', 7), value('zero-last', 0)]);
    expect(slugs(orderRowGroupValues(values))).toEqual(['largest', 'tie-first', 'tie-second', 'zero', 'zero-last']);
    expect(slugs(values)).toEqual(['zero', 'tie-first', 'largest', 'tie-second', 'zero-last']);
});

test('freezes known values while open, appends sorted arrivals and re-sorts next opening', () => {
    const order = createRowGroupValueOrder();
    const original = [value('a', 10), value('b', 20)];
    order.open(original);
    const refreshed = [value('a', 100), value('b', 0), value('new-small', 4), value('new-big', 50)];
    expect(slugs(order.sort(refreshed))).toEqual(['b', 'a', 'new-big', 'new-small']);
    expect(slugs(order.sort([...refreshed].reverse()))).toEqual(['b', 'a', 'new-big', 'new-small']);
    expect(slugs(order.sort(refreshed.filter(item => item.slug !== 'a')))).toEqual(['b', 'new-big', 'new-small']);
    expect(slugs(order.sort(refreshed))).toEqual(['b', 'a', 'new-big', 'new-small']);
    order.close(); order.open(refreshed);
    expect(slugs(order.sort(refreshed))).toEqual(['a', 'new-big', 'new-small', 'b']);
});
