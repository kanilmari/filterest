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
	"sort"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/permissions"
)

const maximumViewFieldSetGroupPriority = 1000000

type viewFieldSetAssignmentCandidate struct {
	FieldSetID    int64
	UserID        sql.NullInt64
	GroupID       sql.NullInt64
	GroupPriority int
}

func viewFieldSetAssignmentScope(candidate viewFieldSetAssignmentCandidate) string {
	if candidate.UserID.Valid {
		return "personal"
	}
	if candidate.GroupID.Valid {
		return "group"
	}
	return "site"
}

func chooseEffectiveViewFieldSetAssignment(
	candidates []viewFieldSetAssignmentCandidate,
) (viewFieldSetAssignmentCandidate, bool) {
	if len(candidates) == 0 {
		return viewFieldSetAssignmentCandidate{}, false
	}

	ordered := append([]viewFieldSetAssignmentCandidate(nil), candidates...)
	sort.SliceStable(ordered, func(leftIndex, rightIndex int) bool {
		left := ordered[leftIndex]
		right := ordered[rightIndex]
		leftScope := viewFieldSetAssignmentScope(left)
		rightScope := viewFieldSetAssignmentScope(right)
		rank := map[string]int{"personal": 3, "group": 2, "site": 1}
		if rank[leftScope] != rank[rightScope] {
			return rank[leftScope] > rank[rightScope]
		}
		if leftScope == "group" && left.GroupPriority != right.GroupPriority {
			return left.GroupPriority > right.GroupPriority
		}
		if leftScope == "group" && left.GroupID.Int64 != right.GroupID.Int64 {
			return left.GroupID.Int64 < right.GroupID.Int64
		}
		return left.FieldSetID < right.FieldSetID
	})
	return ordered[0], true
}

func normalizeViewFieldSetGroupTargets(groupIDs []int64, groupPriority int) ([]int64, error) {
	if groupPriority < -maximumViewFieldSetGroupPriority || groupPriority > maximumViewFieldSetGroupPriority {
		return nil, fmt.Errorf("group_priority must be between -%d and %d", maximumViewFieldSetGroupPriority, maximumViewFieldSetGroupPriority)
	}
	unique := make(map[int64]struct{}, len(groupIDs))
	normalized := make([]int64, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		if groupID <= 0 {
			return nil, fmt.Errorf("target_group_ids must contain positive IDs")
		}
		if _, exists := unique[groupID]; exists {
			continue
		}
		unique[groupID] = struct{}{}
		normalized = append(normalized, groupID)
	}
	if len(normalized) > 256 {
		return nil, fmt.Errorf("at most 256 target groups are allowed")
	}
	sort.Slice(normalized, func(leftIndex, rightIndex int) bool {
		return normalized[leftIndex] < normalized[rightIndex]
	})
	return normalized, nil
}

func normalizeViewFieldSetTargetScope(
	administratorScope bool,
	rawTargetScope string,
	groupIDs []int64,
) (string, error) {
	if !administratorScope {
		if strings.TrimSpace(rawTargetScope) != "" && strings.TrimSpace(rawTargetScope) != "personal" {
			return "", fmt.Errorf("personal field collections require target_scope personal")
		}
		return "personal", nil
	}

	targetScope := strings.ToLower(strings.TrimSpace(rawTargetScope))
	if targetScope == "" {
		if len(groupIDs) > 0 {
			return "groups", nil
		}
		return "site", nil
	}
	switch targetScope {
	case "site":
		if len(groupIDs) > 0 {
			return "", fmt.Errorf("target_scope site cannot contain target_group_ids")
		}
	case "groups":
		if len(groupIDs) == 0 {
			return "", fmt.Errorf("target_scope groups requires target_group_ids")
		}
	default:
		return "", fmt.Errorf("target_scope must be site or groups")
	}
	return targetScope, nil
}

func validateViewFieldSetGroupTargets(q dbutils.Querier, groupIDs []int64) error {
	for _, groupID := range groupIDs {
		var exists bool
		if err := q.QueryRow(`
			SELECT EXISTS (
				SELECT 1 FROM public.system_user_groups WHERE id = $1
			)`, groupID).Scan(&exists); err != nil {
			return fmt.Errorf("validate group %d: %w", groupID, err)
		}
		if !exists {
			return fmt.Errorf("target group %d does not exist", groupID)
		}
	}
	return nil
}

