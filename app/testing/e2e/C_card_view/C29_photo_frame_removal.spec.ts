// C29_photo_frame_removal.spec.ts
// Proves card layout/article device frame removal and unchanged photo geometry.
// Connects disposable uploaded media, real card/article wrappers and protected frames.
// Compares each viewport with the unchanged main decoration on the same DOM.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { login, loadCredentials } from '../helpers/auth';
import { buildTempDatasetName, cleanupDatasetViaRequest, createTempDataset,
  openTempDataset, openTempDatasetRowArticle } from '../helpers/temp-dataset';
import { closeArticleToCardView, configureArticleFieldRoles, postJsonWithCsrf } from '../helpers/image-first-article';
import { confirmTestArtifact, registerTestArtifact } from '../helpers/test-artifact-run-registry';
import { readDatasetIdentityFromRequest } from '../helpers/test-artifact-dataset-identity-reader';

// Exact main rule, used to compare the decoration on the same decoded image.
// Keeping the baseline in the spec makes this proof independent of Git refs.
const mainPhotoFrame = `
.card_image > .wrapper:not(.service_catalog_logo_frame, .card_image_contrast_frame)::after,
.big_card_image > .wrapper:not(.service_catalog_logo_frame, .card_image_contrast_frame)::after,
.row_article_inline_media > .wrapper:not(.service_catalog_logo_frame, .card_image_contrast_frame)::after {
  content: "";
  position: absolute;
  z-index: 2;
  inset: 0;
  box-sizing: border-box;
  border: 1px solid var(--border_color);
  border-radius: inherit;
  pointer-events: none;
}`;

// The app's CSP refuses inline <style> (addStyleTag); a constructed sheet is CSSOM and allowed.
// Adopted sheets cascade after the document's own sheets, as the appended tag did.
async function addMainPhotoFrame(page: Page) {
  await page.evaluate(css => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    (window as unknown as { __wo47MainFrame?: CSSStyleSheet }).__wo47MainFrame = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, mainPhotoFrame);
  return {
    remove: () => page.evaluate(() => {
      const holder = window as unknown as { __wo47MainFrame?: CSSStyleSheet };
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== holder.__wo47MainFrame);
      delete holder.__wo47MainFrame;
    }),
  };
}

async function forceTheme(page: Page, theme: string) {
  // Local browser state only: never change the reserved account's saved theme.
  await page.evaluate(theme => {
    localStorage.setItem('theme', theme);
    document.body.classList.remove('light-mode', 'dark-mode');
    document.body.classList.add(`${theme}-mode`);
  }, theme);
  await expect(page.locator('body')).toHaveClass(new RegExp(`\\b${theme}-mode\\b`));
}

async function sample(wrapper: Locator) {
  return wrapper.evaluate(element => {
    const image = element.querySelector('img')!;
    const media = element.parentElement!;
    const card = element.closest('.card, .big_card_container')!;
    // Positions are relative to the media box, and the card keeps only its size: article content still
    // loading above a probe moves it inside the card between samples (d564c29b: only media/wrapper/image
    // top/bottom/y shifted, by ~1.1–1.4k px, sizes equal), which is not a frame change.
    const mediaBox = media.getBoundingClientRect();
    const geometry = (node: Element, positioned = true) => {
      const style = getComputedStyle(node), box = node.getBoundingClientRect();
      return { box: { width: box.width, height: box.height,
        ...(positioned ? { left: box.left - mediaBox.left, top: box.top - mediaBox.top } : {}) },
        radius: style.borderRadius, objectFit: style.objectFit, objectPosition: style.objectPosition };
    };
    const after = getComputedStyle(element, '::after');
    const mediaStyle = getComputedStyle(media);
    return {
      mediaContentWidth: media.getBoundingClientRect().width - parseFloat(mediaStyle.paddingLeft)
        - parseFloat(mediaStyle.paddingRight) - parseFloat(mediaStyle.borderLeftWidth) - parseFloat(mediaStyle.borderRightWidth),
      geometry: { card: geometry(card, false), media: geometry(media, false), wrapper: geometry(element), image: geometry(image) },
      frame: {
        widths: [after.borderTopWidth, after.borderRightWidth, after.borderBottomWidth, after.borderLeftWidth],
        styles: [after.borderTopStyle, after.borderRightStyle, after.borderBottomStyle, after.borderLeftStyle],
        colors: [after.borderTopColor, after.borderRightColor, after.borderBottomColor, after.borderLeftColor],
        radius: after.borderRadius, content: after.content,
      },
    };
  });
}

