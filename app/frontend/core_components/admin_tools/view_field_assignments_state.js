// view_field_assignments_state.js
// Normalizes field, group-target, and assignment state for the dedicated admin page.
// Bridges view-field-set API responses and deterministic save/readback decisions.
// Exists so targeting and mixed-assignment safeguards stay testable without DOM state.

function positiveInteger(value) {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

export function normalizeGroupAssignments(assignments) {
    const groupsByID = new Map();
    for (const assignment of Array.isArray(assignments) ? assignments : []) {
        const groupID = positiveInteger(assignment?.group_id);
        if (!groupID || groupsByID.has(groupID)) continue;
        const fieldSetID = positiveInteger(assignment?.field_set_id);
        groupsByID.set(groupID, {
            group_id: groupID,
            group_name: String(assignment?.group_name || `#${groupID}`),
            field_set_id: fieldSetID,
            group_priority: Number.isSafeInteger(Number(assignment?.group_priority))
                ? Number(assignment.group_priority)
                : 0,
        });
    }
    return Array.from(groupsByID.values());
}

export function normalizeSelectedGroupIDs(selectedValues, groups) {
    const allowedIDs = new Set(normalizeGroupAssignments(groups).map((group) => group.group_id));
    return Array.from(new Set(
        (Array.isArray(selectedValues) ? selectedValues : [])
            .map(positiveInteger)
            .filter((groupID) => groupID && allowedIDs.has(groupID))
    )).sort((left, right) => left - right);
}

/**
 * Converts the selected real groups into the API's exact site-or-groups target.
 * All real groups mean the site layer; a proper subset remains explicit group IDs.
 * This prevents an empty or partial selection from accidentally widening to the site.
 */
export function resolveAssignmentTarget(selectedValues, assignments) {
    const groups = normalizeGroupAssignments(assignments);
    const selectedGroupIDs = normalizeSelectedGroupIDs(selectedValues, groups);
    const allGroupsSelected = groups.length > 0 && selectedGroupIDs.length === groups.length;
    return {
        mutationAllowed: selectedGroupIDs.length > 0,
        targetScope: allGroupsSelected ? "site" : "groups",
        targetGroupIDs: allGroupsSelected ? [] : selectedGroupIDs,
        selectedGroupIDs,
    };
}

export function normalizeAvailableFields(availableColumns) {
    const fieldsByName = new Map();
    for (const rawField of Array.isArray(availableColumns) ? availableColumns : []) {
        const isObject = rawField && typeof rawField === "object";
        if (isObject && (
            rawField.server_only === true
            || String(rawField.client_delivery_mode || "").toLowerCase() === "server_only"
        )) continue;
        const name = String(isObject
            ? rawField.column_name ?? rawField.name ?? rawField.value ?? ""
            : rawField
        ).trim();
        if (!name || fieldsByName.has(name)) continue;
        fieldsByName.set(name, {
            name,
            columnUID: isObject ? positiveInteger(rawField.column_uid) : null,
        });
    }
    return Array.from(fieldsByName.values());
}

export function buildOrderedFieldRows(availableColumns, visibleColumns, preferredFieldOrder = []) {
    const fields = normalizeAvailableFields(availableColumns);
    const fieldByName = new Map(fields.map((field) => [field.name, field]));
    const visibleNames = Array.from(new Set(
        (Array.isArray(visibleColumns) ? visibleColumns : [])
            .map(String)
            .filter((name) => fieldByName.has(name))
    ));
    const visibleNameSet = new Set(visibleNames);
    const defaultRows = [
        ...visibleNames.map((name) => ({ ...fieldByName.get(name), visible: true })),
        ...fields
            .filter((field) => !visibleNameSet.has(field.name))
            .map((field) => ({ ...field, visible: false })),
    ];

    const preferredNames = Array.from(new Set(
        (Array.isArray(preferredFieldOrder) ? preferredFieldOrder : [])
            .map(String)
            .filter((name) => fieldByName.has(name))
    ));
    const preferredVisibleNames = preferredNames.filter((name) => visibleNameSet.has(name));
    if (JSON.stringify(preferredVisibleNames) !== JSON.stringify(visibleNames)) {
        return defaultRows;
    }

    const preferredNameSet = new Set(preferredNames);
    return [
        ...preferredNames.map((name) => ({ ...fieldByName.get(name), visible: visibleNameSet.has(name) })),
        ...defaultRows.filter((field) => !preferredNameSet.has(field.name)),
    ];
}

/**
 * Builds a field list for one or several selected assignment targets.
 * A mixed row remembers every group's original value so returning to the
 * indeterminate state is a real "leave unchanged" operation, not decoration.
 */
export function buildEditorFieldRows(availableColumns, assignment, preferredFieldOrder = []) {
    const variants = Array.isArray(assignment?.groupVariants)
        ? assignment.groupVariants
        : [];
    if (variants.length < 2) {
        return buildOrderedFieldRows(
            availableColumns,
            assignment?.visibleColumns,
            preferredFieldOrder
        ).map((field) => ({
            ...field,
            visibilityState: field.visible ? "visible" : "hidden",
            initiallyMixed: false,
            visibleByGroup: {},
        }));
    }

    const visibleUnion = [];
    const seenVisible = new Set();
    variants.forEach((variant) => {
        (Array.isArray(variant?.visible_columns) ? variant.visible_columns : []).forEach((name) => {
            const normalizedName = String(name);
            if (seenVisible.has(normalizedName)) return;
            seenVisible.add(normalizedName);
            visibleUnion.push(normalizedName);
        });
    });

    return buildOrderedFieldRows(
        availableColumns,
        visibleUnion,
        preferredFieldOrder
    ).map((field) => {
        const visibleByGroup = Object.fromEntries(variants.map((variant) => [
            String(variant.group_id),
            (variant.visible_columns || []).includes(field.name),
        ]));
        const visibleCount = Object.values(visibleByGroup).filter(Boolean).length;
        const visibilityState = visibleCount === 0
            ? "hidden"
            : visibleCount === variants.length
                ? "visible"
                : "mixed";
        return {
            ...field,
            visible: visibilityState === "visible",
            visibilityState,
            initiallyMixed: visibilityState === "mixed",
            visibleByGroup,
        };
    });
}

export function cycleFieldVisibility(field) {
    const currentState = field?.visibilityState === "mixed"
        ? "mixed"
        : field?.visibilityState === "visible" || field?.visible === true
            ? "visible"
            : "hidden";
    let visibilityState;
    if (field?.initiallyMixed) {
        visibilityState = currentState === "mixed"
            ? "visible"
            : currentState === "visible"
                ? "hidden"
                : "mixed";
    } else {
        visibilityState = currentState === "visible" ? "hidden" : "visible";
    }
    return {
        ...field,
        visibilityState,
        visible: visibilityState === "visible",
    };
}

function sharedFieldSetByID(response, fieldSetID) {
    if (!fieldSetID) return null;
    return (Array.isArray(response?.field_sets) ? response.field_sets : []).find((fieldSet) => (
        fieldSet?.scope === "shared" && positiveInteger(fieldSet?.id) === fieldSetID
    )) || null;
}

function fallbackVisibleColumns(response) {
    return Array.isArray(response?.metadata_visible_columns)
        ? response.metadata_visible_columns.map(String)
        : [];
}

function visibleColumnMembershipSignature(columns) {
    return JSON.stringify(Array.from(new Set(
        (Array.isArray(columns) ? columns : []).map(String)
    )).sort());
}

/**
 * Resolves the editable source for the selected site/group target.
 * Mixed direct assignments intentionally fall back to metadata for the draft and
 * demand confirmation instead of silently choosing one group's configuration.
 */
export function resolveEditorAssignment(response, selectedValues) {
    const assignments = normalizeGroupAssignments(response?.group_assignments);
    const target = resolveAssignmentTarget(selectedValues, assignments);
    const metadataColumns = fallbackVisibleColumns(response);
    const siteFieldSetID = positiveInteger(response?.site_default_field_set_id);
    const siteFieldSet = sharedFieldSetByID(response, siteFieldSetID);

    const selectedAssignments = target.selectedGroupIDs.map((groupID) => (
        assignments.find((assignment) => assignment.group_id === groupID)
    ));
    const groupVariants = selectedAssignments.map((assignment) => {
        const directFieldSetID = assignment?.field_set_id || null;
        const directFieldSet = sharedFieldSetByID(response, directFieldSetID);
        const inheritedFieldSet = directFieldSetID ? null : siteFieldSet;
        const displayedFieldSet = directFieldSet || inheritedFieldSet;
        return {
            group_id: assignment.group_id,
            group_name: assignment.group_name,
            field_set_id: directFieldSetID,
            group_priority: directFieldSetID ? assignment.group_priority : 0,
            visible_columns: Array.isArray(displayedFieldSet?.visible_columns)
                ? displayedFieldSet.visible_columns.map(String)
                : metadataColumns,
        };
    });
    const fieldVisibilityMixed = new Set(groupVariants.map((variant) => (
        visibleColumnMembershipSignature(variant.visible_columns)
    ))).size > 1;
    const groupPriorityMixed = new Set(
        groupVariants.map((variant) => variant.group_priority)
    ).size > 1;
    // A different collection row is not itself a user-visible conflict. Compare
    // the effective values that this editor can change, and keep doing so when
    // selecting every group happens to map the eventual write to the site layer.
    const mixed = fieldVisibilityMixed
        || (target.targetScope === "groups" && groupPriorityMixed);

    if (target.targetScope === "site") {
        return {
            ...target,
            mixed,
            fieldVisibilityMixed,
            fieldSetID: siteFieldSetID,
            fieldSetName: String(siteFieldSet?.name || ""),
            groupPriority: 0,
            // The site-target UI hides group priority, but a mixed save must
            // still retain every selected group's existing priority.
            groupPriorityMixed,
            groupVariants: fieldVisibilityMixed ? groupVariants : [],
            visibleColumns: Array.isArray(siteFieldSet?.visible_columns)
                ? siteFieldSet.visible_columns.map(String)
                : metadataColumns,
        };
    }

    const commonAssignment = mixed ? null : selectedAssignments[0];
    const directFieldSetID = commonAssignment?.field_set_id || null;
    const directFieldSet = sharedFieldSetByID(response, directFieldSetID);
    const inheritedFieldSet = directFieldSetID ? null : siteFieldSet;
    const displayedFieldSet = directFieldSet || inheritedFieldSet;

    return {
        ...target,
        mixed,
        fieldVisibilityMixed,
        fieldSetID: directFieldSetID,
        fieldSetName: String(directFieldSet?.name || ""),
        groupPriority: directFieldSetID ? commonAssignment.group_priority : 0,
        groupPriorityMixed,
        groupVariants,
        visibleColumns: mixed
            ? groupVariants[0]?.visible_columns || metadataColumns
            : Array.isArray(displayedFieldSet?.visible_columns)
                ? displayedFieldSet.visible_columns.map(String)
                : metadataColumns,
    };
}

export function moveFieldRow(fieldRows, fieldName, offset) {
    const rows = (Array.isArray(fieldRows) ? fieldRows : []).map((row) => ({ ...row }));
    const currentIndex = rows.findIndex((row) => row.name === fieldName);
    const targetIndex = currentIndex + Number(offset);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= rows.length) return rows;
    const [moved] = rows.splice(currentIndex, 1);
    rows.splice(targetIndex, 0, moved);
    return rows;
}

