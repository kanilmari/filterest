// component_discovery_test.go
// Proves component permission literals and route comments reach their existing scanners.
// Connects the shared temporary canary with permission registry and route-doc discovery.
// Adds no application route or component to the shipped application.
package router

import (
	"path/filepath"
	"reflect"
	"testing"

	"easelect/testing/componentfixture"
)

func TestComponentCanaryPermissionsAndRouteDocs(t *testing.T) {
	appRoot := filepath.Join(componentfixture.Write(t), "app")
	if got := collectUIPermissionLiterals(t, appRoot); !reflect.DeepEqual(got, []string{"/ui/canary"}) {
		t.Fatalf("component permission literal missed: %v", got)
	}
	docs, err := ExtractRouteHandlerDocs(filepath.Join(appRoot, "backend"), []string{"canary.CanaryHandler"}, filepath.Join(appRoot, "components"))
	if err != nil {
		t.Fatal(err)
	}
	if docs["canary.CanaryHandler"] != "CanaryHandler returns the fixture answer." {
		t.Fatalf("component route docs missed: %v", docs)
	}
}
