// D0_theme_and_mobile_menu.spec.ts
// Verifies explicit application theme switching and responsive navbar controls.
// Connects the real menu actions to Home ownership and the dataset toggle contract.
// Pins account appearance in a per-test fixture without leaving preference rows behind.
import { test, expect } from '@playwright/test';
import { ensureNavbarVisible } from '../helpers/navbar';

test.describe('Feature Tests', () => {

  test.beforeEach(async ({ page }) => {
    let preference = { theme_mode: 'light', revision: 1, configured: true };
    await page.route(url => url.pathname === '/api/user-visual-preference', async route => {
      // This visible-switch proof already fixtures reads; keep its writes in the same isolated state.
      if (route.request().method() === 'PATCH') {
        preference = { ...preference, theme_mode: route.request().postDataJSON().theme_mode, revision: preference.revision + 1 };
      } else if (route.request().method() !== 'GET') return route.continue();
      await route.fulfill({ json: preference });
    });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => localStorage.setItem('theme', 'light'));
    await page.goto('/');
  });

  test('Theme toggle switches between light and dark mode', async ({ page }) => {
    // Set a large viewport to ensure navbar is visible (threshold is 1850px)
    await page.setViewportSize({ width: 1920, height: 1080 });

    const themeBtn = page.locator('#themeToggleBtn');
    const body = page.locator('body');

    // Wait for navbar to be visible (not collapsed)
    const navbar = page.locator('#navbar');
    await expect(navbar).not.toHaveClass(/collapsed/);

    // Get initial class list
    const initialClasses = await body.getAttribute('class');
    
    // Click the theme toggle
    await themeBtn.click();
    
    // Wait for class to change
    await expect(body).not.toHaveClass(initialClasses || '', { timeout: 5000 });
    
    const newClasses = await body.getAttribute('class');
    expect(newClasses).not.toBe(initialClasses);
  });

  test('Mobile menu toggles visibility', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Give time for resize event to fire and handle
    await page.waitForTimeout(1000);
    
    const showMenuBtn = page.locator('#showMenuButton');
    const navbar = page.locator('#navbar');
    const hideMenuBtn = page.locator('#hideMenuButton');
    
    // Verify initial state: navbar should be collapsed
    await expect(navbar).toHaveClass(/collapsed/);
    
    // Ensure button is visible in mobile view
    await expect(showMenuBtn).toBeVisible();
    
    // Click to open
    await showMenuBtn.click();
    
    // Navbar should not be collapsed anymore
    await expect(navbar).not.toHaveClass(/collapsed/);
    await ensureNavbarVisible(page);
    // Owner 14.10.2026: Home and datasets both keep the open-state control in the menu bar.
    await expect(showMenuBtn).toBeHidden();
    await expect(hideMenuBtn).toBeVisible();
    await expect(showMenuBtn).toHaveAttribute('aria-expanded', 'true');

    await hideMenuBtn.click();
    
    // Navbar should be collapsed again
    await expect(navbar).toHaveClass(/collapsed/);
    await expect(showMenuBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(showMenuBtn).toBeVisible();
  });

});