async function assertPhoto(page: Page, wrapper: Locator, width: number, label: string, info: TestInfo,
  layout: 'stacked' | 'wide' | 'fluid') {
  await expect(wrapper).toBeVisible();
  await expect.poll(() => wrapper.locator('img').first().evaluate((image: HTMLImageElement) =>
    image.complete && image.naturalWidth > 0)).toBe(true);
  await wrapper.scrollIntoViewIfNeeded();
  if (layout !== 'fluid') {
    await expect.poll(() => wrapper.evaluate(element =>
      getComputedStyle(element.closest('.card')!.querySelector('.card_body')!).flexDirection))
      .toBe(layout === 'stacked' ? 'column' : 'row');
    if (layout === 'wide') await expect(wrapper).toHaveCSS('width', '300px');
  }
  const current = await sample(wrapper);
  if (layout === 'stacked') {
    expect(current.geometry.wrapper.box.width, `${label}: fluid image width at ${width}`)
      .toBeCloseTo(Math.min(current.mediaContentWidth, page.viewportSize()!.height * 0.8), 1);
  } else if (layout === 'fluid') {
    expect(current.geometry.wrapper.box.width, `${label}: full content width at ${width}`)
      .toBeCloseTo(current.mediaContentWidth, 1);
  }
  const baselineStyle = await addMainPhotoFrame(page);
  try {
    const baseline = await sample(wrapper);
    expect(baseline.frame.widths).toEqual(['1px', '1px', '1px', '1px']);
    expect(baseline.frame.styles).toEqual(['solid', 'solid', 'solid', 'solid']);
    expect(baseline.frame.content).toBe('""');
    expect(baseline.frame.radius).toBe(baseline.geometry.wrapper.radius);
    const themeBorderColor = await wrapper.evaluate(element => {
      const probe = document.createElement('span');
      probe.style.borderColor = 'var(--border_color)';
      element.append(probe);
      const color = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return color;
    });
    expect(baseline.frame.colors).toEqual(Array(4).fill(themeBorderColor));
    if (layout === 'stacked' || (layout === 'fluid' && width <= 1200)) {
      // content:none suppresses the pseudo-element; its computed border can
      // still report 1px because the unchanged main declarations remain active.
      expect(current.frame.content, `${label}: no generated frame at ${width}`).toBe('none');
    } else {
      expect(current.frame, `${label}: main border, colour and radius at ${width}`).toEqual(baseline.frame);
    }
    expect(current.geometry, `${label}: boxes, fit and corners unchanged at ${width}`).toEqual(baseline.geometry);
    if ([390, 1200, 1201, 1440, 1550, 1600, 1920].includes(width)) {
      await info.attach(`${label}-${width}-main`, { body: await wrapper.screenshot(), contentType: 'image/png' });
    }
    await baselineStyle.remove();
    const after = await sample(wrapper);
    expect(after).toEqual(current);
    await info.attach(`${label}-${width}-geometry`, {
      body: Buffer.from(JSON.stringify({ width, layout, main: baseline, current: after }, null, 2)), contentType: 'application/json',
    });
    if ([390, 1200, 1201, 1440, 1550, 1600, 1920].includes(width)) {
      await info.attach(`${label}-${width}-current`, { body: await wrapper.screenshot(), contentType: 'image/png' });
    }
  } finally {
    await baselineStyle.remove();
  }
}

