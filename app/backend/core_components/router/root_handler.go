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
	"easelect/backend/core_components/session_expiry"
	e_sessions "easelect/backend/core_components/sessions"
	"fmt"
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
	signInWasJustRevoked := false
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
				// This browser arrived with a sign-in that has since been revoked
				// or superseded, which is different from never having signed in.
				// A login page reached this way should say why it appeared.
				signInWasJustRevoked = true
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
			if signInWasJustRevoked {
				http.Redirect(w, r, session_expiry.LoginPathWithSessionEndedNotice("/"), http.StatusSeeOther)
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

	// A person who signed in already has a browser binding: it was written when
	// they signed in, and it is exactly what the device and fingerprint pipeline
	// stages compare every protected request against. This page runs neither
	// stage on any kind of site, because it is on the public route profile
	// (app/backend/pipeline/route_profiles.go), so it has to make the comparison
	// itself. Without it, a request that owns nothing but a stolen session cookie
	// is answered with the page — and the page carries the dataset's description
	// and, at a row address, that row's own title, composed by resolvePageMeta.
	// The comparison therefore runs on every kind of site, and a sign-in that
	// does not match its own browser is answered the way an ended sign-in is
	// answered everywhere else in the application.
	//
	// A sign-in that does match has just been used, and opening the front page
	// is as much use as any protected request: the same renewal the device stage
	// makes re-issues all three cookies here, with the session's own values, so
	// the front page can never be the visit that lets one of them lapse.
	//
	// Giving a browser a binding, rather than renewing one, stays a guest's
	// affair on a site that permits public browsing. Minting values there is safe
	// precisely because there is no sign-in to protect; minting them for a
	// signed-in request would hand it the very proof the protected routes demand
	// afterwards. A site that requires a sign-in enrols no guest at all: a
	// visitor without one has already been sent to the login page above.
	if isSignedInUserID(userIDVal) {
		if !e_sessions.RenewUsedSignIn(w, r, session) {
			session_expiry.RespondSignInNoLongerValid(
				w, r, session,
				"the root page was reached with a sign-in whose browser binding is missing or different",
			)
			return
		}
	} else if !loginToBrowse {
		establishGuestBrowserBinding(w, r, session)
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
			ProductName: getSiteName(),
			FaviconPath: frontendassets.SiteFaviconPath(localFrontendDir, meta.SiteName, configuredFaviconReader(r.Context(), backend.Db)),
			PageTitle:   meta.PageTitle, MetaDescription: meta.MetaDescription,
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
