// get_auth_modes.go
// Returns the current user's authentication state and role information via HTTP.
// Bridges the session store and the frontend UI that toggles login/logout and admin elements.
// Exists to let the frontend conditionally render role-dependent UI without duplicating auth logic.
package auth

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	e_sessions "easelect/backend/core_components/sessions"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	gorillaSessions "github.com/gorilla/sessions"
)

// AuthModesResponse keeps the public auth bootstrap payload stable for typed frontend callers.
type AuthModesResponse struct {
	NeedsButton            string `json:"needs_button"`
	RegistrationEnabled    bool   `json:"registration_enabled"`
	LoginRequiredForBrowse bool   `json:"login_required_for_browse"`
}

// GetAuthModesHandler tallentaa käyttäjän roolin sessioon
func GetAuthModesHandler(response_writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		httpresponse.RespondWithError(response_writer, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	fmt.Printf("\033[32mGetAuthModesHandler\033[0m\n")

	loginToBrowse, loginToBrowseErr := middlewares.CheckLoginToBrowse()
	if loginToBrowseErr != nil {
		log.Printf("\033[31mvirhe: login_to_browse fetch failed: %s\033[0m\n", loginToBrowseErr.Error())
		loginToBrowse = true
	}

	// 1. Tarkistetaan, onko käyttäjä kirjautunut
	userID, err := e_sessions.GetUserIDFromSession(request)
	if err != nil || userID <= 0 {
		if loginToBrowse {
			response_writer.Header().Set("Content-Type", "application/json; charset=utf-8")
			responseData := AuthModesResponse{
				NeedsButton:            "login",
				RegistrationEnabled:    middlewares.CheckRegistrationEnabled(),
				LoginRequiredForBrowse: loginToBrowse,
			}
			if encodeErr := json.NewEncoder(response_writer).Encode(responseData); encodeErr != nil {
				log.Printf("\033[31mvirhe: %s\033[0m\n", encodeErr.Error())
				httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding auth modes")
			}
			return
		}

		// Jos käyttäjää ei ole kirjautunut, oletetaan guest (userID=1)
		userID = 1
	}

	// 2. Päätellään, tarvitaanko login- vai logout-painiketta (guest = userID=1)
	var buttonState string
	if userID == 1 {
		buttonState = "login"
	} else {
		userExists, existsErr := authenticatedUserExists(userID)
		if existsErr != nil {
			log.Printf("\033[31mvirhe: user existence check failed for user %d: %s\033[0m\n", userID, existsErr.Error())
		} else if !userExists {
			session, sessionErr := e_sessions.GetOrCreateSession(response_writer, request)
			if sessionErr != nil {
				log.Printf("\033[31mvirhe: %s\033[0m\n", sessionErr.Error())
				httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "session lookup failed")
				return
			}
			clearAuthSessionValues(session)
			if saveErr := session.Save(request, response_writer); saveErr != nil {
				log.Printf("\033[31mvirhe: %s\033[0m\n", saveErr.Error())
				httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "session save failed")
				return
			}

			response_writer.Header().Set("Content-Type", "application/json; charset=utf-8")
			responseData := AuthModesResponse{
				NeedsButton:            "login",
				RegistrationEnabled:    middlewares.CheckRegistrationEnabled(),
				LoginRequiredForBrowse: loginToBrowse,
			}
			if encodeErr := json.NewEncoder(response_writer).Encode(responseData); encodeErr != nil {
				log.Printf("\033[31mvirhe: %s\033[0m\n", encodeErr.Error())
				httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding auth modes")
			}
			return
		}
		buttonState = "logout"
	}

	// If login becomes required while a guest session is still present, clear the
	// stale guest identity so downstream middleware treats the browser as anonymous.
	if userID == 1 && loginToBrowse {
		session, sessionErr := e_sessions.GetOrCreateSession(response_writer, request)
		if sessionErr != nil {
			log.Printf("\033[31mvirhe: %s\033[0m\n", sessionErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "session lookup failed")
			return
		}
		clearAuthSessionValues(session)
		if saveErr := session.Save(request, response_writer); saveErr != nil {
			log.Printf("\033[31mvirhe: %s\033[0m\n", saveErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "session save failed")
			return
		}

		response_writer.Header().Set("Content-Type", "application/json; charset=utf-8")
		responseData := AuthModesResponse{
			NeedsButton:            "login",
			RegistrationEnabled:    middlewares.CheckRegistrationEnabled(),
			LoginRequiredForBrowse: loginToBrowse,
		}
		if encodeErr := json.NewEncoder(response_writer).Encode(responseData); encodeErr != nil {
			log.Printf("\033[31mvirhe: %s\033[0m\n", encodeErr.Error())
			httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding auth modes")
		}
		return
	}

	userRole, resolveErr := backend.ResolveUserRole(userID)
	if resolveErr != nil {
		log.Printf("\033[31mvirhe: role resolution failed for user %d: %s\033[0m\n", userID, resolveErr.Error())
		if userID == 1 {
			userRole = "guest"
		} else {
			userRole = "basic"
		}
	}

	// Tallennetaan rooli ja tarvittaessa user_id sessioon
	session, err := e_sessions.GetOrCreateSession(response_writer, request)
	if err != nil {
		log.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
		// Emme lopeta, mutta kerromme, että sessio ei ehkä toimi
	}
	if _, ok := session.Values["user_id"].(int); !ok {
		session.Values["user_id"] = userID
	}
	session.Values["user_role"] = userRole

	if err := session.Save(request, response_writer); err != nil {
		log.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "session save failed")
		return
	}

	// 4. Palautetaan JSON-muotoinen vastaus (tarvittava painike)
	response_writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	responseData := AuthModesResponse{
		NeedsButton:            buttonState,
		RegistrationEnabled:    middlewares.CheckRegistrationEnabled(),
		LoginRequiredForBrowse: loginToBrowse,
	}
	if err := json.NewEncoder(response_writer).Encode(responseData); err != nil {
		log.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
		httpresponse.RespondWithError(response_writer, http.StatusInternalServerError, "error encoding auth modes")
		return
	}
}

// authenticatedUserExists verifies that a stored logged-in session still points
// at an enabled user row between the auth cookie and system_users.
// It exists so stale cookies for deleted/reseeded dev users do not bootstrap a
// logout shell with an empty permission cache.
func authenticatedUserExists(userID int) (bool, error) {
	if userID <= 1 {
		return true, nil
	}

	roleDB := backend.Db
	if roleDB == nil {
		roleDB = backend.DbGuest
	}
	if roleDB == nil {
		return false, fmt.Errorf("auth modes database unavailable")
	}

	var dummy int
	err := roleDB.QueryRow(
		`SELECT 1 FROM system_users WHERE id = $1 AND enabled IS TRUE`,
		userID,
	).Scan(&dummy)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// clearAuthSessionValues removes authenticated identity keys between a stale
// browser cookie and the next auth bootstrap response.
// It exists so every stale-session path clears the same session fields.
func clearAuthSessionValues(session *gorillaSessions.Session) {
	delete(session.Values, "authenticated")
	delete(session.Values, "user_id")
	delete(session.Values, "username")
	delete(session.Values, "user_role")
}
