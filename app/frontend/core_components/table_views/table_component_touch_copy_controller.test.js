// table_component_touch_copy_controller.test.js
// Verifies phone copying through real component pointer events and menu actions.
// Connects touch selection, shared clipboard payloads and component destruction.
// Keeps scrolling, ordinary taps and desktop mouse selection independent of holding.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const editCellMock = vi.hoisted(() => vi.fn());
vi.mock('../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../function_access_checker.js', () => ({ logAndCheckAccess: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({
    getTranslationForKey: key => ({
        copy_headers_and_cells: 'Kopioi otsikot + solut',
        copy_cells_only: 'Kopioi vain solut',
    })[key] || key,
}));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(), showSuccessToast: vi.fn(),
}));
vi.mock('../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({
    editCell: editCellMock,
}));

import { TableComponent } from './table_component_builder.js';
import { disposeCardResources } from './card_view/card_resource_lifecycle.js';

describe('touch copy menu', () => {
    let component;
    beforeEach(() => {
        vi.useFakeTimers();
        editCellMock.mockClear();
        document.body.replaceChildren();
        localStorage.clear();
        vi.stubGlobal('innerWidth', 375);
        vi.stubGlobal('innerHeight', 667);
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: vi.fn().mockResolvedValue(undefined) },
        });
        component = new TableComponent({
            table_name: 'people',
            headers: [{ key: 'name', label: 'Nimi' }, { key: 'status', label: 'Tila' }],
            data: [{ name: 'Ada', status: 'Valmis' }, { name: 'Linus', status: 'Kesken' }],
        });
        document.body.append(component.getElement());
    });
    afterEach(() => {
        component.destroy();
        vi.restoreAllMocks();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    test('holding an unselected phone cell opens the translated menu and copies its value', async () => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell.firstChild, 'pointerdown');
        pointer(cell.firstChild, 'pointermove', { clientX: 61, clientY: 101 });
        vi.advanceTimersByTime(700);
        pointer(cell.firstChild, 'pointerup');

        const menu = component.selectionMenu;
        expect(menu.style.display).toBe('block');
        expect(menu.style.position).toBe('fixed');
        expect(menu.parentElement).toBe(document.body);
        expect(cell.classList.contains('selected')).toBe(true);
        expect(menu.style.left).toBe('60px');
        expect(menu.style.top).toBe('100px');
        expect(menu.querySelector('[data-action="copy-no-headers"]').textContent).toBe('Kopioi vain solut');

        // Browsers may synthesize these mouse events when the held finger lifts.
        for (const type of ['mousedown', 'mouseup', 'click']) {
            compatibilityMouseEvent(cell, type);
        }
        expect(menu.style.display).toBe('block');
        expect(editCellMock).not.toHaveBeenCalled();
        menu.querySelector('[data-action="copy-no-headers"]').click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Ada');
        expect(menu.style.display).toBe('none');
    });

    test('holding a selected cell preserves the range and copies its headers', async () => {
        component.highlightRegion(0, 0, 1, 1);
        const cell = component.getElement().querySelector('.cell.selected');
        pointer(cell, 'pointerdown');
        vi.advanceTimersByTime(700);
        expect(component.selectionMenu.style.display).toBe('block');
        expect(component.getElement().querySelectorAll('.cell.selected')).toHaveLength(4);
        component.selectionMenu.querySelector('[data-action="copy-headers"]').click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Nimi,Tila\nAda,Valmis\nLinus,Kesken');
    });

    test('holding a comparison value copies its field label with headers', async () => {
        component.setView('transposed');
        const cell = component.getElement().querySelector('.cell[data-row="0"][data-col="1"]');
        pointer(cell.firstChild, 'pointerdown');
        vi.advanceTimersByTime(700);
        expect(component.selectionMenu.style.display).toBe('block');
        component.selectionMenu.querySelector('[data-action="copy-headers"]').click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Nimi,Ada');
    });

    test.each([
        ['cell without a touch marker', 'cell', false, 'copy-no-headers', 'Ada'],
        ['cell with a touch marker', 'cell', true, 'copy-headers', 'Nimi\nAda'],
        ['body-mounted menu with a touch marker', 'menu', true, 'copy-no-headers', 'Ada'],
        ['body-mounted menu without a touch marker', 'menu', false, 'copy-headers', 'Nimi\nAda'],
    ])('the browser release onto the %s keeps the menu and copy action working', async (
        _label, mouseTarget, touchMarked, action, copiedText
    ) => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell.firstChild, 'pointerdown');
        touchEvent(cell.firstChild, 'touchstart');
        vi.advanceTimersByTime(450);
        const menu = component.selectionMenu;
        expect(menu.style.display).toBe('block');
        expect(menu.parentElement).toBe(document.body);
        expect(menu.style.left).toBe('60px');
        expect(menu.style.top).toBe('100px');
        expect(component.getElement().contains(menu)).toBe(false);
        const onMouseDown = vi.spyOn(component, 'onMouseDown');
        const hideSelectionMenu = vi.spyOn(component, 'hideSelectionMenu');

        // Touch/pointer release retains the original touch target. Compatibility
        // mouse events can hit the menu newly mounted at that same viewport point.
        const release = browserTouchRelease(cell.firstChild, mouseTarget === 'menu' ? menu : cell.firstChild, touchMarked);
        expect(release.trace).toEqual([
            { type: 'pointerup', menu: 'block', selected: true },
            { type: 'touchend', menu: 'block', selected: true },
            ...release.mouseEvents.map(type => ({ type, menu: 'block', selected: true })),
        ]);
        expect(menu.style.display).toBe('block');
        expect(cell.classList.contains('selected')).toBe(true);
        expect(onMouseDown).not.toHaveBeenCalled();
        expect(hideSelectionMenu).not.toHaveBeenCalled();
        expect(release.touchEnd.defaultPrevented).toBe(true);
        expect(release.mouseEvents).toEqual([]);
        expect(editCellMock).not.toHaveBeenCalled();

        menu.querySelector(`[data-action="${action}"]`).click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(copiedText);
        expect(menu.style.display).toBe('none');
    });

    test.each(['pointerup', 'pointercancel', 'pointermove'])('%s cancels a pending hold without opening a menu', type => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown');
        pointer(cell, type, { clientX: 90 });
        vi.advanceTimersByTime(700);
        expect(component.selectionMenu.style.display).toBe('none');
        expect(component.getElement().querySelectorAll('.cell.selected')).toHaveLength(0);
    });

    test('touchend cancellation belongs to one completed hold and leaves other releases alone', () => {
        const cells = component.getElement().querySelectorAll('.row:not(.header) .cell');
        pointer(cells[0], 'pointerdown', { pointerId: 7 });
        touchEvent(cells[0], 'touchstart', 0);
        vi.advanceTimersByTime(450);
        pointer(cells[0], 'pointerup', { pointerId: 7 });
        expect(touchEvent(cells[0], 'touchend', 1).defaultPrevented).toBe(false);
        expect(touchEvent(cells[1], 'touchend', 0).defaultPrevented).toBe(false);
        expect(touchEvent(cells[0], 'touchend', 0).defaultPrevented).toBe(true);
        expect(touchEvent(cells[0], 'touchend', 0).defaultPrevented).toBe(false);
        expect(component.selectionMenu.style.display).toBe('block');
    });

    test('a later native tap reusing both touch identities reaches selection and click handlers', () => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown');
        touchEvent(cell, 'touchstart');
        vi.advanceTimersByTime(450);
        expect(browserTouchRelease(cell, cell, true).touchEnd.defaultPrevented).toBe(true);
        const onMouseDown = vi.spyOn(component, 'onMouseDown');
        const onCellClick = vi.spyOn(component, 'onCellClick');
        pointer(cell, 'pointerdown');
        touchEvent(cell, 'touchstart');
        const release = browserTouchRelease(cell, cell, true);
        expect(release.touchEnd.defaultPrevented).toBe(false);
        expect(release.mouseEvents).toEqual(['mousemove', 'mousedown', 'mouseup', 'click']);
        expect(onMouseDown).toHaveBeenCalledTimes(1);
        expect(onCellClick).toHaveBeenCalledTimes(1);
        expect(component.selectionMenu.style.display).toBe('none');
        expect(cell.classList.contains('selected')).toBe(true);
        expect(editCellMock).not.toHaveBeenCalled();
    });

    test.each(['pointercancel', 'expiry', 'destroy'])('%s leaves the old hold touchend uncancelled', ending => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown');
        touchEvent(cell, 'touchstart');
        vi.advanceTimersByTime(450);
        pointer(cell, ending === 'pointercancel' ? 'pointercancel' : 'pointerup');
        if (ending === 'expiry') vi.advanceTimersByTime(750);
        if (ending === 'destroy') component.destroy();
        expect(touchEvent(cell, 'touchend').defaultPrevented).toBe(false);
    });

    test('a second finger cancels the hold', () => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown');
        pointer(cell, 'pointerdown', { pointerId: 2, isPrimary: false });
        vi.advanceTimersByTime(700);
        expect(component.selectionMenu.style.display).toBe('none');
    });

    test.each(['header', 'editing'])('holding a %s cell leaves its existing interaction alone', className => {
        const cell = className === 'header'
            ? component.getElement().querySelector('.cell.header')
            : component.getElement().querySelector('.row:not(.header) .cell');
        cell.classList.add(className);
        pointer(cell, 'pointerdown');
        vi.advanceTimersByTime(700);
        expect(component.selectionMenu.style.display).toBe('none');
    });

    test('a mouse press still selects normally and needs its ordinary right click', () => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown', { pointerType: 'mouse' });
        cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        cell.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        vi.advanceTimersByTime(700);
        expect(component.selectionMenu.style.display).toBe('none');
        cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        expect(component.selectionMenu.style.display).toBe('block');
    });

    test('a native context menu request during a touch hold opens the same copy menu', () => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown');
        const request = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 100 });
        cell.dispatchEvent(request);
        expect(request.defaultPrevented).toBe(true);
        expect(component.selectionMenu.style.display).toBe('block');
        expect(component.selectionMenuPayload.copyActions[1].payload.text).toBe('Ada');
    });

    test('a native context menu during a pending hold also cancels only its own touchend', () => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown');
        touchEvent(cell, 'touchstart');
        cell.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 60, clientY: 100,
        }));
        expect(browserTouchRelease(cell, component.selectionMenu, true).touchEnd.defaultPrevented).toBe(true);
        expect(component.selectionMenu.style.display).toBe('block');
        expect(cell.classList.contains('selected')).toBe(true);
    });

    test('destruction cancels a pending hold and releases touch listeners', () => {
        const cell = component.getElement().querySelector('.row:not(.header) .cell');
        pointer(cell, 'pointerdown');
        component.destroy();
        pointer(cell, 'pointerdown');
        vi.advanceTimersByTime(700);
        expect(component.selectionMenu.isConnected).toBe(false);
        expect(component.selectionMenu.style.display).toBe('none');
    });

    test.each([
        ['ContextMenu', 'ContextMenu', false], ['Shift+F10', 'F10', true],
    ])('%s reopens the same cell menu after touch copying and dismissal', async (_label, key, shiftKey) => {
        const cell = holdAndRelease(component);
        component.selectionMenu.querySelector('[data-action="copy-no-headers"]').click();
        await Promise.resolve();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Ada');
        expect(component.selectionMenu.style.display).toBe('none');

        cell.focus();
        cell.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, shiftKey }));
        // jsdom does not generate the browser's contextmenu from a key press.
        // Keep the same position to prove origin, rather than coordinates, admits it.
        cell.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, clientX: 60, clientY: 100,
        }));
        expect(component.selectionMenu.style.display).toBe('block');
        expect(component.selectionMenuPayload.copyActions[1].payload.text).toBe('Ada');
    });

    test('a mouse right-click reopens the same cell menu after a touch hold', () => {
        const cell = holdAndRelease(component);
        component.hideSelectionMenu();
        // A contextmenu may arrive without another pointerdown on this root.
        pointer(cell, 'contextmenu', { pointerType: 'mouse', pointerId: 2, button: 2 });
        expect(component.selectionMenu.style.display).toBe('block');
    });

    test.each([
        ['contextmenu', 'click'], ['click', 'contextmenu'],
    ])('the touch compatibility sequence %s then %s stays suppressed', (first, second) => {
        const cell = holdAndRelease(component);
        component.hideSelectionMenu();
        const onContextMenu = vi.spyOn(component, 'onContextMenu');
        const onCellClick = vi.spyOn(component, 'onCellClick');
        for (const type of [first, second]) {
            expect(pointer(cell, type).defaultPrevented).toBe(true);
        }
        expect(onContextMenu).not.toHaveBeenCalled();
        expect(onCellClick).not.toHaveBeenCalled();
        expect(editCellMock).not.toHaveBeenCalled();
        expect(component.selectionMenu.style.display).toBe('none');
        expect(vi.getTimerCount()).toBe(0);
    });

    test.each(['contextmenu', 'click'])('the touch compatibility %s is suppressed at most once', type => {
        const cell = holdAndRelease(component);
        const onContextMenu = vi.spyOn(component, 'onContextMenu');
        const onCellClick = vi.spyOn(component, 'onCellClick');
        const existingInteraction = type === 'contextmenu' ? onContextMenu : onCellClick;
        pointer(cell, type);
        expect(existingInteraction).not.toHaveBeenCalled();
        pointer(cell, type);
        expect(existingInteraction).toHaveBeenCalledTimes(1);
    });

    test.each(['contextmenu', 'click'])('legacy touch-origin mouse %s stays suppressed', type => {
        const cell = holdAndRelease(component);
        const existingInteraction = vi.spyOn(component, type === 'contextmenu' ? 'onContextMenu' : 'onCellClick');
        expect(compatibilityMouseEvent(cell, type).defaultPrevented).toBe(true);
        expect(existingInteraction).not.toHaveBeenCalled();
    });

    test.each([
        ['another pointer id', { pointerId: 2 }],
        ['a pen', { pointerType: 'pen' }],
        ['another position', { clientX: 90 }],
    ])('a request from %s reaches the existing menu after touch holding', (_label, options) => {
        const cell = holdAndRelease(component);
        component.hideSelectionMenu();
        pointer(cell, 'contextmenu', options);
        expect(component.selectionMenu.style.display).toBe('block');
    });

    test.each(['contextmenu', 'click'])('touch %s after the release window reaches its existing handler', type => {
        const cell = holdAndRelease(component);
        vi.advanceTimersByTime(1000);
        const existingInteraction = vi.spyOn(component, type === 'contextmenu' ? 'onContextMenu' : 'onCellClick');
        pointer(cell, type);
        expect(existingInteraction).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('a later tap with the same pointer id reaches its existing click handler', () => {
        const cell = holdAndRelease(component);
        const onCellClick = vi.spyOn(component, 'onCellClick');
        pointer(cell, 'pointerdown');
        pointer(cell, 'pointerup');
        pointer(cell, 'click');
        expect(onCellClick).toHaveBeenCalledTimes(1);
    });

    test('an unmarked click on the same cell reaches its handler after touch holding', () => {
        const cell = holdAndRelease(component);
        const onCellClick = vi.spyOn(component, 'onCellClick');
        cell.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true, clientX: 60, clientY: 100,
        }));
        expect(onCellClick).toHaveBeenCalledTimes(1);
    });

    test.each(['destroy', 'pointercancel'])('%s clears the completed touch expiry timer', disposal => {
        const cell = holdAndRelease(component);
        if (disposal === 'destroy') component.destroy();
        else pointer(cell, 'pointercancel');
        expect(vi.getTimerCount()).toBe(0);
    });

    test.each(['dataset subtree replacement', 'observed root replacement'])(
        '%s cancels a pending hold before its timer can open a detached menu', async replacement => {
            const root = component.getElement();
            const cell = root.querySelector('.row:not(.header) .cell');
            const onContextMenu = vi.spyOn(component, 'onContextMenu');
            const showSelectionMenu = vi.spyOn(component, 'showSelectionMenu');
            await Promise.resolve(); // Establish the lifecycle's connected checkpoint.
            pointer(cell, 'pointerdown');
            expect(vi.getTimerCount()).toBe(1);
            if (replacement === 'dataset subtree replacement') disposeCardResources(root);
            root.replaceWith(document.createElement('section'));
            await Promise.resolve(); // Deliver direct-removal cleanup.

            expect(root.isConnected).toBe(false);
            expect(vi.getTimerCount()).toBe(0);
            pointer(cell, 'pointerdown');
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(1000);
            expect(onContextMenu).not.toHaveBeenCalled();
            expect(showSelectionMenu).not.toHaveBeenCalled();
            expect(component.selectionMenu.isConnected).toBe(false);
            expect(component.selectionMenu.style.display).toBe('none');
        }
    );
});

