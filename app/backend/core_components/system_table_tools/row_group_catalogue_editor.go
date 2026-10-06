// row_group_catalogue_editor.go
// Reads and edits the administrator's global classification catalogue.
// Bridges the existing row-group tables with default-language and fixed-identity rules.
// Exists to share fresh and legacy readback without permitting taxonomy deletion.
package system_table_tools

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/lib/pq"
)

func getRowGroupCatalogue(ctx context.Context, tx *sql.Tx, r *http.Request) (rowGroupCatalogue, error) {
	result := rowGroupCatalogue{RowIDs: []int64{}}
	targetName := strings.TrimSpace(r.URL.Query().Get("target"))
	if r.URL.Query().Has("dataset") {
		return result, rowGroupQueryError("use target instead of dataset")
	}
	if targetName != "" {
		if r.URL.Query().Has("table_uid") || r.URL.Query().Has("row_id") {
			return result, rowGroupQueryError("ambiguous target")
		}
		target, err := resolveRowAccessTarget(ctx, tx, targetName)
		if err != nil {
			return result, err
		}
		result.Dataset, result.TableUID = target.TableName, target.TableUID
		if r.URL.Query().Has("row_ids") {
			result.RowIDs, err = parseRowAccessRowIDs(r.URL.Query().Get("row_ids"))
			if err != nil {
				return result, rowGroupQueryError(err.Error())
			}
			if err = validateRowAccessRows(ctx, tx, target, result.RowIDs, false); err != nil {
				return result, err
			}
		}
	} else {
		var err error
		result.TableUID, err = optionalPositiveQueryValue(r, "table_uid")
		if err != nil {
			return result, rowGroupQueryError(err.Error())
		}
		rowID, err := optionalPositiveQueryValue(r, "row_id")
		if err != nil {
			return result, rowGroupQueryError(err.Error())
		}
		if r.URL.Query().Has("row_ids") || (rowID > 0 && result.TableUID == 0) {
			return result, rowGroupQueryError("row selection requires a target")
		}
		if rowID > 0 {
			result.RowIDs = []int64{rowID}
		}
	}
	var err error
	result.Groups, err = listRowGroupsFromDB(ctx, tx, result.TableUID, result.RowIDs)
	if err != nil {
		return result, err
	}
	result.Classifications, err = listRowGroupClassifications(ctx, tx)
	return result, err
}

func listRowGroupsFromDB(ctx context.Context, tx *sql.Tx, tableUID int64, rowIDs []int64) ([]RowGroup, error) {
	rows, err := tx.QueryContext(ctx, `
  SELECT g.id, g.slug, g.title::text, COALESCE(g.description, '{}'::jsonb)::text,
         g.sort_order, g.enabled, g.classification_id,
         ARRAY(SELECT m.row_id FROM public.system_row_group_memberships m
          WHERE m.group_id=g.id AND m.table_uid=$1 AND m.row_id=ANY($2::bigint[]) ORDER BY m.row_id)
  FROM public.system_row_groups g ORDER BY g.sort_order, g.slug, g.id
 `, tableUID, pq.Array(rowIDs))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []RowGroup{}
	for rows.Next() {
		var group RowGroup
		var title, description string
		var selected pq.Int64Array
		if err := rows.Scan(&group.ID, &group.Slug, &title, &description, &group.SortOrder, &group.Enabled, &group.ClassificationID, &selected); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(title), &group.Title); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(description), &group.Description); err != nil {
			return nil, err
		}
		group.SelectedRows = append([]int64{}, selected...)
		group.Selected = len(rowIDs) > 0 && len(selected) == len(rowIDs)
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func listRowGroupClassifications(ctx context.Context, tx *sql.Tx) ([]RowGroup, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, slug, title::text, is_single, sort_order, enabled
  FROM public.system_row_group_classifications ORDER BY sort_order, slug, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	headings := []RowGroup{}
	for rows.Next() {
		var heading RowGroup
		var title string
		var single bool
		if err := rows.Scan(&heading.ID, &heading.Slug, &title, &single, &heading.SortOrder, &heading.Enabled); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(title), &heading.Title); err != nil {
			return nil, err
		}
		heading.IsSingle = &single
		heading.SelectedRows = []int64{}
		headings = append(headings, heading)
	}
	return headings, rows.Err()
}

func saveRowGroupInDB(ctx context.Context, tx *sql.Tx, request createRowGroupRequest, heading bool) (RowGroup, error) {
	if request.Title != nil {
		if err := validateRowGroupLanguagesInDB(ctx, tx, request.Title, request.Description); err != nil {
			return RowGroup{}, err
		}
	}
	if request.ID == 0 {
		return createRowGroupInDB(ctx, tx, request, heading)
	}
	table := "public.system_row_groups"
	if heading {
		table = "public.system_row_group_classifications"
	}
	var title any
	if request.Title != nil {
		encoded, _ := json.Marshal(request.Title)
		title = string(encoded)
	}
	var result RowGroup
	var storedTitle string
	query := `UPDATE ` + table + ` SET title=COALESCE($2::jsonb,title), sort_order=COALESCE($3::integer,sort_order), enabled=COALESCE($4::boolean,enabled)
  WHERE id=$1 RETURNING id,slug,title::text,sort_order,enabled`
	err := tx.QueryRowContext(ctx, query, request.ID, title, request.SortOrder, request.Enabled).Scan(&result.ID, &result.Slug, &storedTitle, &result.SortOrder, &result.Enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return result, errRowGroupUnavailable
	}
	if err != nil {
		return result, err
	}
	err = json.Unmarshal([]byte(storedTitle), &result.Title)
	return result, err
}

func createRowGroupInDB(ctx context.Context, tx *sql.Tx, request createRowGroupRequest, heading bool) (RowGroup, error) {
	title, _ := json.Marshal(request.Title)
	description, _ := json.Marshal(request.Description)
	result := RowGroup{Slug: request.Slug, Title: request.Title, Description: request.Description, Enabled: true, ClassificationID: request.ClassificationID, SelectedRows: []int64{}}
	if request.SortOrder != nil {
		result.SortOrder = *request.SortOrder
	}
	if request.Enabled != nil {
		result.Enabled = *request.Enabled
	}
	var err error
	if heading {
		single := request.IsSingle != nil && *request.IsSingle
		result.IsSingle = &single
		err = tx.QueryRowContext(ctx, `INSERT INTO public.system_row_group_classifications(slug,title,is_single,sort_order,enabled)
   VALUES($1,$2::jsonb,$3,$4,$5) RETURNING id`, result.Slug, string(title), single, result.SortOrder, result.Enabled).Scan(&result.ID)
	} else {
		var exists bool
		err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM public.system_row_group_classifications WHERE id=$1)`, request.ClassificationID).Scan(&exists)
		if err != nil {
			return result, err
		}
		if !exists {
			return result, errRowGroupUnavailable
		}
		if request.Description == nil {
			description = []byte(`{}`)
		}
		err = tx.QueryRowContext(ctx, `INSERT INTO public.system_row_groups(slug,title,description,classification_id,sort_order,enabled)
   VALUES($1,$2::jsonb,$3::jsonb,$4,$5,$6) RETURNING id`, result.Slug, string(title), string(description), request.ClassificationID, result.SortOrder, result.Enabled).Scan(&result.ID)
	}
	var pqError *pq.Error
	if errors.As(err, &pqError) && pqError.Code == "23505" {
		return result, errRowGroupConflict
	}
	return result, err
}
