// check_app_log_search_terms.go
// Reads the site's explicit opt-in to search terms in application diagnostics.
// Connects system_config, the shared configuration cache and URL/text log callers.
// Missing, null or unreadable values keep visitor search terms out of the logs.
package middlewares

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/system_config_cache"
)

const AppLogSearchTermsKey = "app_log_search_terms"

// CheckAppLogSearchTerms reads once per cache lifetime, including missing keys.
// A bounded failed refresh replaces a previous opt-in with the private default.
func CheckAppLogSearchTerms() bool {
	db := backend.Db
	return system_config_cache.Load(AppLogSearchTermsKey, db, func() any {
		if db == nil {
			return false
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		var enabled sql.NullBool
		err := db.QueryRowContext(ctx,
			"SELECT boolean_value FROM system_config WHERE key = $1", AppLogSearchTermsKey).Scan(&enabled)
		return err == nil && enabled.Valid && enabled.Bool
	}).(bool)
}

// AppLogRequestURL preserves the former URL verbatim only for an explicit opt-in.
// Redaction works on a copy so routing, queries and the response stay unchanged.
func AppLogRequestURL(r *http.Request) string {
	if CheckAppLogSearchTerms() {
		return r.URL.String()
	}
	address := *r.URL
	address.RawQuery, address.Fragment, address.RawFragment = "", "", ""
	address.ForceQuery = false
	return address.String()
}
