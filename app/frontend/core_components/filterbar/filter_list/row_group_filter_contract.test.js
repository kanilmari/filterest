// row_group_filter_contract.test.js
// Proves the browser uses the same canonical safe-heading contract as the server.
// Connects shared examples to parse/serialize state without a network or dataset.
// Prevents byte/token limits, duplicate IDs and numeric boundaries from drifting.
import { expect, test } from "vitest";
import examples from "../../../../testing/shared_contracts/row_group_mode_examples.json";
import { parseRowGroupModes, serializeRowGroupModes } from "./row_group_filter_contract.js";

test.each(examples)("mode contract: $raw", ({ raw, valid, canonical }) => {
    const modes = parseRowGroupModes(raw);
    expect(modes !== null).toBe(valid);
    if (valid) expect(serializeRowGroupModes(modes)).toBe(canonical);
});

test("bounds decoded UTF-8 bytes and tokens before normalization", () => {
    const tokens = Array.from({ length: 20 }, (_, id) => `${id}:all`);
    expect(parseRowGroupModes(tokens.join(","))).not.toBeNull();
    expect(parseRowGroupModes([...tokens, "20:all"].join(","))).toBeNull();
    expect(parseRowGroupModes(" ".repeat(513))).toBeNull();
    expect(parseRowGroupModes("\u2000".repeat(171))).toBeNull();
    expect(serializeRowGroupModes({ 9: "all", 2: "all", 1: "any", "01": "all" })).toBe("2:all,9:all");
});
