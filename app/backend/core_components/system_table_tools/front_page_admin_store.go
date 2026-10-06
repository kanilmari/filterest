// front_page_admin_store.go
// Saves front page scopes under transaction locks with optimistic versions.
// Connects the administrator request transaction, registered content datasets and settings.
// Retains a timestamp after reset so an old empty editor cannot overwrite newer work.
package system_table_tools

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

func frontPageScopeKey(scope int) string { return "front_page_scope_version:" + strconv.Itoa(scope) }

func lockFrontPageScope(tx *sql.Tx, scope int, shared bool) error {
	function := "pg_advisory_xact_lock"
	if shared {
		function = "pg_advisory_xact_lock_shared"
	}
	_, err := tx.Exec(`SELECT `+function+`(hashtextextended($1,0))`, frontPageScopeKey(scope))
	return err
}

func frontPageScopeVersion(q dbutils.Querier, scope int) (string, error) {
	var version string
	err := q.QueryRow(`SELECT COALESCE(GREATEST(
        (SELECT MAX(updated) FROM public.system_front_page_blocks WHERE user_id IS NOT DISTINCT FROM NULLIF($1,0)::bigint),
		(SELECT revision FROM public.system_front_page_revisions WHERE user_id IS NOT DISTINCT FROM NULLIF($1,0)::bigint))::text, 'none')`,
		scope).Scan(&version)
	return version, err
}

func advanceFrontPageScopeVersion(tx *sql.Tx, scope int) (string, error) {
	var version string
	// Reset keeps private editor state, while the account FK owns its deletion.
	// greatest() makes rapid writes monotonic under the scope's transaction lock.
	err := tx.QueryRow(`INSERT INTO public.system_front_page_revisions (user_id,revision)
        VALUES (NULLIF($1,0)::bigint, clock_timestamp())
        ON CONFLICT (user_id) DO UPDATE SET revision = GREATEST(clock_timestamp(),
            public.system_front_page_revisions.revision + interval '1 microsecond')
        RETURNING revision::text`, scope).Scan(&version)
	return version, err
}

func saveFrontPageAdminRequest(ctx context.Context, request frontPageAdminRequest) (string, error) {
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		return "", fmt.Errorf("request transaction unavailable")
	}
	if request.Settings != nil {
		for _, setting := range []struct {
			key   string
			value bool
		}{
			{"separate_front_page", *request.Settings.SeparateFrontPage},
			{"front_page_button_shows_site_name", *request.Settings.FrontPageButtonShowsSiteName},
		} {
			if _, err := tx.Exec(`INSERT INTO public.system_config (key,boolean_value,json_value,text_value,value_type,creation_spec)
                VALUES ($1,$2,jsonb_build_object('value',$2::boolean),$2::text,2,'Site-wide front page presentation switch.')
                ON CONFLICT (key) DO UPDATE SET boolean_value=EXCLUDED.boolean_value,json_value=EXCLUDED.json_value,
                    text_value=EXCLUDED.text_value,value_type=2,updated=now()`, setting.key, setting.value); err != nil {
				return "", err
			}
		}
		return "", nil
	}
	scope := 0
	if request.UserID != nil {
		scope = *request.UserID
	}
	if scope != 0 {
		// Hold account existence until commit: a concurrent deletion must either
		// cascade this save's metadata or finish first and make this request fail.
		var accountID int
		err := tx.QueryRow(`SELECT id FROM public.system_users WHERE id=$1 AND id>1 FOR KEY SHARE`, scope).Scan(&accountID)
		if err == sql.ErrNoRows {
			return "", errFrontPageInput
		}
		if err != nil {
			return "", err
		}
	}
	if request.CopyFromCommon != nil {
		if err := lockFrontPageScope(tx, 0, true); err != nil {
			return "", err
		}
	}
	if err := lockFrontPageScope(tx, scope, false); err != nil {
		return "", err
	}
	current, err := frontPageScopeVersion(tx, scope)
	if err != nil {
		return "", err
	}
	if current != request.Version {
		return "", errFrontPageConflict
	}
	blocks := []frontPageBlockInput{}
	if request.Blocks != nil {
		blocks = *request.Blocks
	}
	if request.CopyFromCommon != nil {
		common, err := readFrontPageBlocks(tx, 0)
		if err != nil {
			return "", err
		}
		if len(common) == 0 {
			common, err = defaultFrontPageBlocks(tx, scope)
			if err != nil {
				return "", err
			}
		}
		for _, block := range common {
			blocks = append(blocks, frontPageBlockInput{
				Dataset: block.Dataset, ResultLimit: block.ResultLimit, SortOrder: block.SortOrder, Enabled: block.Enabled})
		}
	}
	if err := validateFrontPageBlockInputs(blocks); err != nil {
		return "", err
	}
	// Resolve every name BEFORE deleting anything. No client-supplied SQL identifiers.
	uids := make([]int, len(blocks))
	for index, block := range blocks {
		err := tx.QueryRow(`SELECT registry.table_uid FROM public.system_db_tables registry
            WHERE registry.table_name=$1 AND COALESCE(NULLIF(registry.schema_name,''),'public')='public'
              AND registry.table_name NOT IN ('system_users','system_about')
              AND public.app_row_actor_side_table_reason(registry.table_name) IS NULL
              AND EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_schema='public'
                  AND col.table_name=registry.table_name AND col.column_name IN ('created','created_at','applied_at','id'))`, block.Dataset).Scan(&uids[index])
		if err == sql.ErrNoRows || !backend.ShouldExposeCloudManagementDatasetName(block.Dataset) {
			return "", errFrontPageInput
		}
		if err != nil {
			return "", err
		}
	}
	if _, err := tx.Exec(`DELETE FROM public.system_front_page_blocks WHERE user_id IS NOT DISTINCT FROM NULLIF($1,0)::bigint`, scope); err != nil {
		return "", err
	}
	for index, block := range blocks {
		if _, err := tx.Exec(`INSERT INTO public.system_front_page_blocks (user_id,table_uid,result_limit,sort_order,enabled)
            VALUES (NULLIF($1,0)::bigint,$2,$3,$4,$5)`, scope, uids[index], block.ResultLimit, block.SortOrder, block.Enabled); err != nil {
			return "", err
		}
	}
	return advanceFrontPageScopeVersion(tx, scope)
}

func searchFrontPageUsers(query string) ([]map[string]any, error) {
	query = strings.TrimSpace(query)
	if len(query) > 100 {
		return nil, errFrontPageInput
	}
	// username is the current public display name, per UserDisplayName. Credential
	// tables and login identifiers are deliberately absent from this query.
	query = strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(query)
	rows, err := backend.Db.Query(`SELECT id,username FROM public.system_users
        WHERE id>1 AND username ILIKE $1 ORDER BY username,id LIMIT 20`, "%"+query+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []map[string]any{}
	for rows.Next() {
		var id int
		var displayName string
		if err := rows.Scan(&id, &displayName); err != nil {
			return nil, err
		}
		users = append(users, map[string]any{"user_id": id, "display_name": displayName})
	}
	return users, rows.Err()
}
