// routing_builder.go
// Shared helper functions for route registration and URL pattern building. Used by both
// router.go and router_for_apps.go to reduce repetition in route setup.
// Exists to centralize pipeline wrapping, template serving, and route registration mechanics.
package router

import (
	"context"
	"database/sql"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/permissions"
	productidentity "easelect/backend/core_components/product_identity"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/pipeline"

	"github.com/google/uuid"
)

var configuredSiteNameReader = backend.ConfiguredSiteName

type indexTemplateData struct {
	CSPNonce                string
	UseMinifiedAssets       bool
	IsDev                   bool
	InstallationEnvironment string
	SiteName                string
	ProductName             string
	ProjectLogoPath         string
	// SEO / Open Graph fields (populated by resolvePageMeta)
	PageTitle       string
	MetaDescription string
	CanonicalURL    string
	OGTitle         string
	OGDescription   string
	OGType          string
	OGURL           string
	OGImage         string
	OGLocale        string
	LangCode        string
	RobotsNoIndex   bool // true → emit <meta name="robots" content="noindex, nofollow">
	ImportsCSSPath  string
	MainBundlePath  string
}

// getSiteName returns the administrator-owned site name before deployment fallbacks.
func getSiteName() string {
	if siteName := configuredSiteNameReader(context.Background(), backend.Db); siteName != "" {
		return siteName
	}
	if s := strings.TrimSpace(os.Getenv("SITE_NAME")); s != "" {
		return s
	}

	identity := productidentity.DetectFromWorkingDirectory()
	if identity.Kind != productidentity.KindUnknown && strings.TrimSpace(identity.Name) != "" {
		return identity.Name
	}

	return "Easelect"
}

func getProjectLogoPath() string {
	if localStorageDir == "" {
		return ""
	}

	for _, ext := range []string{".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"} {
		fileName := fmt.Sprintf("project_logo%s", ext)
		logoPath := filepath.Join(localStorageDir, fileName)
		if _, err := os.Stat(logoPath); err == nil {
			return "/storage/" + fileName
		}
	}

	return ""
}

// getInstallationEnvironment returns the user-facing purpose selected during First Run.
// The process capability still comes from ENVIRONMENT_TYPE/buildEnv and is never downgraded here.
func getInstallationEnvironment() string {
	runtimeEnvironment := os.Getenv("ENVIRONMENT_TYPE")
	if backend.Db == nil {
		return resolveInstallationEnvironment("", runtimeEnvironment)
	}
	var environment string
	err := backend.Db.QueryRow(`
		SELECT COALESCE(NULLIF(text_value, ''), json_value->>'value', '')
		FROM system_config
		WHERE key = 'installation_environment'
    `).Scan(&environment)
	if err != nil {
		return resolveInstallationEnvironment("", runtimeEnvironment)
	}
	return resolveInstallationEnvironment(environment, runtimeEnvironment)
}

func resolveInstallationEnvironment(storedEnvironment, runtimeEnvironment string) string {
	switch strings.ToLower(strings.TrimSpace(storedEnvironment)) {
	case "dev", "test", "qa", "prod":
		return strings.ToLower(strings.TrimSpace(storedEnvironment))
	}
	if strings.EqualFold(strings.TrimSpace(runtimeEnvironment), "dev") {
		return "dev"
	}
	return "prod"
}

