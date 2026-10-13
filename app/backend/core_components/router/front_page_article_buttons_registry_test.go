// front_page_article_buttons_registry_test.go
// Proves the article-list route participates in tableless permission seeding.
// Connects startup registration and stale-flag reconciliation to administrator grants.
// Keeps the site-wide API independent of any selected dataset's rights.
package router

import "testing"

func TestFrontPageArticleButtonsPermissionRegistration(t *testing.T) {
	const handler = "system_table_tools.AdminFrontPageArticleButtonsHandler"
	if defaultSpecificTableRelated(handler) || !tablelessReconciliationHandlers[handler] {
		t.Fatal("site-wide administrator route cannot receive its automatic tableless grant")
	}
}
