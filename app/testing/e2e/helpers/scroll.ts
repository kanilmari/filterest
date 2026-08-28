import { type Page } from '@playwright/test';

export type ScrollMetrics = {
  containerScrollTop: number;
  containerScrollHeight: number;
  containerClientHeight: number;
  containerScrollWidth: number;
  containerClientWidth: number;
  documentScrollWidth: number;
  documentClientWidth: number;
};

function getActiveScrollableMetricsInPage(): ScrollMetrics | null {
  const candidates = Array.from(document.querySelectorAll('.scrollable_content')) as HTMLElement[];
  const activeContainer = candidates.find((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
  });

  if (!activeContainer) {
    return null;
  }

  return {
    containerScrollTop: activeContainer.scrollTop,
    containerScrollHeight: activeContainer.scrollHeight,
    containerClientHeight: activeContainer.clientHeight,
    containerScrollWidth: activeContainer.scrollWidth,
    containerClientWidth: activeContainer.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
  };
}

export async function getActiveScrollableMetrics(page: Page): Promise<ScrollMetrics | null> {
  return page.evaluate(getActiveScrollableMetricsInPage);
}

export async function scrollActiveContentToBottom(page: Page): Promise<void> {
  await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('.scrollable_content')) as HTMLElement[];
    const activeContainer = candidates.find((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
    });

    if (activeContainer) {
      activeContainer.scrollTop = activeContainer.scrollHeight;
    }
  });
}
