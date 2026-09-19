// route_function_identity.go
// Preserves the database identity of a registered address across safe Go handler renames.
// Connects startup route registration with stored function rows and their permission grants.
// Exists so a code-only rename cannot silently detach administrator-granted access.
package router

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
)

type routeFunctionCandidate struct {
	id             int
	name           string
	isActive       bool
	isBackendRoute bool
}

// tryAdoptRenamedRouteFunction preserves a route row, and therefore its grants,
// only when the endpoint identifies one active handler that this startup no
// longer registers. Frontend-only permission rows belong to a separate registry.
func tryAdoptRenamedRouteFunction(
	db *sql.DB,
	rd RouteDefinition,
	registeredHandlerNames map[string]bool,
) (int, bool, error) {
	tx, err := db.Begin()
	if err != nil {
		return 0, false, fmt.Errorf("begin renamed route adoption: %w", err)
	}
	defer func() {
		_ = tx.Rollback()
	}()

	rows, err := tx.Query(`
		SELECT id, name, disabled IS FALSE, ui_only IS FALSE
		  FROM system_functions
		 WHERE url_route_endpoint = $1
		   AND ui_only IS NOT TRUE
		 ORDER BY id
		 FOR UPDATE
	`, rd.UrlPattern)
	if err != nil {
		return 0, false, fmt.Errorf("find route rows for address %q: %w", rd.UrlPattern, err)
	}

	var candidates []routeFunctionCandidate
	for rows.Next() {
		var candidate routeFunctionCandidate
		if err := rows.Scan(
			&candidate.id,
			&candidate.name,
			&candidate.isActive,
			&candidate.isBackendRoute,
		); err != nil {
			_ = rows.Close()
			return 0, false, fmt.Errorf("read route row for address %q: %w", rd.UrlPattern, err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, false, fmt.Errorf("read route rows for address %q: %w", rd.UrlPattern, err)
	}
	if err := rows.Close(); err != nil {
		return 0, false, fmt.Errorf("close route rows for address %q: %w", rd.UrlPattern, err)
	}

	if len(candidates) == 0 {
		return 0, false, nil
	}
	if len(candidates) > 1 {
		candidateNames := make([]string, 0, len(candidates))
		for _, candidate := range candidates {
			state := "disabled"
			if candidate.isActive {
				state = "active"
			}
			candidateNames = append(candidateNames, fmt.Sprintf("%q (%s)", candidate.name, state))
		}
		log.Printf(
			"route adoption skipped for address %q and new handler %q: ambiguous non-UI rows: %s; inserting a new row",
			rd.UrlPattern,
			rd.HandlerName,
			strings.Join(candidateNames, ", "),
		)
		return 0, false, nil
	}

	candidate := candidates[0]
	if !candidate.isBackendRoute {
		log.Printf(
			"route adoption skipped for address %q and new handler %q: candidate %q is not explicitly classified as a backend route, so startup will not retire it; inserting a new row",
			rd.UrlPattern,
			rd.HandlerName,
			candidate.name,
		)
		return 0, false, nil
	}
	if !candidate.isActive {
		log.Printf(
			"route adoption skipped for address %q and new handler %q: candidate %q is not active (disabled is true or unset), so startup will not retire it; inserting a new row",
			rd.UrlPattern,
			rd.HandlerName,
			candidate.name,
		)
		return 0, false, nil
	}
	if registeredHandlerNames[candidate.name] {
		log.Printf(
			"route adoption skipped for address %q and new handler %q: candidate %q is still claimed by a handler registered in this startup; inserting a new row",
			rd.UrlPattern,
			rd.HandlerName,
			candidate.name,
		)
		return 0, false, nil
	}

	var grantCount int
	if err := tx.QueryRow(`
		SELECT COUNT(*)
		  FROM system_group_table_func_rights
		 WHERE function_id = $1
	`, candidate.id).Scan(&grantCount); err != nil {
		return 0, false, fmt.Errorf("count grants for route row %d: %w", candidate.id, err)
	}

	result, err := tx.Exec(`
		UPDATE system_functions
		   SET name = $1,
		       "package" = $2
		 WHERE id = $3
		   AND name = $4
		   AND url_route_endpoint = $5
		   AND disabled IS FALSE
		   AND ui_only IS FALSE
	`,
		rd.HandlerName,
		getPackageNameFromHandler(rd.HandlerName),
		candidate.id,
		candidate.name,
		rd.UrlPattern,
	)
	if err != nil {
		return 0, false, fmt.Errorf("rename route row %d: %w", candidate.id, err)
	}
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, false, fmt.Errorf("read renamed route row count for %d: %w", candidate.id, err)
	}
	if rowsAffected != 1 {
		return 0, false, fmt.Errorf("rename route row %d affected %d rows, want 1", candidate.id, rowsAffected)
	}
	if err := tx.Commit(); err != nil {
		return 0, false, fmt.Errorf("commit renamed route adoption for row %d: %w", candidate.id, err)
	}

	log.Printf(
		"adopted route address %q: handler %q renamed to %q; %d permission grants travelled with row %d",
		rd.UrlPattern,
		candidate.name,
		rd.HandlerName,
		grantCount,
		candidate.id,
	)
	return candidate.id, true, nil
}

func registerMissingRouteFunction(
	db *sql.DB,
	rd RouteDefinition,
	registeredHandlerNames map[string]bool,
	packageName string,
	rateLimitAmount int,
	rateLimitMinutes int,
) (int, error) {
	if adoptedID, adopted, err := tryAdoptRenamedRouteFunction(db, rd, registeredHandlerNames); err != nil {
		return 0, err
	} else if adopted {
		return adoptedID, nil
	}

	var insertedID int
	err := db.QueryRow(`
		INSERT INTO system_functions (
			name,
			"package",
			disabled,
			specific_table_related,
			url_route_endpoint,
			rate_limit_amount,
			rate_limit_minutes,
			ui_only
		)
		VALUES ($1, $2, false, $3, $4, $5, $6, $7)
		RETURNING id
	`,
		rd.HandlerName,
		packageName,
		defaultSpecificTableRelated(rd.HandlerName),
		rd.UrlPattern,
		rateLimitAmount,
		rateLimitMinutes,
		false,
	).Scan(&insertedID)
	if err != nil {
		return 0, fmt.Errorf("insert route function %q: %w", rd.HandlerName, err)
	}
	return insertedID, nil
}
