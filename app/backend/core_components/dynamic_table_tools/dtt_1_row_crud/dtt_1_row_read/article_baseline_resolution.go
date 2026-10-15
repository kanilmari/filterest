// article_baseline_resolution.go
// Projects existing target assignments through the current uncached field readers.
// Connects assignment provenance to Article and source-dependent IFAV order.
// Verifies user-level choices against the live code's resolver rather than a cache.
package dtt_1_row_read

import (
	"database/sql"
	"fmt"
	"reflect"
	"sort"
)

type articleBaselineAssignment struct {
	id, setID       int64
	userID, groupID sql.NullInt64
	priority        int
	view            string
}
type articleBaselineContext struct {
	kind   string
	id     int64
	groups []int64
}

func (a articleBaselineAssignment) source() ArticleBaselineSource {
	result := ArticleBaselineSource{Kind: "site", AssignmentID: &a.id, FieldSetID: &a.setID, GroupPriority: &a.priority}
	if a.userID.Valid {
		result.Kind, result.UserID = "personal", &a.userID.Int64
	} else if a.groupID.Valid {
		result.Kind, result.GroupID = "group", &a.groupID.Int64
	}
	return result
}
func articleBaselineWinner(assignments []articleBaselineAssignment, view string, target articleBaselineContext) *articleBaselineAssignment {
	candidates := []articleBaselineAssignment{}
	for _, a := range assignments {
		if a.view != view || target.kind == "metadata" {
			continue
		}
		if a.userID.Valid {
			if (target.kind != "personal" && target.kind != "reader") || target.id <= 1 || a.userID.Int64 != target.id {
				continue
			}
		} else if a.groupID.Valid {
			applies := target.kind == "group" && target.id == a.groupID.Int64
			if (target.kind == "personal" || target.kind == "reader") && target.id > 1 {
				for _, id := range target.groups {
					applies = applies || id == a.groupID.Int64
				}
			}
			if !applies {
				continue
			}
		}
		candidates = append(candidates, a)
	}
	rank := func(a articleBaselineAssignment) int {
		if a.userID.Valid {
			return 3
		}
		if a.groupID.Valid {
			return 2
		}
		return 1
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if rank(a) != rank(b) {
			return rank(a) > rank(b)
		}
		if a.priority != b.priority {
			return a.priority > b.priority
		}
		if a.groupID.Valid != b.groupID.Valid {
			return a.groupID.Valid
		}
		if a.groupID.Int64 != b.groupID.Int64 {
			return a.groupID.Int64 < b.groupID.Int64
		}
		if a.setID != b.setID {
			return a.setID < b.setID
		}
		return a.id < b.id
	})
	if len(candidates) == 0 {
		return nil
	}
	return &candidates[0]
}

func articleBaselineProjection(tx *sql.Tx, dataset ArticleBaselineDataset, assignments []articleBaselineAssignment,
	columns map[string]ArticleBaselineField, target articleBaselineContext, view string) (ArticleBaselineProjection, error) {
	result := ArticleBaselineProjection{Source: ArticleBaselineSource{Kind: "metadata"}, Fields: []ArticleBaselineField{}}
	var settings []UserColumnSetting
	var err error
	winner := articleBaselineWinner(assignments, view, target)
	widths := map[string]*int{}
	if winner == nil {
		settings, err = fetchMetadataColumnSettings(dataset.UID, dataset.Name, view, tx)
	} else {
		result.Source = winner.source()
		settings, err = fetchAssignedFieldSetColumnSettings(winner.setID, tx)
		if err == nil {
			widths, err = articleBaselineWidths(tx, winner.setID)
		}
	}
	if err != nil {
		return result, err
	}
	if target.kind == "reader" || target.kind == "personal" {
		actual, err := fetchUserColumnSettingsOrDefaults(int(target.id), dataset.Name, view, tx)
		if err != nil {
			return result, err
		}
		if !reflect.DeepEqual(actual, settings) {
			return result, fmt.Errorf("baseline selection differs from current resolver: dataset %d user %d view %s", dataset.UID, target.id, view)
		}
	}
	for _, setting := range settings {
		field := columns[setting.ColumnName]
		field.Name, field.Width, field.StoredWidth = setting.ColumnName, setting.ColumnWidth, widths[setting.ColumnName]
		result.Fields = append(result.Fields, field)
	}
	return result, nil
}
func articleBaselineWidths(tx *sql.Tx, setID int64) (map[string]*int, error) {
	rows, err := tx.Query(`SELECT details.column_name, members.column_width_px
        FROM public.system_column_field_set_members members
        JOIN public.system_column_details details ON details.column_uid=members.column_uid
        WHERE members.field_set_id=$1 ORDER BY members.sort_order, members.column_uid`, setID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]*int{}
	for rows.Next() {
		var name string
		var width sql.NullInt64
		if err := rows.Scan(&name, &width); err != nil {
			return nil, err
		}
		if width.Valid {
			value := int(width.Int64)
			result[name] = &value
		}
	}
	return result, rows.Err()
}

// IFAV sorts Object.keys(row), not response.columns. Server row maps serialize
// their keys alphabetically. Additional transport/generated keys are explicitly
// unresolved here: they are not a saved field preference and may be row-dependent.
func articleBaselineIFAVOrder(fields []ArticleBaselineField) []ArticleBaselineField {
	result := append([]ArticleBaselineField{}, fields...)
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	sort.SliceStable(result, func(i, j int) bool {
		a, b := result[i], result[j]
		if (a.Role != "") != (b.Role != "") {
			return a.Role != ""
		}
		if a.CoNumber > 0 && b.CoNumber > 0 && a.CoNumber != b.CoNumber {
			return a.CoNumber < b.CoNumber
		}
		if (a.CoNumber > 0) != (b.CoNumber > 0) {
			return a.CoNumber > 0
		}
		return false
	})
	return result
}
func articleBaselineIFAV(tx *sql.Tx, dataset ArticleBaselineDataset, assignments []articleBaselineAssignment,
	columns map[string]ArticleBaselineField, target articleBaselineContext, views []string, article ArticleBaselineProjection) (ArticleBaselineIFAV, error) {
	result := ArticleBaselineIFAV{SourceDependent: true, OpeningSources: []ArticleBaselineOpening{}}
	var err error
	result.ConfiguredProjection, err = articleBaselineProjection(tx, dataset, assignments, columns, target, "image_first_view")
	if err != nil {
		return result, err
	}
	for _, view := range views {
		projection, err := articleBaselineProjection(tx, dataset, assignments, columns, target, view)
		if err != nil {
			return result, err
		}
		fields := articleBaselineIFAVOrder(projection.Fields)
		result.OpeningSources = append(result.OpeningSources, ArticleBaselineOpening{
			Path: "supplied_row", ViewKey: view, Source: projection.Source, Fields: fields,
			AdditionalRowKeys: "identity, image support and generated relation keys depend on the supplied row; custom/local rows may have arbitrary keys",
		})
		result.DifferentFromArticle = result.DifferentFromArticle || !reflect.DeepEqual(fields, article.Fields)
	}
	result.OpeningSources = append(result.OpeningSources, ArticleBaselineOpening{
		Path: "history_restore", ViewKey: "article_view", Source: article.Source, Fields: articleBaselineIFAVOrder(article.Fields),
		AdditionalRowKeys: "fresh Article row keys include transport/enrichment; IFAV ignores response.columns",
	})
	result.DifferentFromArticle = result.DifferentFromArticle || !reflect.DeepEqual(articleBaselineIFAVOrder(article.Fields), article.Fields)
	return result, nil
}
