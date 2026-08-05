// router_for_apps.go
// Registers HTTP routes for user-facing application endpoints. Applies the app-specific
// middleware chain and maps app route patterns to their handler functions.
// Exists to keep app-specific backend routes grouped away from core dataset routes.
package router

import (
	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
	payment_gateway "easelect/backend/core_components/payment_gateway"
)

// RegisterAppRoutes registers all application routes.
// Called from RegisterRoutes in router.go.
// Each app should have its routes grouped under /api/app/<app-name>/
func RegisterAppRoutes() {
	// ============================================================
	// Payment Gateway (Core Component - available to all apps)
	// Handles Revolut payments for any easelect application
	// ============================================================
	payment_gateway.Init()

	functionRegisterHandler("/api/payments/create",
		payment_gateway.CreatePaymentHandler,
		"payment_gateway.CreatePaymentHandler")

	functionRegisterHandler("/api/payments/webhook",
		payment_gateway.WebhookHandler,
		"payment_gateway.WebhookHandler")

	// Note: Status endpoint uses pattern /api/payments/{token}/status
	// This is handled by the handler itself parsing the URL
	functionRegisterHandler("/api/payments/",
		payment_gateway.GetPaymentStatusHandler,
		"payment_gateway.GetPaymentStatusHandler")

	// Private Easelect apps register themselves through app_registry from
	// private activation packages. Filterest omits those activation imports.
	appregistry.RegisterRoutes(functionRegisterHandler)

	// ============================================================
	// AI Chat App
	// Narrow API-first facade for filter bar AI capabilities and dataset reads
	// ============================================================
	functionRegisterHandler("/api/app/ai-chat/capabilities",
		dtt_1_row_read.FilterbarAICapabilitiesHandler,
		"dtt_1_row_read.FilterbarAICapabilitiesHandler")

	functionRegisterHandler("/api/app/ai-chat/query",
		dtt_1_row_read.FilterbarAIQueryHandler,
		"dtt_1_row_read.FilterbarAIQueryHandler")

	functionRegisterHandler("/api/app/ai-chat/codex-query",
		dtt_1_row_read.FilterbarAICodexQueryHandler,
		"dtt_1_row_read.FilterbarAICodexQueryHandler")

	functionRegisterHandler("/api/app/ai-chat/conversation",
		dtt_1_row_read.FilterbarAIConversationHandler,
		"dtt_1_row_read.FilterbarAIConversationHandler")

	// ============================================================
	// Future Apps
	// ============================================================
	// Add new apps here following the pattern:
	// functionRegisterHandler("/api/app/<app-name>/<endpoint>", handler, "package.Handler")
}
