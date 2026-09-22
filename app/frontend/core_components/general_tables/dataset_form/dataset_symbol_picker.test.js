// @vitest-environment jsdom
// dataset_symbol_picker.test.js
// Verifies the dataset form's symbol control in both modes, its routes, and that
// each symbol is offered as a picture drawn in the current text colour.
// Bridges the safe symbol registry, the chosen key and the assignment request.
// Exists so a dataset's symbol is saved — or removed — deliberately, and never guessed,
// and so the chosen symbol stays visible in the dark theme.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const endpointRouterMock = vi.fn();
vi.mock('../../endpoints/endpoint_router.js', () => ({
    endpoint_router: (...args) => endpointRouterMock(...args),
}));
vi.mock('../../lang/translation_handler.js', () => ({
    getTranslationForKey: (key, { fallback } = {}) => fallback,
}));

const { assignDatasetSymbol, createDatasetSymbolPicker, readDatasetSymbol } = await import('./dataset_symbol_picker.js');

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

const snapshot = {
    symbols: [{ key: 'payments', url: '/symbol-assets/payments.svg' }, { key: 'calendar' }],
    datasets: [{ table_uid: 3470, dataset_name: 'subscriptions', icon_key: 'payments' }],
    fields: [],
};

function mount(settings) {
    const picker = createDatasetSymbolPicker(settings);
    document.body.appendChild(picker.element);
    return picker;
}
const status = (picker) => picker.element.querySelector('.dataset-symbol-status');
const trigger = (picker) => picker.element.querySelector('.vdw-dropdown-input');
const preview = (picker) => picker.element.querySelector('.dataset-symbol-preview');

/** The names the open list offers, in order. */
function offeredNames(picker) {
    picker.dropdown.open();
    const names = Array.from(document.querySelectorAll('.vdw-dropdown-options .vdw-option'))
        .map((option) => option.textContent);
    picker.dropdown.close();
    return names;
}

/** Choose one option the way a person does: by clicking its row in the open list. */
function clickOption(picker, name) {
    picker.dropdown.open();
    const option = Array.from(document.querySelectorAll('.vdw-dropdown-options .vdw-option'))
        .find((element) => element.textContent === name);
    if (!option) throw new Error(`The list does not offer "${name}".`);
    option.click();
    picker.dropdown.close();
}

beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.lang = 'en';
    endpointRouterMock.mockReset();
    endpointRouterMock.mockResolvedValue(snapshot);
});