export function moveFieldRowBefore(fieldRows, movedName, targetName) {
    const rows = (Array.isArray(fieldRows) ? fieldRows : []).map((row) => ({ ...row }));
    const movedIndex = rows.findIndex((row) => row.name === movedName);
    const targetIndex = rows.findIndex((row) => row.name === targetName);
    if (movedIndex < 0 || targetIndex < 0 || movedIndex === targetIndex) return rows;
    const [moved] = rows.splice(movedIndex, 1);
    rows.splice(rows.findIndex((row) => row.name === targetName), 0, moved);
    return rows;
}

export function visibleColumnsFromRows(fieldRows) {
    return (Array.isArray(fieldRows) ? fieldRows : [])
        .filter((row) => row.visible)
        .map((row) => row.name);
}

export function groupVariantsFromRows(fieldRows, assignment, commonPriority = null) {
    const variants = Array.isArray(assignment?.groupVariants)
        ? assignment.groupVariants
        : [];
    const normalizedPriority = commonPriority === null || commonPriority === ""
        ? null
        : Number(commonPriority);
    return variants.map((variant) => ({
        group_id: variant.group_id,
        group_priority: Number.isSafeInteger(normalizedPriority)
            ? normalizedPriority
            : variant.group_priority,
        visible_columns: (Array.isArray(fieldRows) ? fieldRows : [])
            .filter((field) => (
                field.visibilityState === "visible"
                || (
                    field.visibilityState === "mixed"
                    && field.visibleByGroup?.[String(variant.group_id)] === true
                )
            ))
            .map((field) => field.name),
    }));
}

