// route_method_contracts_test.go
// Verifies curated HTTP method metadata for stable backend routes.
// Bridges explicit route contracts and manifest/client generation expectations.
// Exists so new stable API slices cannot silently miss method metadata.
package router_test

import (
	"testing"

	"easelect/backend/core_components/router"
)

func TestCloudActionAndRolloutMethodContracts(t *testing.T) {
	t.Parallel()

	for _, handlerName := range []string{
		"cloud_management.InstancesActionHandler",
		"cloud_management.InstancesRolloutPlanHandler",
		"cloud_management.InstancesRolloutCreateHandler",
	} {
		handlerName := handlerName
		t.Run(handlerName, func(t *testing.T) {
			t.Parallel()

			contract, ok := router.GetRouteMethodContract(handlerName)
			if !ok {
				t.Fatalf("missing route method contract for %s", handlerName)
			}
			if contract.Source != router.RouteMethodSourceExplicitStableContract {
				t.Fatalf("Source = %q, want %q", contract.Source, router.RouteMethodSourceExplicitStableContract)
			}
			if len(contract.Methods) != 1 || contract.Methods[0] != "POST" {
				t.Fatalf("Methods = %+v, want [POST]", contract.Methods)
			}
		})
	}
}

func TestCloudAuditMethodContract(t *testing.T) {
	t.Parallel()

	contract, ok := router.GetRouteMethodContract("cloud_management.InstancesAuditHandler")
	if !ok {
		t.Fatalf("missing route method contract for cloud_management.InstancesAuditHandler")
	}
	if contract.Source != router.RouteMethodSourceExplicitStableContract {
		t.Fatalf("Source = %q, want %q", contract.Source, router.RouteMethodSourceExplicitStableContract)
	}
	if len(contract.Methods) != 1 || contract.Methods[0] != "GET" {
		t.Fatalf("Methods = %+v, want [GET]", contract.Methods)
	}
}

func TestRolloutResourceMethodContract(t *testing.T) {
	t.Parallel()

	contract, ok := router.GetRouteMethodContract("cloud_management.InstancesRolloutHandler")
	if !ok {
		t.Fatalf("missing route method contract for cloud_management.InstancesRolloutHandler")
	}
	if contract.Source != router.RouteMethodSourceExplicitStableContract {
		t.Fatalf("Source = %q, want %q", contract.Source, router.RouteMethodSourceExplicitStableContract)
	}
	if len(contract.Methods) != 2 || contract.Methods[0] != "GET" || contract.Methods[1] != "POST" {
		t.Fatalf("Methods = %+v, want [GET POST]", contract.Methods)
	}
}
