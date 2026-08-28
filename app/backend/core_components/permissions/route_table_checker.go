// route_table_checker.go
// Provides canonical route/table permission checks for backend callers.
// Bridges permission principals, route metadata, table scopes, and rights rows.
// Exists so AI/tool paths and HTTP routes can reuse the same permission helper layer.
package permissions

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	"easelect/backend/core_components/dbutils"

	"github.com/lib/pq"
)

// DisabledFunctionPolicy controls how route permission queries treat disabled functions.
type DisabledFunctionPolicy int

const (
	// DisabledFunctionStrictFalse matches existing frontend permission batching behavior.
	DisabledFunctionStrictFalse DisabledFunctionPolicy = iota
	// DisabledFunctionFalseOrNull matches access-control's legacy enabled-route lookup.
	DisabledFunctionFalseOrNull
	// DisabledFunctionIgnored preserves legacy access-control permission-row lookups.
	DisabledFunctionIgnored
)

// Principal identifies the current permission actor.
type Principal struct {
	UserID int
}

// RouteTableScope identifies the optional dataset/table target for a route permission.
type RouteTableScope struct {
	TableName string
	TableUID  string
}

// RouteTablePermissionOptions keeps legacy callers explicit about small behavior differences.
type RouteTablePermissionOptions struct {
	DisabledPolicy         DisabledFunctionPolicy
	AllowMissingPermission bool
}

// PermissionContext binds a database queryer to the principal being checked.
type PermissionContext struct {
	queryer   dbutils.Querier
	principal Principal
}

// NewPermissionContext creates a reusable permission context for one principal.
func NewPermissionContext(queryer dbutils.Querier, userID int) PermissionContext {
	return PermissionContext{
		queryer: queryer,
		principal: Principal{
			UserID: userID,
		},
	}
}

// StrictRouteTableOptions returns the behavior used by current auth permission endpoints.
func StrictRouteTableOptions() RouteTablePermissionOptions {
	return RouteTablePermissionOptions{
		DisabledPolicy: DisabledFunctionStrictFalse,
	}
}

// AccessControlRouteTableOptions returns the behavior used by the route pipeline.
func AccessControlRouteTableOptions(allowMissingPermission bool) RouteTablePermissionOptions {
	return RouteTablePermissionOptions{
		DisabledPolicy:         DisabledFunctionIgnored,
		AllowMissingPermission: allowMissingPermission,
	}
}

// NormalizeRouteEndpoints trims, removes blanks, and preserves first-seen route order.
func NormalizeRouteEndpoints(routes []string) []string {
	seen := make(map[string]struct{}, len(routes))
	normalized := make([]string, 0, len(routes))
	for _, route := range routes {
		trimmed := strings.TrimSpace(route)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		normalized = append(normalized, trimmed)
	}
	return normalized
}

// Normalize trims a route/table scope without changing its meaning.
func (scope RouteTableScope) Normalize() RouteTableScope {
	return RouteTableScope{
		TableName: strings.TrimSpace(scope.TableName),
		TableUID:  strings.TrimSpace(scope.TableUID),
	}
}

// Tableless reports whether the scope is capability-only instead of dataset-specific.
func (scope RouteTableScope) Tableless() bool {
	scope = scope.Normalize()
	return scope.TableName == "" && scope.TableUID == ""
}

// LookupTableUIDByName returns the table_uid for a table name as a string.
func LookupTableUIDByName(queryer dbutils.Querier, tableName string) (string, error) {
	tableName = strings.TrimSpace(tableName)
	if tableName == "" {
		return "", fmt.Errorf("missing table name")
	}

	var tableUID int64
	if err := queryer.QueryRow(
		`SELECT table_uid FROM system_db_tables WHERE table_name = $1`,
		tableName,
	).Scan(&tableUID); err != nil {
		return "", err
	}
	return strconv.FormatInt(tableUID, 10), nil
}

// ResolveRouteTableScope adds a table UID when only a table name is known.
func ResolveRouteTableScope(queryer dbutils.Querier, scope RouteTableScope) (RouteTableScope, error) {
	scope = scope.Normalize()
	if scope.TableUID != "" || scope.TableName == "" {
		return scope, nil
	}

	tableUID, err := LookupTableUIDByName(queryer, scope.TableName)
	if err != nil {
		return scope, err
	}
	scope.TableUID = tableUID
	return scope, nil
}

// FunctionSpecificTableRelated returns whether a route is dataset-specific.
func FunctionSpecificTableRelated(queryer dbutils.Querier, route string, disabledPolicy DisabledFunctionPolicy) (bool, error) {
	route = strings.TrimSpace(route)
	if route == "" {
		return false, fmt.Errorf("missing route endpoint")
	}

	var specificTableRelated bool
	if err := queryer.QueryRow(buildFunctionSpecificTableRelatedQuery(disabledPolicy), route).Scan(&specificTableRelated); err != nil {
		return false, err
	}
	return specificTableRelated, nil
}