async function addProtectedFrameProbes(photo: Locator) {
  // The modern article nests its wrapper in inline media. Also exercise the
  // direct big-card selector retained for other callers, with the same media DOM.
  await photo.evaluate(element => {
    const content = element.closest('.row_article_content, .card_image_content')!;
    const probes = document.createElement('div');
    probes.dataset.wo47Probes = '';
    const direct = document.createElement('div');
    direct.className = 'big_card_image';
    direct.dataset.wo47Direct = '';
    direct.append(element.cloneNode(true));
    probes.append(direct);
    for (const surface of ['card_image', 'big_card_image', 'row_article_inline_media']) {
      for (const frame of ['service_catalog_logo_frame', 'card_image_contrast_frame', 'record_svg_image_frame']) {
        const host = document.createElement('div');
        host.className = surface;
        const wrapper = element.cloneNode(true) as HTMLElement;
        wrapper.classList.add(frame);
        wrapper.dataset.wo47Protected = `${surface}/${frame}`;
        host.append(wrapper);
        // Inline media receives the same big-card ancestor as the real article.
        const parent = document.createElement('div');
        parent.className = 'big_card_image';
        parent.append(host);
        probes.append(parent);
      }
    }
    content.append(probes);
  });
}

async function assertProtectedFrames(page: Page) {
  const protectedFrames = page.locator('[data-wo47-protected]');
  await expect(protectedFrames).toHaveCount(9);
  const protectedSample = () => protectedFrames.evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return { borders: [style.borderTop, style.borderRight, style.borderBottom, style.borderLeft],
      radius: style.borderRadius };
  }));
  const protectedCurrent = await protectedSample();
  for (const frame of await protectedFrames.all()) {
    await expect(frame).toHaveCSS('border-top-width', '1px');
    await expect(frame).toHaveCSS('border-top-style', 'solid');
    await expect(frame).toHaveCSS('border-right-width', '1px');
    await expect(frame).toHaveCSS('border-bottom-width', '1px');
    await expect(frame).toHaveCSS('border-left-width', '1px');
  }
  const protectedBaselineStyle = await addMainPhotoFrame(page);
  try {
    expect(await protectedSample(), 'logo/contrast/SVG borders and radii match main at every width')
      .toEqual(protectedCurrent);
  } finally {
    await protectedBaselineStyle.remove();
  }
  await page.locator('[data-wo47-probes]').evaluate(element => element.remove());
}