func tablesHandler(w http.ResponseWriter, r *http.Request, loginToBrowse bool) {
	log.Printf("tablesHandler: user requested URL: %s", r.URL.String())
	setAuthShellNoStoreHeaders(w, loginToBrowse)

	// 1) Haetaan nonce, jonka CSP-middleware on laittanut contextiin
	nonce := middlewares.GetCSPNonce(r)

	useMinified, err := middlewares.ShouldUseMinifiedAssetsInDev()
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		useMinified = true
	}

	// 2) Parsitaan index.html Go-templaatiksi
	tplPath := filepath.Join(localFrontendDir, "index.html")
	tpl, err := template.ParseFiles(tplPath)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		http.ServeFile(w, r, tplPath) // fallback – ei noncea
		return
	}

	// 3) Ajetaan templaatti ja syötetään nonce + SEO-metatiedot
	envType := os.Getenv("ENVIRONMENT_TYPE")
	isDev := envType == "" || envType == "dev"
	meta := resolvePageMeta(r)
	siteName := meta.SiteName
	noIndex := !isIndexingAllowed()
	assetPaths := frontendassets.Resolve(localFrontendDir, useMinified)
	data := indexTemplateData{
		CSPNonce: nonce, UseMinifiedAssets: useMinified, IsDev: isDev,
		InstallationEnvironment: getInstallationEnvironment(), SiteName: siteName,
		ProductName:     getSiteName(),
		ProjectLogoPath: getProjectLogoPath(),
		PageTitle:       meta.PageTitle, MetaDescription: meta.MetaDescription,
		CanonicalURL: meta.CanonicalURL, OGTitle: meta.OGTitle,
		OGDescription: meta.OGDescription, OGType: meta.OGType,
		OGURL: meta.OGURL, OGImage: meta.OGImage,
		OGLocale: meta.OGLocale, LangCode: meta.LangCode,
		RobotsNoIndex:  noIndex,
		ImportsCSSPath: assetPaths.ImportsCSSPath,
		MainBundlePath: assetPaths.MainBundlePath,
	}
	if err := tpl.Execute(w, data); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
	}
}

func adminHandler(w http.ResponseWriter, r *http.Request) {
	log.Printf("adminHandler: user requested URL: %s", r.URL.String())
	setAuthShellNoStoreHeaders(w, true)

	nonce := middlewares.GetCSPNonce(r)

	useMinified, err := middlewares.ShouldUseMinifiedAssetsInDev()
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		useMinified = true
	}

	tplPath := filepath.Join(localFrontendDir, "index.html")
	tpl, err := template.ParseFiles(tplPath)
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		http.ServeFile(w, r, tplPath)
		return
	}

	meta := resolvePageMeta(r)
	assetPaths := frontendassets.Resolve(localFrontendDir, useMinified)
	data := indexTemplateData{
		CSPNonce: nonce, UseMinifiedAssets: useMinified,
		InstallationEnvironment: getInstallationEnvironment(), SiteName: meta.SiteName,
		ProductName:     getSiteName(),
		ProjectLogoPath: getProjectLogoPath(),
		PageTitle:       meta.PageTitle, MetaDescription: meta.MetaDescription,
		CanonicalURL: meta.CanonicalURL, OGTitle: meta.OGTitle,
		OGDescription: meta.OGDescription, OGType: meta.OGType,
		OGURL: meta.OGURL, OGImage: meta.OGImage,
		OGLocale: meta.OGLocale, LangCode: meta.LangCode,
		RobotsNoIndex:  true, // admin pages are always noindex
		ImportsCSSPath: assetPaths.ImportsCSSPath,
		MainBundlePath: assetPaths.MainBundlePath,
	}
	if err := tpl.Execute(w, data); err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
	}
}

func datasetsRedirectHandler(w http.ResponseWriter, r *http.Request) {
	newPath := strings.TrimPrefix(r.URL.Path, "/datasets")
	if newPath == "" {
		newPath = "/"
	}
	http.Redirect(w, r, newPath, http.StatusMovedPermanently)
}

func datasetExists(name string) bool {
	rawName := resolveRawDatasetName(name)
	if rawName == "" || !backend.ShouldExposeCloudManagementDatasetName(rawName) {
		return false
	}
	var exists bool
	err := backend.Db.QueryRow(`SELECT EXISTS (SELECT 1 FROM system_db_tables WHERE table_name = $1)`, rawName).Scan(&exists)
	if err != nil {
		log.Printf("\033[31merror: %v\033[0m", err)
		return false
	}
	return exists
}

func guestCanReadDataset(name string, guestUserID int) bool {
	rawName := resolveRawDatasetName(name)
	if rawName == "" || guestUserID <= 0 {
		return false
	}

	allowed, err := permissions.CheckRouteTablePermission(
		backend.Db,
		"/api/get-results",
		guestUserID,
		permissions.RouteTableScope{TableName: rawName},
		permissions.AccessControlRouteTableOptions(false),
	)
	if err != nil {
		log.Printf("\033[31merror: guest dataset permission check failed for %s: %v\033[0m", rawName, err)
		return false
	}
	return allowed
}

