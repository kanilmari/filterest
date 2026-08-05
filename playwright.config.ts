import { defineConfig } from '@playwright/test';

const htmlReportOpenMode =
  process.env.PLAYWRIGHT_HTML_OPEN === 'always'
    ? 'always'
    : process.env.PLAYWRIGHT_HTML_OPEN === 'on-failure'
      ? 'on-failure'
      : 'never';
const includeSetupTests = process.env.PLAYWRIGHT_INCLUDE_SETUP === '1';
const requestedWorkerCount = Number.parseInt(process.env.PLAYWRIGHT_WORKERS || '', 10);
const localWorkerCount = Number.isInteger(requestedWorkerCount) && requestedWorkerCount > 0
  ? requestedWorkerCount
  : 2;
const requestedBaseURL = String(process.env.EASELECT_E2E_BASE_URL || '').trim();
const baseURL = requestedBaseURL || 'https://localhost:8082';
const parsedBaseURL = new URL(baseURL);
if (
  parsedBaseURL.protocol !== 'https:'
  || parsedBaseURL.username
  || parsedBaseURL.password
  || !['localhost', '127.0.0.1'].includes(parsedBaseURL.hostname)
) {
  throw new Error(
    'EASELECT_E2E_BASE_URL must be a credential-free local HTTPS origin.',
  );
}

/**
 * Easelect GUI Test Matrix
 *
 * 6 projects = 3 viewport widths × 2 card views.
 * Every .spec.ts in testing/e2e/ runs in all 6 combinations automatically.
 *
 * Viewports:
 *   mobile   375×667   (phone portrait)
 *   tablet   768×1024  (tablet portrait)
 *   desktop  1440×900  (full-width desktop)
 *
 * Card views (custom metadata, read via test.info().project.metadata.cardView):
 *   normal   standard compact cards
 *   big      expanded big-card modal
 */

export default defineConfig({
  testDir: './testing/e2e',
  /* Ignore setup/ folder from matrix runs — run setup tests explicitly */
  testIgnore: includeSetupTests
    ? ['**/global-setup.*', '**/*.test.ts']
    : ['**/setup/**', '**/global-setup.*', '**/*.test.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Four concurrent browsers can saturate the native app/database and create
  // unrelated timeout clusters. Keep the local default bounded but overridable.
  workers: process.env.CI ? 1 : localWorkerCount,
  reporter: [['html', { outputFolder: 'testing/playwright-report', open: htmlReportOpenMode }]],
  outputDir: './testing/test-results',

  /* Global setup: login once, share session with all projects */
  globalSetup: './testing/e2e/global-setup.ts',
  globalTeardown: './testing/e2e/global-teardown.ts',

  use: {
    baseURL,
    trace: 'on-first-retry',
    ignoreHTTPSErrors: true,
    /* Re-use the authenticated session from global-setup */
    storageState: './testing/e2e/.auth/user.json',
    /* Bypass rate limiting in dev environment (see rate_limiting.go) */
    extraHTTPHeaders: {
      'X-Bypass-Ratelimit': 'test-mode',
    },
  },
  projects: [
    // ── Mobile (375×667) ──
    {
      name: 'mobile-card',
      use: {
        viewport: { width: 375, height: 667 },
      },
      metadata: { cardView: 'normal', screenWidth: 'mobile' },
    },
    {
      name: 'mobile-bigcard',
      use: {
        viewport: { width: 375, height: 667 },
      },
      metadata: { cardView: 'big', screenWidth: 'mobile' },
    },

    // ── Tablet (768×1024) ──
    {
      name: 'tablet-card',
      use: {
        viewport: { width: 768, height: 1024 },
      },
      metadata: { cardView: 'normal', screenWidth: 'tablet' },
    },
    {
      name: 'tablet-bigcard',
      use: {
        viewport: { width: 768, height: 1024 },
      },
      metadata: { cardView: 'big', screenWidth: 'tablet' },
    },

    // ── Desktop (1440×900) ──
    {
      name: 'desktop-card',
      use: {
        viewport: { width: 1440, height: 900 },
      },
      metadata: { cardView: 'normal', screenWidth: 'desktop' },
    },
    {
      name: 'desktop-bigcard',
      use: {
        viewport: { width: 1440, height: 900 },
      },
      metadata: { cardView: 'big', screenWidth: 'desktop' },
    },
  ],
});
