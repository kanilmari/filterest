// db_role_management_handlers.go
// API handlers for PostgreSQL role management, providing full CRUD operations
// via HTTP endpoints so admins can create, update, and delete database roles
// without direct SQL or shell access. All operations require admin-level access.
package db_admin

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/security"
)

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

// RoleInfo represents a PostgreSQL role with its key attributes.
type RoleInfo struct {
	Name        string `json:"name"`
	CanLogin    bool   `json:"can_login"`
	IsSuperUser bool   `json:"is_superuser"`
	CreateDB    bool   `json:"create_db"`
	CreateRole  bool   `json:"create_role"`
	Inherit     bool   `json:"inherit"`
	ConnLimit   int    `json:"conn_limit"`
}

// CreateRoleRequest is the expected JSON body for role creation.
type CreateRoleRequest struct {
	Name     string `json:"name"`
	Password string `json:"password"`
	CanLogin bool   `json:"can_login"`
}

// UpdateRoleRequest is the expected JSON body for role modification.
type UpdateRoleRequest struct {
	Name        string  `json:"name"`
	NewPassword *string `json:"new_password,omitempty"`
	CanLogin    *bool   `json:"can_login,omitempty"`
}

// DeleteRoleRequest is the expected JSON body for role deletion.
type DeleteRoleRequest struct {
	Name string `json:"name"`
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

// protectedRoles are system roles that must not be modified or deleted via API.
var protectedRoles = map[string]bool{
	"mcpuser":    true,
	"postgres":   true,
	"admin_user": true,
}

// isProtectedRole returns true if the role name is a system-critical role.
func isProtectedRole(name string) bool {
	return protectedRoles[strings.ToLower(name)]
}

// jsonError writes a JSON error response.
func jsonError(w http.ResponseWriter, message string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// jsonOK writes a JSON success response.
func jsonOK(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/db-roles — List all database roles
// ──────────────────────────────────────────────────────────────────────────────

// ListRolesHandler returns a JSON array of all non-internal PostgreSQL roles.
func ListRolesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	query := `
		SELECT
			rolname,
			rolcanlogin,
			rolsuper,
			rolcreatedb,
			rolcreaterole,
			rolinherit,
			rolconnlimit
		FROM pg_roles
		WHERE rolname NOT LIKE 'pg_%'
		ORDER BY rolname
	`

	rows, err := backend.Db.Query(query)
	if err != nil {
		log.Printf("\033[31merror: [db_admin] list roles: %v\033[0m", err)
		jsonError(w, "database query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	roles := make([]RoleInfo, 0)
	for rows.Next() {
		var role RoleInfo
		if err := rows.Scan(
			&role.Name,
			&role.CanLogin,
			&role.IsSuperUser,
			&role.CreateDB,
			&role.CreateRole,
			&role.Inherit,
			&role.ConnLimit,
		); err != nil {
			log.Printf("[db_admin] ListRoles scan error: %v", err)
			continue
		}
		roles = append(roles, role)
	}

	jsonOK(w, roles)
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/db-roles/create — Create a new database role
// ──────────────────────────────────────────────────────────────────────────────

// CreateRoleHandler creates a new PostgreSQL role with LOGIN and a password.
func CreateRoleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CreateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Name == "" || req.Password == "" {
		jsonError(w, "name and password are required", http.StatusBadRequest)
		return
	}

	// Sanitize role name to prevent SQL injection in identifier position
	safeName, err := security.SanitizeIdentifier(req.Name)
	if err != nil {
		jsonError(w, fmt.Sprintf("invalid role name: %v", err), http.StatusBadRequest)
		return
	}

	if isProtectedRole(safeName) {
		jsonError(w, "cannot create a role with a protected name", http.StatusForbidden)
		return
	}

	// Check if role already exists
	var exists bool
	err = backend.Db.QueryRow(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, safeName).Scan(&exists)
	if err != nil {
		log.Printf("[db_admin] CreateRole check error: %v", err)
		jsonError(w, "database error", http.StatusInternalServerError)
		return
	}
	if exists {
		jsonError(w, fmt.Sprintf("role '%s' already exists", safeName), http.StatusConflict)
		return
	}

	// Build CREATE ROLE statement
	// Note: Password must be provided as a literal in CREATE ROLE (cannot be parameterized)
	// The role name is sanitized via SanitizeIdentifier.
	loginClause := "NOLOGIN"
	if req.CanLogin {
		loginClause = "LOGIN"
	}

	createSQL := fmt.Sprintf(
		"CREATE ROLE %s WITH %s PASSWORD %s",
		safeName,
		loginClause,
		quoteStringLiteral(req.Password),
	)

	if _, err := backend.Db.Exec(createSQL); err != nil {
		log.Printf("[db_admin] CreateRole exec error: %v", err)
		jsonError(w, fmt.Sprintf("failed to create role: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[db_admin] Role created: %s (login=%v)", safeName, req.CanLogin)
	w.WriteHeader(http.StatusCreated)
	jsonOK(w, map[string]string{"message": fmt.Sprintf("role '%s' created", safeName)})
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/db-roles/update — Modify a database role (password, login)
// ──────────────────────────────────────────────────────────────────────────────

// UpdateRoleHandler modifies an existing PostgreSQL role.
func UpdateRoleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req UpdateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		jsonError(w, "name is required", http.StatusBadRequest)
		return
	}

	safeName, err := security.SanitizeIdentifier(req.Name)
	if err != nil {
		jsonError(w, fmt.Sprintf("invalid role name: %v", err), http.StatusBadRequest)
		return
	}

	if isProtectedRole(safeName) {
		jsonError(w, "cannot modify a protected role", http.StatusForbidden)
		return
	}

	// Verify role exists
	var exists bool
	if err := backend.Db.QueryRow(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1)`, safeName).Scan(&exists); err != nil || !exists {
		jsonError(w, fmt.Sprintf("role '%s' not found", safeName), http.StatusNotFound)
		return
	}

	// Build ALTER ROLE clauses
	alterClauses := make([]string, 0)

	if req.NewPassword != nil && *req.NewPassword != "" {
		alterClauses = append(alterClauses, fmt.Sprintf("PASSWORD %s", quoteStringLiteral(*req.NewPassword)))
	}
	if req.CanLogin != nil {
		if *req.CanLogin {
			alterClauses = append(alterClauses, "LOGIN")
		} else {
			alterClauses = append(alterClauses, "NOLOGIN")
		}
	}

	if len(alterClauses) == 0 {
		jsonError(w, "no changes specified (provide new_password and/or can_login)", http.StatusBadRequest)
		return
	}

	alterSQL := fmt.Sprintf("ALTER ROLE %s WITH %s", safeName, strings.Join(alterClauses, " "))
	if _, err := backend.Db.Exec(alterSQL); err != nil {
		log.Printf("[db_admin] UpdateRole exec error: %v", err)
		jsonError(w, fmt.Sprintf("failed to update role: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[db_admin] Role updated: %s", safeName)
	jsonOK(w, map[string]string{"message": fmt.Sprintf("role '%s' updated", safeName)})
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/db-roles/delete — Drop a database role
// ──────────────────────────────────────────────────────────────────────────────

// DeleteRoleHandler drops a PostgreSQL role. Protected roles cannot be deleted.
func DeleteRoleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req DeleteRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		jsonError(w, "name is required", http.StatusBadRequest)
		return
	}

	safeName, err := security.SanitizeIdentifier(req.Name)
	if err != nil {
		jsonError(w, fmt.Sprintf("invalid role name: %v", err), http.StatusBadRequest)
		return
	}

	if isProtectedRole(safeName) {
		jsonError(w, "cannot delete a protected role", http.StatusForbidden)
		return
	}

	// Check current ownership to warn
	var ownedCount int
	_ = backend.Db.QueryRow(`
		SELECT count(*) FROM pg_class c
		JOIN pg_roles r ON r.oid = c.relowner
		WHERE r.rolname = $1 AND c.relkind = 'r'
	`, safeName).Scan(&ownedCount)

	if ownedCount > 0 {
		jsonError(w, fmt.Sprintf("role '%s' owns %d tables — reassign ownership first", safeName, ownedCount), http.StatusConflict)
		return
	}

	dropSQL := fmt.Sprintf("DROP ROLE IF EXISTS %s", safeName)
	if _, err := backend.Db.Exec(dropSQL); err != nil {
		log.Printf("[db_admin] DeleteRole exec error: %v", err)
		jsonError(w, fmt.Sprintf("failed to delete role: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("[db_admin] Role deleted: %s", safeName)
	jsonOK(w, map[string]string{"message": fmt.Sprintf("role '%s' deleted", safeName)})
}

// ──────────────────────────────────────────────────────────────────────────────
// Utility: Safe string literal quoting for DDL statements
// ──────────────────────────────────────────────────────────────────────────────

// quoteStringLiteral safely quotes a string for use in DDL (e.g., passwords).
// Escapes single quotes by doubling them (PostgreSQL standard).
func quoteStringLiteral(s string) string {
	escaped := strings.ReplaceAll(s, "'", "''")
	return fmt.Sprintf("'%s'", escaped)
}

// ──────────────────────────────────────────────────────────────────────────────
// Unused import prevention
// ──────────────────────────────────────────────────────────────────────────────

var _ = sql.ErrNoRows // Keep database/sql import for future use
