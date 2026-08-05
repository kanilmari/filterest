// visual_guardian_helpers.ts
// Provides shared helpers for Visual Guardian Playwright screenshot tests.
// Bridges authenticated app loading, screenshot artifact writing, and failure capture.
// Exists so visual regression specs use one deterministic setup and artifact path.

import { type Page, type TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

import { login } from '../e2e/helpers/auth';
import {
  navigateToDataset,
  waitForAppReady,
  waitForDataLoaded,
} from '../e2e/helpers/navigation';

export const VISUAL_GUARDIAN_OUTPUT_DIR = 'testing/test-results/visual_guardian';

function ensureOutputDir(): void {
  if (!fs.existsSync(VISUAL_GUARDIAN_OUTPUT_DIR)) {
    fs.mkdirSync(VISUAL_GUARDIAN_OUTPUT_DIR, { recursive: true });
  }
}

export type LoadVisualGuardianAppOptions = {
  datasetName?: string;
};

export async function loadVisualGuardianApp(
  page: Page,
  options: LoadVisualGuardianAppOptions = {},
): Promise<void> {
  await login(page);
  await waitForAppReady(page);

  if (options.datasetName) {
    // Visual Guardian needs a representative dataset surface, not a specific
    // project-root tab. Allow fallback so structural tab visibility rules do
    // not make the capture suite brittle when a dataset moves into a subfolder.
    await navigateToDataset(page, options.datasetName, { allowFallback: true });
    await waitForDataLoaded(page);
    return;
  }

  await page.waitForSelector('.scrollable_content', {
    state: 'attached',
    timeout: 15000,
  });
}

export async function takeGuardianScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  ensureOutputDir();
  const projectName = testInfo.project.name.replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
  await page.screenshot({
    path: path.join(VISUAL_GUARDIAN_OUTPUT_DIR, `${projectName}_${name}.png`),
    fullPage: true,
  });
}

// Waits for finite CSS/Web Animations transitions to settle before capture.
// Connects browser animation state to screenshot timing in Visual Guardian specs.
// Exists to reduce fixed-sleep flake without blocking on infinite decorative loops.
export async function waitForVisualGuardianIdle(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
  await page.waitForFunction(
    () => {
      const elements = Array.from(document.querySelectorAll('*'));
      return elements.every((element) => {
        const getAnimations = (element as Element & {
          getAnimations?: () => Animation[];
        }).getAnimations;
        const animations = typeof getAnimations === 'function' ? getAnimations.call(element) : [];
        return animations.every((animation) => {
          const timing = animation.effect?.getTiming();
          if (timing?.iterations === Infinity) {
            return true;
          }
          return animation.playState === 'finished' || animation.playState === 'idle';
        });
      });
    },
    { timeout: 2500 },
  ).catch(() => {});
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

export async function saveVisualGuardianFailureArtifacts(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  if (testInfo.status === testInfo.expectedStatus) {
    return;
  }

  const htmlPath = testInfo.outputPath('page-source.html');
  const screenshotPath = testInfo.outputPath('failure-page.png');

  await fs.promises.writeFile(htmlPath, await page.content(), 'utf8');
  await page.screenshot({ path: screenshotPath, fullPage: true });
}
