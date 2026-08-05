// notification_triggers_helpers.js
// Pure formatting and payload-shaping helpers for notification trigger management.
// Accepts primitive trigger form values from notification_triggers.js and returns serializable payload pieces.
// Exists so the UI module keeps DOM plumbing local while the string and JSON logic stays easy to unit test.

/**
 * buildTriggerCondition:
 * Formats the source-table condition string from the selected column, operator, value, and input type.
 * Keeps the quoting rules in one place so the form code only has to supply raw values.
 * Returns an empty string when the condition is incomplete.
 *
 * @param {string|null|undefined} column
 * @param {string|null|undefined} operator
 * @param {string|boolean|null|undefined} value
 * @param {string|null|undefined} valueType
 * @returns {string}
 */
export function buildTriggerCondition(column, operator, value, valueType) {
    if (!column || !operator) return '';

    if (valueType === 'checkbox') {
        return `${column} ${operator} ${value}`;
    }

    if (valueType === 'text') {
        return `${column} ${operator} '${value}'`;
    }

    if (valueType === 'number') {
        return `${column} ${operator} ${value}`;
    }

    return `${column} ${operator} '${value}'`;
}

/**
 * serializeTriggerActionValues:
 * Normalizes action-value entries into the JSON string expected by the trigger endpoint.
 * Appends the required creation_spec marker without mutating the caller's object.
 * Returns a stable JSON string so the request payload stays identical to the current behavior.
 *
 * @param {Object<string, string>} actionValues
 * @returns {string}
 */
export function serializeTriggerActionValues(actionValues) {
    const normalizedActionValues = actionValues && typeof actionValues === 'object' && !Array.isArray(actionValues)
        ? actionValues
        : {};

    return JSON.stringify({
        ...normalizedActionValues,
        creation_spec: 'trigger',
    });
}

/**
 * buildTriggerFormData:
 * Combines the DOM-collected trigger form values into the request body for createTrigger.
 * Leaves the caller responsible for reading the DOM while centralizing the payload shape.
 * Returns the exact object the endpoint router expects.
 *
 * @param {Object} params
 * @param {string|null|undefined} params.sourceTable
 * @param {string|null|undefined} params.column
 * @param {string|null|undefined} params.operator
 * @param {string|boolean|null|undefined} params.value
 * @param {string|null|undefined} params.valueType
 * @param {string|null|undefined} params.targetTable
 * @param {Object<string, string>} params.actionValues
 * @returns {{ source_table: string|null, condition: string, target_table: string|null, action_values: string }}
 */
export function buildTriggerFormData({
    sourceTable,
    column,
    operator,
    value,
    valueType,
    targetTable,
    actionValues,
}) {
    return {
        source_table: sourceTable || null,
        condition: buildTriggerCondition(column, operator, value, valueType),
        target_table: targetTable || null,
        action_values: serializeTriggerActionValues(actionValues),
    };
}
