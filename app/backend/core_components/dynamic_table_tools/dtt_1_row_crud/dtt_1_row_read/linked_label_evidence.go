// linked_label_evidence.go
// Enumerates linked aliases using the row projections' own metadata and naming.
// Connects declared language-key evidence to actual FK and actor projections.
// Does not query rows, change projection behavior or manufacture ordinary labels.
package dtt_1_row_read

import (
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

// LinkedLabelEvidenceAliases returns aliases by live producer expression. Keep
// this next to the projections: cached-name suppression applies only to the
// primary projection, while related rows allocate aliases around collisions.
func LinkedLabelEvidenceAliases(table string, columns []string) (map[string]map[string]bool, error) {
	uid, err := getTableUID(table, backend.Db)
	if err != nil {
		return nil, err
	}
	relations, err := readForeignKeyRelations(backend.Db, uid, true)
	if err != nil {
		return nil, err
	}
	foreignKeys, err := dtt_utils.GetForeignKeysForTableForEvidence(table)
	if err != nil {
		return nil, err
	}
	actors, err := row_mutation_policy.ReadRowActorColumns(backend.Db, table)
	if err != nil {
		return nil, err
	}
	return linkedLabelEvidenceAliases(columns, relations, foreignKeys, actors), nil
}

func linkedLabelEvidenceAliases(columns []string, relations map[string]OneMRelation, foreignKeys map[string]dtt_utils.ForeignKey, actors row_mutation_policy.RowActorColumns) map[string]map[string]bool {
	primary, related := map[string]bool{}, map[string]bool{}
	existing, used := map[string]struct{}{}, map[string]struct{}{}
	for _, column := range columns {
		existing[strings.ToLower(column)] = struct{}{}
	}
	for _, column := range columns {
		actor := actors[column] != ""
		fk, foreign := foreignKeys[column]
		if !actor && (!foreign || fk.NameColumn == "") {
			continue
		}
		if actor || relations[column].CachedNameColInSrc == "" {
			primary[generatedForeignNameAlias(column)] = true
		}
		related[buildRelatedFKDisplayAlias(column, existing, used)] = true
	}
	return map[string]map[string]bool{
		`return alias + " (ln)"`:          primary,
		`candidate = baseAlias + " (ln)"`: related,
	}
}
