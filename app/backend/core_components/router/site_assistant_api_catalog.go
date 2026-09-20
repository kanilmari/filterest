// site_assistant_api_catalog.go
// Serves the site assistant's up-to-date description of this installation's HTTP API.
// Bridges the live route registry, pipeline access profiles, method contracts and handler docs.
// Exists so an assistant acting through the API always sees the routes of the running release.
package router

import (
	"fmt"
	"net/http"
	"sort"
	"strings"

	"easelect/backend/core_components/httpresponse"
	productidentity "easelect/backend/core_components/product_identity"
	"easelect/backend/pipeline"
)

// SiteAssistantAPICatalog is the JSON document an assistant receives before a task.
type SiteAssistantAPICatalog struct {
	ProductName    string                       `json:"product_name"`
	AppVersion     string                       `json:"app_version"`
	AccessNotes    []string                     `json:"access_notes"`
	CoreOperations []SiteAssistantCoreOperation `json:"core_operations"`
	Routes         []SiteAssistantCatalogRoute  `json:"routes"`
}

// SiteAssistantCatalogRoute describes one registered API route.
type SiteAssistantCatalogRoute struct {
	Path         string         `json:"path"`
	MatchType    RouteMatchType `json:"match_type"`
	Methods      []string       `json:"methods,omitempty"`
	MethodSource string         `json:"method_source,omitempty"`
	Access       string         `json:"access"`
	AdminOnly    bool           `json:"admin_only"`
	Handler      string         `json:"handler"`
	Summary      string         `json:"summary,omitempty"`
}

// SiteAssistantCoreOperation documents the request shape of a frequently
// needed operation. Paths are checked against the registry by tests so an
// example cannot silently outlive its route.
type SiteAssistantCoreOperation struct {
	Name        string `json:"name"`
	Method      string `json:"method"`
	Path        string `json:"path"`
	Query       string `json:"query,omitempty"`
	Body        string `json:"body,omitempty"`
	Description string `json:"description"`
}

// siteAssistantCoreOperations mirrors the canonical Python API client
// (server_tools/agent_tools/easelect_api_client.py), which the CLI and MCP tools use.
var siteAssistantCoreOperations = []SiteAssistantCoreOperation{
	{Name: "list_datasets", Method: http.MethodGet, Path: "/api/dataset-names",
		Description: "Dataset names the caller may read."},
	{Name: "dataset_columns", Method: http.MethodGet, Path: "/api/dataset-columns/",
		Query:       "/api/dataset-columns/{url-encoded dataset}",
		Description: "Column metadata for one dataset."},
	{Name: "read_rows", Method: http.MethodGet, Path: "/api/get-results",
		Query:       "dataset=NAME&offset=0&row_count=20&sort_column=COL&sort_order=ASC|DESC&COLUMN=VALUE&COLUMN_from=A&COLUMN_to=B",
		Description: "Row page with exact and range filters; row ids are data[].id."},
	{Name: "update_row", Method: http.MethodPost, Path: "/api/update-row",
		Query:       "dataset=NAME",
		Body:        `{"id": 123, "updates": [{"column": "header", "value": "New text"}]}`,
		Description: "Update chosen columns of one row. Read the row first and change only intended fields."},
	{Name: "add_row", Method: http.MethodPost, Path: "/api/add-row-multipart",
		Query:       "dataset=NAME",
		Body:        `multipart field jsonPayload = {"column": "value"}`,
		Description: "Create one row."},
	{Name: "delete_rows", Method: http.MethodPost, Path: "/api/delete-rows",
		Query:       "dataset=NAME",
		Body:        `{"ids": [123]}`,
		Description: "Delete rows by id after reading them."},
	{Name: "read_language_key", Method: http.MethodGet, Path: "/api/get-lang-key-translations",
		Query:       "lang_key=KEY",
		Description: "Current translations of one language key."},
	{Name: "upsert_language_key", Method: http.MethodPost, Path: "/api/admin/lang-key",
		Body:        `{"lang_key": "KEY", "fi": "…", "en": "…"}`,
		Description: "Create or update the given translation fields of one language key; read it back afterwards."},
}

