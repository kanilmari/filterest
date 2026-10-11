// @vitest-environment jsdom
// table_component_teardown.test.js
// Verifies that removed list, comparison and ticket components release their menus and listeners.
// Connects real TableComponent instances with explicit disposal and dataset subtree replacement.
// Prevents repeated view builds from retaining interactive menus outside their table roots.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../dev_tools/function_counter.js', () => ({ count_this_function: vi.fn() }));
vi.mock('../function_access_checker.js', () => ({ logAndCheckAccess: vi.fn() }));
vi.mock('../lang/translation_handler.js', () => ({ getTranslationForKey: key => key }));
vi.mock('../../reusable_components/notifications/toast_notification_printer.js', () => ({
    showErrorToast: vi.fn(), showSuccessToast: vi.fn(),
}));
vi.mock('../general_tables/gt_1_row_crud/gt_1_3_row_update/cell_editor.js', () => ({ editCell: vi.fn() }));

import { TableComponent } from './table_component_builder.js';
import { disposeCardResources } from './card_view/card_resource_lifecycle.js';

const components = [];
const removalPaths = [
    ['destroy', component => component.destroy()],
    ['root removal', component => component.getElement().remove()],
    ['view container replacement', (_component, host) => host.replaceChildren()],
    ['dataset ancestor removal', (_component, host) => host.parentElement.remove()],
    ['dataset subtree disposal', (_component, host) => disposeCardResources(host)],
];

function createComponent(view = 'normal') {
    const component = new TableComponent({
        table_name: 'people', initialView: view,
        headers: [{ key: 'name', label: 'Nimi' }],
        data: [{ id: 1, name: 'Ada' }],
    });
    components.push(component);
    return component;
}

function mountComponent(component) {
    const ancestor = document.createElement('section');
    const host = document.createElement('div');
    ancestor.append(host);
    host.append(component.getElement());
    document.body.append(ancestor);
    return host;
}

beforeEach(() => {
    document.body.replaceChildren();
    localStorage.clear();
});

