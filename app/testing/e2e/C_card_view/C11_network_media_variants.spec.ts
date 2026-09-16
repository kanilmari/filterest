/**
 * C11_network_media_variants.spec.ts
 *
 * Catalog/home/list display slots should request 300/1000/2160 media, not
 * raster originals, when a sized derivative exists or the URL was rewritten
 * onto one. Article/lightbox/download originals are out of scope here.
 * Exists so LNCD #890 (kuvat tulevat edelleen originalina vaikka variantin
 * pitäisi riittää) has a Playwright network assertion next to the #888 notes.
 */

import { expect, test } from "@playwright/test";
import { countStorageMediaRequests } from "../helpers/storage-media-requests";
import { navigateToDefaultDataset } from "../helpers/navigation";

test.describe("C11 — Catalog media prefers sized variants", () => {
  test("home/catalog storage fetches do not use raster originals first", async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-card",
      "Network original-vs-variant count only needs one viewport project.",
    );

    const urls: string[] = [];
    page.on("request", (request) => {
      urls.push(request.url());
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await navigateToDefaultDataset(page);
    await page.waitForLoadState("networkidle");

    const counts = countStorageMediaRequests(urls);
    expect(
      counts.rasterOriginalCount,
      `raster original media URLs: ${counts.originalUrls.join(", ")}`,
    ).toBe(0);
  });
});
