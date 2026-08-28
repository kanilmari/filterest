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
	"net/url"
	"os"
	"strings"

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

func singleConsistentIdentifier(kind string, candidates ...string) (string, error) {
	resolved := ""
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		if resolved == "" {
			resolved = candidate
			continue
		}
		if candidate != resolved {
			return "", fmt.Errorf("conflicting %s identifiers", kind)
		}
	}
	return resolved, nil
}

func extractRouteTableTarget(r *http.Request, urlRoute string) (string, string, error) {
	queryName, err := singleConsistentIdentifier(
		"dataset name",
		r.URL.Query().Get("dataset"),
		r.URL.Query().Get("table"),
	)
	if err != nil {
		return "", "", err
	}
	queryUID, err := singleConsistentIdentifier(
		"dataset UID",
		r.URL.Query().Get("dataset_uid"),
		r.URL.Query().Get("table_uid"),
	)
	if err != nil {
		return "", "", err
	}

	bodyName := ""
	bodyUID := ""
	referencingName := ""
	if r.Method != http.MethodGet && strings.Contains(r.Header.Get("Content-Type"), "application/json") {
		bodyBytes, bodyErr := io.ReadAll(r.Body)
		if bodyErr != nil {
			return "", "", fmt.Errorf("read request body: %w", bodyErr)
		}
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

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
			bodyName, err = singleConsistentIdentifier(
				"request-body dataset name",
				body.DatasetName,
				body.TableName,
				body.Dataset,
				body.Table,
			)
			if err != nil {
				return "", "", err
			}
			bodyUID, err = singleConsistentIdentifier(
				"request-body dataset UID",
				jsonScalarToString(body.DatasetUID),
				jsonScalarToString(body.TableUID),
			)
			if err != nil {
				return "", "", err
			}
			referencingName, err = singleConsistentIdentifier(
				"referencing dataset name",
				body.ReferencingDataset,
				body.ReferencingTable,
			)
			if err != nil {
				return "", "", err
			}
		}
	}

	tableName, err := singleConsistentIdentifier("dataset name", queryName, bodyName)
	if err != nil {
		return "", "", err
	}
	tableUID, err := singleConsistentIdentifier("dataset UID", queryUID, bodyUID)
	if err != nil {
		return "", "", err
	}
	if tableName == "" {
		tableName = referencingName
	}
	if tableUID == "" && tableName == "" && strings.HasPrefix(r.URL.Path, urlRoute) {
		tableName = strings.Trim(strings.TrimPrefix(r.URL.Path, urlRoute), "/")
	}
	return tableName, tableUID, nil
}

func routeTableIdentifiersMatch(tableName, tableUID string) (bool, error) {
	tableName = strings.TrimSpace(tableName)
	tableUID = strings.TrimSpace(tableUID)
	if tableName == "" || tableUID == "" {
		return true, nil
	}

	var matches bool
	err := backend.Db.QueryRow(`
		SELECT EXISTS (
			SELECT 1
			FROM public.system_db_tables
			WHERE table_name = $1
			  AND table_uid::text = $2
			  AND COALESCE(NULLIF(schema_name, ''), 'public') = 'public'
		)`, tableName, tableUID).Scan(&matches)
	return matches, err
}

const sessionEndedLoginNotice = "session-ended"

func isBrowserDocumentNavigation(r *http.Request) bool {
	if r.Method != http.MethodGet || strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	if !strings.Contains(strings.ToLower(r.Header.Get("Accept")), "text/html") {
		return false
	}
	fetchMode := strings.ToLower(strings.TrimSpace(r.Header.Get("Sec-Fetch-Mode")))
	if fetchMode != "" && fetchMode != "navigate" {
		return false
	}
	return true
}

// redirectBrowserDocumentToLogin turns an unauthenticated page navigation into
// a recoverable browser flow while leaving API behavior unchanged. The fixed
// notice code is rendered as localized copy by the login page and removed from
// the address bar after it has been consumed.
func redirectBrowserDocumentToLogin(w http.ResponseWriter, r *http.Request, session *sessions.Session) bool {
	if !isBrowserDocumentNavigation(r) {
		return false
	}

	returnPath := r.URL.RequestURI()
	if returnPath == "" || strings.HasPrefix(returnPath, "/login") {
		returnPath = "/"
	}
	session.Values["redirect_after_login"] = returnPath
	if err := session.Save(r, w); err != nil {
		log.Printf("\033[31m[WithAccessControl] browser-login redirect session save failed: %v\033[0m", err)
	}
	query := url.Values{}
	query.Set("auth_notice", sessionEndedLoginNotice)
	query.Set("redirect", returnPath)
	http.Redirect(w, r, "/login?"+query.Encode(), http.StatusSeeOther)
	return true
}

// redirectGuestDocumentToLogin scopes the shared browser redirect to a denied
// guest shell. Authenticated authorization denials must remain ordinary 403s.
func redirectGuestDocumentToLogin(w http.ResponseWriter, r *http.Request, session *sessions.Session, userID int) bool {
	return userID == 1 && redirectBrowserDocumentToLogin(w, r, session)
}

