// view_field_set_group_variants.go
// Normalizes, persists, and verifies per-group variants of shared field collections.
// Bridges mixed administrator selections with deterministic per-group collection identities.
// Exists so indeterminate fields can preserve each group's value without ambiguous shared writes.
package system_table_tools

import (
	"crypto/sha256"
	"fmt"
	"slices"
	"sort"
	"strings"

	"easelect/backend/core_components/dbutils"
)

func normalizeViewFieldSetGroupVariants(
	variants []saveViewFieldSetGroupVariant,
	targetGroupIDs []int64,
) ([]saveViewFieldSetGroupVariant, error) {
	if len(variants) == 0 || len(variants) != len(targetGroupIDs) {
		return nil, fmt.Errorf("group_variants must cover every target group exactly once")
	}
	normalized := make([]saveViewFieldSetGroupVariant, 0, len(variants))
	seen := make(map[int64]bool, len(variants))
	for _, variant := range variants {
		if seen[variant.GroupID] {
			return nil, fmt.Errorf("group_variants must contain unique group IDs")
		}
		if _, err := normalizeViewFieldSetGroupTargets(
			[]int64{variant.GroupID},
			variant.GroupPriority,
		); err != nil {
			return nil, err
		}
		visibleColumns, err := normalizeVisibleColumnNames(variant.VisibleColumns)
		if err != nil {
			return nil, fmt.Errorf("group %d: %w", variant.GroupID, err)
		}
		seen[variant.GroupID] = true
		normalized = append(normalized, saveViewFieldSetGroupVariant{
			GroupID:        variant.GroupID,
			GroupPriority:  variant.GroupPriority,
			VisibleColumns: visibleColumns,
		})
	}
	sort.Slice(normalized, func(leftIndex, rightIndex int) bool {
		return normalized[leftIndex].GroupID < normalized[rightIndex].GroupID
	})
	if len(normalized) != len(targetGroupIDs) {
		return nil, fmt.Errorf("group_variants target mismatch")
	}
	for index, variant := range normalized {
		if variant.GroupID != targetGroupIDs[index] {
			return nil, fmt.Errorf("group_variants target mismatch")
		}
	}
	return normalized, nil
}

func mixedViewFieldSetName(baseName string, visibleColumns []string) string {
	digest := sha256.Sum256([]byte(strings.Join(visibleColumns, "\x00")))
	suffix := fmt.Sprintf(" · variant %x", digest[:16])
	baseRunes := []rune(strings.TrimSpace(baseName))
	maximumBaseLength := 128 - len([]rune(suffix))
	if len(baseRunes) > maximumBaseLength {
		baseRunes = baseRunes[:maximumBaseLength]
	}
	return string(baseRunes) + suffix
}

func saveViewFieldSetGroupVariants(
	q dbutils.Querier,
	tableUID, viewID int,
	createdBy int64,
	baseName string,
	variants []saveViewFieldSetGroupVariant,
	columnUIDsByGroup map[int64][]int,
) ([]savedViewFieldSetGroupVariant, error) {
	saved := make([]savedViewFieldSetGroupVariant, 0, len(variants))
	for _, variant := range variants {
		fieldSetName := mixedViewFieldSetName(baseName, variant.VisibleColumns)
		var fieldSetID int64
		if err := q.QueryRow(`
			INSERT INTO public.system_column_field_sets (table_uid, owner_user_id, name, created_by)
			VALUES ($1, NULL, $2, $3)
			ON CONFLICT (table_uid, owner_user_id, name)
			DO UPDATE SET updated = now()
			RETURNING id`, tableUID, fieldSetName, createdBy).Scan(&fieldSetID); err != nil {
			return nil, err
		}
		if _, err := q.Exec(`
			DELETE FROM public.system_column_field_set_members
			WHERE field_set_id = $1`, fieldSetID); err != nil {
			return nil, err
		}
		columnUIDs := columnUIDsByGroup[variant.GroupID]
		if len(columnUIDs) != len(variant.VisibleColumns) {
			return nil, fmt.Errorf("group %d column UID readback mismatch", variant.GroupID)
		}
		for index, columnUID := range columnUIDs {
			if _, err := q.Exec(`
				INSERT INTO public.system_column_field_set_members
				    (field_set_id, table_uid, column_uid, sort_order)
				VALUES ($1, $2, $3, $4)`, fieldSetID, tableUID, columnUID, index+1); err != nil {
				return nil, err
			}
		}
		if err := upsertViewFieldSetAssignment(
			q,
			nil,
			variant.GroupID,
			tableUID,
			viewID,
			fieldSetID,
			createdBy,
			variant.GroupPriority,
		); err != nil {
			return nil, err
		}
		saved = append(saved, savedViewFieldSetGroupVariant{
			GroupID:        variant.GroupID,
			FieldSetID:     fieldSetID,
			GroupPriority:  variant.GroupPriority,
			VisibleColumns: append([]string(nil), variant.VisibleColumns...),
		})
	}

	fieldSets, err := listAccessibleViewFieldSets(q, tableUID, createdBy)
	if err != nil {
		return nil, err
	}
	assignments, err := listViewFieldSetGroupAssignments(q, tableUID, viewID)
	if err != nil {
		return nil, err
	}
	if !viewFieldSetGroupVariantsReadbackMatches(saved, fieldSets, assignments) {
		return nil, fmt.Errorf("group field variants readback mismatch")
	}
	return saved, nil
}

func viewFieldSetGroupVariantsReadbackMatches(
	saved []savedViewFieldSetGroupVariant,
	fieldSets []viewFieldSet,
	assignments []viewFieldSetGroupAssignment,
) bool {
	for _, expected := range saved {
		var assignment *viewFieldSetGroupAssignment
		for index := range assignments {
			if assignments[index].GroupID == expected.GroupID {
				assignment = &assignments[index]
				break
			}
		}
		if assignment == nil || assignment.FieldSetID == nil ||
			*assignment.FieldSetID != expected.FieldSetID ||
			assignment.GroupPriority != expected.GroupPriority {
			return false
		}
		var fieldSet *viewFieldSet
		for index := range fieldSets {
			if fieldSets[index].ID == expected.FieldSetID {
				fieldSet = &fieldSets[index]
				break
			}
		}
		if fieldSet == nil || !slices.Equal(fieldSet.VisibleColumns, expected.VisibleColumns) {
			return false
		}
	}
	return len(saved) > 0
}