func redirectGuestDatasetRequestToLoginEntry(w http.ResponseWriter, r *http.Request) {
	redirectTarget := r.URL.RequestURI()
	if redirectTarget == "" {
		redirectTarget = "/"
	}

	query := url.Values{}
	query.Set("login-entry", "1")
	query.Set("redirect", redirectTarget)
	http.Redirect(w, r, "/?"+query.Encode(), http.StatusSeeOther)
}

func shouldRedirectGuestDeepLinkToLogin(r *http.Request, firstSeg string, statErr error, firstSegIsDataset bool, guestUserID int) bool {
	if r == nil || guestUserID <= 0 || isAuthShellEntryRequest(r) {
		return false
	}

	if firstSegIsDataset {
		return !guestCanReadDataset(firstSeg, guestUserID)
	}

	return os.IsNotExist(statErr) && isSpaDeepLinkPath(r.URL.Path)
}

func isSpaDeepLinkPath(pathValue string) bool {
	trimmedPath := strings.TrimSpace(pathValue)
	if trimmedPath == "" || trimmedPath == "/" {
		return false
	}
	trimmedPath = strings.Trim(trimmedPath, "/")
	if trimmedPath == "" {
		return false
	}
	lastSegment := trimmedPath
	if idx := strings.LastIndex(lastSegment, "/"); idx >= 0 {
		lastSegment = lastSegment[idx+1:]
	}
	return filepath.Ext(lastSegment) == ""
}

func isGuestUserID(userIDVal interface{}) bool {
	userID, ok := userIDVal.(int)
	return ok && userID == 1
}

// faviconHandler palvelee tiedoston "/favicon..."
func faviconHandler(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, filepath.Join(localFrontendDir, "favicon4S.png"))
}

func robotsHandler(w http.ResponseWriter, r *http.Request) {
	// If indexing is not allowed, return a restrictive robots.txt
	if !isIndexingAllowed() {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		fmt.Fprint(w, "User-agent: *\nDisallow: /\n")
		return
	}
	http.ServeFile(w, r, filepath.Join(localFrontendDir, "robots.txt"))
}

// setAuthShellNoStoreHeaders marks auth-gated HTML shell responses as uncacheable.
// This keeps browser back/forward navigation from reviving a stale authenticated shell
// after logout when login_to_browse is enabled.
func setAuthShellNoStoreHeaders(w http.ResponseWriter, loginToBrowse bool) {
	if !loginToBrowse {
		return
	}

	w.Header().Set("Cache-Control", "no-store, max-age=0, must-revalidate, private")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	w.Header().Set("Vary", "Cookie")
}