for (const theme of ['light', 'dark']) {
  for (const language of ['fi', 'en']) {
    test(`WO47 card/article frames at 390/768/1024/1200/1201/1366/1440/1550/1600/1920 and narrow container, ${theme}, ${language}`, async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-card', 'This proof sets every boundary viewport explicitly.');
      test.setTimeout(500_000);
      await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light', reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await login(page, loadCredentials());
      await page.evaluate(language => localStorage.setItem('chosen_language', language), language);
      const dataset = buildTempDatasetName('e2e_wo47_photos');
      const images = `${dataset}_assets`;
      let created = false;
      let imagesUID: number | null = null;
      try {
        // The shared current-main helper configures all three field roles.
        await createTempDataset(page, { datasetName: dataset,
          columns: { id: 'SERIAL', title: 'TEXT', description: 'TEXT', detail_note: 'TEXT' },
          seedRows: [{ title: JSON.stringify({ fi: 'Valokuva ilman kehystä', en: 'Photo without a frame' }),
            description: JSON.stringify({ fi: 'Kuvan kulmat ja koko säilyvät.', en: 'Photo corners and size stay the same.' }),
            detail_note: JSON.stringify({ fi: 'Kuvan tiedot', en: 'Photo details' }) }] });
        created = true;
        await configureArticleFieldRoles(page, dataset);
        registerTestArtifact('dataset', images);
        const enabled = await postJsonWithCsrf(page, '/api/asset-linking/images/enable', {
          parent_table: dataset, max_file_size_mb: 10,
        });
        expect(enabled.status, enabled.body).toBe(201);
        expect(JSON.parse(enabled.body).child_table).toBe(images);
        const identity = await readDatasetIdentityFromRequest(page.request, images);
        expect(identity).not.toBeNull();
        imagesUID = identity!.tableUID;
        confirmTestArtifact('dataset', images, imagesUID);
        await openTempDatasetRowArticle(page, dataset, 1);
        // Use an opaque landscape raster: PNGs with alpha select the protected
        // contrast presentation instead of the ordinary photo being tested.
        const imageBase64 = await page.evaluate(() => {
          const canvas = document.createElement('canvas');
          canvas.width = 480; canvas.height = 320;
          const context = canvas.getContext('2d')!;
          context.fillStyle = '#367c8f'; context.fillRect(0, 0, 480, 320);
          context.fillStyle = '#d6b879'; context.fillRect(0, 200, 480, 120);
          return canvas.toDataURL('image/jpeg').split(',')[1];
        });
        await page.locator('.big_card_image_gallery input[type="file"]').first().setInputFiles({
          name: 'wo47-photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(imageBase64, 'base64'),
        });
        await expect(page.locator('[data-testid="big-card-image-thumb-0"] img')).toHaveAttribute('src', /\/storage\//);
        await closeArticleToCardView(page);

        const cases = [390, 768, 1024, 1200, 1201, 1366, 1440, 1550, 1600, 1920]
          .map(width => ({ width, narrowContainer: false }));
        cases.push({ width: 1600, narrowContainer: true });
        for (const { width, narrowContainer } of cases) {
          await page.setViewportSize({ width, height: width === 768 ? 1024 : 1080 });
          await openTempDataset(page, dataset, 'card');
          await forceTheme(page, theme);
          const card = page.locator(`#${dataset}_card_view_container .card[data-id="1"]:visible`);
          await expect(card).toContainText(language === 'fi' ? 'Valokuva ilman kehystä' : 'Photo without a frame');
          // CSSOM only: the CSP refuses style attributes written with setAttribute.
          const originalListStyle = await card.evaluate((element, narrow) => {
            const list = element.closest('.card_container') as HTMLElement;
            const original = ['max-width', 'box-sizing'].map(prop =>
              [prop, list.style.getPropertyValue(prop), list.style.getPropertyPriority(prop)]);
            if (narrow) {
              // Constrain the real named query container, without changing viewport rules.
              list.style.setProperty('max-width', '1060px', 'important');
              list.style.setProperty('box-sizing', 'content-box', 'important');
            }
            return original;
          }, narrowContainer);
          const layout = width <= 1550 || narrowContainer ? 'stacked' : 'wide';
          const containerWidth = await card.evaluate(element => {
            const list = element.closest('.card_container')!;
            const style = getComputedStyle(list);
            return list.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          });
          if (narrowContainer) {
            expect(containerWidth, '1600px exercises container stacking independently of the viewport').toBeLessThanOrEqual(1060);
          } else if (layout === 'wide') {
            expect(containerWidth, `${width}px default layout has room for a normal 300px image`).toBeGreaterThan(1060);
          }
          try {
            await assertPhoto(page, card.locator('.card_image > .wrapper'), width,
              narrowContainer ? 'card-container1060' : 'card', info, layout);
            if (narrowContainer) {
              await addProtectedFrameProbes(card.locator('.card_image > .wrapper'));
              await assertProtectedFrames(page);
            }
          } finally {
            await card.evaluate((element, original) => {
              const list = element.closest('.card_container') as HTMLElement;
              for (const [prop, value, priority] of original) {
                if (value) list.style.setProperty(prop, value, priority);
                else list.style.removeProperty(prop);
              }
            }, originalListStyle);
          }
          if (narrowContainer) continue;
          await openTempDatasetRowArticle(page, dataset, 1);
          await forceTheme(page, theme);
          const inline = page.locator('.active_row_article .row_article_inline_media > .wrapper');
          await assertPhoto(page, inline, width, 'inline-article', info, 'fluid');
          await addProtectedFrameProbes(inline);
          await assertPhoto(page, page.locator('[data-wo47-direct] > .wrapper'), width, 'big-card', info, 'fluid');
          await assertProtectedFrames(page);
          // The compact phone bar has no shared top-bar article close (d564c29 at 390 px).
          // Every assertion for this width is done, so close from the desktop bar at 1920.
          await page.setViewportSize({ width: 1920, height: 1080 });
          await closeArticleToCardView(page);
        }
      } finally {
        // Parent cleanup preserves managed-child attribution; both names/UIDs
        // are verified absent even after a failed browser assertion.
        if (imagesUID !== null) await readDatasetIdentityFromRequest(page.request, images, imagesUID);
        if (created) await cleanupDatasetViaRequest(page.request, dataset);
        if (imagesUID !== null) await cleanupDatasetViaRequest(page.request, images);
      }
    });
  }
}
