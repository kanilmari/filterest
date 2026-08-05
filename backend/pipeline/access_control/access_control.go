// access_control.go
// Pipeline stage that enforces table-level and route-level access control.
// Bridges the user session, permissions model, and the downstream handler chain.
// Exists to check permissions against the requested resource and reject unauthorized requests.
package access_control

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/permissions"
	e_sessions "easelect/backend/core_components/sessions"

	"github.com/google/uuid"
	"github.com/gorilla/sessions"
)

func jsonScalarToString(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}

	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return strings.TrimSpace(asString)
	}

	var asNumber json.Number
	if err := json.Unmarshal(raw, &asNumber); err == nil {
		return asNumber.String()
	}

	return ""
}

func userIsAdmin(userID int) bool {
	var dummy int
	err := backend.Db.QueryRow(
		`SELECT 1 FROM system_user_group_memberships WHERE user_id = $1 AND group_id = 1`,
		userID,
	).Scan(&dummy)
	if err == sql.ErrNoRows {
		log.Printf("userIsAdmin: User %d is NOT admin (no rows)", userID)
		return false
	}
	if err != nil {
		log.Printf("\033[31merror: %v\033[0m", err)
		return false
	}
	log.Printf("userIsAdmin: User %d IS admin", userID)
	return true
}

