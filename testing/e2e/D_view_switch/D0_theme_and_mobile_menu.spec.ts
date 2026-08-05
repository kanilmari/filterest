import { test, expect } from '@playwright/test';

test.describe('Feature Tests', () => {

  test.beforeEach(async ({ page }) => {
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
    await expect(showMenuBtn).toBeVisible();
    await expect(showMenuBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(hideMenuBtn).toBeHidden();

    // The same canonical top-left button closes the menu. The legacy
    // in-navbar duplicate remains outside the visual and accessibility trees.
    await showMenuBtn.click();
    
    // Navbar should be collapsed again
    await expect(navbar).toHaveClass(/collapsed/);
    await expect(showMenuBtn).toHaveAttribute('aria-expanded', 'false');
    await expect(showMenuBtn).toBeVisible();
  });

});
