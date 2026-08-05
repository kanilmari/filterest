// introspection_handler.go
// Exposes pipeline and route introspection data for debugging via an HTTP endpoint.
// Bridges the pipeline registry and admin debugging tools with JSON route metadata.
// Exists to let developers inspect registered routes, security profiles, and applied stages.
package pipeline

import (
	"encoding/json"
	"net/http"
	"easelect/backend/core_components/httpresponse"
)

// PipelineInfoResponse is the JSON response for the introspection endpoint.
type PipelineInfoResponse struct {
	Handler string   `json:"handler"`
	Stages  []string `json:"stages"`
}

// IntrospectionHandler returns the pipeline stages for a given handler.
// Query parameter: ?handler=<handlerName>
// If no handler is specified, returns stages for the default profile.
func IntrospectionHandler(w http.ResponseWriter, r *http.Request) {
	handlerName := r.URL.Query().Get("handler")
	if handlerName == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "missing ?handler= query parameter")
		return
	}

	profile := GetProfile(handlerName)
	ctx := RouteContext{HandlerName: handlerName}

	stages := DescribePipeline(ctx, profile)

	resp := PipelineInfoResponse{
		Handler: handlerName,
		Stages:  stages,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}
