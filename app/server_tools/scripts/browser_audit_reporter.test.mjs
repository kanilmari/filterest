// browser_audit_reporter.test.mjs
// Verifies that browser reports distinguish decoded images from styled empty boxes.
// Bridges the live DOM snapshot with the blocking audit finding used during review.
// Exists so a storage HTTP 404 cannot pass merely because an img has dimensions in CSS.
import assert from "node:assert/strict";
import test from "node:test";

import { buildFindings } from "./browser_audit_reporter.mjs";

function snapshotWithImage(image) {
    return {
        title: "Filterest",
        lang: "en",
        headings: [{ level: 1, text: "Documentation" }],
        images: [image],
        forms: [],
        links: [],
    };
}

test("a CSS-sized image with no decoded pixels is a blocking DOM finding", () => {
    const findings = buildFindings({
        domSnapshot: snapshotWithImage({
            src: "https://localhost:8100/storage/9/1/1000/9_1_1.png",
            alt: "Picture missing",
            role: "",
            complete: true,
            naturalWidth: 0,
            naturalHeight: 0,
            renderedWidth: 300,
            renderedHeight: 300,
        }),
    });

    assert.equal(findings.length, 1);
    assert.equal(findings[0].priority, "P1");
    assert.match(findings[0].summary, /failed to load or decode/);
});

test("a decoded content image produces no broken-image finding", () => {
    const findings = buildFindings({
        domSnapshot: snapshotWithImage({
            src: "https://localhost:8100/storage/9/1/1000/9_1_1.png",
            alt: "Browse, filter and manage data",
            role: "",
            complete: true,
            naturalWidth: 1000,
            naturalHeight: 1000,
            renderedWidth: 300,
            renderedHeight: 300,
        }),
    });

    assert.deepEqual(findings, []);
});

test("an incomplete lazy content image produces no broken-image finding", () => {
    const findings = buildFindings({
        domSnapshot: snapshotWithImage({
            src: "https://localhost:8100/storage/9/2/1000/9_2_1.png",
            alt: "First dataset",
            role: "",
            complete: false,
            naturalWidth: 0,
            naturalHeight: 0,
            renderedWidth: 300,
            renderedHeight: 300,
        }),
    });

    assert.deepEqual(findings, []);
});
