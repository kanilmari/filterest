// health_installation_environment.go
// Resolves the display-only installation purpose included in manager health probes.
// Keeps the bounded configuration read separate from the health transport handlers.
package router

import (
	"context"
	"os"
	"time"

	backend "easelect/backend/core_components"
)

// currentSystemInstallationEnvironment reads the display-only environment purpose for manager probes.
// It bridges system_config and the private readiness contract with a bounded query.
// It exists so deployment checks can distinguish a production runtime from an accidentally visible DEV badge.
func currentSystemInstallationEnvironment() string {
	runtimeEnvironment := os.Getenv("ENVIRONMENT_TYPE")
	if backend.Db == nil {
		return resolveInstallationEnvironment("", runtimeEnvironment)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var storedEnvironment string
	err := backend.Db.QueryRowContext(ctx, `
		SELECT COALESCE(NULLIF(text_value, ''), json_value->>'value', '')
		FROM system_config
		WHERE key = 'installation_environment'
	`).Scan(&storedEnvironment)
	if err != nil {
		return resolveInstallationEnvironment("", runtimeEnvironment)
	}
	return resolveInstallationEnvironment(storedEnvironment, runtimeEnvironment)
}
