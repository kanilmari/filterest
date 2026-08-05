// about_handler.go
// Returns system information for the About page as JSON.
// Bridges the application version, build info, and environment details with the frontend About view.
// Exists to expose build and environment metadata through a single admin endpoint.
package system_table_tools

import (
	backend "easelect/backend/core_components"
	"encoding/json"
	"log"
	"net/http"
	"easelect/backend/core_components/httpresponse"
	"strconv"
)

// GetAboutRowHandler palauttaa yhden system_about-rivin id:n perusteella.
// GET /api/about?id=4 → { "id": 4, "title": "{...}", "description": "{...}" }
func GetAboutRowHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	idStr := r.URL.Query().Get("id")
	if idStr == "" {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Missing required parameter: id")
		return
	}

	id, err := strconv.Atoi(idStr)
	if err != nil {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid id parameter")
		return
	}

	var title, description string
	err = backend.Db.QueryRow(`
		SELECT COALESCE(title, ''), COALESCE(description, '')
		FROM system_about
		WHERE id = $1
	`, id).Scan(&title, &description)

	if err != nil {
		log.Printf("[GetAboutRowHandler] id=%d: %v", id, err)
		httpresponse.RespondWithError(w, http.StatusNotFound, "Not found")
		return
	}

	result := map[string]interface{}{
		"id":          id,
		"title":       title,
		"description": description,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
