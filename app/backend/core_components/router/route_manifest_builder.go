// route_manifest_builder.go
// Builds a reproducible route manifest from the runtime registration path.
// Bridges RegisterRoutes, RouteProfiles, and future client generation without AST assumptions.
// Exists to inventory backend routes across environment-sensitive registration scenarios.
package router

import (
	"fmt"
	"os"
	"sort"

	"easelect/backend/pipeline"
)

// RouteManifestScenario describes one environment combination used to build the
// route inventory. The manifest keeps the scenario name stable for deterministic output.
type RouteManifestScenario struct {
	Name              string
	EnvironmentType   string
	EnableAPILanguage bool
}

// RouteManifestScenarioProfile captures the effective profile for one route in
// one registration scenario.
type RouteManifestScenarioProfile struct {
	Name        string   `json:"name"`
	ProfileName string   `json:"profile_name"`
	SkipStages  []string `json:"skip_stages"`
	AdminOnly   bool     `json:"admin_only"`
}

// RouteManifestEntry stores one registered route together with the scenarios in
// which it exists and the effective pipeline profile for each scenario.
type RouteManifestEntry struct {
	PathPattern       string                         `json:"path_pattern"`
	MatchType         RouteMatchType                 `json:"match_type"`
	HandlerName       string                         `json:"handler_name"`
	Methods           []string                       `json:"methods,omitempty"`
	MethodSource      string                         `json:"method_source,omitempty"`
	ConditionalSource string                         `json:"conditional_source,omitempty"`
	Scenarios         []RouteManifestScenarioProfile `json:"scenarios"`
}

// RouteManifest is the checked-in inventory consumed by later generator steps.
type RouteManifest struct {
	GeneratedBy   string               `json:"generated_by"`
	ScenarioOrder []string             `json:"scenario_order"`
	Routes        []RouteManifestEntry `json:"routes"`
}

// DefaultRouteManifestScenarios returns the canonical scenario matrix for route
// inventory work: production, development, and API-language enabled production.
func DefaultRouteManifestScenarios() []RouteManifestScenario {
	return []RouteManifestScenario{
		{Name: "production", EnvironmentType: "production"},
		{Name: "development", EnvironmentType: "dev"},
		{Name: "api_language", EnvironmentType: "production", EnableAPILanguage: true},
	}
}

// BuildDefaultRouteManifest builds the canonical route manifest using the repo's
// normal frontend/storage placeholder paths.
func BuildDefaultRouteManifest() (RouteManifest, error) {
	return BuildRouteManifest(DefaultRouteManifestScenarios(), "frontend", "storage")
}