describe('dataset symbol control', () => {
    test('offers every safe symbol plus the choice of none', async () => {
        const picker = mount();
        await picker.ready;
        expect(offeredNames(picker)).toEqual(['No symbol', 'payments', 'calendar']);
        expect(trigger(picker).value).toBe('No symbol');
        expect(picker.value()).toBe('');
    });

    test('each symbol is offered as its own picture beside its name', async () => {
        const picker = mount();
        await picker.ready;
        picker.dropdown.open();
        const rows = Array.from(document.querySelectorAll('.vdw-dropdown-options .vdw-option'));
        const paymentsIcon = rows[1].querySelector('.vdw-option-icon');

        expect(rows[1].classList.contains('vdw-option--with-leading-icon')).toBe(true);
        expect(paymentsIcon.classList.contains('metadata-symbol-icon')).toBe(true);
        expect(paymentsIcon.style.getPropertyValue('--metadata-symbol-url'))
            .toBe('url("/symbol-assets/payments.svg")');
        // "No symbol" has no picture of its own, only the space one would take.
        expect(rows[0].querySelector('.vdw-option-icon').classList.contains('metadata-symbol-icon'))
            .toBe(false);
        picker.dropdown.close();
    });

    // A click on the picture must choose the option, exactly like a click on the name.
    test('clicking a symbol picture chooses that symbol', async () => {
        const picker = mount();
        await picker.ready;
        picker.dropdown.open();
        const rows = Array.from(document.querySelectorAll('.vdw-dropdown-options .vdw-option'));
        rows[2].querySelector('.vdw-option-icon').click();

        expect(picker.value()).toBe('calendar');
    });

    // The symbol files are black drawings, so a dark theme would swallow a plain
    // picture. The preview is a mask that takes the surrounding text colour.
    test('the chosen symbol is drawn in the theme text colour, not as a black picture', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        await picker.ready;

        expect(preview(picker).tagName).toBe('SPAN');
        expect(preview(picker).classList.contains('metadata-symbol-icon')).toBe(true);
        expect(preview(picker).style.getPropertyValue('--metadata-symbol-url'))
            .toBe('url("/symbol-assets/payments.svg")');

        const maskCss = readFileSync(resolve(CURRENT_DIR, '../../../reusable_components/symbol_asset_resolver.css'), 'utf8');
        expect(maskCss).toContain('background-color: currentcolor');
        const formCss = readFileSync(resolve(CURRENT_DIR, 'dataset_form.css'), 'utf8');
        expect(formCss).toContain('form.dataset-form .dataset-symbol-preview[hidden]');
        expect(formCss).toContain('color: var(--text_color)');
    });

    test('a stored symbol is shown with its picture', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        await picker.ready;
        expect(picker.value()).toBe('payments');
        expect(picker.changed()).toBe(false);
        expect(preview(picker).hidden).toBe(false);
    });

    test('with no symbol chosen there is no picture to show', async () => {
        const picker = mount();
        await picker.ready;
        expect(preview(picker).hidden).toBe(true);
        clickOption(picker, 'calendar');
        expect(preview(picker).hidden).toBe(false);
        clickOption(picker, 'No symbol');
        expect(preview(picker).hidden).toBe(true);
    });

    // A new dataset has no symbol; every dataset the creation mode makes is new,
    // so the same choice is a change for each of them.
    test('a new dataset starts without a symbol, and a saved choice stays a change', async () => {
        const picker = mount();
        await picker.ready;
        expect(picker.changed()).toBe(false);
        clickOption(picker, 'calendar');
        expect(picker.changed()).toBe(true);
        picker.accept();
        expect(picker.changed()).toBe(true);
    });

    // The creating form starts over for the next dataset. The dropdown is not a
    // native form control, so the form's own reset cannot clear it.
    test('starting over leaves the next dataset without a symbol', async () => {
        const picker = mount();
        await picker.ready;
        clickOption(picker, 'payments');
        picker.reset();
        expect(picker.value()).toBe('');
        expect(picker.changed()).toBe(false);
        expect(preview(picker).hidden).toBe(true);
    });

    // The edit mode learns the dataset's symbol after the control is built. What
    // it learns must become the baseline a Save compares against, or "No symbol"
    // looks unchanged and a stored symbol can never be removed.
    test('a stored symbol is the baseline, so choosing No symbol is a change', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        expect(trigger(picker).disabled).toBe(true);
        await picker.ready;
        expect(trigger(picker).disabled).toBe(false);
        clickOption(picker, 'No symbol');
        expect(picker.changed()).toBe(true);
        expect(picker.value()).toBe('');
        picker.accept();
        expect(picker.changed()).toBe(false);
    });

    test('a stored symbol the registry does not list is kept, not silently removed', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'retired_symbol', tableUID: 3470 }) });
        await picker.ready;
        expect(picker.value()).toBe('retired_symbol');
        expect(picker.changed()).toBe(false);
        expect(offeredNames(picker)).toContain('retired symbol');
    });

    test('an unreadable registry never turns an untouched Save into a removal', async () => {
        endpointRouterMock.mockRejectedValue(new Error('network'));
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        await picker.ready;
        expect(picker.value()).toBe('payments');
        expect(picker.changed()).toBe(false);
        expect(status(picker).textContent).toBe('The symbols could not be read.');
    });

    test('without a known dataset identity the control stays closed and says why', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: '', tableUID: 0 }) });
        await picker.ready;
        expect(trigger(picker).disabled).toBe(true);
        expect(picker.changed()).toBe(false);
        expect(status(picker).textContent).toBe('The symbols could not be read.');
    });

    test('a refused symbol is reported beside the control and stays a change for a retry', async () => {
        const picker = mount({ stored: Promise.resolve({ iconKey: 'payments', tableUID: 3470 }) });
        await picker.ready;
        clickOption(picker, 'No symbol');
        picker.reportFailure();
        expect(status(picker).hidden).toBe(false);
        expect(status(picker).textContent).toBe('The symbol could not be saved.');
        expect(picker.changed()).toBe(true);
        picker.accept();
        expect(status(picker).hidden).toBe(true);
    });

    test('disposing takes the dropdown’s open list off the page', async () => {
        const picker = mount();
        await picker.ready;
        picker.dropdown.open();
        expect(document.querySelectorAll('.vdw-dropdown-list')).toHaveLength(1);
        picker.dispose();
        expect(document.querySelectorAll('.vdw-dropdown-list')).toHaveLength(0);
    });
});

describe('dataset symbol routes', () => {
    test('a dataset reports the symbol it uses and its identity', async () => {
        expect(await readDatasetSymbol('subscriptions')).toEqual({ iconKey: 'payments', tableUID: 3470 });
        expect(await readDatasetSymbol('unknown_dataset')).toEqual({ iconKey: '', tableUID: 0 });
    });

    test('a symbol is assigned quietly to one dataset; an empty key removes it', async () => {
        await assignDatasetSymbol(3470, '');
        expect(endpointRouterMock).toHaveBeenLastCalledWith('adminSymbols', {
            method: 'POST',
            body_data: { target_type: 'dataset', target_uid: 3470, icon_key: '' },
            suppressErrorToast: true,
        });
    });
});
