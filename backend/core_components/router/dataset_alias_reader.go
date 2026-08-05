// dataset_alias_reader.go
// Resolves public dataset URL aliases to raw internal table names and back.
// Bridges inbound router/SEO paths with canonical system_db_tables.table_name values.
// Exists to centralize the temporary dataset alias rollout inside the router package.
package router

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dataset_routes"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"log"
	"net/http"
)

// resolveRawDatasetName maps a public alias or raw dataset name to the raw table name.
func resolveRawDatasetName(datasetName string) string {
	return dataset_routes.ResolveRawDatasetNameWithQuerier(backend.Db, datasetName)
}

// resolvePublicDatasetName maps a raw dataset name to its public alias when one exists.
func resolvePublicDatasetName(datasetName string) string {
	return dataset_routes.ResolvePublicDatasetNameWithQuerier(backend.Db, datasetName)
}

// GetDatasetAliasesHandler serves the dedicated dataset alias registry read surface.
func GetDatasetAliasesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	registry, err := dataset_routes.LoadAliasRegistry(backend.Db)
	if err != nil {
		log.Printf("\033[33mwarning: dataset alias registry fallback in GetDatasetAliasesHandler: %v\033[0m", err)
	}

	w.Header().Set("Content-Type", "application/json")
	if encodeErr := json.NewEncoder(w).Encode(map[string]any{
		"raw_to_public": registry.RawToPublic,
		"public_to_raw": registry.PublicToRaw,
	}); encodeErr != nil {
		log.Printf("\033[31merror: encode dataset alias registry: %v\033[0m", encodeErr)
	}
}
