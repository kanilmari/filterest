// number_input_step_resolver.js
// Resolves the HTML step contract for PostgreSQL number columns.
// Bridges precise database type descriptions with add-row and edit controls.
// Exists so every numeric editor accepts exactly the precision the schema permits.

const INTEGER_TYPES = new Set([
    "smallint",
    "integer",
    "bigint",
    "int",
    "int2",
    "int4",
    "int8",
    "smallserial",
    "serial",
    "bigserial",
]);

const APPROXIMATE_NUMBER_TYPES = new Set([
    "real",
    "double precision",
    "float4",
    "float8",
]);

const DECIMAL_TYPE_PATTERN = /^(?:numeric|decimal)(?:\s*\(([^)]*)\))?$/i;

function normalizeDatabaseType(dataType) {
    return String(dataType || "").trim().toLowerCase();
}

function decimalStepForScale(scale) {
    if (scale === 0) return "1";
    if (scale > 0) {
        return scale <= 100
            ? `0.${"0".repeat(scale - 1)}1`
            : `1e-${scale}`;
    }

    const wholeNumberZeroCount = Math.abs(scale);
    return wholeNumberZeroCount <= 100
        ? `1${"0".repeat(wholeNumberZeroCount)}`
        : `1e${wholeNumberZeroCount}`;
}

/**
 * Returns the mandatory step for a database-backed number input.
 * Bare or unreadable decimals use `any`; nonnumeric types return null.
 *
 * @param {string} dataType
 * @returns {string|null}
 */
export function resolveNumberInputStep(dataType) {
    const normalizedType = normalizeDatabaseType(dataType);
    if (INTEGER_TYPES.has(normalizedType)) return "1";
    if (APPROXIMATE_NUMBER_TYPES.has(normalizedType)) return "any";

    const decimalMatch = normalizedType.match(DECIMAL_TYPE_PATTERN);
    if (!decimalMatch) return null;

    const typeArguments = decimalMatch[1];
    if (typeArguments === undefined || typeArguments.trim() === "") {
        return "any";
    }

    const argumentParts = typeArguments.split(",").map((part) => part.trim());
    if (argumentParts.length === 1) {
        return /^\d+$/.test(argumentParts[0]) ? "1" : "any";
    }
    if (argumentParts.length !== 2 || !/^-?\d+$/.test(argumentParts[1])) {
        return "any";
    }

    const scale = Number(argumentParts[1]);
    return Number.isSafeInteger(scale) ? decimalStepForScale(scale) : "any";
}

/**
 * Applies the shared step contract when the element represents a database number.
 *
 * @param {HTMLInputElement} input
 * @param {string} dataType
 * @returns {boolean} whether the data type is numeric
 */
export function applyNumberInputStep(input, dataType) {
    const step = resolveNumberInputStep(dataType);
    if (step === null) return false;
    input.step = step;
    return true;
}
