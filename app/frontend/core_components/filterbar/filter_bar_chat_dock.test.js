// @vitest-environment jsdom
// filter_bar_chat_dock.test.js
// Verifies the filterbar chat dock's placement and maximize/restore transition contract.
// Bridges mocked chat construction with the real create_filter_bar orchestration.
// Exists so chat overlay behavior is isolated from search, header, and compact chrome tests.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
    cleanupFilterBarBuilderTestDom,
    resetFilterBarBuilderTestDom,
} from './filter_bar_builder_test_setup.js';

describe('create_filter_bar chat dock layout', () => {
    beforeEach(() => {
        resetFilterBarBuilderTestDom();
        document.head.innerHTML = '<meta property="og:site_name" content="filt">';
    });

    afterEach(() => {
        cleanupFilterBarBuilderTestDom();
    });

    test('mounts the chat dock outside the scroll body directly above the clock bar', async () => {
        const adminTools = await import('../admin_tools/admin_button_builder.js');
        adminTools.appendChatUIIfAllowed.mockImplementationOnce(() => {
            const dock = document.createElement('section');
            dock.classList.add('filterbar-chat-dock');
            dock.__setMaximized = vi.fn((maximized) => {
                dock.dataset.maximized = String(Boolean(maximized));
            });
            return dock;
        });

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const panelBody = document.getElementById('demo_filterBar_panelBody');
        const chatDock = panel.querySelector('.filterbar-chat-dock');
        const clockBar = panel.querySelector('.filterbar-clock-bar');

        expect(adminTools.appendChatUIIfAllowed).toHaveBeenCalledWith('demo', null, {
            tableDisplayName: 'Demo',
        });
        expect(chatDock?.parentElement).toBe(panel);
        expect(panelBody?.contains(chatDock)).toBe(false);
        expect(chatDock?.nextElementSibling).toBe(clockBar);
        expect(clockBar?.querySelector('[data-testid="filterbar-admin-version-info"]')).toBeTruthy();

        chatDock?.dispatchEvent(new CustomEvent('filterbar-chat-maximize-toggle', {
            bubbles: true,
            detail: { maximized: true },
        }));

        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(true);
        expect(chatDock?.dataset.maximized).toBe('true');

        chatDock?.dispatchEvent(new CustomEvent('filterbar-chat-maximize-toggle', {
            bubbles: true,
            detail: { maximized: false },
        }));

        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(true);
        expect(chatDock?.dataset.maximized).toBe('true');

        chatDock?.dispatchEvent(new TransitionEvent('transitionend', {
            bubbles: true,
            propertyName: 'height',
        }));

        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(false);
        expect(chatDock?.dataset.maximized).toBe('false');
    });

    test('freezes chat overlay height before applying maximized layout state', async () => {
        const adminTools = await import('../admin_tools/admin_button_builder.js');
        let wasFrozenBeforeState = false;
        adminTools.appendChatUIIfAllowed.mockImplementationOnce(() => {
            const dock = document.createElement('section');
            dock.classList.add('filterbar-chat-dock');
            dock.getBoundingClientRect = vi.fn(() => ({ height: 56 }));
            dock.__setMaximized = vi.fn(() => {
                wasFrozenBeforeState = Boolean(
                    dock.parentElement?.classList.contains('filterbar-panel--chat-layout-animating') &&
                    dock.style.height === '56px' &&
                    dock.style.flex === '0 0 56px' &&
                    dock.style.transition === 'none'
                );
            });
            return dock;
        });

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const chatDock = panel.querySelector('.filterbar-chat-dock');

        chatDock?.dispatchEvent(new CustomEvent('filterbar-chat-maximize-toggle', {
            bubbles: true,
            detail: { maximized: true },
        }));

        expect(wasFrozenBeforeState).toBe(true);
        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(true);
    });

    test('keeps the chat dock visually maximized until close height animation finishes', async () => {
        const adminTools = await import('../admin_tools/admin_button_builder.js');
        adminTools.appendChatUIIfAllowed.mockImplementationOnce(() => {
            const dock = document.createElement('section');
            dock.classList.add('filterbar-chat-dock');
            dock.getBoundingClientRect = vi.fn(() => ({ height: 400 }));
            dock.__setMaximized = vi.fn((maximized) => {
                dock.dataset.maximized = String(Boolean(maximized));
            });
            return dock;
        });

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const chatDock = panel.querySelector('.filterbar-chat-dock');

        chatDock?.dispatchEvent(new CustomEvent('filterbar-chat-maximize-toggle', {
            bubbles: true,
            detail: { maximized: true },
        }));
        expect(chatDock?.dataset.maximized).toBe('true');
        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(true);

        chatDock?.dispatchEvent(new CustomEvent('filterbar-chat-maximize-toggle', {
            bubbles: true,
            detail: { maximized: false },
        }));

        expect(chatDock?.dataset.maximized).toBe('true');
        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(true);

        chatDock?.dispatchEvent(new TransitionEvent('transitionend', {
            bubbles: true,
            propertyName: 'height',
        }));

        expect(chatDock?.dataset.maximized).toBe('false');
        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(false);
    });

    test('ignores bubbled child transitionend while overlay close is still running', async () => {
        const adminTools = await import('../admin_tools/admin_button_builder.js');
        adminTools.appendChatUIIfAllowed.mockImplementationOnce(() => {
            const dock = document.createElement('section');
            dock.classList.add('filterbar-chat-dock');
            dock.getBoundingClientRect = vi.fn(() => ({ height: 400 }));
            const content = document.createElement('div');
            content.classList.add('filterbar-chat-dock__content');
            dock.appendChild(content);
            dock.__setMaximized = vi.fn((maximized) => {
                dock.dataset.maximized = String(Boolean(maximized));
            });
            return dock;
        });

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const chatDock = panel.querySelector('.filterbar-chat-dock');
        const content = chatDock?.querySelector('.filterbar-chat-dock__content');

        chatDock?.dispatchEvent(new CustomEvent('filterbar-chat-maximize-toggle', {
            bubbles: true,
            detail: { maximized: true },
        }));
        chatDock?.dispatchEvent(new CustomEvent('filterbar-chat-maximize-toggle', {
            bubbles: true,
            detail: { maximized: false },
        }));

        content?.dispatchEvent(new TransitionEvent('transitionend', {
            bubbles: true,
            propertyName: 'height',
        }));

        expect(chatDock?.dataset.maximized).toBe('true');
        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(true);

        chatDock?.dispatchEvent(new TransitionEvent('transitionend', {
            bubbles: true,
            propertyName: 'height',
        }));

        expect(chatDock?.dataset.maximized).toBe('false');
        expect(panel.classList.contains('filterbar-panel--chat-maximized')).toBe(false);
    });
});
