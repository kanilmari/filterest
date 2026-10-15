// pregrant_route_checker.go
// Checks explicit method contracts and reviewed writers that bypass route grants.
// Bridges the live registration/profile tables and build-specific security tests.
// Exists so optional compositions can apply the same guard to their full inventory.
package router

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"easelect/backend/pipeline"
)

// PreGrantWriteAllowance records one reviewed authentication boundary. Exact
// path, handler, profile and write methods prevent a review from covering a new
// handler, weaker profile or broader method contract by accident.
type PreGrantWriteAllowance struct {
	PathPattern string   `json:"path_pattern"`
	HandlerName string   `json:"handler_name"`
	Profile     string   `json:"profile"`
	Methods     []string `json:"methods"`
	Reason      string   `json:"reason"`
}

//go:embed pregrant_write_allowlist.json
var reviewedPreGrantWrites []byte

// ReviewedPreGrantWriteAllowances returns a fresh copy of Filterest's reviewed
// exceptions. Downstream build tests can append their own reviewed entries and
// pass the combined table to ValidatePreGrantRouteContracts.
func ReviewedPreGrantWriteAllowances() ([]PreGrantWriteAllowance, error) {
	var allowances []PreGrantWriteAllowance
	if err := json.Unmarshal(reviewedPreGrantWrites, &allowances); err != nil {
		return nil, fmt.Errorf("read pre-grant write allowlist: %w", err)
	}
	return allowances, nil
}

// ValidatePreGrantRouteContracts checks every registration has methods and every
// writer that skips access_control has an exact reviewed exception. In addition
// to Public/LoginOnly, this covers the public, CSRF-protected sign-out profile.
// Call after all optional registrations and environment overrides are applied;
// this helper does not activate apps, change profiles or access a database.
func ValidatePreGrantRouteContracts(routes []RouteDefinition, allowances []PreGrantWriteAllowance) error {
	key := func(path, handler, profile, method string) string {
		return path + " " + handler + " " + profile + " " + method
	}
	reviewed := map[string]bool{}
	for _, allowance := range allowances {
		if strings.TrimSpace(allowance.Reason) == "" || strings.ContainsAny(allowance.Reason, "\r\n") || allowance.PathPattern == "" ||
			allowance.HandlerName == "" || allowance.Profile == "" || len(allowance.Methods) == 0 {
			return fmt.Errorf("incomplete pre-grant allowance for %s: identity, methods and reason are required", allowance.PathPattern)
		}
		for _, method := range allowance.Methods {
			identity := key(allowance.PathPattern, allowance.HandlerName, allowance.Profile, method)
			if !isPreGrantWriteMethod(method) || reviewed[identity] {
				return fmt.Errorf("invalid or duplicate pre-grant allowance: %s", identity)
			}
			reviewed[identity] = true
		}
	}
	var failures []error
	for _, route := range routes {
		contract := newRouteMethodContract(route.Methods...)
		if len(contract.Methods) == 0 {
			failures = append(failures, fmt.Errorf("route %s (%s) has no declared methods", route.UrlPattern, route.HandlerName))
			continue
		}
		if !pipeline.GetProfile(route.HandlerName).Skips("access_control") {
			continue
		}
		profile := pipeline.DescribeRouteProfile(route.HandlerName).ProfileName
		for _, method := range contract.Methods {
			if isPreGrantWriteMethod(method) && !reviewed[key(route.UrlPattern, route.HandlerName, profile, method)] {
				failures = append(failures, fmt.Errorf("unreviewed pre-grant writer: %s %s (%s, %s)", method, route.UrlPattern, route.HandlerName, profile))
			}
		}
	}
	return errors.Join(failures...)
}

func isPreGrantWriteMethod(method string) bool {
	switch method {
	case "POST", "PUT", "PATCH", "DELETE":
		return true
	default:
		return false
	}
}
