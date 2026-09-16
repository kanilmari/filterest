/**
 * storage-media-requests.ts
 * Classifies /storage media URLs as sized variants or original fallbacks.
 * Bridges Playwright request logs and the 300/1000/2160/original folder contract.
 * Exists so catalog/home network assertions can count original vs variant fetches.
 */

const STORAGE_MEDIA_RE =
  /\/storage\/(?:media\/[0-9a-f-]+|\d+\/(?:dataset_media\/(?:cover|background)|\d+))\/(original|300|1000|2160)\/([^/?#]+)/i;
const VECTOR_OR_ANIMATED_RE = /\.(svg|gif)$/i;

export type StorageMediaRequestCounts = {
  originalCount: number;
  variantCount: number;
  rasterOriginalCount: number;
  originalUrls: string[];
  variantUrls: string[];
};

function pathnameOf(rawUrl: string): string {
  try {
    return new URL(rawUrl, "https://example.test").pathname;
  } catch {
    return String(rawUrl || "");
  }
}

export function classifyStorageMediaPath(rawUrl: string): "original" | "variant" | "other" {
  const match = pathnameOf(rawUrl).match(STORAGE_MEDIA_RE);
  if (!match) {
    return "other";
  }
  return match[1].toLowerCase() === "original" ? "original" : "variant";
}

export function countStorageMediaRequests(urls: Iterable<string>): StorageMediaRequestCounts {
  const originalUrls: string[] = [];
  const variantUrls: string[] = [];
  let rasterOriginalCount = 0;

  for (const rawUrl of urls) {
    const pathname = pathnameOf(rawUrl);
    const match = pathname.match(STORAGE_MEDIA_RE);
    if (!match) {
      continue;
    }
    if (match[1].toLowerCase() === "original") {
      originalUrls.push(pathname);
      if (!VECTOR_OR_ANIMATED_RE.test(match[2])) {
        rasterOriginalCount += 1;
      }
    } else {
      variantUrls.push(pathname);
    }
  }

  return {
    originalCount: originalUrls.length,
    variantCount: variantUrls.length,
    rasterOriginalCount,
    originalUrls,
    variantUrls,
  };
}