// HasRouteTablePermission checks one route permission in the current context.
func (ctx PermissionContext) HasRouteTablePermission(route string, scope RouteTableScope, options RouteTablePermissionOptions) (bool, error) {
	return CheckRouteTablePermission(ctx.queryer, route, ctx.principal.UserID, scope, options)
}

// QueryAllowedRoutes checks a batch of route permissions in the current context.
func (ctx PermissionContext) QueryAllowedRoutes(routes []string, scope RouteTableScope, options RouteTablePermissionOptions) (map[string]bool, error) {
	return QueryAllowedRoutes(ctx.queryer, routes, ctx.principal.UserID, scope, options)
}

// CheckRouteTablePermission checks one route permission for a principal and optional table scope.
func CheckRouteTablePermission(queryer dbutils.Querier, route string, userID int, scope RouteTableScope, options RouteTablePermissionOptions) (bool, error) {
	route = strings.TrimSpace(route)
	if route == "" || userID <= 0 {
		return false, nil
	}

	query, args := buildRouteTablePermissionQuery(route, userID, scope, options.DisabledPolicy, false)
	var dummy int
	if err := queryer.QueryRow(query, args...).Scan(&dummy); err != nil {
		if err == sql.ErrNoRows {
			return options.AllowMissingPermission, nil
		}
		return false, err
	}
	return true, nil
}

// QueryAllowedRoutes checks several route permissions for one principal and table scope.
func QueryAllowedRoutes(queryer dbutils.Querier, routes []string, userID int, scope RouteTableScope, options RouteTablePermissionOptions) (map[string]bool, error) {
	routes = NormalizeRouteEndpoints(routes)
	allowedByRoute := make(map[string]bool, len(routes))
	for _, route := range routes {
		allowedByRoute[route] = false
	}
	if len(routes) == 0 || userID <= 0 {
		return allowedByRoute, nil
	}

	query, args := buildRouteTablePermissionQuery("", userID, scope, options.DisabledPolicy, true)
	args = append([]interface{}{pq.Array(routes)}, args...)

	rows, err := queryer.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var route string
		if err := rows.Scan(&route); err != nil {
			return nil, err
		}
		allowedByRoute[route] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return allowedByRoute, nil
}

func buildRouteTablePermissionQuery(route string, userID int, scope RouteTableScope, disabledPolicy DisabledFunctionPolicy, batch bool) (string, []interface{}) {
	scope = scope.Normalize()

	selectClause := `SELECT 1`
	whereRouteClause := `f.url_route_endpoint = $1`
	args := []interface{}{route, userID}
	userIDPlaceholder := `$2`
	nextPlaceholder := 3

	if batch {
		selectClause = `SELECT DISTINCT f.url_route_endpoint`
		whereRouteClause = `f.url_route_endpoint = ANY($1)`
		args = []interface{}{userID}
		userIDPlaceholder = `$2`
		nextPlaceholder = 3
	}

	query := selectClause + `
                 FROM system_group_table_func_rights gf
                 JOIN system_functions f ON gf.function_id = f.id
                 JOIN system_user_group_memberships ug ON gf.user_group_id = ug.group_id`

	var scopeClause string
	switch {
	case scope.TableUID != "":
		scopeClause = fmt.Sprintf(`AND gf.target_table_uid = $%d`, nextPlaceholder)
		args = append(args, scope.TableUID)
	case scope.TableName != "":
		query += `
                 JOIN system_db_tables sdt ON sdt.table_uid = gf.target_table_uid`
		scopeClause = fmt.Sprintf(`AND sdt.table_name = $%d`, nextPlaceholder)
		args = append(args, scope.TableName)
	default:
		scopeClause = `AND gf.target_table_uid IS NULL`
	}

	query += fmt.Sprintf(`
                 WHERE %s
                   AND ug.user_id = %s
                   %s
                   %s`, whereRouteClause, userIDPlaceholder, scopeClause, disabledClause(disabledPolicy))

	if !batch {
		query += `
                  LIMIT 1`
	}

	return query, args
}

func buildFunctionSpecificTableRelatedQuery(disabledPolicy DisabledFunctionPolicy) string {
	query := `SELECT COALESCE(specific_table_related, true) FROM system_functions WHERE url_route_endpoint = $1`
	if clause := disabledColumnClause(disabledPolicy, ""); clause != "" {
		query += clause
	}
	query += ` LIMIT 1`
	return query
}

func disabledClause(policy DisabledFunctionPolicy) string {
	return disabledColumnClause(policy, "f")
}

func disabledColumnClause(policy DisabledFunctionPolicy, qualifier string) string {
	columnName := "disabled"
	if qualifier != "" {
		columnName = qualifier + "." + columnName
	}

	switch policy {
	case DisabledFunctionStrictFalse:
		return ` AND ` + columnName + ` = false`
	case DisabledFunctionFalseOrNull:
		return ` AND (` + columnName + ` = false OR ` + columnName + ` IS NULL)`
	case DisabledFunctionIgnored:
		return ``
	default:
		return ` AND ` + columnName + ` = false`
	}
}
