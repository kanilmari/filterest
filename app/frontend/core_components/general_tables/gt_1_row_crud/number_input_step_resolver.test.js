/* @vitest-environment jsdom */

// Verifies PostgreSQL decimal scale becomes browser-valid number input steps.
// Bridges formatted database type strings with native HTML constraint validation.
// Prevents browsers from silently reverting decimal inputs to whole-number steps.

import { describe, expect, test } from "vitest";
import {
    applyNumberInputStep,
    resolveNumberInputStep,
} from "./number_input_step_resolver.js";

describe("resolveNumberInputStep", () => {
    test("accepts a scale-two price such as 22.39", () => {
        const input = document.createElement("input");
        input.type = "number";
        applyNumberInputStep(input, "numeric(18,2)");
        input.value = "22.39";

        expect(input.step).toBe("0.01");
        expect(input.validity.stepMismatch).toBe(false);
    });

    test("lets a scaleless numeric accept arbitrary decimals", () => {
        const input = document.createElement("input");
        input.type = "number";
        applyNumberInputStep(input, "numeric");
        input.value = "22.39123456789";

        expect(input.step).toBe("any");
        expect(input.validity.stepMismatch).toBe(false);
        expect(resolveNumberInputStep("double precision")).toBe("any");
    });

    test("keeps integer inputs on whole-number steps", () => {
        expect(resolveNumberInputStep("integer")).toBe("1");
        expect(resolveNumberInputStep("bigint")).toBe("1");
        expect(resolveNumberInputStep("numeric(18,0)")).toBe("1");
    });

    test("falls back safely for unreadable decimal scales", () => {
        expect(resolveNumberInputStep("numeric(18,unknown)")).toBe("any");
        expect(resolveNumberInputStep("text")).toBeNull();
    });
});
