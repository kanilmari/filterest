// article_baseline_reader.go
// Reads one repeatable, read-only snapshot of legacy article settings.
// Connects current projection readers to the offline K388 compatibility report.
// Never initializes the application, invokes migrations or accesses global caches.
package dtt_1_row_read

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strconv"

	"easelect/backend/core_components/permissions"
	contract "easelect/frontend/shared/article_presentations"
)

// ReadArticlePresentationBaseline accepts an explicitly supplied database only.
// PostgreSQL enforces READ ONLY for every reader, including shared helpers. The
// transaction always rolls back; a partial report is never returned as success.
func ReadArticlePresentationBaseline(ctx context.Context, db *sql.DB) (ArticleBaselineReport, error) {
	return readArticlePresentationSnapshot(ctx, db, false)
}

func readArticlePresentationSnapshot(ctx context.Context, db *sql.DB, after bool) (ArticleBaselineReport, error) {
	result := ArticleBaselineReport{Phase: "before", FormatVersion: 2, ContractVersion: contract.Read().Version,
		Scope: "current saved presentation settings before reader column grants and row-value visibility",
		Limitations: []string{
			"IFAV is source-dependent: normal opening uses the supplied row; history restoration fetches Article, not the configured IFAV projection.",
			"IFAV orders reported projection keys by role presence, positive co_number, then server JSON row-key order; this is not a single effective IFAV assignment.",
			"Additional row keys, suffix-sorted description/details, empty/false values, ownership, relation expansion and media are row-dependent; this settings report is not a rendered-row or reader-column-grant proof.",
			"Signed-in browser route rights include grants at any target scope; guest bootstrap uses the named guests group with NULL dataset scope. Article route audiences describe current grants only; dataset, row, column, media and login-to-browse checks still apply. Startup admin grants are not simulated.",
		}, Groups: []ArticleBaselineGroup{}, Users: []ArticleBaselineUser{}, Datasets: []ArticleBaselineDataset{}}
	if after {
		result.Phase = "after"
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return ArticleBaselineReport{}, err
	}
	defer tx.Rollback()
	if err := articlePresentationPhase(tx, after); err != nil {
		return ArticleBaselineReport{}, err
	}
	if err := articleBaselinePrincipals(tx, &result); err != nil {
		return ArticleBaselineReport{}, err
	}
	rows, err := tx.Query(`SELECT table_uid, table_name, COALESCE(NULLIF(schema_name,''),'public'),
        article_section_initial_open, to_jsonb(system_db_tables)->'article_opener_policy' FROM public.system_db_tables ORDER BY table_uid`)
	if err != nil {
		return ArticleBaselineReport{}, err
	}
	for rows.Next() {
		var dataset ArticleBaselineDataset
		// database/sql stores SQL NULL into *[]byte but not into a named byte slice like json.RawMessage. Both JSON
		// columns can be NULL here: the blocks column by data, the opener column on every pre-upgrade copy (it
		// arrives with migration 10, NOT NULL there). nil = absent; blocks keep the explicit "null" below.
		var storedBlocks, opener []byte
		if err := rows.Scan(&dataset.UID, &dataset.Name, &dataset.Schema, &storedBlocks, &opener); err != nil {
			rows.Close()
			return ArticleBaselineReport{}, err
		}
		dataset.StoredBlocks, dataset.OpenerPolicy = storedBlocks, opener
		if len(dataset.StoredBlocks) == 0 {
			dataset.StoredBlocks = []byte("null")
		}
		result.Datasets = append(result.Datasets, dataset)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return ArticleBaselineReport{}, err
	}
	rows.Close()
	for i := range result.Datasets {
		dataset := &result.Datasets[i]
		if err := articleBaselineDataset(tx, dataset, result.Users); err != nil {
			return ArticleBaselineReport{}, fmt.Errorf("dataset %d (%s): %w", dataset.UID, dataset.Name, err)
		}
	}
	return result, nil
}
func articleBaselinePrincipals(tx *sql.Tx, result *ArticleBaselineReport) error {
	rows, err := tx.Query(`SELECT id,name FROM public.system_user_groups ORDER BY id`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var group ArticleBaselineGroup
		if err := rows.Scan(&group.ID, &group.Name); err != nil {
			rows.Close()
			return err
		}
		result.Groups = append(result.Groups, group)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	rows, err = tx.Query(`SELECT users.id, memberships.group_id FROM public.system_users users
        LEFT JOIN public.system_user_group_memberships memberships ON memberships.user_id=users.id
        ORDER BY users.id,memberships.group_id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var group sql.NullInt64
		if err := rows.Scan(&id, &group); err != nil {
			return err
		}
		if len(result.Users) == 0 || result.Users[len(result.Users)-1].ID != id {
			result.Users = append(result.Users, ArticleBaselineUser{ID: id, GroupIDs: []int64{}})
		}
		if group.Valid {
			user := &result.Users[len(result.Users)-1]
			user.GroupIDs = append(user.GroupIDs, group.Int64)
		}
	}
	return rows.Err()
}
func articleBaselineDataset(tx *sql.Tx, dataset *ArticleBaselineDataset, users []ArticleBaselineUser) error {
	dataset.Blocks, dataset.BlockReadError = articleBaselineBlocks(dataset.StoredBlocks)
	assignments, views, err := articleBaselineAssignments(tx, dataset.UID)
	if err != nil {
		return err
	}
	columns, err := articleBaselineColumns(tx, dataset.UID)
	if err != nil {
		return err
	}
	contexts := []articleBaselineContext{{kind: "metadata"}, {kind: "site"}}
	personal, groups := map[int64]bool{}, map[int64]bool{}
	for _, a := range assignments {
		if a.userID.Valid {
			personal[a.userID.Int64] = true
		}
		if a.groupID.Valid {
			groups[a.groupID.Int64] = true
		}
	}
	for _, entry := range []struct {
		kind string
		ids  map[int64]bool
	}{{"group", groups}, {"personal", personal}} {
		ids := []int64{}
		for id := range entry.ids {
			ids = append(ids, id)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		for _, id := range ids {
			context := articleBaselineContext{kind: entry.kind, id: id}
			for _, user := range users {
				if user.ID == id && entry.kind == "personal" {
					context.groups = user.GroupIDs
				}
			}
			contexts = append(contexts, context)
		}
	}
	dataset.Targets = []ArticleBaselineTarget{}
	for _, target := range contexts {
		article, err := articleBaselineProjection(tx, *dataset, assignments, columns, target, "article_view")
		if err != nil {
			return err
		}
		ifav, err := articleBaselineIFAV(tx, *dataset, assignments, columns, target, views, article)
		if err != nil {
			return err
		}
		page, err := articleBaselineProjection(tx, *dataset, assignments, columns, target, "image_first_page_view")
		if err != nil {
			return err
		}
		output := ArticleBaselineTarget{Kind: target.kind, Article: article, IFAV: ifav, Page: page}
		if target.kind == "personal" || target.kind == "group" {
			id := target.id
			output.ID = &id
		}
		dataset.Targets = append(dataset.Targets, output)
	}
	route := *contract.Read().Presentations["article_view"].CurrentPermissionRoute
	dataset.Audience, err = articleBaselineAudience(tx, route, strconv.Itoa(dataset.UID))
	if err != nil {
		return err
	}
	dataset.Readers = []ArticleBaselineReader{}
	for _, user := range users {
		target := articleBaselineContext{kind: "reader", id: user.ID, groups: user.GroupIDs}
		article, err := articleBaselineProjection(tx, *dataset, assignments, columns, target, "article_view")
		if err != nil {
			return err
		}
		ifav, err := articleBaselineIFAV(tx, *dataset, assignments, columns, target, views, article)
		if err != nil {
			return err
		}
		allowed, err := permissions.CheckRouteTablePermission(tx, route, int(user.ID), permissions.RouteTableScope{}, permissions.StrictRouteTableOptions())
		if err != nil {
			return err
		}
		access, err := permissions.CheckRouteTablePermission(tx, route, int(user.ID), permissions.RouteTableScope{}, permissions.AccessControlRouteTableOptions(false))
		if err != nil {
			return err
		}
		browserAllowed := dataset.Audience.GuestAllowed
		if user.ID > 1 {
			browserAllowed = false
			for _, groupID := range user.GroupIDs {
				for _, allowedID := range dataset.Audience.GroupIDs {
					browserAllowed = browserAllowed || groupID == allowedID
				}
			}
		}
		page, err := articleBaselineProjection(tx, *dataset, assignments, columns, target, "image_first_page_view")
		if err != nil {
			return err
		}
		dataset.Readers = append(dataset.Readers, ArticleBaselineReader{Page: page, UserID: user.ID, Article: article, IFAV: ifav, ArticleRouteAllowed: browserAllowed, ArticleRouteTablelessAllowed: allowed, ArticleRouteAccessControlAllowed: access})
	}
	return nil
}
func articleBaselineAssignments(tx *sql.Tx, uid int) ([]articleBaselineAssignment, []string, error) {
	rows, err := tx.Query(`SELECT a.id,a.field_set_id,a.user_id,a.group_id,a.group_priority,v.view_key
        FROM public.system_view_field_set_assignments a JOIN public.system_table_views v ON v.id=a.view_id
        WHERE a.table_uid=$1 ORDER BY a.id`, uid)
	if err != nil {
		return nil, nil, err
	}
	assignments := []articleBaselineAssignment{}
	for rows.Next() {
		var a articleBaselineAssignment
		if err := rows.Scan(&a.id, &a.setID, &a.userID, &a.groupID, &a.priority, &a.view); err != nil {
			rows.Close()
			return nil, nil, err
		}
		assignments = append(assignments, a)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, err
	}
	rows.Close()
	rows, err = tx.Query(`SELECT view_key FROM public.system_table_views ORDER BY view_key,id`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	keys := map[string]bool{"article_view": true, "card": true}
	views := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, nil, err
		}
		keys[normalizeResultsViewKey(key)] = true
	}
	for key := range keys {
		views = append(views, key)
	}
	sort.Strings(views)
	return assignments, views, rows.Err()
}
func articleBaselineColumns(tx *sql.Tx, uid int) (map[string]ArticleBaselineField, error) {
	rows, err := tx.Query(`SELECT column_uid,column_name,COALESCE(card_element,''),COALESCE(co_number,0),
        COALESCE(hide_on_bg_crd_if_not_own,false),COALESCE(hide_false_null_on_big_crd,false)
        FROM public.system_column_details WHERE table_uid=$1 ORDER BY column_uid`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns := map[string]ArticleBaselineField{}
	for rows.Next() {
		var f ArticleBaselineField
		var id int64
		if err := rows.Scan(&id, &f.Name, &f.Role, &f.CoNumber, &f.HideUnlessOwn, &f.HideFalseNull); err != nil {
			return nil, err
		}
		f.UID = &id
		columns[f.Name] = f
	}
	return columns, rows.Err()
}