func adminPermissionRecoveryModeEnabled() bool {
	if os.Getenv("ENVIRONMENT_TYPE") != "dev" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

// Yhdistetty tarkistusfunktio: tarkistaa sekä function-level että (tarvittaessa) table-level -oikeudet.
// userHasFunctionPermissionOnTable.go
func userHasFunctionPermissionOnTable(userID int, urlRoute, tableName, tableUID string) bool {
	specificTableRelated, err := permissions.FunctionSpecificTableRelated(
		backend.Db,
		urlRoute,
		permissions.DisabledFunctionFalseOrNull,
	)
	if err != nil {
		log.Printf("\033[31m[userHasFunctionPermissionOnTable] specific_table_related fetch error for urlRoute='%s': %v\033[0m", urlRoute, err)
		return false
	}

	if !specificTableRelated {
		tableName = ""
		tableUID = ""
	} else if tableUID == "" && tableName == "" {
		log.Printf("\033[31m[userHasFunctionPermissionOnTable] specific_table_related true but table info missing for urlRoute='%s'\033[0m", urlRoute)
		return false
	}

	recovery_mode := adminPermissionRecoveryModeEnabled() && userIsAdmin(userID)

	scope := permissions.RouteTableScope{TableName: tableName, TableUID: tableUID}
	allowed, err := permissions.CheckRouteTablePermission(
		backend.Db,
		urlRoute,
		userID,
		scope,
		permissions.AccessControlRouteTableOptions(false),
	)
	if err != nil {
		log.Printf("\033[31m[userHasFunctionPermissionOnTable] database error: %v\033[0m", err)
		return false
	}
	if allowed {
		return true
	}

	if recovery_mode {
		if tableUID != "" {
			log.Printf("\033[33m[userHasFunctionPermissionOnTable] recovery mode active: no permission row found for route='%s', table_uid='%s' (userID=%d), allowing exceptionally\033[0m",
				urlRoute, tableUID, userID)
		} else if tableName != "" {
			log.Printf("\033[33m[userHasFunctionPermissionOnTable] recovery mode active: no permission row found for route='%s', table='%s' (userID=%d), allowing exceptionally\033[0m",
				urlRoute, tableName, userID)
		} else {
			log.Printf("\033[33m[userHasFunctionPermissionOnTable] recovery mode active: no tableless function permission found for route='%s' (userID=%d), allowing exceptionally\033[0m",
				urlRoute, userID)
		}
		return true
	}

	if tableUID != "" {
		log.Printf("\033[31m[userHasFunctionPermissionOnTable] no permission row found for route='%s', table_uid='%s' (userID=%d)\033[0m",
			urlRoute, tableUID, userID)
	} else if tableName != "" {
		log.Printf("\033[31m[userHasFunctionPermissionOnTable] no permission row found for route='%s', table='%s' (userID=%d)\033[0m",
			urlRoute, tableName, userID)
	} else {
		log.Printf("\033[31m[userHasFunctionPermissionOnTable] no tableless function permission found for route='%s' (userID=%d)\033[0m",
			urlRoute, userID)
	}
	return false
}

func WithAccessControl(urlRoute, handlerName string, originalHandler http.HandlerFunc) http.HandlerFunc {
	isDev := os.Getenv("ENVIRONMENT_TYPE") == "dev"

	return func(w http.ResponseWriter, r *http.Request) {

		// DEV ONLY: Skip access control for schema modification endpoints
		if isDev && (urlRoute == "/api/modify-columns" || urlRoute == "/api/create_dataset" || urlRoute == "/api/set-comments" || urlRoute == "/api/create-indexes") {
			log.Printf("[WithAccessControl][%s] Skipping access control (dev mode)", handlerName)
			originalHandler(w, r)
			return
		}

		// --- Session ja käyttäjätarkistus ---
		session, err := e_sessions.GetOrCreateSession(w, r)
		if err != nil {
			log.Printf("\033[31m[WithAccessControl][%s] session lookup failed: %v\033[0m", handlerName, err)
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		loginToBrowse, loginToBrowseErr := middlewares.CheckLoginToBrowse()
		if loginToBrowseErr != nil {
			log.Printf("\033[31m[WithAccessControl][%s] login_to_browse fetch failed: %v\033[0m", handlerName, loginToBrowseErr)
			loginToBrowse = true
		}

		if cookie, errCookie := r.Cookie(e_sessions.SessionName); errCookie == nil {
			val := cookie.Value
			if len(val) > 12 {
				val = val[:12]
			}
			log.Printf("[WithAccessControl][%s] session-cookie: %s...", handlerName, val)
		} else {
			log.Printf("[WithAccessControl][%s] session cookie not received", handlerName)
		}

		userIDVal, ok := session.Values["user_id"]
		if !ok {
			if loginToBrowse {
				log.Printf("\033[31m[WithAccessControl][%s] Anonymous user -> redirecting to login page\033[0m", handlerName)
				session.Values["redirect_after_login"] = r.URL.RequestURI()
				if errSave := session.Save(r, w); errSave != nil {
					log.Printf("\033[31m[WithAccessControl][%s] session save failed: %v\033[0m", handlerName, errSave)
				}
				http.Redirect(w, r, "/login", http.StatusSeeOther)
				return
			}

			// login_to_browse=false -> luodaan vieraskäyttäjän sessio
			ensureGuestSession(w, r, session)
			userIDVal = session.Values["user_id"]
		}

		userID, ok2 := userIDVal.(int)
		if !ok2 {
			log.Printf("\033[31m[WithAccessControl][%s] user_id is not int -> no permissions\033[0m", handlerName)
			httpresponse.RespondWithAuthFailure(w, "403 - Forbidden")
			return
		}
		if userID == 1 && loginToBrowse {
			log.Printf("\033[31m[WithAccessControl][%s] Guest session blocked because login_to_browse=true -> redirecting to login page\033[0m", handlerName)
			delete(session.Values, "authenticated")
			delete(session.Values, "user_id")
			delete(session.Values, "username")
			delete(session.Values, "user_role")
			session.Values["redirect_after_login"] = r.URL.RequestURI()
			if errSave := session.Save(r, w); errSave != nil {
				log.Printf("\033[31m[WithAccessControl][%s] guest-session clear failed: %v\033[0m", handlerName, errSave)
			}
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}

		// Hae käyttäjänimi lokitusta varten
		var username string
		err = backend.Db.QueryRow("SELECT username FROM system_users WHERE id = $1", userID).Scan(&username)
		if err != nil {
			log.Printf("\033[31m[WithAccessControl][%s] username lookup failed, userID=%d: %v\033[0m",
				handlerName, userID, err)
			username = fmt.Sprintf("id:%d", userID) // fallback
		}

		specificTableRelated, err := permissions.FunctionSpecificTableRelated(
			backend.Db,
			urlRoute,
			permissions.DisabledFunctionIgnored,
		)
		if err != nil {
			log.Printf("\033[31m[WithAccessControl][%s] specific_table_related fetch error: %v\033[0m", handlerName, err)
			specificTableRelated = true
		}

		if !specificTableRelated {
			if !userHasFunctionPermissionOnTable(userID, urlRoute, "", "") {
				httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (function-level)")
				return
			}
			originalHandler(w, r)
			return
		}
		// --- Tarkista, mitä datasetteja (jos mitään) parametreissa on ---
		tableExists := func(name string) bool {
			if !backend.ShouldExposeCloudManagementDatasetName(name) {
				return false
			}
			var exists bool
			err := backend.Db.QueryRow("SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1)", name).Scan(&exists)
			if err != nil {
				log.Printf("\033[31merror: table existence check failed for %s: %v\033[0m", name, err)
				return false
			}
			return exists
		}

		datasetsParam := r.URL.Query().Get("datasets")
		if datasetsParam != "" {
			// Usean datasetin pyyntö: ?datasets=table1,table2
			tableList := strings.Split(datasetsParam, ",")
			for i := range tableList {
				tableList[i] = strings.TrimSpace(tableList[i])
			}

			validTables := []string{}
			for _, tbl := range tableList {
				if tableExists(tbl) {
					validTables = append(validTables, tbl)
				}
			}

			if len(validTables) > 0 {
				for _, tbl := range validTables {
					if !userHasFunctionPermissionOnTable(userID, urlRoute, tbl, "") {
						httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (multiple datasets)")
						return
					}
				}
			} else {
				if !userHasFunctionPermissionOnTable(userID, urlRoute, "", "") {
					httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (no valid datasets)")
					return
				}
			}

		} else {
			// Yhden datasetin pyyntö ?dataset=...
			tableName := r.URL.Query().Get("dataset")
			if tableName == "" {
				tableName = r.URL.Query().Get("table")
			}
			tableUID := r.URL.Query().Get("dataset_uid")
			if tableUID == "" {
				tableUID = r.URL.Query().Get("table_uid")
			}
			if tableUID == "" && tableName == "" && strings.HasPrefix(r.URL.Path, urlRoute) {
				tableName = strings.Trim(strings.TrimPrefix(r.URL.Path, urlRoute), "/")
			}

			if tableUID == "" && tableName == "" && r.Method != http.MethodGet && strings.Contains(r.Header.Get("Content-Type"), "application/json") {
				bodyBytes, bodyErr := io.ReadAll(r.Body)
				if bodyErr == nil {
					var body struct {
						DatasetName        string          `json:"dataset_name"`
						TableName          string          `json:"table_name"`
						DatasetUID         json.RawMessage `json:"dataset_uid"`
						TableUID           json.RawMessage `json:"table_uid"`
						ReferencingDataset string          `json:"referencing_dataset"`
						ReferencingTable   string          `json:"referencing_table"`
						Dataset            string          `json:"dataset"`
						Table              string          `json:"table"`
					}
					if jsonErr := json.Unmarshal(bodyBytes, &body); jsonErr == nil {
						if tableUID == "" {
							if datasetUID := jsonScalarToString(body.DatasetUID); datasetUID != "" {
								tableUID = datasetUID
							} else if bodyTableUID := jsonScalarToString(body.TableUID); bodyTableUID != "" {
								tableUID = bodyTableUID
							}
						}
						if tableName == "" {
							if body.DatasetName != "" {
								tableName = body.DatasetName
							} else if body.TableName != "" {
								tableName = body.TableName
							} else if body.ReferencingDataset != "" {
								tableName = body.ReferencingDataset
							} else if body.ReferencingTable != "" {
								tableName = body.ReferencingTable
							} else if body.Dataset != "" {
								tableName = body.Dataset
							} else if body.Table != "" {
								tableName = body.Table
							}
						}
					}
					r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))
				} else {
					r.Body = io.NopCloser(bytes.NewBuffer([]byte{}))
				}
			}

			// Jos taulunimi on annettu, tarkistetaan oikeus sille
			if tableUID != "" {
				if !userHasFunctionPermissionOnTable(userID, urlRoute, "", tableUID) {
					httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (single table)")
					return
				}
			} else if tableName != "" {
				if !backend.ShouldExposeCloudManagementDatasetName(tableName) {
					httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
					return
				}
				// log.Printf("[WithAccessControl][%s] Tarkistetaan käyttäjän %s (id=%d) oikeus funktiolle='%s' tauluun='%s'",
				// 	handlerName, username, userID, handlerName, tableName)

				if !userHasFunctionPermissionOnTable(userID, urlRoute, tableName, "") {
					// log.Printf("\033[31m[WithAccessControl][%s] EI oikeutta -> 403\033[0m", handlerName)
					httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (single table)")
					return
				}
			} else {
				// Ei taulunimeä ollenkaan = "tauluton" kutsu
				// log.Printf("[WithAccessControl][%s] Tarkistetaan käyttäjän %s (id=%d) tauluton oikeus funktiolle='%s'",
				// 	handlerName, username, userID, handlerName)

				if !userHasFunctionPermissionOnTable(userID, urlRoute, "", "") {
					// log.Printf("\033[31m[WithAccessControl][%s] EI oikeutta (tauluton) -> 403\033[0m", handlerName)
					httpresponse.RespondWithError(w, http.StatusForbidden, "403 - Forbidden (function-level)")
					return
				}
			}
		}

		// // Kaikki ok -> lokitetaan onnistuminen ja suoritetaan varsinainen handler
		// log.Printf("\033[32m[WithAccessControl][%s] Käyttöoikeustarkastus onnistui käyttäjälle %s (id=%d)\033[0m",
		// 	handlerName, username, userID)
		originalHandler(w, r)
	}
}

