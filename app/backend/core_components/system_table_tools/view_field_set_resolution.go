// view_field_set_resolution.go
// Resolves reusable dataset field collections, assignments, and readable columns.
// Keeps persistence and permission helpers separate from the HTTP mutation handlers.
// Exists to keep the per-view field collection implementation small and auditable.
package system_table_tools

import (
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
)

func listAccessibleViewFieldSets(q dbutils.Querier, tableUID int, userID int64) ([]viewFieldSet, error) {
	preferenceOwner := personalViewFieldSetOwner(userID)
	rows, err := q.Query(`
		SELECT sets.id, sets.name,
		       CASE WHEN sets.owner_user_id IS NULL THEN 'shared' ELSE 'personal' END,
		       details.column_name
		FROM public.system_column_field_sets AS sets
		LEFT JOIN public.system_column_field_set_members AS members ON members.field_set_id = sets.id
		LEFT JOIN public.system_column_details AS details
		  ON details.column_uid = members.column_uid
		 AND COALESCE(details.hide_everywhere, false) = false
		WHERE sets.table_uid = $1
		  AND (sets.owner_user_id = $2 OR sets.owner_user_id IS NULL)
		ORDER BY (sets.owner_user_id IS NULL), lower(sets.name), members.sort_order`, tableUID, preferenceOwner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sets := make([]viewFieldSet, 0)
	indexByID := map[int64]int{}
	for rows.Next() {
		var id int64
		var name, scope string
		var column sql.NullString
		if err := rows.Scan(&id, &name, &scope, &column); err != nil {
			return nil, err
		}
		index, exists := indexByID[id]
		if !exists {
			index = len(sets)
			indexByID[id] = index
			sets = append(sets, viewFieldSet{ID: id, Name: name, Scope: scope, VisibleColumns: []string{}})
		}
		if column.Valid {
			sets[index].VisibleColumns = append(sets[index].VisibleColumns, column.String)
		}
	}
	return sets, rows.Err()
}

func resolveEffectiveViewFieldSet(q dbutils.Querier, tableUID, viewID int, userID int64, viewKey string) (*int64, string, []string, error) {
	preferenceOwner := personalViewFieldSetOwner(userID)
	var fieldSetID int64
	var scope string
	err := q.QueryRow(`
		SELECT assignments.field_set_id,
		       CASE WHEN assignments.user_id IS NULL THEN 'site' ELSE 'personal' END
		FROM public.system_view_field_set_assignments AS assignments
		WHERE assignments.table_uid = $1 AND assignments.view_id = $2
		  AND (assignments.user_id = $3 OR assignments.user_id IS NULL)
		ORDER BY (assignments.user_id IS NOT NULL) DESC
		LIMIT 1`, tableUID, viewID, preferenceOwner).Scan(&fieldSetID, &scope)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, "", nil, err
	}
	if err == nil {
		columns, memberErr := viewFieldSetMemberNames(q, fieldSetID)
		return &fieldSetID, scope, columns, memberErr
	}

	query := `
		SELECT column_name
		FROM public.system_column_details
		WHERE table_uid = $1 AND COALESCE(hide_everywhere, false) = false`
	if viewKey == "card" {
		query += ` AND COALESCE(hide_on_small_card, false) = false`
	}
	query += ` ORDER BY co_number NULLS LAST, column_uid`
	rows, err := q.Query(query, tableUID)
	if err != nil {
		return nil, "", nil, err
	}
	defer rows.Close()
	columns := []string{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, "", nil, err
		}
		columns = append(columns, column)
	}
	return nil, "metadata", columns, rows.Err()
}

func viewFieldSetMemberNames(q dbutils.Querier, fieldSetID int64) ([]string, error) {
	rows, err := q.Query(`
		SELECT details.column_name
		FROM public.system_column_field_set_members AS members
		JOIN public.system_column_details AS details ON details.column_uid = members.column_uid
		WHERE members.field_set_id = $1
		  AND COALESCE(details.hide_everywhere, false) = false
		ORDER BY members.sort_order`, fieldSetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := []string{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, err
		}
		columns = append(columns, column)
	}
	return columns, rows.Err()
}