func rootHandler(w http.ResponseWriter, r *http.Request) {
	if pending, err := auth.IsFirstRunAdminSetupPending(r.Context(), backend.Db); err == nil && pending {
		http.Redirect(w, r, "/first-run", http.StatusSeeOther)
		return
	} else if err != nil {
		log.Printf("[rootHandler] first-run state check unavailable; setup remains closed: %v", err)
	}

	// Jos pyyntö on favicon, palvellaan se suoraan
	if r.URL.Path == "/favicon4S.png" {
		http.ServeFile(w, r, filepath.Join(localFrontendDir, "favicon4S.png"))
		return
	}

	// Salli suoraan JS, CSS, PNG, JPG, ... ilman kirjautumista
	if strings.HasSuffix(r.URL.Path, ".js") ||
		strings.HasSuffix(r.URL.Path, ".css") ||
		strings.HasSuffix(r.URL.Path, ".png") ||
		strings.HasSuffix(r.URL.Path, ".jpg") {
		fs := http.FileServer(http.Dir(localFrontendDir))
		fs.ServeHTTP(w, r)
		return
	}

	// Tarkistetaan asetuksista
	loginToBrowse, err := middlewares.CheckLoginToBrowse()
	if err != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		// oletuksena pakotetaan kirjautuminen
		loginToBrowse = true
	}

	// Haetaan sessio
	session, sessErr := e_sessions.GetOrCreateSession(w, r)
	if sessErr != nil {
		fmt.Printf("\033[31merror: %s\033[0m\n", sessErr.Error())
		http.Redirect(w, r, "/login", http.StatusSeeOther)
		return
	}

	authShellEntry := isAuthShellEntryRequest(r)
	userIDVal, onkoKayttaja := session.Values["user_id"]
	if !onkoKayttaja {
		// ei user_id:tä
		if loginToBrowse && !authShellEntry {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		if !loginToBrowse {
			session.Values["user_id"] = 1
			userIDVal = 1
			onkoKayttaja = true
		}
	}

	if onkoKayttaja {
		if _, castOk := userIDVal.(int); !castOk {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
	}

	// Device_id ja fingerprint varmistetaan,
	// jos login_to_browse on false (ja ollaan siis 'guest'-tilassa).
	// Muussa tapauksessa nämä kannattaa hoitaa omassa middleware-funktiossa, jos haluat.
	if !loginToBrowse {
		changed := false

		// Varmista device_id
		cDev, cDevErr := r.Cookie("device_id")
		var deviceID string
		if cDevErr != nil || cDev.Value == "" {
			deviceID = uuid.NewString()
			changed = true
		} else {
			deviceID = cDev.Value
		}
		if sessID, _ := session.Values["device_id"].(string); sessID != deviceID {
			session.Values["device_id"] = deviceID
			changed = true
		}
		if changed {
			http.SetCookie(w, &http.Cookie{
				Name:     "device_id",
				Value:    deviceID,
				Path:     "/",
				HttpOnly: false,
				Expires:  time.Now().Add(7 * 24 * time.Hour),
			})
		}

		// Varmista fingerprint
		cF, cFErr := r.Cookie("fingerprint")
		var fingerprint string
		if cFErr != nil || cF.Value == "" {
			fingerprint = uuid.NewString()
			changed = true
		} else {
			fingerprint = cF.Value
		}
		if sessFp, _ := session.Values["fingerprint_hash"].(string); sessFp != fingerprint {
			session.Values["fingerprint_hash"] = fingerprint
			changed = true
		}
		if changed {
			http.SetCookie(w, &http.Cookie{
				Name:     "fingerprint",
				Value:    fingerprint,
				Path:     "/",
				HttpOnly: false,
				Expires:  time.Now().Add(7 * 24 * time.Hour),
			})
			if errSave := session.Save(r, w); errSave != nil {
				log.Printf("\033[31merror: session save failed: %s\033[0m\n", errSave.Error())
			}
		}
	}

	// Jos polku on "/", palvellaan index.html
	if r.URL.Path == "/" {
		setAuthShellNoStoreHeaders(w, loginToBrowse)
		nonce := middlewares.GetCSPNonce(r)
		tplPath := filepath.Join(localFrontendDir, "index.html")
		tpl, err := template.ParseFiles(tplPath)
		if err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
			http.ServeFile(w, r, tplPath)
			return
		}
		useMinified, flagErr := middlewares.ShouldUseMinifiedAssetsInDev()
		if flagErr != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", flagErr.Error())
			useMinified = true
		}
		meta := resolvePageMeta(r)
		assetPaths := frontendassets.Resolve(localFrontendDir, useMinified)
		data := indexTemplateData{
			CSPNonce: nonce, UseMinifiedAssets: useMinified,
			InstallationEnvironment: getInstallationEnvironment(), SiteName: meta.SiteName,
			ProductName:     getSiteName(),
			ProjectLogoPath: getProjectLogoPath(),
			PageTitle:       meta.PageTitle, MetaDescription: meta.MetaDescription,
			CanonicalURL: meta.CanonicalURL, OGTitle: meta.OGTitle,
			OGDescription: meta.OGDescription, OGType: meta.OGType,
			OGURL: meta.OGURL, OGImage: meta.OGImage,
			OGLocale: meta.OGLocale, LangCode: meta.LangCode,
			RobotsNoIndex:  !isIndexingAllowed(),
			ImportsCSSPath: assetPaths.ImportsCSSPath,
			MainBundlePath: assetPaths.MainBundlePath,
		}
		if err := tpl.Execute(w, data); err != nil {
			fmt.Printf("\033[31merror: %s\033[0m\n", err.Error())
		}
		return
	}

	// Palautetaan index.html myös dynaamisille dataset- ja custom-view -osoitteille
	if !strings.HasPrefix(r.URL.Path, "/admin/") &&
		!strings.HasPrefix(r.URL.Path, "/api/") &&
		!strings.HasPrefix(r.URL.Path, "/frontend/") &&
		!strings.HasPrefix(r.URL.Path, "/storage/") {
		// Jos tiedostoa ei ole, tai kyseessä on olemassa oleva dataset
		fsPath := filepath.Join(localFrontendDir, strings.TrimPrefix(r.URL.Path, "/"))
		_, statErr := os.Stat(fsPath)
		firstSeg := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")[0]
		firstSegIsDataset := datasetExists(firstSeg)
		if !loginToBrowse && isGuestUserID(userIDVal) {
			guestUserID, _ := userIDVal.(int)
			if shouldRedirectGuestDeepLinkToLogin(r, firstSeg, statErr, firstSegIsDataset, guestUserID) {
				redirectGuestDatasetRequestToLoginEntry(w, r)
				return
			}
		}
		if (os.IsNotExist(statErr) && isSpaDeepLinkPath(r.URL.Path)) || firstSegIsDataset {
			tablesHandler(w, r, loginToBrowse)
			return
		}
	}

	// Muille poluille staattinen tiedostopalvelu
	fs := http.FileServer(http.Dir(localFrontendDir))
	fs.ServeHTTP(w, r)
}