func denyRouteAccess(w http.ResponseWriter, r *http.Request, session *sessions.Session, userID int, message string) {
	if redirectGuestDocumentToLogin(w, r, session, userID) {
		return
	}
	httpresponse.RespondWithError(w, http.StatusForbidden, message)
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
				if redirectBrowserDocumentToLogin(w, r, session) {
					return
				}
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
			if redirectBrowserDocumentToLogin(w, r, session) {
				return
			}
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
				denyRouteAccess(w, r, session, userID, "403 - Forbidden (function-level)")
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

		tableName, tableUID, targetErr := extractRouteTableTarget(r, urlRoute)
		if targetErr != nil {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "conflicting dataset identifiers")
			return
		}

		datasetsParam := r.URL.Query().Get("datasets")
		if datasetsParam != "" {
			if tableName != "" || tableUID != "" {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "plural and singular dataset identifiers cannot be combined")
				return
			}
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
						denyRouteAccess(w, r, session, userID, "403 - Forbidden (multiple datasets)")
						return
					}
				}
			} else {
				if !userHasFunctionPermissionOnTable(userID, urlRoute, "", "") {
					denyRouteAccess(w, r, session, userID, "403 - Forbidden (no valid datasets)")
					return
				}
			}

		} else {
			if tableName != "" && !backend.ShouldExposeCloudManagementDatasetName(tableName) {
				httpresponse.RespondWithError(w, http.StatusNotFound, "dataset not found")
				return
			}
			identifiersMatch, matchErr := routeTableIdentifiersMatch(tableName, tableUID)
			if matchErr != nil {
				log.Printf("\033[31m[WithAccessControl][%s] dataset identifier validation failed: %v\033[0m", handlerName, matchErr)
				httpresponse.RespondWithError(w, http.StatusInternalServerError, "dataset identity check failed")
				return
			}
			if !identifiersMatch {
				httpresponse.RespondWithError(w, http.StatusBadRequest, "dataset identifiers do not match")
				return
			}

			// Jos taulunimi on annettu, tarkistetaan oikeus sille
			if tableUID != "" {
				if !userHasFunctionPermissionOnTable(userID, urlRoute, "", tableUID) {
					denyRouteAccess(w, r, session, userID, "403 - Forbidden (single table)")
					return
				}
			} else if tableName != "" {
				// log.Printf("[WithAccessControl][%s] Tarkistetaan käyttäjän %s (id=%d) oikeus funktiolle='%s' tauluun='%s'",
				// 	handlerName, username, userID, handlerName, tableName)

				if !userHasFunctionPermissionOnTable(userID, urlRoute, tableName, "") {
					// log.Printf("\033[31m[WithAccessControl][%s] EI oikeutta -> 403\033[0m", handlerName)
					denyRouteAccess(w, r, session, userID, "403 - Forbidden (single table)")
					return
				}
			} else {
				// Ei taulunimeä ollenkaan = "tauluton" kutsu
				// log.Printf("[WithAccessControl][%s] Tarkistetaan käyttäjän %s (id=%d) tauluton oikeus funktiolle='%s'",
				// 	handlerName, username, userID, handlerName)

				if !userHasFunctionPermissionOnTable(userID, urlRoute, "", "") {
					// log.Printf("\033[31m[WithAccessControl][%s] EI oikeutta (tauluton) -> 403\033[0m", handlerName)
					denyRouteAccess(w, r, session, userID, "403 - Forbidden (function-level)")
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
	if cookieDevice, err := r.Cookie(e_sessions.DeviceIDCookieName()); err == nil && cookieDevice.Value != "" {
		deviceID = cookieDevice.Value
	}
	if deviceID == "" {
		deviceID = uuid.NewString()
	}
	if sessDeviceID, _ := session.Values["device_id"].(string); sessDeviceID != deviceID {
		session.Values["device_id"] = deviceID
		changed = true
	}
	e_sessions.SetDeviceIDCookie(w, deviceID)

	fingerprint := ""
	if sessFP, ok := session.Values["fingerprint_hash"].(string); ok && sessFP != "" {
		fingerprint = sessFP
	}
	if cookieFP, err := r.Cookie(e_sessions.FingerprintCookieName()); err == nil && cookieFP.Value != "" {
		fingerprint = cookieFP.Value
	}
	if fingerprint == "" {
		fingerprint = uuid.NewString()
	}
	if sessFP, _ := session.Values["fingerprint_hash"].(string); sessFP != fingerprint {
		session.Values["fingerprint_hash"] = fingerprint
		changed = true
	}
	e_sessions.SetFingerprintCookie(w, fingerprint)

	if changed {
		if err := session.Save(r, w); err != nil {
			log.Printf("\033[31m[WithAccessControl] guest session save failed: %v\033[0m", err)
		}
	}
}

// WithDeviceIDCheck varmistaa, että sessionin device_id vastaa device_id-evästettä.
