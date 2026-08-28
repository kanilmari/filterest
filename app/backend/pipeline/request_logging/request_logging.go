// request_logging.go
// Pipeline stage that logs each incoming HTTP request with method, path, user, and duration.
// Bridges the HTTP request lifecycle and the server log output.
// Exists to provide per-request monitoring and debugging traces.
package request_logging

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/logging"
	e_sessions "easelect/backend/core_components/sessions"
)

// LogUserRequest records debug request context when REQUEST_LOGGING_DEBUG is enabled.
// It bridges the HTTP request, optional session/user metadata, and structured
// server logs while keeping the default non-debug request path lightweight.
func LogUserRequest(original_handler http.HandlerFunc) http.HandlerFunc {
	debug := os.Getenv("REQUEST_LOGGING_DEBUG") == "true"

	return func(w http.ResponseWriter, r *http.Request) {
		// Vältetään lokituksen spämmäystä staattisilla tiedostoilla
		if strings.HasSuffix(r.URL.Path, ".css") ||
			strings.HasSuffix(r.URL.Path, ".js") ||
			strings.HasSuffix(r.URL.Path, ".ico") {
			original_handler(w, r)
			return
		}

		// Jos debug on false, ohitetaan lokitus ja kutsutaan alkuperäinen handler
		if !debug {
			original_handler(w, r)
			return
		}

		datasetName := r.URL.Query().Get("dataset")
		logAttrs := []slog.Attr{
			slog.String("path", r.URL.Path),
			slog.String("method", r.Method),
		}
		if datasetName != "" {
			logAttrs = append(logAttrs, slog.String("dataset", datasetName))
		}

		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			logging.WarnAttrs(
				"request logging session lookup failed",
				append(logAttrs, slog.String("error", err.Error()))...,
			)
			original_handler(w, r)
			return
		}

		user_val, ok := session.Values["user_id"]
		if !ok {
			logging.InfoAttrs(
				"request observed",
				append(logAttrs, slog.String("auth_state", "anonymous"))...,
			)
			original_handler(w, r)
			return
		}

		user_id, ok2 := user_val.(int)
		if !ok2 {
			logging.WarnAttrs(
				"request logging user_id invalid",
				append(
					logAttrs,
					slog.Any("user_id_value", user_val),
				)...,
			)
			original_handler(w, r)
			return
		}

		// Haetaan käyttäjänimi
		var user_name string
		err_query := backend.Db.QueryRow(`SELECT username FROM system_users WHERE id = $1`, user_id).Scan(&user_name)
		if err_query != nil {
			logging.WarnAttrs(
				"request logging username lookup failed",
				append(
					logAttrs,
					slog.Int("user_id", user_id),
					slog.String("error", err_query.Error()),
				)...,
			)
			original_handler(w, r)
			return
		}

		// Haetaan ryhmät
		rows, err_groups := backend.Db.Query(`
            SELECT g.name
            FROM system_user_groups g
            JOIN system_user_group_memberships ug 
                ON g.id = ug.group_id
            WHERE ug.user_id = $1
	        `, user_id)
		if err_groups != nil {
			logging.WarnAttrs(
				"request logging group lookup failed",
				append(
					logAttrs,
					slog.Int("user_id", user_id),
					slog.String("username", user_name),
					slog.String("error", err_groups.Error()),
				)...,
			)
			original_handler(w, r)
			return
		}

		group_names := []string{}
		for rows.Next() {
			var group_name string
			if scan_err := rows.Scan(&group_name); scan_err == nil {
				group_names = append(group_names, group_name)
			}
		}
		rows.Close()

		logging.InfoAttrs(
			"request observed",
			append(
				logAttrs,
				slog.Int("user_id", user_id),
				slog.String("username", user_name),
				slog.Int("group_count", len(group_names)),
				slog.Any("groups", group_names),
			)...,
		)

		original_handler(w, r)
	}
}