// isAuthShellEntryRequest detects the SPA shell handoff queries that must be
// allowed to load the public root page even when anonymous browsing is blocked.
func isAuthShellEntryRequest(r *http.Request) bool {
	if r == nil {
		return false
	}

	query := r.URL.Query()
	return query.Get("login-entry") == "1" || query.Get("register-entry") == "1"
}

// --- LISÄYS: handleFrontend-funktio, joka palvelee /frontend/... -polut
func handleFrontend(w http.ResponseWriter, r *http.Request) {
	// Varmistetaan, ettei pyydetty /frontend/-juurta suoraan
	if r.URL.Path == "/frontend/" {
		httpresponse.RespondWithError(w, http.StatusNotFound, "missing file name")
		return
	}
	// Palvelen tiedostot poistamalla "/frontend/"-prefiksin
	strip := http.StripPrefix("/frontend/", http.FileServer(http.Dir(localFrontendDir)))
	strip.ServeHTTP(w, r)
}

// handleApps is the fail-closed boundary for application-owned static assets.
// Private apps must register each intentionally public asset as an exact route,
// so no source, configuration, credential, or directory listing is served here.
func handleApps(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	httpresponse.RespondWithError(w, http.StatusNotFound, "application asset not found")
}

// getPackageNameFromHandler pilkkoo esim. "tree_data.GetTreeDataHandler" -> "tree_data"
func getPackageNameFromHandler(handlerName string) string {
	parts := strings.Split(handlerName, ".")
	if len(parts) > 1 {
		return parts[0]
	}
	return "default"
}

func defaultSpecificTableRelated(handlerName string) bool {
	packageName := getPackageNameFromHandler(handlerName)
	specificTableRelated := defaultTableSpecificPackages[packageName]

	switch handlerName {
	case "dtt_system_table_folders.HandleUpdateTableFolder":
		// Folder-management handlers are usually tableless, but moving a table
		// between folders must be bound to the specific dataset permission.
		return true
	case "dtt_foreign_keys.GetTableNamesHandler",
		"dtt_crud_workflows.SimpleCreateTableHandler",
		"dtt_crud_workflows.SimpleQueryTableHandler",
		"system_table_tools.GetTaskTodoProgressHandler",
		"dtt_1_row_read.CommentListHandler",
		"dtt_1_row_read.CommentCreateHandler",
		"dtt_1_row_read.CommentDeleteHandler",
		"dtt_1_row_read.CommentCountHandler":
		return false
	default:
		return specificTableRelated
	}
}

