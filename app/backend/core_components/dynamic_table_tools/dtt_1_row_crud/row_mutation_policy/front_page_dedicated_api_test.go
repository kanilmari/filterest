// front_page_dedicated_api_test.go
// Keeps front page configuration behind its transactional administrator API.
package row_mutation_policy

import "testing"

func TestFrontPageRequiresDedicatedAPI(t *testing.T) {
	if !RequiresDedicatedMutationAPI("system_front_page_blocks") || !RequiresDedicatedMutationAPI(" SYSTEM_FRONT_PAGE_BLOCKS ") {
		t.Fatal("front page blocks accept generic writes")
	}
	if !RequiresDedicatedMutationAPI("system_front_page_revisions") || !IsInternalRegistryTable("system_front_page_revisions") {
		t.Fatal("private front page revisions accept generic writes or dataset registration")
	}
}
