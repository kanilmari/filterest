// @vitest-environment jsdom

import { beforeEach, describe, expect, test } from 'vitest';
import {
    captureDatasetScrollState,
    clearDatasetScrollState,
    restoreDatasetScrollState,
} from './dataset_scroll_retention.js';

describe('dataset scroll retention', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <section id="orders_container">
                <div id="orders_card_view_container" class="scrollable_content">
                    <div class="card" data-id="10"></div>
                    <div class="card" data-id="11"></div>
                </div>
            </section>
        `;
    });

    test('restores scroll coordinates without replacing already-loaded rows', () => {
        const dataset = document.getElementById('orders_container');
        const scrollable = document.getElementById('orders_card_view_container');
        const cardsBefore = Array.from(scrollable.querySelectorAll('.card'));
        scrollable.scrollTop = 640;
        scrollable.scrollLeft = 25;

        captureDatasetScrollState(dataset);
        scrollable.scrollTop = 0;
        scrollable.scrollLeft = 0;
        restoreDatasetScrollState(dataset);

        expect(scrollable.scrollTop).toBe(640);
        expect(scrollable.scrollLeft).toBe(25);
        expect(Array.from(scrollable.querySelectorAll('.card'))).toEqual(cardsBefore);
    });

    test('clears a stale snapshot before a deliberate rerender', () => {
        const dataset = document.getElementById('orders_container');
        const scrollable = document.getElementById('orders_card_view_container');
        scrollable.scrollTop = 320;

        captureDatasetScrollState(dataset);
        clearDatasetScrollState(dataset);
        scrollable.scrollTop = 0;
        restoreDatasetScrollState(dataset);

        expect(scrollable.scrollTop).toBe(0);
    });
});
