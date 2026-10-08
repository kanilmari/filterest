// presentation_palette_shell.test.js
// Proves the extracted shell owns close/focus/drag/reset/teardown for either editor.
// Connects DOM interactions to a narrow typed-state adapter without dataset code.
// Verifies ownership cannot release another palette's preview or overwrite newer drafts.
import { afterEach, expect, test, vi } from 'vitest';
import { createPresentationPaletteShell, createPaletteDraftOwner } from './presentation_palette_shell.js';
const mounted = [];
afterEach(() => { mounted.splice(0).forEach(shell => shell.destroy()); document.body.replaceChildren(); vi.restoreAllMocks(); });
function setup() {
    const button = document.createElement('button'); document.body.append(button);
    const onReset = vi.fn(), onSave = vi.fn();
    const shell = createPresentationPaletteShell({ button, prefix: 'test-palette',
        getCopy: () => ({ title: 'Title', button: 'Palette', close: 'Close', reset: 'Reset', save: 'Save' }), onReset, onSave });
    shell.syncCopy(); mounted.push(shell);
    return { ...shell, onReset, onSave };
}
function pointer(type, props) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { button: 0, clientX: 0, clientY: 0, ...props }); return event;
}

test('close, outside click and Escape hide; Close and Escape return focus and teardown disconnects', () => {
    const shell = setup(); shell.button.click();
    expect(shell.panel.hidden).toBe(false);
    expect(shell.button.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(shell.panel.hidden).toBe(true); expect(document.activeElement).toBe(shell.button);
    shell.button.click(); document.body.dispatchEvent(pointer('pointerdown'));
    expect(shell.panel.hidden).toBe(true);
    shell.button.click();
    const close = shell.panel.querySelector('[data-testid="test-palette-close"]');
    close.focus(); close.click();
    expect(shell.panel.hidden).toBe(true); expect(document.activeElement).toBe(shell.button);
    expect(shell.onReset).not.toHaveBeenCalled();
    shell.destroy(); shell.button.click();
    expect(shell.panel.isConnected).toBe(false); expect(shell.panel.hidden).toBe(true);
});

test('drag clamps to viewport, cancellation stops it and reset removes resized geometry', () => {
    const shell = setup(); const heading = shell.panel.querySelector('.dataset-cover-test-palette__heading');
    shell.panel.getBoundingClientRect = () => ({ left: 100, top: 20 });
    Object.defineProperty(shell.panel, 'offsetWidth', { value: 400 });
    Object.defineProperty(shell.panel, 'offsetHeight', { value: 300 });
    heading.dispatchEvent(pointer('pointerdown', { clientX: 120, clientY: 30 }));
    document.dispatchEvent(pointer('pointermove', { clientX: 99999, clientY: -10 }));
    expect(shell.panel.style.left).toBe(`${window.innerWidth - 400}px`);
    expect(shell.panel.style.top).toBe('0px');
    document.dispatchEvent(pointer('pointercancel'));
    document.dispatchEvent(pointer('pointermove', { clientX: 50, clientY: 50 }));
    expect(shell.panel.style.top).toBe('0px');
    shell.panel.style.width = '500px'; shell.panel.style.height = '350px';
    shell.resetGeometry(); expect(shell.panel.getAttribute('style')).toBe('');
    shell.panel.querySelector('[data-testid="test-palette-reset"]').click(); expect(shell.onReset).toHaveBeenCalledOnce();
});

test('preview owners remain distinct and save destruction never paints a late response', async () => {
    let preview;
    let finish;
    const state = { savedSettings: () => ({ value: 1 }),
        setPreview: (owner, settings) => { preview = { owner, settings }; },
        releasePreview: owner => { if (preview?.owner === owner) preview = null; },
        saveSettings: () => new Promise(resolve => { finish = resolve; }) };
    const render = vi.fn(); const setStatus = vi.fn();
    const options = { state, render, setStatus, syncControls: vi.fn(), resetGeometry: vi.fn() };
    const first = createPaletteDraftOwner(options), second = createPaletteDraftOwner(options);
    first.previewDraft(); second.replaceDraft({ value: 3 }); first.destroy();
    expect(preview.settings.value).toBe(3);
    const saving = second.saveSettings(); second.destroy(); finish({ value: 4 }); await saving;
    expect(setStatus).toHaveBeenLastCalledWith('saving'); expect(preview).toBeNull();
    expect(render).toHaveBeenCalledTimes(2);
});

// Reset during a save discards unsaved edits, so the completed save's stored value becomes the visible draft.
test('a reset during a save shows the stored value once the save completes', async () => {
    let stored = { value: 1 };
    let finish;
    const state = { savedSettings: () => ({ ...stored }), setPreview: vi.fn(), releasePreview: vi.fn(),
        saveSettings: value => new Promise(resolve => { finish = () => { stored = { ...value }; resolve({ ...value }); }; }) };
    const syncControls = vi.fn();
    const owner = createPaletteDraftOwner({ state, render: vi.fn(), setStatus: vi.fn(), syncControls, resetGeometry: vi.fn() });
    owner.replaceDraft({ value: 2 });
    const saving = owner.saveSettings();
    owner.replaceDraft({ value: 3 }); owner.resetPreview();
    expect(owner.draft).toEqual({ value: 1 });
    finish(); await saving;
    expect(owner.draft).toEqual({ value: 2 });
    expect(syncControls).toHaveBeenCalledTimes(2);
});
