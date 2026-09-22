// foreign_keys_translation_fallbacks.test.js
// Verifies the foreign-keys admin page's bootstrap copy.
// Bridges the fallback table with the page translator's four languages.
// Exists so the page never falls back to a key name before its keys are seeded.

import { expect, test } from "vitest";
import { FOREIGN_KEYS_TRANSLATION_FALLBACKS } from "./foreign_keys_translation_fallbacks.js";

test("every foreign-keys page text has Finnish, English, Chinese and Cantonese copy", () => {
    for (const [key, copy] of Object.entries(FOREIGN_KEYS_TRANSLATION_FALLBACKS)) {
        for (const language of ["fi", "en", "ch", "yue"]) {
            expect(String(copy[language] || "").trim(), `${key}.${language}`).not.toBe("");
        }
    }
});
