// @vitest-environment jsdom
// ui_config.test.js
// Verifies shared frontend layout breakpoints for viewport and container card modes.
// Bridges responsive CSS expectations and JS media-folder decisions.
// Exists to prevent the card/filterbar threshold split from drifting silently.

import { describe, expect, test } from "vitest";

import {
    isCardStackViewport,
    predictCardImageCssWidth,
    resolveCardMediaFolder,
    resolveCardMediaFolderForImageWidth,
} from "./ui_config.js";

describe("ui_config card stack breakpoints", () => {
    test("forces stacked card behavior at the viewport breakpoint", () => {
        expect(isCardStackViewport(1550)).toBe(true);
        expect(isCardStackViewport(1551)).toBe(false);
        expect(resolveCardMediaFolder(1550, { basis: "viewport" })).toBe("1000");
        expect(resolveCardMediaFolder(1551, { basis: "viewport" })).toBe("300");
    });

    test("keeps the container threshold separate for measured card widths", () => {
        expect(resolveCardMediaFolder(1060)).toBe("1000");
        expect(resolveCardMediaFolder(1061)).toBe("300");
    });
});

describe("ui_config card image media folder", () => {
    test("uses the compact folder while the image needs at most 360 device pixels", () => {
        expect(resolveCardMediaFolderForImageWidth(300, 1)).toBe("300");
        expect(resolveCardMediaFolderForImageWidth(360, 1)).toBe("300");
        expect(resolveCardMediaFolderForImageWidth(361, 1)).toBe("1000");
        expect(resolveCardMediaFolderForImageWidth(300, 2)).toBe("1000");
        expect(resolveCardMediaFolderForImageWidth(140, 2)).toBe("300");
    });

    test("predicts stacked images from viewport height as well as width", () => {
        // A short window (for example with developer tools open) draws a small stacked image.
        expect(predictCardImageCssWidth({ viewportWidth: 1500, viewportHeight: 400 })).toBe(320);
        expect(predictCardImageCssWidth({ viewportWidth: 390, viewportHeight: 844 })).toBe(390);
        expect(predictCardImageCssWidth({ viewportWidth: 1400, viewportHeight: 2000 })).toBe(1000);
    });

    test("uses the fixed wide-card image sizes above the stack breakpoint", () => {
        expect(predictCardImageCssWidth({ viewportWidth: 1920, viewportHeight: 1080 })).toBe(300);
        expect(predictCardImageCssWidth({ large: false, viewportWidth: 1920, viewportHeight: 1080 })).toBe(140);
    });
});
