// card_picture_candidate_contract.test.js
// Proves that every picture in the shared examples is the card list's own answer.
// Between the card list's test for a picture in a named field (normalizeFallbackImageCandidate,
// reached through resolveFallbackCardImageValue) and the server's LikelyPictureValue in
// app/backend/core_components/dynamic_table_tools/dtt_card_picture/card_picture_fields.go,
// whose card_picture_candidate_contract_test.go reads the same examples.
// Exists because the article must show the picture the card shows: a change to this rule
// that the examples, and so the server, do not follow fails here instead.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { resolveFallbackCardImageValue } from "./card_element_builder_helpers.js";

const sharedPictureExamples = JSON.parse(readFileSync(
    resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../testing/shared_contracts/card_picture_candidate_examples.json"
    ),
    "utf8"
));

describe("the card list's test for a picture in a named field", () => {
    test("has shared examples to answer", () => {
        expect(sharedPictureExamples.examples.length).toBeGreaterThan(0);
    });

    // Only cached_image is offered and preferred, so the answer is the field's own and no
    // other key is scanned.
    test.each(sharedPictureExamples.examples.map(
        ({ why, input, picture }) => [why, input, picture]
    ))("gives the answer the server must give: %s", (_why, input, picture) => {
        expect(resolveFallbackCardImageValue({ cached_image: input }, ["cached_image"])).toBe(picture);
    });
});
