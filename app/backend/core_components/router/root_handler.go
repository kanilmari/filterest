// root_handler.go
// Serves the SPA entry point after authentication and dataset visibility checks.
// Bridges direct dataset URLs, the current session and the HTML/SEO shell.
// Exists so hidden dataset pages cannot leak content before browser routing runs.
package router

import (
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/auth_generation"
	dataset_visibility "easelect/backend/core_components/dataset_visibility"
	frontendassets "easelect/backend/core_components/frontend_assets"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/middlewares"
	e_sessions "easelect/backend/core_components/sessions"
	"fmt"
	"github.com/google/uuid"
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

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
		fs := frontendassets.FileServer(localFrontendDir)
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
	if onkoKayttaja {
		if userID, castOK := userIDVal.(int); castOK && userID > 1 {
			generationMatches, generationErr := rootAuthenticationGenerationMatches(
				r.Context(),
				backend.DbConfidential,
				session,
				userID,
			)
			if generationErr != nil {
				log.Printf("[rootHandler] authentication state unavailable for user %d: %v", userID, generationErr)
				httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "authentication state unavailable")
				return
			}
			if !generationMatches {
				auth_generation.ClearIdentity(session)
				if saveErr := session.Save(r, w); saveErr != nil {
					log.Printf("[rootHandler] stale session clear failed: %v", saveErr)
					httpresponse.RespondWithError(w, http.StatusInternalServerError, "session save failed")
					return
				}
				userIDVal = nil
				onkoKayttaja = false
			}
		}
	}
	if !onkoKayttaja {
		// ei user_id:tä
		if loginToBrowse && !authShellEntry {
			if r.URL.Path != "/" {
				// File-like unknown paths are not SPA destinations. Returning 404 here
				// prevents internet exploit scans (for example *.php probes) from being
				// amplified into login-page loads that consume authentication capacity.
				if !isSpaDeepLinkPath(r.URL.Path) {
					httpresponse.RespondWithError(w, http.StatusNotFound, "not found")
					return
				}
				redirectProtectedDatasetRequestToLogin(w, r)
				return
			}
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
		cDev, cDevErr := r.Cookie(e_sessions.DeviceIDCookieName())
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
			e_sessions.SetDeviceIDCookie(w, deviceID)
		}

		// Varmista fingerprint
		cF, cFErr := r.Cookie(e_sessions.FingerprintCookieName())
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
			e_sessions.SetFingerprintCookie(w, fingerprint)
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
			FaviconPath:     frontendassets.SiteFaviconPath(localFrontendDir, meta.SiteName, configuredFaviconReader(r.Context(), backend.Db)),
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
		if firstSegIsDataset {
			userID, _ := userIDVal.(int)
			hidden, visibilityErr := dataset_visibility.HiddenForUser(backend.Db, resolveRawDatasetName(firstSeg), userID)
			if visibilityErr != nil {
				httpresponse.RespondWithError(w, http.StatusServiceUnavailable, "dataset visibility unavailable")
				return
			}
			if hidden {
				w.Header().Set("Cache-Control", "no-store")
				httpresponse.RespondWithError(w, http.StatusNotFound, "not found")
				return
			}
		}
		if !loginToBrowse && isGuestUserID(userIDVal) {
			guestUserID, _ := userIDVal.(int)
			if shouldRedirectGuestDeepLinkToLogin(r, firstSeg, statErr, firstSegIsDataset, guestUserID) {
				redirectProtectedDatasetRequestToLogin(w, r)
				return
			}
		}
		if (os.IsNotExist(statErr) && isSpaDeepLinkPath(r.URL.Path)) || firstSegIsDataset {
			tablesHandler(w, r, loginToBrowse)
			return
		}
	}

	// Muille poluille staattinen tiedostopalvelu
	fs := frontendassets.FileServer(localFrontendDir)
	fs.ServeHTTP(w, r)
}
