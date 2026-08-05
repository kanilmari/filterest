// product_identity_handler.go
// Serves the current product identity as a small public JSON endpoint.
// Bridges backend marker-file detection and frontend runtime branching.
// Exists so shared Filterest/Easelect UI code can discover product identity safely.
package productidentity

import (
	"encoding/json"
	"net/http"
)

// Handler returns the detected product identity for the current runtime root.
// Between HTTP callers and DetectFromWorkingDirectory, it exposes a stable
// public contract without requiring database access or private imports.
func Handler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(DetectFromWorkingDirectory()); err != nil {
		http.Error(w, "failed to encode product identity", http.StatusInternalServerError)
		return
	}
}