func upsertViewFieldSetAssignment(
	q dbutils.Querier,
	userID interface{},
	groupID interface{},
	tableUID, viewID int,
	fieldSetID, createdBy int64,
	groupPriority int,
) error {
	_, err := q.Exec(`
		INSERT INTO public.system_view_field_set_assignments
		    (user_id, group_id, table_uid, view_id, field_set_id, created_by, group_priority)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (user_id, group_id, table_uid, view_id)
		DO UPDATE SET field_set_id = EXCLUDED.field_set_id,
		              created_by = EXCLUDED.created_by,
		              group_priority = EXCLUDED.group_priority,
		              updated = now()`,
		userID, groupID, tableUID, viewID, fieldSetID, createdBy, groupPriority)
	return err
}

func saveViewFieldSetAssignments(
	q dbutils.Querier,
	userID int64,
	tableUID, viewID int,
	fieldSetID int64,
	administratorScope bool,
	groupIDs []int64,
	groupPriority int,
) (string, error) {
	if !administratorScope {
		return "personal", upsertViewFieldSetAssignment(
			q, userID, nil, tableUID, viewID, fieldSetID, userID, 0,
		)
	}
	if len(groupIDs) == 0 {
		return "site", upsertViewFieldSetAssignment(
			q, nil, nil, tableUID, viewID, fieldSetID, userID, 0,
		)
	}
	for _, groupID := range groupIDs {
		if err := upsertViewFieldSetAssignment(
			q, nil, groupID, tableUID, viewID, fieldSetID, userID, groupPriority,
		); err != nil {
			return "", err
		}
	}
	return "group", nil
}

// replaceSharedViewFieldSetAssignmentTargets removes the prior site/group
// targets for one shared collection in one view before its new exact target set
// is written. Assignments belonging to other collections remain untouched.
func replaceSharedViewFieldSetAssignmentTargets(
	q dbutils.Querier,
	tableUID, viewID int,
	fieldSetID int64,
) error {
	_, err := q.Exec(`
		DELETE FROM public.system_view_field_set_assignments
		WHERE table_uid = $1 AND view_id = $2 AND field_set_id = $3
		  AND user_id IS NULL`, tableUID, viewID, fieldSetID)
	return err
}

func viewFieldSetTargetReadbackMatches(
	fieldSetID int64,
	targetScope string,
	targetGroupIDs []int64,
	siteFieldSetID *int64,
	groupAssignments []viewFieldSetGroupAssignment,
) bool {
	groupsUsingFieldSet := make([]int64, 0)
	for _, assignment := range groupAssignments {
		if assignment.FieldSetID != nil && *assignment.FieldSetID == fieldSetID {
			groupsUsingFieldSet = append(groupsUsingFieldSet, assignment.GroupID)
		}
	}
	sort.Slice(groupsUsingFieldSet, func(leftIndex, rightIndex int) bool {
		return groupsUsingFieldSet[leftIndex] < groupsUsingFieldSet[rightIndex]
	})

	if targetScope == "site" {
		return siteFieldSetID != nil &&
			*siteFieldSetID == fieldSetID &&
			len(groupsUsingFieldSet) == 0
	}
	if siteFieldSetID != nil && *siteFieldSetID == fieldSetID {
		return false
	}
	if len(groupsUsingFieldSet) != len(targetGroupIDs) {
		return false
	}
	for index := range groupsUsingFieldSet {
		if groupsUsingFieldSet[index] != targetGroupIDs[index] {
			return false
		}
	}
	return true
}