func viewFieldSetUserIsAdmin(q dbutils.Querier, userID int64) (bool, error) {
	var isAdmin bool
	err := q.QueryRow(`SELECT EXISTS (
		SELECT 1
		FROM public.system_user_group_memberships AS memberships
		JOIN public.system_user_groups AS groups ON groups.id = memberships.group_id
		WHERE memberships.user_id = $1 AND groups.name = 'admins'
	)`, userID).Scan(&isAdmin)
	return isAdmin, err
}

var errViewFieldSetDatasetForbidden = errors.New("dataset read access denied")

func authorizeViewFieldSetDatasetRead(tableUID, userID int) error {
	allowed, err := permissions.CheckRouteTablePermission(
		backend.Db,
		"/api/get-results",
		userID,
		permissions.RouteTableScope{TableUID: strconv.Itoa(tableUID)},
		permissions.AccessControlRouteTableOptions(false),
	)
	if err != nil {
		return err
	}
	if !allowed {
		return errViewFieldSetDatasetForbidden
	}
	return nil
}

func respondViewFieldSetAuthorizationError(w http.ResponseWriter, err error) {
	if errors.Is(err, errViewFieldSetDatasetForbidden) {
		httpresponse.RespondWithError(w, http.StatusForbidden, "dataset read access denied")
		return
	}
	httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset permission check failed")
}

func selectableViewFieldSetColumns(userID int, dataset string) (map[string]bool, error) {
	role, err := backend.ResolveUserRole(userID)
	if err != nil {
		return nil, err
	}
	roleDB := backend.GetRequestDBForRole(role)
	if roleDB == nil {
		return nil, fmt.Errorf("role database unavailable")
	}
	rows, err := roleDB.Query(`
		SELECT column_name
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = $1
		  AND has_column_privilege(
		      current_user,
		      format('%I.%I', table_schema, table_name),
		      column_name,
		      'SELECT'
		  )`, dataset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	allowed := map[string]bool{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, err
		}
		allowed[column] = true
	}
	return allowed, rows.Err()
}

func filterViewFieldSetsByPermission(sets []viewFieldSet, allowed map[string]bool) []viewFieldSet {
	filtered := make([]viewFieldSet, 0, len(sets))
	for _, fieldSet := range sets {
		fieldSet.VisibleColumns = filterViewFieldColumnNames(fieldSet.VisibleColumns, allowed)
		filtered = append(filtered, fieldSet)
	}
	return filtered
}

func filterViewFieldColumnNames(columns []string, allowed map[string]bool) []string {
	filtered := make([]string, 0, len(columns))
	for _, column := range columns {
		if allowed[column] {
			filtered = append(filtered, column)
		}
	}
	return filtered
}

func orderedSelectableViewFieldSetColumns(
	q dbutils.Querier,
	tableUID int,
	allowed map[string]bool,
) ([]string, error) {
	rows, err := q.Query(`
		SELECT column_name
		FROM public.system_column_details
		WHERE table_uid = $1
		  AND COALESCE(hide_everywhere, false) = false
		ORDER BY co_number NULLS LAST, column_uid`, tableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := make([]string, 0)
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return nil, err
		}
		if allowed[column] {
			columns = append(columns, column)
		}
	}
	return columns, rows.Err()
}

func resolveViewFieldSetAssignments(q dbutils.Querier, tableUID, viewID int, userID int64) (*int64, *int64, error) {
	preferenceOwner := personalViewFieldSetOwner(userID)
	rows, err := q.Query(`
		SELECT user_id, field_set_id
		FROM public.system_view_field_set_assignments
		WHERE table_uid = $1 AND view_id = $2
		  AND (user_id = $3 OR user_id IS NULL)`, tableUID, viewID, preferenceOwner)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var personalID, siteID *int64
	for rows.Next() {
		var assignmentUser sql.NullInt64
		var fieldSetID int64
		if err := rows.Scan(&assignmentUser, &fieldSetID); err != nil {
			return nil, nil, err
		}
		id := fieldSetID
		if assignmentUser.Valid {
			personalID = &id
		} else {
			siteID = &id
		}
	}
	return personalID, siteID, rows.Err()
}

// The built-in guest identity (user 1) authorizes public dataset reads but is
// not a person who may own or receive a personal presentation preference.
func personalViewFieldSetOwner(userID int64) sql.NullInt64 {
	if userID <= 1 {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: userID, Valid: true}
}