afterEach(() => {
    components.splice(0).forEach(component => {
        component.destroy();
        // Also clean the pre-fix counterproof so each failing case is independent.
        component.selectionMenu.remove();
    });
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('TableComponent teardown', () => {
    test.each(['normal', 'transposed', 'ticket'])('%s repeated destroy removes the body menu and its click listener', view => {
        const disconnectObserver = vi.spyOn(MutationObserver.prototype, 'disconnect');
        for (let rebuild = 0; rebuild < 5; rebuild++) {
            const component = createComponent(view);
            mountComponent(component);
            component.showSelectionMenu(40, 80);
            const menu = component.selectionMenu;
            const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
            expect(document.body.querySelectorAll(':scope > .selection-menu')).toHaveLength(1);

            component.destroy();
            component.destroy();

            expect(document.body.querySelectorAll(':scope > .selection-menu')).toHaveLength(0);
            menu.querySelector('[data-action="copy-no-headers"]').click();
            expect(copySelected).not.toHaveBeenCalled();
        }
        expect(disconnectObserver).toHaveBeenCalledTimes(5);
    });

    describe.each([true, false])('menu opened: %s', menuOpened => {
        test.each(removalPaths)('%s releases the menu and root listeners across rebuilds', async (_name, removeComponent) => {
            const anotherComponent = createComponent();
            mountComponent(anotherComponent);
            anotherComponent.showSelectionMenu(100, 120);
            const survivingMenu = anotherComponent.selectionMenu;

            for (let rebuild = 0; rebuild < 5; rebuild++) {
                const component = createComponent();
                const host = mountComponent(component);
                // Raw removal is observed only after a connected checkpoint.
                await Promise.resolve();
                if (menuOpened) component.showSelectionMenu(40, 80);
                const root = component.getElement();
                const menu = component.selectionMenu;
                const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
                const onCellClick = vi.spyOn(component, 'onCellClick').mockImplementation(() => {});
                const onMouseDown = vi.spyOn(component, 'onMouseDown').mockImplementation(() => {});

                removeComponent(component, host);
                // Native DOM removals deliver their cleanup at the mutation checkpoint.
                await Promise.resolve();

                expect([...document.body.querySelectorAll(':scope > .selection-menu')]).toEqual([survivingMenu]);
                menu.querySelector('[data-action="copy-no-headers"]').click();
                root.click();
                root.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                expect(copySelected).not.toHaveBeenCalled();
                expect(onCellClick).not.toHaveBeenCalled();
                expect(onMouseDown).not.toHaveBeenCalled();
                component.destroy();
                component.destroy();
                host.parentElement?.remove();
            }
            expect(survivingMenu.style.display).toBe('block');
        });
    });

    test('destroy is safe before mounting or opening a menu', () => {
        const component = createComponent();
        const menu = component.selectionMenu;
        const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
        expect(() => { component.destroy(); component.destroy(); }).not.toThrow();
        expect(menu.parentNode).toBeNull();
        menu.querySelector('[data-action="copy-no-headers"]').click();
        expect(copySelected).not.toHaveBeenCalled();
    });

    test('destroy removes the click listener even when the opened menu reference is retained', () => {
        const component = createComponent();
        mountComponent(component);
        component.showSelectionMenu(40, 80);
        const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
        component.destroy();
        component.selectionMenu.querySelector('[data-action="copy-no-headers"]').click();
        expect(copySelected).not.toHaveBeenCalled();
    });

    test('destroy makes every registered root interaction inactive', () => {
        const component = createComponent();
        const root = component.getElement();
        const interactions = [
            ['mousedown', 'onMouseDown'], ['mousemove', 'onMouseMove'], ['mouseup', 'onMouseUp'],
            ['click', 'onCellClick'], ['contextmenu', 'onContextMenu'],
            ['dblclick', 'onCellDoubleClick'], ['keydown', 'onCellKeyDown'],
        ].map(([eventName, methodName]) => [eventName, vi.spyOn(component, methodName).mockImplementation(() => {})]);
        component.destroy();
        interactions.forEach(([eventName, interaction]) => {
            root.dispatchEvent(new Event(eventName, { bubbles: true }));
            expect(interaction).not.toHaveBeenCalled();
        });
    });

    test('dataset subtree disposal releases a same-task mount and removal before observation', async () => {
        const component = createComponent();
        const host = mountComponent(component);
        component.showSelectionMenu(40, 80);
        // generate_table disposes the old dataset subtree before replacing it.
        disposeCardResources(host.parentElement);
        host.parentElement.remove();
        expect(document.body.querySelectorAll(':scope > .selection-menu')).toHaveLength(0);
        await Promise.resolve();
        expect(document.body.querySelectorAll(':scope > .selection-menu')).toHaveLength(0);
    });

    test.each(['destroy', 'dataset subtree disposal'])('never-mounted component does constant work for 1,000 unrelated removals, then %s releases it', async disposalPath => {
        const component = createComponent();
        const root = component.getElement();
        const unrelatedHost = document.createElement('div');
        unrelatedHost.append(...Array.from({ length: 1000 }, () => document.createElement('span')));
        document.body.append(unrelatedHost);
        await Promise.resolve();
        const connectionChecks = vi.spyOn(root, 'isConnected', 'get');
        const removedNodeReads = vi.spyOn(MutationRecord.prototype, 'removedNodes', 'get');
        const containsCalls = vi.spyOn(Node.prototype, 'contains');
        const disconnectObserver = vi.spyOn(MutationObserver.prototype, 'disconnect');
        const destroy = vi.spyOn(component, 'destroy');
        const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
        const onCellClick = vi.spyOn(component, 'onCellClick').mockImplementation(() => {});

        unrelatedHost.replaceChildren();
        await Promise.resolve();

        expect({
            connectionChecks: connectionChecks.mock.calls.length,
            removedNodeReads: removedNodeReads.mock.calls.length,
            containsCalls: containsCalls.mock.calls.length,
        }).toEqual({ connectionChecks: 1, removedNodeReads: 0, containsCalls: 0 });
        expect(destroy).not.toHaveBeenCalled();
        expect(root.tableComponentInstance).toBe(component);

        if (disposalPath === 'destroy') component.destroy();
        else disposeCardResources(root);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(disconnectObserver).toHaveBeenCalledTimes(1);
        expect(root.tableComponentInstance).toBeUndefined();
        expect(component.selectionMenu.parentNode).toBeNull();
        component.selectionMenu.querySelector('[data-action="copy-no-headers"]').click();
        root.click();
        expect(copySelected).not.toHaveBeenCalled();
        expect(onCellClick).not.toHaveBeenCalled();
    });

    test('dataset disposal releases an abandoned component that never mounted', () => {
        const component = createComponent();
        disposeCardResources(component.getElement());
        const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
        component.selectionMenu.querySelector('[data-action="copy-no-headers"]').click();
        expect(copySelected).not.toHaveBeenCalled();
        expect(component.selectionMenu.parentNode).toBeNull();
    });

    test('rerenders and connected reparenting keep one working menu listener without global click listeners', async () => {
        const documentListeners = vi.spyOn(document, 'addEventListener');
        const windowListeners = vi.spyOn(window, 'addEventListener');
        const component = createComponent();
        mountComponent(component);
        const copySelected = vi.spyOn(component, 'copySelected').mockImplementation(() => {});
        const menu = component.selectionMenu;

        for (const view of ['transposed', 'ticket', 'normal']) {
            component.showSelectionMenu(40, 80);
            component.setView(view);
            expect(menu.parentNode).toBe(component.getElement());
            expect(menu.style.display).toBe('none');
            component.setData([{ id: 1, name: 'Liisa' }]);
            mountComponent(component); // Moves the connected root into another dataset host.
            await Promise.resolve();
            component.showSelectionMenu(40, 80);
            expect(menu.parentNode).toBe(document.body);
            expect(menu.style.position).toBe('fixed');
            expect(menu.style.left).toBe('40px');
            expect(menu.style.top).toBe('80px');
            menu.querySelector('[data-action="copy-no-headers"]').click();
            expect(menu.style.display).toBe('none');
        }
        expect(copySelected).toHaveBeenCalledTimes(3);
        expect(documentListeners.mock.calls.filter(([eventName]) => eventName === 'click')).toHaveLength(0);
        expect(windowListeners.mock.calls.filter(([eventName]) => eventName === 'click')).toHaveLength(0);
    });
});