func ensureGuestSession(w http.ResponseWriter, r *http.Request, session *sessions.Session) {
	changed := false

	if _, hasUserID := session.Values["user_id"].(int); !hasUserID {
		session.Values["user_id"] = 1
		changed = true
	}

	deviceID := ""
	if sessDeviceID, ok := session.Values["device_id"].(string); ok && sessDeviceID != "" {
		deviceID = sessDeviceID
	}
	if cookieDevice, err := r.Cookie("device_id"); err == nil && cookieDevice.Value != "" {
		deviceID = cookieDevice.Value
	}
	if deviceID == "" {
		deviceID = uuid.NewString()
	}
	if sessDeviceID, _ := session.Values["device_id"].(string); sessDeviceID != deviceID {
		session.Values["device_id"] = deviceID
		changed = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "device_id",
		Value:    deviceID,
		Path:     "/",
		HttpOnly: false,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})

	fingerprint := ""
	if sessFP, ok := session.Values["fingerprint_hash"].(string); ok && sessFP != "" {
		fingerprint = sessFP
	}
	if cookieFP, err := r.Cookie("fingerprint"); err == nil && cookieFP.Value != "" {
		fingerprint = cookieFP.Value
	}
	if fingerprint == "" {
		fingerprint = uuid.NewString()
	}
	if sessFP, _ := session.Values["fingerprint_hash"].(string); sessFP != fingerprint {
		session.Values["fingerprint_hash"] = fingerprint
		changed = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "fingerprint",
		Value:    fingerprint,
		Path:     "/",
		HttpOnly: false,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		Secure:   e_sessions.ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})

	if changed {
		if err := session.Save(r, w); err != nil {
			log.Printf("\033[31m[WithAccessControl] guest session save failed: %v\033[0m", err)
		}
	}
}

// WithDeviceIDCheck varmistaa, että sessionin device_id vastaa device_id-evästettä.
