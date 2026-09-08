// media_response_guard.go
// Removes unavailable independent media links and derived cache fields from row responses.
// Between normal/semantic/related row serializers and the media library's read decision.
// Exists to make cache metadata obey the same revocation as original files without an import cycle.
package dtt_1_row_read

import (
	"easelect/backend/core_components/dbutils"
	"strings"
	"sync"
)

type independentMediaAuthorizer func(dbutils.Querier, dbutils.RequestActorContext, string) bool

var independentMediaRead struct {
	sync.RWMutex
	authorize independentMediaAuthorizer
}

// RegisterIndependentMediaAuthorizer connects the optional library at process
// composition time. An absent component always denies its reserved namespace.
func RegisterIndependentMediaAuthorizer(authorize func(dbutils.Querier, dbutils.RequestActorContext, string) bool) {
	independentMediaRead.Lock()
	defer independentMediaRead.Unlock()
	independentMediaRead.authorize = authorize
}

// FilterIndependentMediaRows changes only media URLs and derived cached_image
// fields. Authored title/description and every unrelated field remain intact.
func FilterIndependentMediaRows(q dbutils.Querier, actor dbutils.RequestActorContext, rows []map[string]interface{}) {
	independentMediaRead.RLock()
	authorize := independentMediaRead.authorize
	independentMediaRead.RUnlock()
	decisions := map[string]bool{}
	filterIndependentMediaRows(rows, func(reference string) bool {
		if allowed, seen := decisions[reference]; seen {
			return allowed
		}
		allowed := authorize != nil && authorize(q, actor, reference)
		decisions[reference] = allowed
		return allowed
	})
}
func filterIndependentMediaRows(rows []map[string]interface{}, allowed func(string) bool) {
	for _, row := range rows {
		for _, key := range []string{"cached_image", "filename"} {
			reference, ok := row[key].(string)
			if !ok || !strings.HasPrefix(reference, "/storage/media/") {
				continue
			}
			if allowed(reference) {
				continue
			}
			row[key] = nil
			if key == "cached_image" {
				for field := range row {
					if strings.HasPrefix(field, "cached_image_") {
						delete(row, field)
					}
				}
			}
		}
	}
}
