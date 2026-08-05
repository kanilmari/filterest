// main.go
// Boots the Easelect backend runtime.
// Bridges environment/session/database initialization with middleware and route registration.
// Exists to start and gracefully shut down HTTP services for all local apps.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	backend "easelect/backend/core_components"
	appregistry "easelect/backend/core_components/app_registry"
	"easelect/backend/core_components/auth"
	"easelect/backend/core_components/dynamic_table_tools/dtt_2_column_crud/dtt_2_column_update"
	dtt_crud_workflows "easelect/backend/core_components/dynamic_table_tools/dtt_crud_workflows"
	dtt_foreign_keys "easelect/backend/core_components/dynamic_table_tools/dtt_foreign_keys"
	"easelect/backend/core_components/middlewares"
	"easelect/backend/core_components/middlewares/firewall"
	"easelect/backend/core_components/router"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/startup"
	"easelect/backend/pipeline/rate_limiting"
)

// buildEnv is set at compile time via -ldflags.
// If built with -ldflags "-X main.buildEnv=prod", this binary can NEVER run in dev mode.
// If built with -ldflags "-X main.buildEnv=dev" (or not set), runtime ENVIRONMENT_TYPE can override.
// Security: prod binaries cannot be downgraded to dev via environment variables.
var buildEnv string = "dev" // default to dev if not set at build time

// StartApps initializes all Easelect applications.
// This function should be called after the database is initialized.
func StartApps(port string, envType string) {
	log.Println("Starting Easelect applications...")

	appregistry.StartAll(port, envType)

	// Note: For webhooks to work in development, start ngrok manually.
	// We use a separate HTTP port for ngrok to avoid TLS issues.
	if envType == "dev" {
		p, err := strconv.Atoi(port)
		if err == nil {
			httpPort := p + 1
			log.Printf("Note: To enable email webhooks, run 'ngrok http %d' manually and configure the URL in Postmark.", httpPort)
		}
	}

	// Add more apps here as they are developed
	log.Println("All applications started successfully.")
}

func runDeferredMetadataMaintenance() {
	log.Println("[STARTUP] Metadata maintenance continues in background.")

	if err := dtt_crud_workflows.UpdateOidsAndTableNamesWithBridge(backend.Db); err != nil {
		log.Printf("OID-päivitysvirhe: %v", err)
	}
	if err := dtt_2_column_update.UpdateColumnMetadata(backend.Db); err != nil {
		log.Printf("kolumnimetadatan synkronointivirhe: %v", err)
	}
	if err := dtt_foreign_keys.SyncOneToManyFKConstraints(backend.Db); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}
	if err := dtt_foreign_keys.SyncManyToManyFKConstraints(backend.Db); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}

	log.Println("[STARTUP] Metadata maintenance completed.")
}

