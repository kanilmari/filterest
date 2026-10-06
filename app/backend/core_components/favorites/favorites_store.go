// favorites_store.go
// Resolves administrator tool routes to stable permission rows and persists personal favorites.
// Connects the shared registry, group grants and request-owned transaction.
// Exists to keep route identity across handler renames without trusting client row references.
package favorites

import (
	"context"
	"database/sql"
	"errors"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
)

// Every future target type must resolve its table/key on the server, check the
// caller's read permission before revealing existence, and filter GET by that
// permission. Client input must never become an SQL identifier. V1 resolves only
// admin_tool; integer system_functions primary keys are stored in decimal text.
const favoriteTargetJoin = `
    JOIN public.system_db_tables registry ON registry.table_uid = favorite.target_table_uid
      AND registry.table_name = 'system_functions'
      AND COALESCE(NULLIF(registry.schema_name, ''), 'public') = 'public'
    JOIN public.system_functions stored ON stored.id::text = favorite.target_key`

const grantedRoutePredicate = `
    EXISTS (SELECT 1 FROM public.system_functions allowed
        JOIN public.system_group_table_func_rights rights ON rights.function_id = allowed.id
        JOIN public.system_user_group_memberships membership ON membership.group_id = rights.user_group_id
        WHERE membership.user_id = $1 AND allowed.disabled = false
          AND allowed.url_route_endpoint = stored.url_route_endpoint)`

func readFavorites(ctx context.Context, userID int) ([]favorite, error) {
	rows, err := backend.Db.QueryContext(ctx, `
        SELECT id, url_route_endpoint, sort_order FROM (
            SELECT favorite.id, stored.url_route_endpoint, favorite.sort_order,
                   row_number() OVER (PARTITION BY stored.url_route_endpoint ORDER BY favorite.sort_order, favorite.id) AS position
            FROM public.system_favorites favorite `+favoriteTargetJoin+`
            WHERE favorite.user_id = $1 AND COALESCE(stored.url_route_endpoint, '') <> ''
              AND `+grantedRoutePredicate+`
        ) visible WHERE position = 1 ORDER BY sort_order, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []favorite{}
	for rows.Next() {
		item := favorite{Type: "admin_tool"}
		if err := rows.Scan(&item.ID, &item.Route, &item.SortOrder); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func cleanGoneFavorites(ctx context.Context, tx *sql.Tx, userID int) error {
	_, err := tx.ExecContext(ctx, `
        DELETE FROM public.system_favorites favorite USING public.system_db_tables registry
        WHERE favorite.user_id = $1 AND registry.table_uid = favorite.target_table_uid
          AND registry.table_name = 'system_functions'
          AND COALESCE(NULLIF(registry.schema_name, ''), 'public') = 'public'
          AND NOT EXISTS (SELECT 1 FROM public.system_functions stored WHERE stored.id::text = favorite.target_key)`, userID)
	return err
}

func findRouteFavorite(ctx context.Context, tx *sql.Tx, userID int, route string) (favorite, error) {
	item := favorite{Type: "admin_tool", Route: route}
	err := tx.QueryRowContext(ctx, `SELECT favorite.id, favorite.sort_order
        FROM public.system_favorites favorite `+favoriteTargetJoin+`
        WHERE favorite.user_id = $1 AND stored.url_route_endpoint = $2
        ORDER BY favorite.sort_order, favorite.id LIMIT 1`, userID, route).Scan(&item.ID, &item.SortOrder)
	return item, err
}

func addFavorite(ctx context.Context, userID int, route string) (favorite, bool, error) {
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		return favorite{}, false, errors.New("request transaction unavailable")
	}
	var tableUID int
	var targetKey string
	// Check the grant BEFORE returning an existing favorite. Several function
	// rows may share a route after a handler rename; the lowest granted id wins.
	err := tx.QueryRowContext(ctx, `
        SELECT registry.table_uid, allowed.id::text FROM public.system_functions allowed
        JOIN public.system_db_tables registry ON registry.table_name = 'system_functions'
          AND COALESCE(NULLIF(registry.schema_name, ''), 'public') = 'public'
        WHERE allowed.url_route_endpoint = $2 AND allowed.disabled = false
          AND EXISTS (SELECT 1 FROM public.system_group_table_func_rights rights
            JOIN public.system_user_group_memberships membership ON membership.group_id = rights.user_group_id
            WHERE rights.function_id = allowed.id AND membership.user_id = $1)
        ORDER BY allowed.id LIMIT 1`, userID, route).Scan(&tableUID, &targetKey)
	if errors.Is(err, sql.ErrNoRows) {
		return favorite{}, false, errTargetNotFound
	}
	if err != nil {
		return favorite{}, false, err
	}
	if err := cleanGoneFavorites(ctx, tx, userID); err != nil {
		return favorite{}, false, err
	}
	item, err := findRouteFavorite(ctx, tx, userID, route)
	if err == nil {
		return item, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return item, false, err
	}
	err = tx.QueryRowContext(ctx, `
        INSERT INTO public.system_favorites (user_id, target_table_uid, target_key, sort_order)
        SELECT $1, $2, $3, COALESCE(MAX(sort_order), 0) + 1 FROM public.system_favorites WHERE user_id = $1
        ON CONFLICT (user_id, target_table_uid, target_key) DO NOTHING
        RETURNING id, sort_order`, userID, tableUID, targetKey).Scan(&item.ID, &item.SortOrder)
	if errors.Is(err, sql.ErrNoRows) {
		item, err = findRouteFavorite(ctx, tx, userID, route)
		return item, false, err
	}
	return item, err == nil, err
}

func deleteFavorite(ctx context.Context, userID int, request favoriteRequest) (bool, error) {
	tx, ok := dbutils.RequireTx(ctx)
	if !ok {
		return false, errors.New("request transaction unavailable")
	}
	route := request.Route
	if request.ID > 0 {
		err := tx.QueryRowContext(ctx, `SELECT COALESCE(stored.url_route_endpoint, '')
            FROM public.system_favorites favorite `+favoriteTargetJoin+`
            WHERE favorite.user_id = $1 AND favorite.id = $2`, userID, request.ID).Scan(&route)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return false, err
		}
	}
	// Route-wide deletion deliberately needs no target grant or enabled state.
	// The id alternative also removes its own stale/route-cleared target.
	result, err := tx.ExecContext(ctx, `DELETE FROM public.system_favorites favorite
        WHERE favorite.user_id = $1 AND (favorite.id = $2 OR favorite.id IN (
            SELECT favorite.id FROM public.system_favorites favorite `+favoriteTargetJoin+`
            WHERE favorite.user_id = $1 AND stored.url_route_endpoint = NULLIF($3, '')))`, userID, request.ID, route)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if err := cleanGoneFavorites(ctx, tx, userID); err != nil {
		return false, err
	}
	return count > 0, nil
}
