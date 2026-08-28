// @vitest-environment jsdom

import { describe, expect, test } from 'vitest';
import { showViewportContextMenu } from './viewport_context_menu_positioner.js';

describe('showViewportContextMenu', () => {
    test('portals a menu to the body and keeps pointer coordinates independent of its source container', () => {
        document.body.innerHTML = '<main id="offset-host"><div id="menu"></div></main>';
        const menu = document.getElementById('menu');
        Object.defineProperty(menu, 'getBoundingClientRect', {
            value: () => ({ width: 180, height: 120 }),
        });

        showViewportContextMenu(menu, { clientX: 320, clientY: 240 });

        expect(menu.parentElement).toBe(document.body);
        expect(menu.style.position).toBe('fixed');
        expect(menu.style.left).toBe('320px');
        expect(menu.style.top).toBe('240px');
    });

    test('clamps the complete menu inside the viewport', () => {
        document.body.innerHTML = '<div id="menu"></div>';
        const menu = document.getElementById('menu');
        Object.defineProperty(menu, 'getBoundingClientRect', {
            value: () => ({ width: 220, height: 160 }),
        });
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });

        const position = showViewportContextMenu(menu, { x: 790, y: 590 });

        expect(position).toEqual({ x: 572, y: 432 });
        expect(menu.style.left).toBe('572px');
        expect(menu.style.top).toBe('432px');
    });
});
