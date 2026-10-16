// component_discovery_test.go
// Proves the private sign-in name guard scans component-owned handlers.
// Connects the shared temporary fixture to the existing source-boundary check.
// Prevents a component move from hiding newly introduced private-name access.
package auth

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"easelect/testing/componentfixture"
)

func TestComponentCanaryPrivateNameGuard(t *testing.T) {
	root := filepath.Join(componentfixture.Write(t), "app")
	path := filepath.Join(root, "components", "canary", "backend", "canary.go")
	for _, broken := range []bool{false, true} {
		if broken {
			file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				t.Fatal(err)
			}
			_, err = file.WriteString("\nvar private = \"login_name\"\n")
			file.Close()
			if err != nil {
				t.Fatal(err)
			}
		}
		findings, err := collectLoginNameSourceGuardFindings(root)
		if err != nil {
			t.Fatal(err)
		}
		caught := strings.Contains(strings.Join(findings, "\n"), "unreviewed private-name source: "+path)
		if caught != broken {
			t.Fatalf("broken=%v caught=%v: %v", broken, caught, findings)
		}
	}
}
