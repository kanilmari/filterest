// linked_label_evidence.go
// Enumerates linked aliases using the row projections' own metadata and naming.
// Connects declared language-key evidence to actual FK and actor projections.
// Reads schema proof only; withheld target fields never become label evidence.
package dtt_1_row_read

import (
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/row_mutation_policy"
	"easelect/backend/core_components/dynamic_table_tools/dtt_utils"
)

// The producer expressions the language-key declarations name.
const (
	primaryLinkedLabelBuilder = `return alias + " (ln)"`
	relatedLinkedLabelBuilder = `candidate = baseAlias + " (ln)"`
)

// LinkedLabelEvidence is what one dataset's row projections prove about their
// linked labels: the aliases each producer emits, and the stored column each
// alias is read through.
type LinkedLabelEvidence struct {
	// Aliases maps a producer expression to the aliases it emits.
	Aliases map[string]map[string]bool
	// SourceColumns maps an emitted alias to the dataset columns it labels.
	SourceColumns map[string][]string
}

// linkedLabelProjection is one alias a projection emits for one column.
type linkedLabelProjection struct {
	builder, alias, column string
}

// LinkedLabelEvidenceAliases returns aliases by live producer expression. Keep
// this next to the projections: cached-name suppression applies only to the
// primary projection, while related rows allocate aliases around collisions.
func LinkedLabelEvidenceAliases(table string, columns []string) (map[string]map[string]bool, error) {
	evidence, err := ReadLinkedLabelEvidence(table, columns)
	return evidence.Aliases, err
}

// ReadLinkedLabelEvidence reads one dataset's linked-label proof with a single
// pass over its relation metadata.
func ReadLinkedLabelEvidence(table string, columns []string) (LinkedLabelEvidence, error) {
	projections, err := readLinkedLabelProjections(table, columns)
	if err != nil {
		return LinkedLabelEvidence{}, err
	}
	return linkedLabelEvidenceFrom(projections), nil
}

func readLinkedLabelProjections(table string, columns []string) ([]linkedLabelProjection, error) {
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
	targets, err := fetchRecordTitleAliasTargets(backend.Db, foreignKeys)
	if err != nil {
		return nil, err
	}
	return linkedLabelProjections(columns, relations, foreignKeys, targets, actors), nil
}

func linkedLabelEvidenceAliases(columns []string, relations map[string]OneMRelation, foreignKeys map[string]dtt_utils.ForeignKey, targets map[string]recordTitleTargetMetadata, actors row_mutation_policy.RowActorColumns) map[string]map[string]bool {
	return linkedLabelEvidenceFrom(linkedLabelProjections(columns, relations, foreignKeys, targets, actors)).Aliases
}

func linkedLabelEvidenceFrom(projections []linkedLabelProjection) LinkedLabelEvidence {
	evidence := LinkedLabelEvidence{
		Aliases: map[string]map[string]bool{
			primaryLinkedLabelBuilder: {},
			relatedLinkedLabelBuilder: {},
		},
		SourceColumns: map[string][]string{},
	}
	for _, projection := range projections {
		evidence.Aliases[projection.builder][projection.alias] = true
		evidence.SourceColumns[projection.alias] = appendUniqueColumn(evidence.SourceColumns[projection.alias], projection.column)
	}
	return evidence
}

func appendUniqueColumn(columns []string, column string) []string {
	for _, existing := range columns {
		if existing == column {
			return columns
		}
	}
	return append(columns, column)
}

func linkedLabelProjections(columns []string, relations map[string]OneMRelation, foreignKeys map[string]dtt_utils.ForeignKey, targets map[string]recordTitleTargetMetadata, actors row_mutation_policy.RowActorColumns) []linkedLabelProjection {
	var projections []linkedLabelProjection
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
		// Reserve the same alias even for NULL labels, preserving later collisions.
		relatedAlias := buildRelatedFKDisplayAlias(column, existing, used)
		target, proven := targets[column]
		if !actor && fkDisplayLabelExpression("target", fk.NameColumn, target, proven) == "NULL::text" {
			continue
		}
		if actor || relations[column].CachedNameColInSrc == "" {
			projections = append(projections, linkedLabelProjection{primaryLinkedLabelBuilder, generatedForeignNameAlias(column), column})
		}
		projections = append(projections, linkedLabelProjection{relatedLinkedLabelBuilder, relatedAlias, column})
	}
	return projections
}
