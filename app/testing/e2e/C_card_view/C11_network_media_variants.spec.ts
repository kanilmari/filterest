/**
 * C11_network_media_variants.spec.ts
 *
 * Catalog/home/list display slots should request 300/1000/2160 media, not
 * raster originals, when a sized derivative exists or the URL was rewritten
 * onto one. Article/lightbox/download originals are out of scope here.
 * Uses an uploaded raster in a registered temporary dataset, independent of
 * the installation's default tab and its changing content.
 * Exists so LNCD #890 (kuvat tulevat edelleen originalina vaikka variantin
 * pitäisi riittää) has a Playwright network assertion next to the #888 notes.
 */

import { expect, test, type Request } from "@playwright/test";
import { classifyStorageMediaPath, countStorageMediaRequests } from "../helpers/storage-media-requests";
import {
  buildTempDatasetName,
  cleanupDatasetViaRequest,
  createTempDataset,
  openTempDataset,
  openTempDatasetRowArticle,
} from "../helpers/temp-dataset";
import { postJsonWithCsrf } from "../helpers/image-first-article";
import { confirmTestArtifact, registerTestArtifact } from "../helpers/test-artifact-run-registry";
import { readDatasetIdentityFromRequest } from "../helpers/test-artifact-dataset-identity-reader";
import { waitForVisiblePageReady } from "../../../server_tools/lib/browser_view_readiness.mjs";

test.describe("C11 — Catalog media prefers sized variants", () => {
  test("home/catalog storage fetches do not use raster originals first", async ({ page, browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-card",
      "Network original-vs-variant count only needs one viewport project.",
    );

    test.setTimeout(70_000);
    const datasetName = buildTempDatasetName("e2e_catalog_media");
    const imageDatasetName = `${datasetName}_assets`;
    // Article setup may request originals. Keep it in a separate context so
    // the measured catalogue starts with an empty media cache and no article.
    const setupContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      ignoreHTTPSErrors: testInfo.project.use.ignoreHTTPSErrors,
      extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
      viewport: page.viewportSize(),
      storageState: await page.context().storageState(),
    });
    let datasetCreated = false;
    let imageDatasetUID: number | null = null;

    try {
      const setupPage = await setupContext.newPage();
      await setupPage.goto("/", { waitUntil: "domcontentloaded" });
      await createTempDataset(setupPage, {
        datasetName,
        columns: { id: "SERIAL", title: "TEXT" },
        seedRows: [{ title: "Catalogue media fixture" }],
      });
      datasetCreated = true;
      // Record the canonical child before enabling images, including the crash
      // window before the response and its stable identity can be confirmed.
      registerTestArtifact("dataset", imageDatasetName);
      const enableImages = await postJsonWithCsrf(setupPage, "/api/asset-linking/images/enable", {
        parent_table: datasetName,
        max_file_size_mb: 10,
      });
      expect(enableImages.status, enableImages.body).toBe(201);
      const enabled = JSON.parse(enableImages.body) as { child_table?: unknown };
      expect(enabled.child_table).toBe(imageDatasetName);
      const imageIdentity = await readDatasetIdentityFromRequest(setupPage.request, imageDatasetName);
      expect(imageIdentity, "Enabled image child has a stable dataset identity").not.toBeNull();
      imageDatasetUID = imageIdentity!.tableUID;
      confirmTestArtifact("dataset", enabled.child_table as string, imageDatasetUID);
      await openTempDatasetRowArticle(setupPage, datasetName, 1);
      await setupPage.locator('.big_card_image_gallery input[type="file"]').first().setInputFiles({
        name: "catalogue-media.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      const uploadedImage = setupPage.locator('[data-testid="big-card-image-thumb-0"] img').first();
      await expect(uploadedImage).toHaveAttribute("src", /\/storage\//, { timeout: 15_000 });
      const uploadedPath = new URL((await uploadedImage.getAttribute("src"))!, setupPage.url()).pathname;
      expect(classifyStorageMediaPath(uploadedPath), "Uploaded fixture has a canonical storage media URL").not.toBe("other");
      const fixtureMediaPrefix = uploadedPath.replace(/\/(?:original|300|1000|2160)\/[^/]+$/, "/");

      const urls: string[] = [];
      const pendingMedia = new Set<Request>();
      page.on("request", (request) => {
        // Only the fixture's media proves this catalogue contract; landing-page
        // backgrounds or pictures in another dataset cannot satisfy the guard.
        if (!new URL(request.url()).pathname.startsWith(fixtureMediaPrefix)) return;
        urls.push(request.url());
        if (classifyStorageMediaPath(request.url()) !== "other") pendingMedia.add(request);
      });
      page.on("requestfinished", request => pendingMedia.delete(request));
      page.on("requestfailed", request => pendingMedia.delete(request));

      await openTempDataset(page, datasetName, "card");
      const card = page.locator(`#${datasetName}_card_view_container .card[data-id="1"]:visible`);
      await expect(card).toBeVisible();
      // Do not pass vacuously before this card has requested its uploaded raster.
      await expect.poll(() => countStorageMediaRequests(urls).variantCount, {
        message: `C11: no sized catalogue media request for the uploaded picture in ${datasetName} (${fixtureMediaPrefix})`,
      }).toBeGreaterThan(0);
      await waitForVisiblePageReady(page);
      await expect.poll(() => pendingMedia.size, { message: "Started storage media requests finish" }).toBe(0);
      const cardImage = card.locator(".card_image img").first();
      await expect(cardImage).toBeVisible();
      await expect.poll(() => cardImage.evaluate((image: HTMLImageElement) => image.naturalWidth), {
        message: "C11: uploaded catalogue picture decodes successfully",
      }).toBeGreaterThan(0);

      const counts = countStorageMediaRequests(urls);
      expect(
        counts.rasterOriginalCount,
        `raster original media URLs: ${counts.originalUrls.join(", ")}`,
      ).toBe(0);
    } finally {
      try {
        // Check the recorded child before the parent can cascade into it. Then
        // prove name/UID absence after the parent drop, removing a recorded
        // orphan through the same helper if managed-child deletion missed it.
        if (imageDatasetUID !== null) {
          await readDatasetIdentityFromRequest(page.request, imageDatasetName, imageDatasetUID);
        }
        if (datasetCreated) await cleanupDatasetViaRequest(page.request, datasetName);
        if (imageDatasetUID !== null) await cleanupDatasetViaRequest(page.request, imageDatasetName);
      } finally {
        await setupContext.close();
      }
    }
  });
});