export function everyGroupVariantHasVisibleColumns(groupVariants) {
    return Array.isArray(groupVariants)
        && groupVariants.length > 0
        && groupVariants.every((variant) => (
            Array.isArray(variant?.visible_columns) && variant.visible_columns.length > 0
        ));
}

export function buildViewFieldSetSavePayload({
    dataset,
    viewKey,
    name,
    fieldSetID,
    visibleColumns,
    target,
    groupPriority,
}) {
    return {
        dataset,
        view_key: viewKey,
        field_set_id: positiveInteger(fieldSetID) || 0,
        name: String(name || "").trim(),
        visible_columns: Array.isArray(visibleColumns) ? visibleColumns.map(String) : [],
        target_scope: target.targetScope,
        target_group_ids: target.targetGroupIDs,
        group_priority: target.targetScope === "groups" ? Number(groupPriority) || 0 : 0,
        replace_targets: true,
    };
}

export function buildMixedGroupViewFieldSetSavePayload({
    dataset,
    viewKey,
    name,
    target,
    groupVariants,
}) {
    const targetGroupIDs = target.targetGroupIDs?.length > 0
        ? target.targetGroupIDs
        : target.selectedGroupIDs;
    return {
        dataset,
        view_key: viewKey,
        field_set_id: 0,
        name: String(name || "").trim(),
        target_scope: "groups",
        target_group_ids: [...(targetGroupIDs || [])],
        replace_targets: true,
        group_variants: (Array.isArray(groupVariants) ? groupVariants : []).map((variant) => ({
            group_id: positiveInteger(variant?.group_id),
            group_priority: Number(variant?.group_priority) || 0,
            visible_columns: Array.isArray(variant?.visible_columns)
                ? variant.visible_columns.map(String)
                : [],
        })),
    };
}