func listViewFieldSetGroupAssignments(
	q dbutils.Querier,
	tableUID, viewID int,
) ([]viewFieldSetGroupAssignment, error) {
	rows, err := q.Query(`
		SELECT groups.id,
		       groups.name,
		       assignments.field_set_id,
		       COALESCE(assignments.group_priority, 0)
		FROM public.system_user_groups AS groups
		LEFT JOIN public.system_view_field_set_assignments AS assignments
		  ON assignments.group_id = groups.id
		 AND assignments.table_uid = $1
		 AND assignments.view_id = $2
		ORDER BY lower(groups.name), groups.id`, tableUID, viewID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	assignments := make([]viewFieldSetGroupAssignment, 0)
	for rows.Next() {
		var assignment viewFieldSetGroupAssignment
		var fieldSetID sql.NullInt64
		if err := rows.Scan(
			&assignment.GroupID,
			&assignment.GroupName,
			&fieldSetID,
			&assignment.GroupPriority,
		); err != nil {
			return nil, err
		}
		if fieldSetID.Valid {
			assignment.FieldSetID = &fieldSetID.Int64
		}
		assignments = append(assignments, assignment)
	}
	return assignments, rows.Err()
}

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
		 AND COALESCE(details.client_delivery_mode, 'include') = 'include'
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
	rows, err := q.Query(`
		SELECT assignments.field_set_id,
		       assignments.user_id,
		       assignments.group_id,
		       assignments.group_priority
		FROM public.system_view_field_set_assignments AS assignments
		WHERE assignments.table_uid = $1 AND assignments.view_id = $2
		  AND (
		      assignments.user_id = $3
		      OR (
		          assignments.group_id IS NOT NULL
		          AND EXISTS (
		              SELECT 1
		              FROM public.system_user_group_memberships AS memberships
		              WHERE memberships.user_id = $3
		                AND memberships.group_id = assignments.group_id
		          )
		      )
		      OR (assignments.user_id IS NULL AND assignments.group_id IS NULL)
		  )`, tableUID, viewID, preferenceOwner)
	if err != nil {
		return nil, "", nil, err
	}
	defer rows.Close()
	candidates := make([]viewFieldSetAssignmentCandidate, 0)
	for rows.Next() {
		var candidate viewFieldSetAssignmentCandidate
		if err := rows.Scan(
			&candidate.FieldSetID,
			&candidate.UserID,
			&candidate.GroupID,
			&candidate.GroupPriority,
		); err != nil {
			return nil, "", nil, err
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, "", nil, err
	}
	if candidate, found := chooseEffectiveViewFieldSetAssignment(candidates); found {
		columns, memberErr := viewFieldSetMemberNames(q, candidate.FieldSetID)
		fieldSetID := candidate.FieldSetID
		return &fieldSetID, viewFieldSetAssignmentScope(candidate), columns, memberErr
	}

	columns, err := metadataVisibleViewFieldColumns(q, tableUID, viewKey)
	return nil, "metadata", columns, err
}

// metadataVisibleViewFieldColumns returns the presentation fallback before any
// personal, group, or site assignment is applied. Keeping this read separate
// lets administrators edit the site layer without accidentally copying their
// own effective preference into the shared default.
func metadataVisibleViewFieldColumns(
	q dbutils.Querier,
	tableUID int,
	viewKey string,
) ([]string, error) {
	query := `
		SELECT column_name
		FROM public.system_column_details
		WHERE table_uid = $1 AND COALESCE(hide_everywhere, false) = false`
	query += ` AND COALESCE(client_delivery_mode, 'include') = 'include'`
	if viewKey == "card" {
		query += ` AND COALESCE(hide_on_small_card, false) = false`
	}
	query += ` ORDER BY co_number NULLS LAST, column_uid`
	rows, err := q.Query(query, tableUID)
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

func viewFieldSetMemberNames(q dbutils.Querier, fieldSetID int64) ([]string, error) {
	rows, err := q.Query(`
		SELECT details.column_name
		FROM public.system_column_field_set_members AS members
		JOIN public.system_column_details AS details ON details.column_uid = members.column_uid
		WHERE members.field_set_id = $1
		  AND COALESCE(details.hide_everywhere, false) = false
		  AND COALESCE(details.client_delivery_mode, 'include') = 'include'
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

func orderedSelectableViewFieldSetColumnDetails(
	q dbutils.Querier,
	tableUID int,
	allowed map[string]bool,
) ([]viewFieldSetColumn, error) {
	rows, err := q.Query(`
		SELECT column_uid, column_name
		FROM public.system_column_details
		WHERE table_uid = $1
		  AND COALESCE(hide_everywhere, false) = false
		  AND COALESCE(client_delivery_mode, 'include') = 'include'
		ORDER BY co_number NULLS LAST, column_uid`, tableUID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := make([]viewFieldSetColumn, 0)
	for rows.Next() {
		var column viewFieldSetColumn
		if err := rows.Scan(&column.ColumnUID, &column.ColumnName); err != nil {
			return nil, err
		}
		if allowed[column.ColumnName] {
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
		  AND group_id IS NULL
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
