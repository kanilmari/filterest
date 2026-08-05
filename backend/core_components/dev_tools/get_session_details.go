// get_session_details.go
// Development-only handler that returns the current session payload as JSON.
// Bridges the session store and a debug-facing HTTP response for local inspection.
// Exists to help developers verify session keys, CSRF tokens, and environment state.
package devtools

import (
	"easelect/backend/core_components/httpresponse"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"fmt"
	"net/http"
	"os"

	"github.com/google/uuid"
)

// SessionHandler returns the current session values after converting them into JSON-safe types.
func SessionHandler(w http.ResponseWriter, r *http.Request) {
	session, err := e_sessions.GetOrCreateSession(w, r)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(w, http.StatusInternalServerError, err.Error())
		return
	}

	csrfToken, ok := session.Values["csrf_token"].(string)
	if !ok || csrfToken == "" {
		csrfToken = uuid.NewString()
		session.Values["csrf_token"] = csrfToken
		if errSave := session.Save(r, w); errSave != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", errSave.Error())
		}
	}

	// Muutetaan session.Values (map[interface{}]interface{}) -> map[string]interface{}
	convertedData := convertMapInterfaceKeysToString(session.Values)

	envType := os.Getenv("ENVIRONMENT_TYPE")
	if envType == "" {
		envType = "prod"
	}

	if m, ok := convertedData.(map[string]interface{}); ok {
		m["ENVIRONMENT_TYPE"] = envType
	}

	// tulostetaan palvelimen logiin
	// fmt.Printf("\033[32mSession data: %v\033[0m\n", convertedData)

	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(convertedData); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
	}
}

// convertMapInterfaceKeysToString recursively converts session maps into JSON-encodable string-keyed maps.
func convertMapInterfaceKeysToString(data interface{}) interface{} {
	switch arvot := data.(type) {
	case map[interface{}]interface{}:
		uusiMap := make(map[string]interface{})
		for avain, arvo := range arvot {
			avainStr, ok := avain.(string)
			if !ok {
				avainStr = fmt.Sprintf("%v", avain)
			}
			uusiMap[avainStr] = convertMapInterfaceKeysToString(arvo)
		}
		return uusiMap

	case []interface{}:
		// Jos talletetaan taulukoita, käsitellään myös ne rekursiivisesti
		for i, v := range arvot {
			arvot[i] = convertMapInterfaceKeysToString(v)
		}
		return arvot

	default:
		// Kaikki muu, esim. perusdatatyypit, jätetään ennalleen
		return arvot
	}
}