export function savedAssignmentMatches(response, payload, savedFieldSetID) {
    const fieldSetID = positiveInteger(savedFieldSetID);
    if (!fieldSetID) return false;
    const savedSet = sharedFieldSetByID(response, fieldSetID);
    if (!savedSet || JSON.stringify(savedSet.visible_columns || []) !== JSON.stringify(payload.visible_columns)) {
        return false;
    }
    if (payload.target_scope === "site") {
        return positiveInteger(response?.site_default_field_set_id) === fieldSetID
            && normalizeGroupAssignments(response?.group_assignments)
                .every((assignment) => assignment.field_set_id !== fieldSetID);
    }
    const assignments = normalizeGroupAssignments(response?.group_assignments);
    const requestedGroupIDs = [...payload.target_group_ids].sort((left, right) => left - right);
    const assignedGroupIDs = assignments
        .filter((assignment) => assignment.field_set_id === fieldSetID)
        .map((assignment) => assignment.group_id)
        .sort((left, right) => left - right);
    return positiveInteger(response?.site_default_field_set_id) !== fieldSetID
        && JSON.stringify(assignedGroupIDs) === JSON.stringify(requestedGroupIDs)
        && requestedGroupIDs.every((groupID) => {
            const assignment = assignments.find((candidate) => candidate.group_id === groupID);
            return assignment?.field_set_id === fieldSetID
                && assignment.group_priority === payload.group_priority;
        });
}

export function savedGroupVariantsMatch(response, payload) {
    const assignments = normalizeGroupAssignments(response?.group_assignments);
    const variants = Array.isArray(payload?.group_variants) ? payload.group_variants : [];
    if (variants.length === 0 || variants.length !== payload?.target_group_ids?.length) return false;
    return variants.every((variant) => {
        const assignment = assignments.find((candidate) => candidate.group_id === variant.group_id);
        const fieldSet = sharedFieldSetByID(response, assignment?.field_set_id);
        return Boolean(
            assignment?.field_set_id
            && assignment.group_priority === variant.group_priority
            && fieldSet
            && JSON.stringify(fieldSet.visible_columns || []) === JSON.stringify(variant.visible_columns)
        );
    });
}

export function resetAssignmentMatches(response, target) {
    if (target.targetScope === "site") {
        return positiveInteger(response?.site_default_field_set_id) === null;
    }
    const assignments = normalizeGroupAssignments(response?.group_assignments);
    return target.targetGroupIDs.every((groupID) => (
        assignments.find((assignment) => assignment.group_id === groupID)?.field_set_id === null
    ));
}
