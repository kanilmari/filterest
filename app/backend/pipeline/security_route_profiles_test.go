// security_route_profiles_test.go
// Verifies admin gates for maintenance routes that perform privileged data or schema work.
// Bridges the auditable RouteProfiles map and the effective middleware-stage description.
// Exists to prevent sensitive AI, search, FK DDL, and conditional query routes from regressing.

package pipeline_test

import (
	"testing"

	"easelect/backend/pipeline"
)

func TestSensitiveMaintenanceRoutesRequireAdmin(t *testing.T) {
	handlerNames := []string{
		"ai_features.GetEmbeddingDatasetsHandler",
		"ai_features.EmbeddingStreamHandler",
		"ai_features.RefreshLangEmbeddingsHandler",
		"ai_features.CountLangEmbeddingsHandler",
		"dtt_search_vectors.TextIndexStatusHandler",
		"dtt_search_vectors.RebuildSearchVectorHandler",
		"dtt_foreign_keys.AddForeignKeyHandler",
		"dtt_foreign_keys.DeleteForeignKeyHandler",
		"dtt_crud_workflows.SimpleQueryTableHandler",
		"system_table_tools.UpdateColumnMultilingualHandler",
		"system_table_tools.AdminDatasetUIVisibilityHandler",
		"system_table_tools.UpdateColumnInsertableHandler",
		"system_table_tools.SaveArticleSectionDefaultsHandler",
		"router.saveOpenAIAPIKeyHandler",
		"router.saveProviderAPIKeyHandler",
	}

	for _, handlerName := range handlerNames {
		t.Run(handlerName, func(t *testing.T) {
			descriptor := pipeline.DescribeRouteProfile(handlerName)
			if descriptor.ProfileName != "admin" {
				t.Fatalf("profile = %q, want admin", descriptor.ProfileName)
			}
			if !descriptor.AdminOnly {
				t.Fatal("AdminOnly = false, want true")
			}

			stages := pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(handlerName))
			containsAll(t, stages, []string{"auth", "csrf", "access_control", "admin_check"})
		})
	}
}

func TestForeignKeyReadHelpersKeepDefaultProfile(t *testing.T) {
	handlerNames := []string{
		"dtt_foreign_keys.GetForeignKeys",
		"dtt_foreign_keys.GetTableNamesHandler",
	}

	for _, handlerName := range handlerNames {
		t.Run(handlerName, func(t *testing.T) {
			descriptor := pipeline.DescribeRouteProfile(handlerName)
			if descriptor.ProfileName != "default" {
				t.Fatalf("profile = %q, want default", descriptor.ProfileName)
			}
			if descriptor.AdminOnly {
				t.Fatal("AdminOnly = true, want false")
			}
		})
	}
}

func TestArticleSectionDefaultsReadRetainsSessionSecurity(t *testing.T) {
	handler := "system_table_tools.GetArticleSectionDefaultsHandler"
	descriptor := pipeline.DescribeRouteProfile(handler)
	if descriptor.ProfileName != "login_only" || descriptor.AdminOnly {
		t.Fatalf("read profile = %#v", descriptor)
	}
	stages := pipeline.DescribePipeline(pipeline.RouteContext{}, pipeline.GetProfile(handler))
	containsAll(t, stages, []string{"auth", "csrf", "fingerprint", "device_id"})
}
