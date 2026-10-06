// startup_sequence.go
// Keeps required database initialization ordered inside the exclusive boot barrier.
// Separates error-returning policy writers from post-readiness background work.
// Startup never deletes the owner's stale rights unless cleanup was approved.
package application_runtime

import (
	"context"
	"fmt"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	foreignkeys "easelect/backend/core_components/dynamic_table_tools/dtt_foreign_keys"
	"easelect/backend/core_components/router"
	"easelect/backend/core_components/runtime_grants"
	"easelect/backend/core_components/startup"
	"os"
)

type startupStep struct {
	name string
	run  func() error
}

func runRequiredStartup(steps []startupStep) error {
	for _, step := range steps {
		if err := step.run(); err != nil {
			return fmt.Errorf("%s: %w", step.name, err)
		}
	}
	return nil
}

func requiredStartupSteps(productRoot string, options Options, environmentType string) []startupStep {
	return []startupStep{
		{"role identities", func() error {
			if err := backend.ValidateRuntimeRolePools(context.Background()); err != nil {
				return err
			}
			return runtime_grants.ValidateStartupRoleConfiguration(context.Background(), backend.DbAdmin, runtime_grants.ConfiguredRoles(os.Getenv))
		}},
		{"migrations", func() error {
			return startup.RunEnabledMigrations(backend.Db, productRoot, options.MigrationDirectories...)
		}},
		{"dataset identities", func() error { return workflows.UpdateOidsAndTableNamesWithBridge(backend.Db, true) }},
		{"column metadata", func() error { return dtt_2_column_update.UpdateColumnMetadata(backend.Db, true) }},
		{"one-to-many discovery", func() error { return foreignkeys.SyncOneToManyFKConstraints(backend.Db, true) }},
		{"many-to-many discovery", func() error { return foreignkeys.SyncManyToManyFKConstraints(backend.Db, true) }},
		{"embedding tables", func() error { return startup.EnsureStartupLangEmbeddingTables(context.Background(), backend.DbAdmin) }},
		{"route registration", func() error { return router.RegisterAllRoutesAndUpdateFunctions(backend.Db) }},
		{"function synchronization", func() error { return router.SyncFunctions(backend.Db) }},
		{"UI routes", func() error { return router.ReactivateUIRoutes(backend.Db) }},
		{"approved rights cleanup", func() error {
			return backend.CleanGroupTableFuncRights(backend.Db, backend.PermissionCleanupOptions{RemoveMissingTables: true, RemoveDisabledFuncs: true, RemoveMismatchedUID: true, ReportOnly: !permissionCleanupApprovedByOperator()})
		}},
		{"administrator route rights", func() error { return backend.EnsureAdminPermissions(backend.Db) }},
		{"administrator dataset rights", func() error { return backend.EnsureAdminTablePermissions(backend.Db) }},
		{"anonymous browsing", func() error { return startup.EnsureAnonymousBrowseConsistency(backend.Db) }},
		{"runtime grants", func() error { return backend.EnsureRuntimeRoleGrants(context.Background(), backend.DbAdmin) }},
		{"reserved identities", func() error {
			return startup.ReconcileReservedTestUsers(backend.Db, backend.DbConfidential, environmentType)
		}},
	}
}
