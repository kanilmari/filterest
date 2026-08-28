// Verifies semantic external link fields accept only absolute HTTP(S) URLs.
// Bridges card metadata and shared link validation without guessing from plain text.
// Exists so unsafe schemes cannot become clickable in any card renderer.

import { describe, expect, test } from "vitest";

import { resolveSafeExternalHttpUrl } from "./safe_external_http_url.js";

describe("resolveSafeExternalHttpUrl", () => {
    test.each([
        ["https://example.test/path", "https://example.test/path"],
        [" http://example.test ", "http://example.test"],
        ["javascript:alert(1)", ""],
        ["data:text/html,unsafe", ""],
        ["/internal/path", ""],
        ["example.test", ""],
        ["", ""],
    ])("maps %s to %s", (input, expected) => {
        expect(resolveSafeExternalHttpUrl(input)).toBe(expected);
    });
});
