// media-tab-fixture.ts
// Supplies media-shaped Home and dataset GET responses without saving settings.
// Shared by G18 and the uncommitted WO102 before/after screenshot probe.
// Uses default signed-in storageState; only read-only permission POSTs may pass.
import { expect, type BrowserContext, type Page } from '@playwright/test';
import homeDefinition from '../../../frontend/shared/front_page_presentation/definition.json';
import { waitForAppReady } from './navigation';
import { closeActiveFilterbarIfOpen } from './filterbar';

export const MEDIA_DATASET = 'app_service_catalog';
export const PLAIN_DATASET = 'system_about';
export type MediaTabPolicy = { home: 'video' | 'image' | 'none' | 'hidden'; blocked: string[] };

/** Generate tiny valid local media in memory; no uploaded file or installation media is needed. */
async function buildMedia(page: Page) {
  return page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 960; canvas.height = 540;
    const brush = canvas.getContext('2d')!;
    const gradient = brush.createLinearGradient(0, 0, 960, 540);
    gradient.addColorStop(0, '#e49c4c'); gradient.addColorStop(0.5, '#447b79'); gradient.addColorStop(1, '#493a72');
    brush.fillStyle = gradient; brush.fillRect(0, 0, 960, 540);
    brush.fillStyle = '#ebcc93'; brush.beginPath(); brush.arc(710, 160, 90, 0, Math.PI * 2); brush.fill();
    brush.fillStyle = '#254d58'; brush.fillRect(0, 400, 960, 140);
    const image = canvas.toDataURL('image/png').split(',')[1];
    const stream = canvas.captureStream(5);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks: Blob[] = [];
    const stopped = new Promise<Blob>(resolve => {
      recorder.ondataavailable = event => chunks.push(event.data);
      recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    recorder.start();
    brush.fillRect(0, 400, 960, 140);
    await new Promise(resolve => setTimeout(resolve, 250));
    recorder.stop();
    const video = [...new Uint8Array(await (await stopped).arrayBuffer())];
    for (const track of stream.getTracks()) track.stop();
    return { image, video };
  });
}

/** Routes disappear at teardown. Permission queries are the only necessary non-GETs. */
export async function installMediaTabFixture(page: Page, context: BrowserContext, width: number, theme: 'light' | 'dark') {
  const media = await buildMedia(page);
  const policy: MediaTabPolicy = { home: 'video', blocked: [] };
  await page.setViewportSize({ width, height: width <= 700 ? 844 : 1000 });
  await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
  await page.addInitScript(theme => {
    localStorage.setItem('theme', theme);
    localStorage.setItem('chosen_language', 'fi');
    localStorage.setItem('navVisibleNarrow', 'false');
    localStorage.setItem('navVisibleWide', 'true');
  }, theme);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && ['/api/check-table-rights', '/api/check-table-rights-multi'].includes(url.pathname)) {
      await route.continue(); return;
    }
    if (request.method() !== 'GET') {
      policy.blocked.push(`${request.method()} ${url.pathname}`);
      await route.abort('blockedbyclient'); return;
    }
    if (url.pathname.includes('/d572.')) {
      const video = url.pathname.endsWith('.webm');
      await route.fulfill({ contentType: video ? 'video/webm' : 'image/png',
        body: video ? Buffer.from(media.video) : Buffer.from(media.image, 'base64') }); return;
    }
    if (url.pathname === '/api/user-visual-preference') {
      await route.fulfill({ json: { configured: true, revision: 1, theme_mode: theme } }); return;
    }
    if (url.pathname === '/api/front-page') {
      const profile = await context.request.get(new URL('/api/user-profile', url).href);
      expect(profile.ok()).toBe(true);
      const viewer = (await profile.json()).user_id;
      expect(Number.isInteger(viewer) && viewer > 1, 'Default signed-in storageState is required').toBe(true);
      const video = policy.home === 'video';
      await route.fulfill({ json: { site_name: 'WO102', viewer_id: viewer, blocks: [], show_blocks: false,
        hero: { title: { fi: 'Etusivu', en: 'Home' } },
        presentation: { ...homeDefinition.default, ...(policy.home === 'hidden' ? { light_opacity: 0, dark_opacity: 0 } : {}) },
        background: policy.home === 'none' ? null : { storage_key: `site_media/front_page/original/d572.${video ? 'webm' : 'png'}`,
          mime_type: video ? 'video/webm' : 'image/png', focal_x: 0.5, focal_y: 0.5 } } }); return;
    }
    if (url.pathname === '/api/auth-modes') {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), separate_front_page: true,
        display_index_html_at_startup: false, front_page_button_site_name: '' } }); return;
    }
    if (url.pathname === '/api/datasets') {
      const response = await route.fetch();
      const data = await response.json();
      const datasets = data.datasets.filter((entry: { dataset_name: string }) => [MEDIA_DATASET, PLAIN_DATASET].includes(entry.dataset_name));
      expect(datasets.map((entry: { dataset_name: string }) => entry.dataset_name).sort()).toEqual([MEDIA_DATASET, PLAIN_DATASET].sort());
      await route.fulfill({ response, json: { ...data, tab_order: null, datasets: datasets.map((entry: { dataset_name: string }) => ({
        ...entry, is_in_current_project: true, is_top_level_in_current_project: true,
        has_presentation_media: entry.dataset_name === MEDIA_DATASET,
      })) } }); return;
    }
    if (url.pathname === '/api/get-results' && [MEDIA_DATASET, PLAIN_DATASET].includes(url.searchParams.get('dataset') || '')) {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, dataset_presentation: { ...data.dataset_presentation,
        cover_image_path: '', cover_image_hidden: true, background_image_hidden: false,
        background_image_path: url.searchParams.get('dataset') === MEDIA_DATASET
          ? '/storage/104/dataset_media/background/original/d572.png' : '',
      } } }); return;
    }
    await route.continue();
  });
  return policy;
}

/** Work on main and the batch: these waits depend on the established view lifecycle, not the new flag. */
export async function openMediaTabView(page: Page, view: 'home_video' | 'dataset_media' | 'dataset_plain' | 'home') {
  const home = view === 'home_video' || view === 'home';
  const dataset = view === 'dataset_plain' ? PLAIN_DATASET : MEDIA_DATASET;
  await page.goto(home ? '/' : `/${dataset}?view=card`, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  if (home) {
    await expect(page.locator('#front_page_container')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.front-page-hero')).toBeVisible();
    if (view === 'home_video') await expect.poll(() => page.locator('.front-page-background video').first()
      .evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
  } else {
    const parts = page.locator(`#${dataset}_tab_parts_container`);
    await expect(parts).toBeVisible();
    await closeActiveFilterbarIfOpen(page);
    const content = parts.locator('.tab-content-area');
    if (view === 'dataset_media') {
      await expect(content).toHaveClass(/tab-content-area--has-dataset-background/);
      expect(await content.evaluate(element => element.style.getPropertyValue('--dataset-background-image'))).toContain('d572.png');
    } else {
      await expect(content).not.toHaveClass(/tab-content-area--has-dataset-background/);
    }
  }
}
