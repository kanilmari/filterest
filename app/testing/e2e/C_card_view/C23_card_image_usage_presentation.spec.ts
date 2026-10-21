// C23_card_image_usage_presentation.spec.ts
// Proves use-owned presentation and focal CSS in desktop and phone frames.
// Runs the real light-model adapter and styles in an offline browser fixture.
// No server, accounts, datasets or persistent test artifacts are created.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

const appRoot = path.resolve(__dirname, '../../..');
const origin = 'https://card-image-usage.invalid';
const cardRoot = '/frontend/core_components/table_views/card_view/';

for (const theme of ['light', 'dark']) {
  test(`C23 image use survives default refresh in ${theme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) throw Error(`Unexpected fixture origin: ${url.origin}`);
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
        <link rel="stylesheet" href="/frontend/styles/variables.css">
        <link rel="stylesheet" href="${cardRoot}card_image_presentation.css">
        <style>body { margin: 8px; background: var(--bg_color); color: var(--text_color); }
          .photo { position:relative; width:min(300px, 80vw); height:180px; overflow:hidden; }
          .photo > img { position:relative; width:100%; height:100%; object-position:center; }</style>
        <body class="${theme}-mode"><main class="card_image"></main></body>` });
      const file = path.resolve(appRoot, '.' + url.pathname);
      if (!file.startsWith(appRoot + path.sep)) throw Error('Fixture path escaped app');
      // JSON modules (`import … with { type: 'json' }`) need the JSON MIME type, as the server sends.
      const contentType = file.endsWith('.css') ? 'text/css' : file.endsWith('.json') ? 'application/json' : 'text/javascript';
      return route.fulfill({ contentType, body: await readFile(file) });
    });
    await page.goto(origin);
    await page.evaluate(async cardRoot => {
      const { prepareCardImagePresentation, applyCardImagePresentationSetting } = await import(cardRoot + 'card_image_presentation.js');
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 100;
      const context = canvas.getContext('2d')!; context.fillStyle = 'gray'; context.fillRect(0, 0, 400, 100);
      context.fillStyle = 'green'; context.fillRect(60, 60, 40, 40);
      for (const own of [true, false]) {
        const wrapper = document.createElement('div'); wrapper.className = 'photo';
        wrapper.dataset.cardImageRenderSlot = 'card_media'; wrapper.dataset.imagePresentationKind = 'raster';
        wrapper.id = own ? 'own' : 'inherited';
        const image = new Image(); image.alt = own ? 'Kuva tässä kortissa' : 'Inherited photograph';
        image.src = canvas.toDataURL('image/png'); wrapper.append(image); document.querySelector('main')!.append(wrapper);
        prepareCardImagePresentation(wrapper, image, own ? {
          cardImageOwn: { presentation: 'cover', focal: { x: 0.2, y: 0.8 } },
          cardImageUse: { dataset: 'fixture', row_id: 1, column: 'hero_image', relation_id: 9, link_row_id: 12 },
        } : {});
        await image.decode();
      }
      applyCardImagePresentationSetting('contain_blur');
    }, cardRoot);
    const own = page.locator('#own'), inherited = page.locator('#inherited');
    await expect(own).toHaveAttribute('data-card-image-presentation', 'cover');
    await expect(inherited).toHaveAttribute('data-card-image-presentation', 'contain_blur');
    await expect(own.locator('img')).toHaveCSS('object-fit', 'cover');
    await expect(own.locator('img')).toHaveCSS('object-position', '20% 80%');
    await expect(inherited.locator('img')).toHaveCSS('object-position', '50% 50%');
    for (const ratio of ['1 / 1', '4 / 3', '16 / 9']) {
      await own.evaluate((element, ratio) => { element.style.height = 'auto'; element.style.aspectRatio = ratio; }, ratio);
      await expect(own.locator('img')).toHaveCSS('object-position', '20% 80%');
      const box = await own.boundingBox();
      expect(box!.width).toBeGreaterThan(0); expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    await page.evaluate(async cardRoot => {
      const { applyCardImagePresentationSetting } = await import(cardRoot + 'card_image_presentation.js');
      applyCardImagePresentationSetting('contain');
    }, cardRoot);
    await expect(own).toHaveAttribute('data-card-image-presentation', 'cover');
    await expect(inherited).toHaveAttribute('data-card-image-presentation', 'contain');
    await expect(own.locator('img')).toHaveCount(1);
  });
}