// RegisterAllRoutesAndUpdateFunctions wires middleware chains around each
// registered route using the Pipeline Mediator (pipeline package) and
// upserts the corresponding rows in the system_functions table.
func RegisterAllRoutesAndUpdateFunctions(db *sql.DB) error {
	log.Printf("RegisterAllRoutesAndUpdateFunctions called with %d routes", len(routeDefinitions))

	// Apply dev-mode profile overrides (makes certain admin routes public in dev)
	pipeline.ApplyDevOverrides()

	// --- 1. Wire middleware chains via Pipeline Mediator and register with net/http ---
	for _, rd := range routeDefinitions {
		ctx := pipeline.RouteContext{
			URLPattern:  rd.UrlPattern,
			HandlerName: rd.HandlerName,
			DB:          db,
		}
		profile := pipeline.GetProfile(rd.HandlerName)
		finalHandler := pipeline.BuildHandler(rd.HandlerFunc, ctx, profile)

		pipeline.LogPipeline(ctx, profile)
		http.HandleFunc(rd.UrlPattern, finalHandler)
		registeredFunctions[rd.HandlerName] = true
	}

	// --- 2. Upsert system_functions rows ------------------------------
	for _, rd := range routeDefinitions {
		handlerName := rd.HandlerName
		packageName := getPackageNameFromHandler(handlerName)

		var (
			existingID               int
			existingSpecificTableRel bool
		)
		err := db.QueryRow(`SELECT id, COALESCE(specific_table_related, true) FROM system_functions WHERE name = $1`, handlerName).
			Scan(&existingID, &existingSpecificTableRel)
		switch {
		case err == sql.ErrNoRows:
			specificTableRelated := defaultSpecificTableRelated(handlerName)

			err = db.QueryRow(`
				INSERT INTO system_functions (
					name,
					"package",
					disabled,
					specific_table_related,
					url_route_endpoint,
					rate_limit_amount,
					rate_limit_minutes,
					ui_only
				)
				VALUES ($1, $2, false, $3, $4, $5, $6, $7)
				RETURNING id
			`,
				handlerName,
				packageName,
				specificTableRelated,
				rd.UrlPattern,
				defaultRateLimitAmount,
				defaultRateLimitMinutes,
				false,
			).Scan(&existingID)
			if err != nil {
				log.Printf("error inserting function %s: %v", handlerName, err)
			}
		case err != nil:
			log.Printf("error fetching function %s: %v", handlerName, err)
		default:
			if handlerName == "dtt_crud_workflows.SimpleCreateTableHandler" || handlerName == "dtt_crud_workflows.SimpleQueryTableHandler" {
				_, err = db.Exec(`
					UPDATE system_functions
					SET disabled = false,
					    "package" = $2,
					    url_route_endpoint = $3,
					    ui_only = $4,
					    specific_table_related = false
					WHERE id = $1
				`, existingID, packageName, rd.UrlPattern, false)
			} else {
				_, err = db.Exec(`
					UPDATE system_functions
					SET disabled = false,
					    "package" = $2,
					    url_route_endpoint = $3,
					    ui_only = $4
					WHERE id = $1
				`, existingID, packageName, rd.UrlPattern, false)
			}
			if err != nil {
				log.Printf("error updating function %s: %v", handlerName, err)
			}
		}

		if err == nil {
			FunctionIDs[handlerName] = existingID
		}
	}

	return nil
}

// SyncFunctions merkitsee disabled=true niille funktioille, joita ei käytetty
func SyncFunctions(db *sql.DB) error {
	rows, err := db.Query(`SELECT name FROM system_functions WHERE disabled = false AND ui_only = false`)
	if err != nil {
		return fmt.Errorf("error reading system_functions table: %w", err)
	}
	defer rows.Close()

	var dbFuncs []string
	for rows.Next() {
		var fname string
		if err := rows.Scan(&fname); err != nil {
			return err
		}
		dbFuncs = append(dbFuncs, fname)
	}

	for _, dbf := range dbFuncs {
		if !registeredFunctions[dbf] {
			_, err := db.Exec(`UPDATE system_functions SET disabled = true WHERE name = $1`, dbf)
			if err != nil {
				log.Printf("error marking function %s as disabled=true: %v", dbf, err)
			} else {
				log.Printf("function %s marked as disabled=true", dbf)
			}
		}
	}

	return nil
}
