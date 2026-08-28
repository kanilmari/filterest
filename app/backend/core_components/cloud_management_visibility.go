// cloud_management_visibility.go
// Central opt-in gate for the Management-Easelect cloud datasets.
// Keeps shared app_cloud_* schema available while hiding the management UI from
// ordinary application instances unless their persistent DB role is management.
package backend

import (
	"database/sql"
	"os"
	"strings"
	"sync"
)

const (
	EaselectInstanceRoleApplication = "application"
	EaselectInstanceRoleManagement  = "management"

	easelectInstanceRoleConfigKey = "easelect_instance_role"
)

var easelectInstanceRoleCache = struct {
	sync.RWMutex
	loaded bool
	value  string
}{}

func NormalizeEaselectInstanceRole(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case EaselectInstanceRoleManagement:
		return EaselectInstanceRoleManagement
	default:
		return EaselectInstanceRoleApplication
	}
}

// CurrentEaselectInstanceRole returns the cached application/management role for this process.
func CurrentEaselectInstanceRole() string {
	easelectInstanceRoleCache.RLock()
	if easelectInstanceRoleCache.loaded {
		defer easelectInstanceRoleCache.RUnlock()
		return easelectInstanceRoleCache.value
	}
	easelectInstanceRoleCache.RUnlock()

	role := readEaselectInstanceRole()

	easelectInstanceRoleCache.Lock()
	easelectInstanceRoleCache.loaded = true
	easelectInstanceRoleCache.value = role
	easelectInstanceRoleCache.Unlock()
	return role
}

// ResetEaselectInstanceRoleCache lets tests and rare config-refresh callers re-read the DB role.
func ResetEaselectInstanceRoleCache() {
	easelectInstanceRoleCache.Lock()
	easelectInstanceRoleCache.loaded = false
	easelectInstanceRoleCache.value = ""
	easelectInstanceRoleCache.Unlock()
}

func readEaselectInstanceRole() string {
	if Db == nil {
		return EaselectInstanceRoleApplication
	}

	var role string
	err := Db.QueryRow(`
		SELECT COALESCE(NULLIF(text_value, ''), json_value ->> 'value', $2)
		FROM system_config
		WHERE key = $1
	`, easelectInstanceRoleConfigKey, EaselectInstanceRoleApplication).Scan(&role)
	if err != nil {
		if err != sql.ErrNoRows {
			// Fail closed: a broken config read must not expose management surfaces.
			return EaselectInstanceRoleApplication
		}
		return EaselectInstanceRoleApplication
	}
	return NormalizeEaselectInstanceRole(role)
}

func cloudManagementUIExplicitlyDisabledByEnv() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CLOUD_MANAGEMENT_UI_ENABLED"))) {
	case "0", "false", "no", "off":
		return true
	default:
		return false
	}
}

func CloudManagementUIEnabled() bool {
	if CurrentEaselectInstanceRole() != EaselectInstanceRoleManagement {
		return false
	}
	return !cloudManagementUIExplicitlyDisabledByEnv()
}

func IsCloudManagementDatasetName(tableName string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(tableName)), "app_cloud_")
}

func ShouldExposeCloudManagementDatasetName(tableName string) bool {
	return !IsCloudManagementDatasetName(tableName) || CloudManagementUIEnabled()
}
