// @vitest-environment jsdom
// filter_bar_builder.test.js
// Verifies the unified filterbar keeps inline-hero search mounted across rerenders.
// Bridges mocked filterbar dependencies with the real create_filter_bar orchestration.
// Exists to prevent dataset rerenders from removing the search hero above data.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { flushObserverFrame, setScrollMetrics } from './filter_bar_test_environment_builder.js';
import {
    cleanupFilterBarBuilderTestDom,
    resetFilterBarBuilderTestDom,
    setMockFilterLayoutMode,
    setMockFilterbarPanelMode,
} from './filter_bar_builder_test_setup.js';

describe('create_filter_bar inline hero mounting', () => {
    beforeEach(() => {
        resetFilterBarBuilderTestDom();
        document.head.innerHTML = '<meta property="og:site_name" content="filt">';
    });

    afterEach(() => {
        cleanupFilterBarBuilderTestDom();
    });

    test('reattaches inline hero after the active scrollable content is rerendered', async () => {
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const activeScrollable = document.getElementById('demo_card_view_container');

        expect(panel).toBeTruthy();
        expect(activeScrollable.firstElementChild?.className).toBe('filterbar-scroll-sentinel');
        expect(activeScrollable.children[1]?.className).toBe('filterbar-inline-hero');

        activeScrollable.replaceChildren(document.createElement('div'));
        await flushObserverFrame();

        expect(document.querySelectorAll('.filterbar-inline-hero')).toHaveLength(1);
        expect(activeScrollable.firstElementChild?.className).toBe('filterbar-scroll-sentinel');
        expect(activeScrollable.children[1]?.className).toBe('filterbar-inline-hero');
    });

    test('replaces the project logo grid with the dataset svg icon in inline hero', async () => {
        const { getTabIconPath } = await import('../navigation/main_tabs/tab_icon_library.js');
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const inlineHero = document.querySelector('.filterbar-inline-hero');
        const heroIcon = inlineHero?.querySelector('.filterbar-hero-dataset-icon');
        const heroIconPath = heroIcon?.querySelector('path');

        expect(inlineHero?.querySelector('.logo-letter-backgrounds-container')).toBeNull();
        expect(heroIcon?.getAttribute('viewBox')).toBe('0 -960 960 960');
        expect(heroIconPath?.getAttribute('d')).toBe(getTabIconPath('task'));
    });

    test('falls back to the localized dataset title when the site identity is unavailable', async () => {
        document.head.innerHTML = '';
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const heroTitle = document.querySelector('.morphing-title');
        expect(heroTitle?.querySelector('.morphing-title__site-name')).toBeNull();
        expect(heroTitle?.querySelector('.morphing-title__separator')).toBeNull();
        expect(heroTitle?.querySelector('.morphing-title__dataset-name')?.dataset.langKey)
            .toBe('demo_front_page');
    });

    test('uses the users tab icon fallback for system_users hero', async () => {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="system_users_container" class="content_div">
                <div id="system_users_tab_parts_container" class="tab_parts_container">
                    <div class="tab-content-area">
                        <div class="tab-content-body">
                            <div id="system_users_card_view_container" class="scrollable_content" style="display: block;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `);
        const { getTabIconPath } = await import('../navigation/main_tabs/tab_icon_library.js');
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('system_users', 'system_users_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const heroIcon = document.querySelector(
            '[data-filterbar-inline-hero-for="system_users"] .filterbar-hero-dataset-icon'
        );
        const heroIconPath = heroIcon?.querySelector('path')?.getAttribute('d');

        expect(heroIcon?.classList.contains('filterbar-hero-dataset-icon--users')).toBe(true);
        expect(heroIconPath).toBe(getTabIconPath('group_filled'));
    });

    test('keeps translated dataset title key when display_name only repeats the technical table name', async () => {
        document.body.insertAdjacentHTML('beforeend', `
            <div id="riskienhallinta_container" class="content_div">
                <div id="riskienhallinta_tab_parts_container" class="tab_parts_container">
                    <div class="tab-content-area">
                        <div class="tab-content-body">
                            <div id="riskienhallinta_card_view_container" class="scrollable_content" style="display: block;"></div>
                        </div>
                    </div>
                </div>
            </div>
        `);
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('riskienhallinta', 'riskienhallinta_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const heroTitle = document.querySelector(
            '[data-filterbar-inline-hero-for="riskienhallinta"] .morphing-title'
        );
        const titleRowLabel = document.querySelector(
            '#riskienhallinta_filterBar_panel .filterbar-dataset-title-text'
        );

        const siteName = heroTitle?.querySelector('.morphing-title__site-name');
        expect(siteName?.textContent).toBe('Filt');
        expect(siteName?.hasAttribute('data-lang-key')).toBe(false);
        expect(heroTitle?.querySelector('.morphing-title__separator')?.textContent).toBe(' – ');
        expect(heroTitle?.querySelector('.morphing-title__dataset-name')?.dataset.langKey)
            .toBe('riskienhallinta_front_page');
        expect(heroTitle?.querySelector('.morphing-title__dataset-name')?.textContent)
            .toBe('riskienhallinta');
        expect(titleRowLabel?.dataset.langKey).toBe('riskienhallinta');
    });

    test('shows dataset title and row article close control in the shared topbar', async () => {
        const sharedTopbarRules = await import('./shared_topbar_builder.js');
        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(true);
        const closeSpy = vi.fn();

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const sharedTopbar = document.querySelector('.dataset-shared-topbar');
        const sharedTitle = sharedTopbar?.querySelector('.dataset-shared-topbar__dataset-title');
        const sharedClose = sharedTopbar?.querySelector('.dataset-shared-topbar__article-close');
        const legacyClose = document.createElement('button');
        legacyClose.classList.add('big_card_close');
        legacyClose.addEventListener('click', closeSpy);
        const activeArticle = document.createElement('article');
        activeArticle.classList.add('active_row_article');
        activeArticle.appendChild(legacyClose);
        document.getElementById('demo_tab_parts_container')?.appendChild(activeArticle);

        expect(sharedTitle?.textContent).toBe('Demo');
        expect(sharedTitle?.dataset.langKey).toBe('demo');
        expect(document.querySelector('.filterbar-dataset-title-text')?.dataset.langKey).toBe('demo');
        expect(document.querySelector('.morphing-title__dataset-name')?.dataset.langKey)
            .toBe('demo_front_page');
        expect(sharedClose?.hidden).toBe(true);

        document.dispatchEvent(new CustomEvent('big-card-toggle', {
            detail: { tableName: 'demo', isOpen: true },
        }));

        expect(sharedClose?.hidden).toBe(false);
        expect(sharedClose?.getAttribute('aria-hidden')).toBe('false');

        sharedClose?.click();

        expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    test('docks the one working navbar button before the dataset title whenever the shared topbar is shown', async () => {
        const sharedTopbarRules = await import('./shared_topbar_builder.js');
        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(true);
        document.getElementById('navbar')?.classList.add('collapsed');
        const showButtonClickSpy = vi.fn();
        const documentClickSpy = vi.fn();
        const showMenuButtonBeforeMount = document.getElementById('showMenuButton');
        const originalMenuButtonParent = showMenuButtonBeforeMount?.parentElement;
        showMenuButtonBeforeMount?.addEventListener('click', showButtonClickSpy);
        document.addEventListener('click', documentClickSpy, { once: true });

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const startSlot = document.querySelector('.dataset-shared-topbar__slot--start');
        const menuSlot = startSlot?.querySelector('.dataset-shared-topbar__menu-slot');
        const title = startSlot?.querySelector('.dataset-shared-topbar__dataset-title');
        const showMenuButton = document.getElementById('showMenuButton');
        const sharedMenuButton = menuSlot?.firstElementChild;

        expect(menuSlot?.hidden).toBe(false);
        expect(menuSlot?.firstElementChild).toBe(sharedMenuButton);
        expect(sharedMenuButton).toBe(showMenuButton);
        expect(showMenuButton?.classList.contains('shared-topbar-docked-button')).toBe(true);
        expect(document.querySelectorAll('#showMenuButton')).toHaveLength(1);
        expect(startSlot?.firstElementChild).toBe(menuSlot);
        expect(menuSlot?.nextElementSibling).toBe(title);

        sharedMenuButton?.click();

        expect(showButtonClickSpy).toHaveBeenCalledTimes(1);
        expect(documentClickSpy).toHaveBeenCalledTimes(1);
        expect(documentClickSpy.mock.calls[0]?.[0]?.target).toBe(showMenuButton);

        document.getElementById('navbar')?.classList.remove('collapsed');
        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(false);
        window.dispatchEvent(new CustomEvent('navbar-visibility-changed'));

        expect(menuSlot?.hidden).toBe(true);
        expect(showMenuButton?.classList.contains('shared-topbar-docked-button')).toBe(false);
        expect(showMenuButton?.parentElement).toBe(originalMenuButtonParent);
    });

    test('keeps the menu button in its navbar position when an article topbar opens on wide layout', async () => {
        const sharedTopbarRules = await import('./shared_topbar_builder.js');
        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(true);
        document.getElementById('navbar')?.classList.remove('collapsed');
        const showMenuButton = document.getElementById('showMenuButton');
        const originalMenuButtonParent = showMenuButton?.parentElement;

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const menuSlot = document.querySelector('.dataset-shared-topbar__menu-slot');
        expect(menuSlot?.hidden).toBe(true);
        expect(menuSlot?.contains(showMenuButton)).toBe(false);
        expect(showMenuButton?.parentElement).toBe(originalMenuButtonParent);
        expect(document.querySelectorAll('#showMenuButton')).toHaveLength(1);
    });

    test('keeps inline hero count-free and wires reset search to the shared filter reset', async () => {
        const topRowBuilder = await import('./top_row_buttons/top_row_builder.js');
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 12, false, 'card');

        const inlineHero = document.querySelector('.filterbar-inline-hero');
        const resetButton = inlineHero?.querySelector('[data-testid="btn-reset-search-content-hero"]');

        expect(inlineHero?.querySelector('.filterbar_results_count')).toBeNull();
        expect(resetButton).toBeTruthy();
        expect(resetButton?.dataset.langKey).toBe('reset_search');

        resetButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(topRowBuilder.clearAllFilters).toHaveBeenCalledWith(
            'demo',
            document.getElementById('demo_tab_parts_container')
        );
    });

    test('adds a titled filters section using the configured field layout mode', async () => {
        const favefoxBuilder = await import('./filter_list/favefox_style_filters_container/accordion_filter_builder.js');
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const heading = panel.querySelector('.favefox-filterbar-wrapper > button.filterbar-section-heading');
        const contentShell = panel.querySelector('.favefox-filterbar-wrapper > .animated-disclosure-content-shell');

        expect(heading).toBeTruthy();
        expect(heading.classList.contains('animated-disclosure-header')).toBe(true);
        expect(heading.getAttribute('aria-expanded')).toBe('false');
        expect(contentShell?.hidden).toBe(true);
        expect(heading.getAttribute('aria-controls')).toBe(contentShell?.id);
        expect(heading.textContent).toBe('Suodattimet');
        expect(heading.querySelector('[data-lang-key="filters"]')).toBeTruthy();
        expect(favefoxBuilder.build_favefox_style_filter_bar_from_columns).toHaveBeenCalledWith(
            'demo',
            ['id'],
            { id: 'INTEGER' },
            true,
            expect.objectContaining({
                layoutMode: 'inline-open',
                prependSections: expect.arrayContaining([
                    expect.objectContaining({
                        key: 'text_search',
                        title: 'Tekstihaku',
                    }),
                ]),
            }),
        );
    });

    test('passes accordion filter layout mode through from ui config', async () => {
        setMockFilterLayoutMode('accordion');
        const favefoxBuilder = await import('./filter_list/favefox_style_filters_container/accordion_filter_builder.js');
        const { create_filter_bar } = await import('./filter_bar_builder.js');

        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        expect(favefoxBuilder.build_favefox_style_filter_bar_from_columns).toHaveBeenCalledWith(
            'demo',
            ['id'],
            { id: 'INTEGER' },
            true,
            expect.objectContaining({
                layoutMode: 'accordion',
            }),
        );
    });

    test('keeps the shared topbar mounted until its exit transition can finish', async () => {
        vi.useFakeTimers();
        const sharedTopbarRules = await import('./shared_topbar_builder.js');
        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(true);

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const sharedTopbar = document.querySelector('.dataset-shared-topbar');
        expect(sharedTopbar.hidden).toBe(false);
        expect(sharedTopbar.getAttribute('aria-hidden')).toBe('false');
        expect(sharedTopbar.inert).toBe(false);

        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(false);
        window.dispatchEvent(new Event('navbar-visibility-changed'));

        expect(sharedTopbar.hidden).toBe(false);
        expect(sharedTopbar.classList.contains('dataset-shared-topbar--visible')).toBe(false);
        expect(sharedTopbar.getAttribute('aria-hidden')).toBe('true');
        expect(sharedTopbar.inert).toBe(true);

        vi.advanceTimersByTime(259);
        expect(sharedTopbar.hidden).toBe(false);

        vi.advanceTimersByTime(1);
        expect(sharedTopbar.hidden).toBe(true);
    });

    test('cancels a pending shared topbar hide when visibility returns quickly', async () => {
        vi.useFakeTimers();
        const sharedTopbarRules = await import('./shared_topbar_builder.js');
        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(true);

        const { create_filter_bar } = await import('./filter_bar_builder.js');
        create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');

        const sharedTopbar = document.querySelector('.dataset-shared-topbar');

        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(false);
        window.dispatchEvent(new Event('navbar-visibility-changed'));
        expect(sharedTopbar.hidden).toBe(false);

        sharedTopbarRules.shouldShowSharedTopBar.mockReturnValue(true);
        window.dispatchEvent(new Event('navbar-visibility-changed'));

        vi.advanceTimersByTime(260);
        expect(sharedTopbar.hidden).toBe(false);
        expect(sharedTopbar.getAttribute('aria-hidden')).toBe('false');
        expect(sharedTopbar.inert).toBe(false);
    });

    test('keeps compact filterbar body visible while the panel slides out', async () => {
        vi.useFakeTimers();
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const panelBody = document.getElementById('demo_filterBar_panelBody');
        const hideButton = panel.querySelector('.hide_filter_bar_button');

        expect(panelBody.classList.contains('filterbar-panel-body--hidden')).toBe(false);

        hideButton.click();

        expect(panel.classList.contains('filterbar-panel--hidden')).toBe(true);
        expect(panelBody.classList.contains('filterbar-panel-body--hidden')).toBe(false);

        vi.advanceTimersByTime(699);
        expect(panelBody.classList.contains('filterbar-panel-body--hidden')).toBe(false);

        vi.advanceTimersByTime(1);
        expect(panelBody.classList.contains('filterbar-panel-body--hidden')).toBe(true);
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

    test('keeps compact chrome expanded when body has only a tiny scroll range', async () => {
        setMockFilterbarPanelMode('morphing');
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const panelBody = document.getElementById('demo_filterBar_panelBody');
        panel.classList.remove('filterbar-panel--wide');
        panel.classList.add('filterbar-panel--compact');
        panelBody.classList.remove('filterbar-panel-body--hidden');
        setScrollMetrics(panelBody, {
            scrollTop: 40,
            scrollHeight: 620,
            clientHeight: 560,
        });
        panelBody.dispatchEvent(new Event('scroll'));
        expect(panel.classList.contains('filterbar-panel--body-scrolled')).toBe(false);
    });

    test('collapses compact chrome only when body has stable scroll room', async () => {
        setMockFilterbarPanelMode('morphing');
        const { create_filter_bar } = await import('./filter_bar_builder.js');
        const panel = create_filter_bar('demo', 'demo_uid', ['id'], { id: 'INTEGER' }, 1, false, 'card');
        const panelBody = document.getElementById('demo_filterBar_panelBody');
        panel.classList.remove('filterbar-panel--wide');
        panel.classList.add('filterbar-panel--compact');
        panelBody.classList.remove('filterbar-panel-body--hidden');
        setScrollMetrics(panelBody, {
            scrollTop: 40,
            scrollHeight: 980,
            clientHeight: 560,
        });
        panelBody.dispatchEvent(new Event('scroll'));
        expect(panel.classList.contains('filterbar-panel--body-scrolled')).toBe(true);
        setScrollMetrics(panelBody, {
            scrollTop: 4,
            scrollHeight: 980,
            clientHeight: 560,
        });
        panelBody.dispatchEvent(new Event('scroll'));
        expect(panel.classList.contains('filterbar-panel--body-scrolled')).toBe(false);
    });
});
