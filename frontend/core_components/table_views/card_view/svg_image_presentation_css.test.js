// svg_image_presentation_css.test.js
// Verifies one container-relative logo ratio drives every SVG presentation size.
// Bridges the shared DOM classes with card, thumbnail, and image-first CSS consumers.
// Exists so individual views cannot drift back to unrelated mark/title proportions.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const directory = path.dirname(fileURLToPath(import.meta.url));

describe("shared SVG image presentation CSS", () => {
    test("derives the mark and label proportions from the presentation container", () => {
        const css = fs.readFileSync(
            path.join(directory, "svg_image_presentation.css"),
            "utf8",
        );

        expect(css).toMatch(
            /\.record_image_logo_presentation__mark\s*\{[^}]*width:\s*80% !important;[^}]*height:\s*80% !important;/s,
        );
        expect(css).toMatch(
            /\.record_image_logo_presentation__label\s*\{[^}]*100cqi\s*\/\s*var\(--record-image-logo-label-length[^}]*12cqi/s,
        );
        expect(css).toMatch(
            /\.record_image_logo_presentation\s*\{[^}]*clamp\(0\.3rem, 6cqi, 6rem\)[^}]*clamp\(0\.35rem, 7cqi, 7rem\)/s,
        );
        expect(css).not.toMatch(/big_card_thumbnail[^}]*record-image-logo-label-length/s);
        expect(css).not.toMatch(/row_article_image_first_media[^}]*record-image-logo-label-length/s);
    });
});
