// @vitest-environment jsdom
// Locks the temporary admin-only dataset-cover live preview contract.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mountDatasetCoverTestPalette } from './dataset_cover_test_palette.js';

function createCoverHero() {
    const hero = document.createElement('section');
    hero.classList.add('filterbar-inline-hero', 'filterbar-inline-hero--has-cover');
    document.body.appendChild(hero);
    return hero;
}

describe('dataset cover test palette', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        history.replaceState({}, '', '/demo?view=card');
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    test('fails closed unless both admin permission and the protected flag are present', async () => {
        const hero = createCoverHero();
        const requestFn = vi.fn(async () => ({
            view_admin_cover_image_test_palette: true,
        }));

        await expect(mountDatasetCoverTestPalette(hero, 'demo', {
            requestFn,
            permissionCheck: () => false,
        })).resolves.toBeNull();
        expect(requestFn).not.toHaveBeenCalled();

        await expect(mountDatasetCoverTestPalette(hero, 'demo', {
            requestFn: vi.fn(async () => ({
                view_admin_cover_image_test_palette: false,
            })),
            permissionCheck: () => true,
        })).resolves.toBeNull();

        await expect(mountDatasetCoverTestPalette(hero, 'demo', {
            requestFn: vi.fn(async () => {
                throw new Error('endpoint unavailable');
            }),
            permissionCheck: () => true,
        })).resolves.toBeNull();

        expect(hero.querySelector('[data-testid="dataset-cover-test-palette-button"]'))
            .toBeNull();
    });

    test('uses the stable flag fetcher seam without route arguments', async () => {
        const hero = createCoverHero();
        const requestFn = vi.fn(async () => ({
            view_admin_cover_image_test_palette: true,
        }));

        const control = await mountDatasetCoverTestPalette(hero, 'demo', {
            requestFn,
            permissionCheck: () => true,
        });

        expect(control).not.toBeNull();
        expect(requestFn).toHaveBeenCalledOnce();
        expect(requestFn).toHaveBeenCalledWith();
        control.destroy();
    });

    test('previews every mask and image value without persistence or URL changes', async () => {
        const hero = createCoverHero();
        const initialUrl = window.location.href;
        const control = await mountDatasetCoverTestPalette(hero, 'demo', {
            requestFn: vi.fn(async () => ({
                view_admin_cover_image_test_palette: true,
            })),
            permissionCheck: () => true,
        });
        const button = control.button;
        const panel = control.panel;

        expect(panel.hidden).toBe(true);
        button.click();
        expect(panel.hidden).toBe(false);
        expect(button.getAttribute('aria-expanded')).toBe('true');
        expect(panel.dataset.datasetName).toBe('demo');
        expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(13);

        const changes = [
            ['oval-x', '--dataset-cover-mask-oval-x', '72', '72%'],
            ['oval-y', '--dataset-cover-mask-oval-y', '95', '95%'],
            ['oval-position-y', '--dataset-cover-mask-position-y', '42', '42%'],
            ['center-opacity', '--dataset-cover-mask-center-opacity', '0.1', '0.1'],
            ['mid-opacity', '--dataset-cover-mask-mid-opacity', '0.5', '0.5'],
            ['edge-opacity', '--dataset-cover-mask-edge-opacity', '0.9', '0.9'],
            ['center-stop', '--dataset-cover-mask-center-stop', '20', '20%'],
            ['mid-stop', '--dataset-cover-mask-mid-stop', '60', '60%'],
            ['edge-stop', '--dataset-cover-mask-edge-stop', '95', '95%'],
            ['image-opacity', '--dataset-cover-image-opacity', '0.75', '0.75'],
            ['hero-height', '--dataset-cover-hero-extra-height', '80', '80px'],
            ['overlay-opacity', '--dataset-cover-overlay-opacity', '0.4', '0.4'],
            ['image-blur', '--dataset-cover-image-blur', '7', '7px'],
        ];
        changes.forEach(([id, variable, inputValue, expectedValue]) => {
            const input = panel.querySelector(
                `[data-testid="dataset-cover-test-palette-${id}"]`
            );
            input.value = inputValue;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            expect(hero.style.getPropertyValue(variable)).toBe(expectedValue);
        });

        const maskInput = panel.querySelector(
            '[data-testid="dataset-cover-test-palette-mask-enabled"]'
        );
        maskInput.checked = false;
        maskInput.dispatchEvent(new Event('change', { bubbles: true }));
        expect(hero.style.getPropertyValue('--dataset-cover-mask-image')).toBe('none');
        maskInput.checked = true;
        maskInput.dispatchEvent(new Event('change', { bubbles: true }));
        expect(hero.style.getPropertyValue('--dataset-cover-mask-image')).toBe('initial');
        maskInput.checked = false;
        maskInput.dispatchEvent(new Event('change', { bubbles: true }));
        expect(localStorage).toHaveLength(0);
        expect(window.location.href).toBe(initialUrl);

        panel.querySelector('[data-testid="dataset-cover-test-palette-reset"]').click();
        expect(maskInput.checked).toBe(true);
        expect(hero.style.getPropertyValue('--dataset-cover-mask-image')).toBe('');
        changes.forEach(([, variable]) => {
            expect(hero.style.getPropertyValue(variable)).toBe('');
        });
        expect(panel.querySelector(
            '[data-testid="dataset-cover-test-palette-center-opacity"]'
        ).value).toBe('0.2');

        control.destroy();
    });

    test('closes with its button, Escape, or an outside pointer action', async () => {
        const hero = createCoverHero();
        const control = await mountDatasetCoverTestPalette(hero, 'demo', {
            requestFn: vi.fn(async () => ({
                view_admin_cover_image_test_palette: true,
            })),
            permissionCheck: () => true,
        });

        control.button.click();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        expect(control.panel.hidden).toBe(true);

        control.button.click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(control.panel.hidden).toBe(true);
        expect(document.activeElement).toBe(control.button);

        control.button.click();
        control.panel.querySelector('[data-testid="dataset-cover-test-palette-close"]')
            .click();
        expect(control.panel.hidden).toBe(true);

        control.destroy();
    });

    test('moves by its heading and reset restores its temporary geometry', async () => {
        const hero = createCoverHero();
        const control = await mountDatasetCoverTestPalette(hero, 'demo', {
            requestFn: vi.fn(async () => ({
                view_admin_cover_image_test_palette: true,
            })),
            permissionCheck: () => true,
        });
        Object.defineProperties(control.panel, {
            offsetWidth: { configurable: true, value: 420 },
            offsetHeight: { configurable: true, value: 300 },
        });
        vi.spyOn(control.panel, 'getBoundingClientRect').mockReturnValue({
            left: 400,
            top: 100,
            right: 820,
            bottom: 400,
            width: 420,
            height: 300,
        });

        const heading = control.panel.querySelector('.dataset-cover-test-palette__heading');
        heading.dispatchEvent(new MouseEvent('pointerdown', {
            bubbles: true,
            button: 0,
            clientX: 410,
            clientY: 110,
        }));
        document.dispatchEvent(new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 260,
            clientY: 210,
        }));

        expect(control.panel.style.left).toBe('250px');
        expect(control.panel.style.top).toBe('200px');
        expect(control.panel.style.right).toBe('auto');
        expect(control.panel.classList.contains('dataset-cover-test-palette--dragging'))
            .toBe(true);
        document.dispatchEvent(new MouseEvent('pointermove', {
            bubbles: true,
            clientX: 2000,
            clientY: 2000,
        }));
        expect(control.panel.style.left).toBe(`${window.innerWidth - 420}px`);
        expect(control.panel.style.top).toBe(`${window.innerHeight - 300}px`);
        document.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
        expect(control.panel.classList.contains('dataset-cover-test-palette--dragging'))
            .toBe(false);

        control.panel.style.width = '320px';
        control.panel.style.height = '240px';
        control.panel.querySelector('[data-testid="dataset-cover-test-palette-reset"]')
            .click();
        expect(control.panel.style.left).toBe('');
        expect(control.panel.style.top).toBe('');
        expect(control.panel.style.right).toBe('');
        expect(control.panel.style.width).toBe('');
        expect(control.panel.style.height).toBe('');

        const panel = control.panel;
        const button = control.button;
        control.destroy();
        expect(panel.isConnected).toBe(false);
        expect(button.isConnected).toBe(false);
    });
});