// BuildRouteManifest runs the route registration path for each requested
// scenario, then merges the resulting inventory into one deterministic manifest.
func BuildRouteManifest(scenarios []RouteManifestScenario, frontendDir string, storagePath string) (RouteManifest, error) {
	if len(scenarios) == 0 {
		return RouteManifest{}, fmt.Errorf("build route manifest: no scenarios provided")
	}

	scenarioOrder := make([]string, 0, len(scenarios))
	scenarioIndex := make(map[string]int, len(scenarios))
	for index, scenario := range scenarios {
		if scenario.Name == "" {
			return RouteManifest{}, fmt.Errorf("build route manifest: scenario %d has empty name", index)
		}
		if _, exists := scenarioIndex[scenario.Name]; exists {
			return RouteManifest{}, fmt.Errorf("build route manifest: duplicate scenario %q", scenario.Name)
		}
		scenarioIndex[scenario.Name] = index
		scenarioOrder = append(scenarioOrder, scenario.Name)
	}

	envSnapshot := captureRouteManifestEnvironment()
	defer envSnapshot.restore()

	entryIndex := make(map[string]*RouteManifestEntry)
	for _, scenario := range scenarios {
		activateRouteManifestScenario(scenario)
		pipeline.ResetRouteProfiles()
		RegisterRoutes(frontendDir, storagePath)
		pipeline.ApplyDevOverrides()

		for _, route := range GetRouteDefinitions() {
			entryKey := route.UrlPattern + "\n" + route.HandlerName
			descriptor := pipeline.DescribeRouteProfile(route.HandlerName)

			entry, exists := entryIndex[entryKey]
			if !exists {
				methodContract, hasMethodContract := GetRouteMethodContract(route.HandlerName)
				entry = &RouteManifestEntry{
					PathPattern:       route.UrlPattern,
					MatchType:         route.MatchType,
					HandlerName:       route.HandlerName,
					Methods:           nil,
					MethodSource:      "",
					ConditionalSource: route.ConditionalSource,
				}
				if hasMethodContract {
					entry.Methods = append([]string{}, methodContract.Methods...)
					entry.MethodSource = methodContract.Source
				}
				entryIndex[entryKey] = entry
			}

			if entry.MatchType != route.MatchType {
				return RouteManifest{}, fmt.Errorf("build route manifest: conflicting match type for %s", route.HandlerName)
			}
			if methodContract, ok := GetRouteMethodContract(route.HandlerName); ok {
				if !equalStringSlices(entry.Methods, methodContract.Methods) || entry.MethodSource != methodContract.Source {
					return RouteManifest{}, fmt.Errorf("build route manifest: conflicting method contract for %s", route.HandlerName)
				}
			} else if len(entry.Methods) > 0 || entry.MethodSource != "" {
				return RouteManifest{}, fmt.Errorf("build route manifest: unexpected residual method contract for %s", route.HandlerName)
			}
			if entry.ConditionalSource != route.ConditionalSource {
				return RouteManifest{}, fmt.Errorf("build route manifest: conflicting conditional source for %s", route.HandlerName)
			}

			entry.Scenarios = append(entry.Scenarios, RouteManifestScenarioProfile{
				Name:        scenario.Name,
				ProfileName: descriptor.ProfileName,
				SkipStages:  append([]string{}, descriptor.SkipStages...),
				AdminOnly:   descriptor.AdminOnly,
			})
		}
	}

	routes := make([]RouteManifestEntry, 0, len(entryIndex))
	for _, entry := range entryIndex {
		sort.Slice(entry.Scenarios, func(i int, j int) bool {
			return scenarioIndex[entry.Scenarios[i].Name] < scenarioIndex[entry.Scenarios[j].Name]
		})
		routes = append(routes, *entry)
	}

	sort.Slice(routes, func(i int, j int) bool {
		if routes[i].PathPattern != routes[j].PathPattern {
			return routes[i].PathPattern < routes[j].PathPattern
		}
		return routes[i].HandlerName < routes[j].HandlerName
	})

	pipeline.ResetRouteProfiles()
	ResetRouteDefinitions()

	return RouteManifest{
		GeneratedBy:   "server_tools/scripts/generate_route_manifest.go",
		ScenarioOrder: scenarioOrder,
		Routes:        routes,
	}, nil
}

type routeManifestEnvironment struct {
	environmentType   routeManifestEnvValue
	enableAPILanguage routeManifestEnvValue
}

type routeManifestEnvValue struct {
	Key     string
	Value   string
	Present bool
}

func captureRouteManifestEnvironment() routeManifestEnvironment {
	return routeManifestEnvironment{
		environmentType:   captureRouteManifestEnvValue("ENVIRONMENT_TYPE"),
		enableAPILanguage: captureRouteManifestEnvValue("ENABLE_API_LANGUAGE"),
	}
}

func captureRouteManifestEnvValue(key string) routeManifestEnvValue {
	value, present := os.LookupEnv(key)
	return routeManifestEnvValue{
		Key:     key,
		Value:   value,
		Present: present,
	}
}

func (env routeManifestEnvironment) restore() {
	env.environmentType.restore()
	env.enableAPILanguage.restore()
}

func (env routeManifestEnvValue) restore() {
	if env.Present {
		_ = os.Setenv(env.Key, env.Value)
		return
	}
	_ = os.Unsetenv(env.Key)
}

func activateRouteManifestScenario(scenario RouteManifestScenario) {
	_ = os.Setenv("ENVIRONMENT_TYPE", scenario.EnvironmentType)
	if scenario.EnableAPILanguage {
		_ = os.Setenv("ENABLE_API_LANGUAGE", "true")
		return
	}
	_ = os.Unsetenv("ENABLE_API_LANGUAGE")
}

func equalStringSlices(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