func main() {
	//-----------------------------------------------------------------
	// 0) Log application version
	//-----------------------------------------------------------------
	cwd, _ := os.Getwd()
	startup.LogApplicationVersion(cwd)

	//-----------------------------------------------------------------
	// 1) Ladataan ympäristömuuttujat ja varmistetaan ympäristötyypin
	//    mukainen tiedosto (.env tai test_variables.env)
	//-----------------------------------------------------------------
	envType, envLoadErr := backend.LoadEnvironmentVariables()
	if envLoadErr != nil {
		log.Printf("Ympäristömuuttujien latausvaroitus: %v", envLoadErr)
	}

	//-----------------------------------------------------------------
	// 1b) Validoidaan kriittiset konfiguraatiot
	//-----------------------------------------------------------------
	if err := backend.ValidateConfig(); err != nil {
		log.Fatalf("Configuration validation failed:\n%v", err)
	}

	//-----------------------------------------------------------------
	// 2) Alustetaan sessiot (CookieStore, asetukset)
	//-----------------------------------------------------------------
	e_sessions.InitSessionStore()

	//-----------------------------------------------------------------
	// 2a) Määritellään portti ja ympäristötyyppi
	//     Security: If buildEnv=prod, ENVIRONMENT_TYPE cannot downgrade to dev
	//-----------------------------------------------------------------
	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}
	// Validate port is a valid number in the allowed range
	portNum, portErr := strconv.Atoi(port)
	if portErr != nil || portNum < 1 || portNum > 65535 {
		log.Fatalf("Invalid PORT value %q: must be a number between 1 and 65535", port)
	}

	// Determine effective environment type with security constraints
	if buildEnv == "prod" {
		// Production binary: ALWAYS runs as prod, ignore ENVIRONMENT_TYPE
		envType = "prod"
		log.Println("🔒 Production build detected - running in prod mode (cannot be overridden)")
	} else {
		// Dev binary: can be upgraded to prod via ENVIRONMENT_TYPE, but does not
		// silently enable dev mode when the environment is unspecified.
		if runtimeEnvType := os.Getenv("ENVIRONMENT_TYPE"); runtimeEnvType != "" {
			envType = runtimeEnvType
		}
		if envType == "" {
			envType = "prod"
		}
		log.Printf("🔧 Dev build - running in %s mode (ENVIRONMENT_TYPE=%s)", envType, os.Getenv("ENVIRONMENT_TYPE"))
	}

	// Export effective environment type for other packages to use
	os.Setenv("ENVIRONMENT_TYPE", envType)

	//-----------------------------------------------------------------
	// 3) Alustetaan tietokanta
	//-----------------------------------------------------------------
	if err := backend.InitDB(); err != nil {
		log.Fatalf("DB-yhteys epäonnistui: %v", err)
	}
	defer backend.CloseDB()

	//-----------------------------------------------------------------
	// 3a) Ajetaan erikseen sallitut migraatiot ennen kuin käynnistyksen
	//     muut vaiheet käyttävät mahdollisesti muuttunutta skeemaa.
	//-----------------------------------------------------------------
	if err := startup.RunEnabledMigrations(backend.Db, cwd); err != nil {
		log.Fatalf("[MIGRATIONS] migration failed: %v", err)
	}

	//-----------------------------------------------------------------
	// 3b) Varmistetaan restricted-skeeman oikeudet ennen dev-startupin
	//     reserved test user -täsmäytystä, jotta shared-dev-kannat eivät
	//     kaadu kesken käynnistyksen puuttuviin confidential-grantteihin.
	//-----------------------------------------------------------------
	if err := backend.EnsureConfidentialRolePermissions(backend.Db); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}

	//-----------------------------------------------------------------
	// 3c) Täsmäytetään varatut testi-käyttäjät ennen liikenteen avaamista
	//-----------------------------------------------------------------
	if err := startup.ReconcileReservedTestUsers(backend.Db, backend.DbConfidential, envType); err != nil {
		log.Fatalf("Reserved test user reconcile failed: %v", err)
	}

	//-----------------------------------------------------------------
	// 3d) Tarkistetaan kantaversio
	//-----------------------------------------------------------------
	if err := startup.CheckDatabaseVersion(backend.Db, cwd); err != nil {
		log.Printf("\033[33m⚠ %v\033[0m", err)
	}

	//-----------------------------------------------------------------
	// 3e) Käynnistetään sovellukset
	//-----------------------------------------------------------------
	StartApps(port, envType)

	//-----------------------------------------------------------------
	// 3f) Selvitetään polku ei-välttämättömiä käynnistystehtäviä varten
	//-----------------------------------------------------------------
	exePath, err := os.Executable()
	if err != nil {
		log.Fatalf("Executable-polun haku epäonnistui: %v", err)
	}
	exeDir := filepath.Dir(exePath)
	//-----------------------------------------------------------------
	// 3g) Ajetaan ei-välttämättömät käynnistystehtävät
	//-----------------------------------------------------------------
	startup.RunOptionalTasks(exeDir)

	// //-----------------------------------------------------------------
	// // 3d) Import dev_todo table from CSV if present
	// //-----------------------------------------------------------------
	// if tx, err := backend.Db.Begin(); err == nil {
	// 	ctx := dbutils.SetTx(context.Background(), tx)
	// 	if _, _, err := devtools.ImportTableCSV(ctx, "dev_todo"); err != nil {
	// 		_ = tx.Rollback()
	// 		log.Printf("dev_todo import failed: %v", err)
	// 	} else if err := tx.Commit(); err != nil {
	// 		log.Printf("dev_todo import commit failed: %v", err)
	// 	}
	// } else {
	// 	log.Printf("dev_todo import begin failed: %v", err)
	// }

	// //-----------------------------------------------------------------
	// // 3e) Export dev_todo table to CSV for developer tasks
	// //-----------------------------------------------------------------
	// if tx, err := backend.Db.Begin(); err == nil {
	// 	ctx := dbutils.SetTx(context.Background(), tx)
	// 	if _, _, err := devtools.ExportTableCSVToFile(ctx, "dev_todo"); err != nil {
	// 		_ = tx.Rollback()
	// 		log.Printf("dev_todo export failed: %v", err)
	// 	} else if err := tx.Commit(); err != nil {
	// 		log.Printf("dev_todo export commit failed: %v", err)
	// 	}
	// } else {
	// 	log.Printf("dev_todo export begin failed: %v", err)
	// }

	//-----------------------------------------------------------------
	// 4) Selvitetään frontend- ja tallennuspolut
	//-----------------------------------------------------------------
	frontendDir := filepath.Join(exeDir, "frontend")
	if _, err := os.Stat(frontendDir); os.IsNotExist(err) {
		// Jos ei löydy exen vierestä (esim. go run), kokeillaan nykyistä hakemistoa
		cwd, _ := os.Getwd()
		frontendDir = filepath.Join(cwd, "frontend")
	}

	storagePath := filepath.Join(exeDir, "storage")
	if _, err := os.Stat(storagePath); os.IsNotExist(err) {
		cwd, _ := os.Getwd()
		storagePath = filepath.Join(cwd, "storage")
	}

	//-----------------------------------------------------------------
	// 5) Alustetaan autentikaatio ja reitit
	//-----------------------------------------------------------------
	rate_limiting.InitDevRateLimitingFlag(backend.Db)
	auth.InitAuth(e_sessions.GetStore(), frontendDir)
	router.RegisterRoutes(frontendDir, storagePath)
	if err := router.RegisterAllRoutesAndUpdateFunctions(backend.Db); err != nil {
		log.Printf("virhe rekisteröidessä reittejä/päivittäessä funktioita: %v", err)
	}
	if err := router.SyncFunctions(backend.Db); err != nil {
		log.Printf("virhe synkronoitaessa funktioita: %v", err)
	}
	if err := router.ReactivateUIRoutes(backend.Db); err != nil {
		log.Printf("virhe UI-reittien aktivoinnissa: %v", err)
	}
	cleanOpts := backend.PermissionCleanupOptions{
		RemoveMissingTables: true,
		RemoveDisabledFuncs: true,
		RemoveMismatchedUID: true,
	}
	if err := backend.CleanGroupTableFuncRights(backend.Db, cleanOpts); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}
	if err := backend.EnsureAdminPermissions(backend.Db); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}
	if err := backend.EnsureAdminTablePermissions(backend.Db); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}

	//-----------------------------------------------------------------
	// 5a) Jatketaan raskasta metadatansynkkaa taustalla, jotta shared-dev
	//     -käynnistys pääsee kuunteluun ennen hitaimpia ylläpitotehtäviä.
	//-----------------------------------------------------------------
	go runDeferredMetadataMaintenance()

	//-----------------------------------------------------------------
	// 6) Kääritään handlerit (firewall → security headers → CSP)
	//    CSRF ja Transaction hoidetaan pipeline-stageissa (csrf, transaction).
	//-----------------------------------------------------------------
	baseMux := http.DefaultServeMux
	firewallWrappedHandler := firewall.FirewallHandler(baseMux)
	securityWrappedHandler := middlewares.WithSecurityHeaders(firewallWrappedHandler)
	wrappedHandler := middlewares.WithCSP(securityWrappedHandler)
	wrappedHandler = router.WithSystemActiveRequestTracking(wrappedHandler)

	//-----------------------------------------------------------------
	// 7) Lisätään panic recovery koko handlerin ympärille
	//-----------------------------------------------------------------
	wrappedHandler = middlewares.WithPanicRecovery(wrappedHandler)

	//-----------------------------------------------------------------
	// 7b) Maintenance mode — outermost wrapper, blocks ALL requests
	//-----------------------------------------------------------------
	middlewares.InitMaintenanceMode()
	wrappedHandler = middlewares.WithMaintenanceMode(wrappedHandler)
	if middlewares.IsMaintenanceMode() {
		log.Println("\033[33m⚠ MAINTENANCE MODE ACTIVE — all requests return 503\033[0m")
	}

	startMsStr := os.Getenv("EASELECT_START_MS")
	if startMsStr != "" {
		if startMs, err := strconv.ParseInt(startMsStr, 10, 64); err == nil {
			elapsedMs := time.Now().UnixMilli() - startMs
			log.Printf("easelect startup completed in %d ms", elapsedMs)
		}
	}

	//-----------------------------------------------------------------
	// 8) Päätetään käynnistystapa ympäristötyypin mukaan
	//    Uses http.Server for graceful shutdown on SIGTERM/SIGINT.
	//-----------------------------------------------------------------
	serverAddr := "0.0.0.0:" + port

	srv := &http.Server{
		Addr:    serverAddr,
		Handler: wrappedHandler,
	}

	// Graceful shutdown goroutine — listens for SIGTERM/SIGINT
	shutdownCh := make(chan os.Signal, 1)
	signal.Notify(shutdownCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		sig := <-shutdownCh
		log.Printf("[INFO] Received signal %v — initiating graceful shutdown…", sig)
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			log.Printf("[WARN] Graceful shutdown error: %v", err)
		}
	}()

	if !backend.ShouldServeWithTLS(envType, os.Getenv("FILTEREST_LOCAL_TLS")) {
		// ------------------------------------------------------------
		// Tuotanto: nginx terminatoi TLS:n portissa 443 → sovellus
		// kuuntelee selväkielistä HTTP:tä portissa 8082
		// ------------------------------------------------------------
		log.Printf("[INFO] Server running on port %s (plain HTTP behind nginx TLS-terminator)…", port)
		if externalPort := os.Getenv("APP_PORT"); externalPort != "" && externalPort != port {
			log.Printf("[INFO] External port (Docker mapping): %s", externalPort)
		}
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
		}
	} else {
		// ------------------------------------------------------------
		// Kehitys ja paikallinen admin-asennus käyttävät suoraa TLS:ää.
		// ------------------------------------------------------------
		if envType != "prod" {
			// Start secondary HTTP server for development webhooks to avoid TLS issues.
			p, _ := strconv.Atoi(port) // port already validated above
			httpPort := p + 1
			go func() {
				httpAddr := fmt.Sprintf("0.0.0.0:%d", httpPort)
				log.Printf("[INFO] Starting plain HTTP server for webhooks on %s...", httpAddr)
				if err := http.ListenAndServe(httpAddr, wrappedHandler); err != nil {
					log.Printf("Webhook server error: %v", err)
				}
			}()
		}

		certFile := os.Getenv("TLS_CERT_FILE")
		if certFile == "" {
			certFile = "dev-cert.crt"
		}
		keyFile := os.Getenv("TLS_KEY_FILE")
		if keyFile == "" {
			keyFile = "dev-cert.key"
		}

		log.Printf("[INFO] Server running on port %s with direct TLS…", port)
		if externalPort := os.Getenv("APP_PORT"); externalPort != "" && externalPort != port {
			log.Printf("[INFO] External port (Docker mapping): %s → access via https://localhost:%s", externalPort, externalPort)
		}
		if err := srv.ListenAndServeTLS(certFile, keyFile); err != nil && err != http.ErrServerClosed {
			fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
		}
	}

	log.Println("[INFO] Server stopped.")
}