function holdAndRelease(component) {
    const cell = component.getElement().querySelector('.row:not(.header) .cell');
    pointer(cell, 'pointerdown');
    vi.advanceTimersByTime(700);
    expect(component.selectionMenu.style.display).toBe('block');
    pointer(cell, 'pointerup');
    return cell;
}

function touchEvent(target, type, identifier = 0) {
    // jsdom does not construct Touch objects; retain the native TouchEvent lists.
    const touch = { identifier, target, clientX: 60, clientY: 100 };
    const event = new TouchEvent(type, {
        bubbles: true, cancelable: true,
        changedTouches: [touch],
        touches: type === 'touchstart' ? [touch] : [],
        targetTouches: type === 'touchstart' ? [touch] : [],
    });
    target.dispatchEvent(event);
    return event;
}

function browserTouchRelease(touchTarget, mouseTarget, touchMarked) {
    const cell = touchTarget.closest('.cell');
    const menu = cell.closest('.table-component-root').tableComponentInstance.selectionMenu;
    const trace = [];
    const record = type => trace.push({
        type, menu: menu.style.display, selected: cell.classList.contains('selected'),
    });
    pointer(touchTarget, 'pointerup');
    record('pointerup');
    const touchEnd = touchEvent(touchTarget, 'touchend');
    record('touchend');
    const mouseEvents = [];
    // jsdom has no gesture detector: replay Chromium's tap fallback only when
    // touchend was not cancelled, including the press that restarts selection.
    if (!touchEnd.defaultPrevented) {
        for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) {
            const event = new MouseEvent(type, {
                bubbles: true, cancelable: true, button: 0, clientX: 60, clientY: 100,
            });
            if (touchMarked) Object.defineProperty(event, 'sourceCapabilities', {
                value: { firesTouchEvents: true },
            });
            mouseTarget.dispatchEvent(event);
            mouseEvents.push(type);
            record(type);
        }
    }
    return { touchEnd, mouseEvents, trace };
}

function compatibilityMouseEvent(target, type) {
    const event = new MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0, clientX: 60, clientY: 100,
    });
    Object.defineProperty(event, 'sourceCapabilities', { value: { firesTouchEvents: true } });
    target.dispatchEvent(event);
    return event;
}

function pointer(target, type, options = {}) {
    // jsdom has no PointerEvent constructor; preserve its browser event fields.
    const event = new MouseEvent(type, {
        bubbles: true, cancelable: true, button: 0, clientX: 60, clientY: 100, ...options,
    });
    Object.defineProperties(event, {
        pointerType: { value: options.pointerType || 'touch' },
        pointerId: { value: options.pointerId || 1 },
        isPrimary: { value: options.isPrimary !== false },
    });
    target.dispatchEvent(event);
    return event;
}
