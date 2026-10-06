// cache_target_lifecycle_test.go
// Proves both effective and per-profile cache targets follow dataset lifecycle.
// Exercises the shared JSON editor without altering unrelated configuration.
// PostgreSQL route companions prove the edits commit with physical renames/drops.
package automation_metadata

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestCacheTargetLifecyclePreservesUnrelatedConfiguration(t *testing.T) {
	specs := []byte(`{"preset":{"id":42},"file_upload":{"unknown":{"keep":true},"cache_targets":[{"table":"old","column":"cached_image","extra":9},{"table":"other","column":"title"}],"profiles":{"image":{"cache_targets":[{"table":"old","column":"cached_image"}],"max_size":8},"attachment":{"cache_targets":[{"table":"old","column":"thumbnail"},{"table":"other","column":"other"}]}}}}`)
	for _, destination := range []string{"new", ""} {
		updated, changed, err := rewriteCacheTargetDatasets(specs, "old", destination)
		if err != nil || !changed {
			t.Fatal(changed, err)
		}
		var got map[string]interface{}
		if err := json.Unmarshal(updated, &got); err != nil {
			t.Fatal(err)
		}
		upload := got["file_upload"].(map[string]interface{})
		configs := []map[string]interface{}{upload}
		for _, profile := range upload["profiles"].(map[string]interface{}) {
			configs = append(configs, profile.(map[string]interface{}))
		}
		matches := 0
		for _, config := range configs {
			for _, raw := range config["cache_targets"].([]interface{}) {
				target := raw.(map[string]interface{})
				if target["table"] == "old" {
					t.Fatal("old destination survived", got)
				}
				if destination != "" && target["table"] == destination {
					matches++
				}
			}
		}
		if destination != "" && matches != 3 {
			t.Fatal("missed profile copy", matches)
		}
		if !reflect.DeepEqual(upload["unknown"], map[string]interface{}{"keep": true}) || got["preset"].(map[string]interface{})["id"] != float64(42) {
			t.Fatal(got)
		}
		repeated, changed, err := rewriteCacheTargetDatasets(updated, "old", destination)
		if err != nil || changed || string(repeated) != string(updated) {
			t.Fatal("non-idempotent rewrite", changed, err)
		}
	}
}
