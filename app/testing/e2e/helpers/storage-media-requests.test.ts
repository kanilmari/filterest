/**
 * storage-media-requests.test.ts
 * Verifies original vs sized-variant counting for catalog/home network assertions.
 * Bridges captured request URLs and the 300/1000/2160/original storage folders.
 * Exists so LNCD #890 can assert that display slots do not fetch raster originals first.
 */

import { describe, expect, it } from "vitest";

import { classifyStorageMediaPath, countStorageMediaRequests } from "./storage-media-requests";

describe("countStorageMediaRequests", () => {
  it("counts sized variants separately from original fallbacks", () => {
    const counts = countStorageMediaRequests([
      "https://localhost:8082/storage/104/dataset_media/background/2160/background.webp",
      "https://localhost:8082/storage/104/dataset_media/cover/1000/cover.webp",
      "https://localhost:8082/storage/104/392/1000/firefox.svg",
      "https://localhost:8082/storage/9/1/original/9_1_1.png",
      "https://localhost:8082/storage/104/7/original/logo.svg",
      "https://localhost:8082/api/datasets",
      "/storage/project_logo.png",
    ]);

    expect(counts.variantCount).toBe(3);
    expect(counts.originalCount).toBe(2);
    expect(counts.rasterOriginalCount).toBe(1);
    expect(counts.originalUrls).toEqual([
      "/storage/9/1/original/9_1_1.png",
      "/storage/104/7/original/logo.svg",
    ]);
  });

  it("classifies missing or unknown folders as other", () => {
    expect(classifyStorageMediaPath("/storage/104/7/640/file.png")).toBe("other");
    expect(classifyStorageMediaPath("/frontend/main.js")).toBe("other");
  });
});