var siteAssistantAccessNotes = []string{
	"Calls run with the asking user's own rights; a route the user cannot use fails with 401 or 403.",
	"access public: no login; login_only: any signed-in user; default and access_control_no_tx: signed-in user with the route or dataset permission; admin and admin_no_tx: administrator only.",
	"Routes ending in / match every path below them; the handler reads the rest of the path.",
	"Every route lists the request methods it accepts; HEAD accompanies ordinary GET reads.",
	"Never change data with SQL; use these routes, read before writing and read back after writing.",
}

// BuildSiteAssistantAPICatalog describes the routes registered in this process.
// It reads the live registry, so dev-only routes appear only in development.
func BuildSiteAssistantAPICatalog() (SiteAssistantAPICatalog, error) {
	docs, err := EmbeddedRouteHandlerDocs()
	if err != nil {
		return SiteAssistantAPICatalog{}, err
	}

	routes := make([]SiteAssistantCatalogRoute, 0)
	for _, definition := range GetRouteDefinitions() {
		if !strings.HasPrefix(definition.UrlPattern, "/api/") && definition.UrlPattern != "/storage/" {
			continue
		}
		profile := pipeline.DescribeRouteProfile(definition.HandlerName)
		route := SiteAssistantCatalogRoute{
			Path:      definition.UrlPattern,
			MatchType: definition.MatchType,
			Access:    profile.ProfileName,
			AdminOnly: profile.AdminOnly,
			Handler:   definition.HandlerName,
			Summary:   docs[definition.HandlerName],
		}
		route.Methods = append([]string{}, definition.Methods...)
		route.MethodSource = definition.MethodSource
		routes = append(routes, route)
	}
	sort.Slice(routes, func(i, j int) bool { return routes[i].Path < routes[j].Path })

	identity := productidentity.DetectFromWorkingDirectory()
	return SiteAssistantAPICatalog{
		ProductName:    identity.Name,
		AppVersion:     identity.Version,
		AccessNotes:    append([]string{}, siteAssistantAccessNotes...),
		CoreOperations: append([]SiteAssistantCoreOperation{}, siteAssistantCoreOperations...),
		Routes:         routes,
	}, nil
}

// RenderSiteAssistantAPICatalogMarkdown renders the catalog as compact prompt text.
func RenderSiteAssistantAPICatalogMarkdown(catalog SiteAssistantAPICatalog) string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "# %s %s HTTP API\n\n## Access\n", catalog.ProductName, catalog.AppVersion)
	for _, note := range catalog.AccessNotes {
		fmt.Fprintf(&builder, "- %s\n", note)
	}
	builder.WriteString("\n## Core operations\n")
	for _, operation := range catalog.CoreOperations {
		fmt.Fprintf(&builder, "- %s: %s %s", operation.Name, operation.Method, operation.Path)
		if operation.Query != "" {
			fmt.Fprintf(&builder, " (query/path: %s)", operation.Query)
		}
		if operation.Body != "" {
			fmt.Fprintf(&builder, " body: %s", operation.Body)
		}
		fmt.Fprintf(&builder, " — %s\n", operation.Description)
	}
	builder.WriteString("\n## Routes\n")
	for _, route := range catalog.Routes {
		methods := "methods: see summary"
		if len(route.Methods) > 0 {
			methods = strings.Join(route.Methods, ",")
		}
		fmt.Fprintf(&builder, "- %s [%s; %s]", route.Path, route.Access, methods)
		if route.Summary != "" {
			fmt.Fprintf(&builder, " %s", route.Summary)
		}
		builder.WriteString("\n")
	}
	return builder.String()
}

// siteAssistantAPICatalogHandler returns the administrator-only description of
// this installation's HTTP API routes, access levels, methods and core request
// shapes as JSON, or as Markdown with ?format=markdown for site assistant context.
func siteAssistantAPICatalogHandler(w http.ResponseWriter, r *http.Request) {

	catalog, err := BuildSiteAssistantAPICatalog()
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "API catalog is unavailable")
		return
	}
	if r.URL.Query().Get("format") == "markdown" {
		w.Header().Set("Content-Type", "text/markdown; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(RenderSiteAssistantAPICatalogMarkdown(catalog)))
		return
	}
	httpresponse.RespondWithJSON(w, http.StatusOK, catalog)
}
