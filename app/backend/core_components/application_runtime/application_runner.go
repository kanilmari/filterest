// application_runner.go
// Runs the shared Filterest HTTP application from an importable core package.
// Bridges a thin public or private executable with startup, routes, and shutdown.
// Exists so private extensions can register themselves without patching public main.
package application_runtime

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
	productidentity "easelect/backend/core_components/product_identity"
	"easelect/backend/core_components/router"
	"easelect/backend/core_components/runtimepaths"
	e_sessions "easelect/backend/core_components/sessions"
	"easelect/backend/core_components/startup"
	"easelect/backend/core_components/system_table_tools"
	"easelect/backend/pipeline/rate_limiting"
)

// Options describes the executable-owned values needed by the shared runtime.
// BuildEnvironment preserves the compile-time production lock. InstallationRoot
// identifies mutable operator-owned state, while ApplicationRoot identifies the
// immutable public app. ProductRoot remains the private composition's version,
// identity, and migration root during the staged transition. Relative product
// roots are anchored to InstallationRoot rather than the process working directory.
// AppDBCompatibilityManifest and MigrationDirectories let a private outer
// composition declare its release metadata and merge its migrations explicitly,
// while FrontendExtensions serves disjoint browser modules without placing them
// inside the canonical public source tree. AdditionalLangKeySourceRoots lets
// that composition include its own frontend/backend sources in language-key
// maintenance without teaching public Filterest to discover sibling projects.
// MaterializePublicBootstrapMedia is an explicit public-launcher capability;
// private compositions leave it false so their storage remains untouched.
type Options struct {
	BuildEnvironment                string
	InstallationRoot                string
	ApplicationRoot                 string
	MaterializePublicBootstrapMedia bool
	ProductRoot                     string
	FrontendRoot                    string
	AppDBCompatibilityManifest      string
	MigrationDirectories            []string
	FrontendExtensions              []FrontendExtension
	AdditionalLangKeySourceRoots    []string
}

// FrontendExtension mounts one additional browser-source directory below the
// normal /frontend/ URL space. Public Filterest needs none; private compositions
// can use it for disjoint extension modules during and after the source move.
type FrontendExtension struct {
	URLPrefix string
	Directory string
}

func startRegisteredApps(port string, environmentType string) {
	log.Println("Starting Easelect applications...")

	appregistry.StartAll(port, environmentType)

	// Note: For webhooks to work in development, start ngrok manually.
	// We use a separate HTTP port for ngrok to avoid TLS issues.
	if environmentType == "dev" {
		parsedPort, err := strconv.Atoi(port)
		if err == nil {
			httpPort := parsedPort + 1
			log.Printf("Note: To enable email webhooks, run 'ngrok http %d' manually and configure the URL in Postmark.", httpPort)
		}
	}

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

func resolveProductRoot(rootHint string, installationRoot string, applicationRoot string) string {
	if rootHint != "" {
		absoluteRoot, err := normalizeRuntimeRoot(rootHint, installationRoot)
		if err != nil {
			log.Fatalf("Filterest product root resolution failed: %v", err)
		}
		return absoluteRoot
	}
	return applicationRoot
}

func resolveFrontendDirectory(
	rootHint string,
	executableDirectory string,
	productRoot string,
) (string, error) {
	isFrontendRoot := func(candidate string) bool {
		info, err := os.Stat(candidate)
		if err != nil || !info.IsDir() {
			return false
		}
		indexInfo, err := os.Stat(filepath.Join(candidate, "index.html"))
		return err == nil && indexInfo.Mode().IsRegular()
	}

	if rootHint != "" {
		absoluteRoot, err := filepath.Abs(rootHint)
		if err != nil {
			return "", fmt.Errorf("resolve configured frontend root: %w", err)
		}
		info, err := os.Stat(absoluteRoot)
		if err != nil {
			return "", fmt.Errorf("configured frontend root %q: %w", absoluteRoot, err)
		}
		if !info.IsDir() {
			return "", fmt.Errorf("configured frontend root %q is not a directory", absoluteRoot)
		}
		if !isFrontendRoot(absoluteRoot) {
			return "", fmt.Errorf("configured frontend root %q has no index.html", absoluteRoot)
		}
		return absoluteRoot, nil
	}

	for _, candidate := range []string{
		filepath.Join(productRoot, "frontend"),
		filepath.Join(executableDirectory, "frontend"),
		filepath.Join(productRoot, "filterest", "frontend"),
	} {
		if isFrontendRoot(candidate) {
			return candidate, nil
		}
	}
	return "", fmt.Errorf("frontend directory not found beside executable or product root")
}

func effectiveEnvironmentType(
	buildEnvironment string,
	loadedEnvironmentType string,
	runtimeEnvironmentType string,
) string {
	if buildEnvironment == "prod" {
		return "prod"
	}
	if runtimeEnvironmentType != "" {
		return runtimeEnvironmentType
	}
	if loadedEnvironmentType != "" {
		return loadedEnvironmentType
	}
	return "prod"
}

func useInstallationRuntimeLayout(roots runtimeRoots) bool {
	return roots.installationRootExplicit &&
		roots.applicationRoot != roots.installationRoot
}

// Run starts Filterest after executable-specific blank imports have registered
// public or private extensions. It owns initialization order, HTTP serving, and
// graceful shutdown while keeping the executable itself as a thin composition root.
func Run(options Options) {
	roots, err := resolveRuntimeRoots(
		options.InstallationRoot,
		options.ApplicationRoot,
	)
	if err != nil {
		log.Fatalf("Filterest root resolution failed: %v", err)
	}
	if !roots.installationRootExplicit {
		log.Printf(
			"⚠ FILTEREST_ROOT or --root is not set; using legacy working-directory layout at %s",
			roots.installationRoot,
		)
	}
	runtimePaths, err := runtimepaths.Resolve(
		roots.applicationRoot,
		roots.installationRoot,
		useInstallationRuntimeLayout(roots),
	)
	if err != nil {
		log.Fatalf("Filterest runtime path resolution failed: %v", err)
	}
	if err := runtimepaths.Configure(runtimePaths); err != nil {
		log.Fatalf("Filterest runtime path configuration failed: %v", err)
	}
	if options.MaterializePublicBootstrapMedia {
		createdMediaCount, materializeErr := startup.MaterializePublicBootstrapMedia(runtimePaths)
		if materializeErr != nil {
			log.Fatalf("\033[31merror: public bootstrap media materialization failed: %v\033[0m", materializeErr)
		}
		log.Printf(
			"[PUBLIC BOOTSTRAP MEDIA] created %d missing installation storage files; existing operator files were left untouched",
			createdMediaCount,
		)
	}
	additionalLangKeySourceRoots := make([]string, 0, len(options.AdditionalLangKeySourceRoots))
	for _, sourceRoot := range options.AdditionalLangKeySourceRoots {
		resolvedSourceRoot, resolveErr := normalizeRuntimeRoot(
			sourceRoot,
			roots.installationRoot,
		)
		if resolveErr != nil {
			log.Fatalf("Additional language-key source root resolution failed: %v", resolveErr)
		}
		additionalLangKeySourceRoots = append(additionalLangKeySourceRoots, resolvedSourceRoot)
	}
	if err := system_table_tools.ConfigureAdditionalLangKeySourceRoots(additionalLangKeySourceRoots); err != nil {
		log.Fatalf("Additional language-key source root configuration failed: %v", err)
	}
	productRoot := resolveProductRoot(
		options.ProductRoot,
		roots.installationRoot,
		roots.applicationRoot,
	)
	if err := productidentity.ConfigureApplicationRoot(productRoot); err != nil {
		log.Fatalf("Filterest product identity root configuration failed: %v", err)
	}
	startup.LogApplicationVersion(productRoot)

	environmentType, environmentLoadError := backend.LoadEnvironmentVariablesFromRoot(
		roots.installationRoot,
	)
	if environmentLoadError != nil {
		log.Printf("Ympäristömuuttujien latausvaroitus: %v", environmentLoadError)
	}

	if err := backend.ValidateConfig(); err != nil {
		log.Fatalf("Configuration validation failed:\n%v", err)
	}

	e_sessions.InitSessionStore()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8082"
	}
	portNumber, portError := strconv.Atoi(port)
	if portError != nil || portNumber < 1 || portNumber > 65535 {
		log.Fatalf("Invalid PORT value %q: must be a number between 1 and 65535", port)
	}

	environmentType = effectiveEnvironmentType(
		options.BuildEnvironment,
		environmentType,
		os.Getenv("ENVIRONMENT_TYPE"),
	)
	if options.BuildEnvironment == "prod" {
		log.Println("🔒 Production build detected - running in prod mode (cannot be overridden)")
	} else {
		log.Printf("🔧 Dev build - running in %s mode (ENVIRONMENT_TYPE=%s)", environmentType, os.Getenv("ENVIRONMENT_TYPE"))
	}
	os.Setenv("ENVIRONMENT_TYPE", environmentType)

	if err := backend.InitDB(); err != nil {
		log.Fatalf("DB-yhteys epäonnistui: %v", err)
	}
	defer backend.CloseDB()

	if err := startup.RunEnabledMigrations(
		backend.Db,
		productRoot,
		options.MigrationDirectories...,
	); err != nil {
		log.Fatalf("[MIGRATIONS] migration failed: %v", err)
	}

	if err := backend.EnsureConfidentialRolePermissions(backend.Db); err != nil {
		log.Fatalf("[CONFIDENTIAL ROLE PERMISSIONS] startup reconcile failed: %v", err)
	}
	if err := backend.EnsureRowGroupRuntimeRolePermissions(backend.Db); err != nil {
		log.Fatalf("[ROW GROUP PERMISSIONS] startup reconcile failed: %v", err)
	}

	if err := startup.ReconcileReservedTestUsers(backend.Db, backend.DbConfidential, environmentType); err != nil {
		log.Fatalf("Reserved test user reconcile failed: %v", err)
	}

	if err := startup.CheckDatabaseVersion(backend.Db, productRoot); err != nil {
		log.Printf("\033[33m⚠ %v\033[0m", err)
	}

	startRegisteredApps(port, environmentType)

	executablePath, err := os.Executable()
	if err != nil {
		log.Fatalf("Executable-polun haku epäonnistui: %v", err)
	}
	executableDirectory := filepath.Dir(executablePath)
	startup.RunOptionalTasks(productRoot, options.AppDBCompatibilityManifest)

	frontendDirectory, err := resolveFrontendDirectory(
		options.FrontendRoot,
		executableDirectory,
		roots.applicationRoot,
	)
	if err != nil {
		log.Fatalf("Frontend directory resolution failed: %v", err)
	}

	rate_limiting.InitDevRateLimitingFlag(backend.Db)
	auth.InitAuth(e_sessions.GetStore(), frontendDirectory)
	router.RegisterRoutes(frontendDirectory, runtimePaths.StorageRoot)
	for _, extension := range options.FrontendExtensions {
		if err := router.RegisterFrontendDirectory(
			extension.URLPrefix,
			extension.Directory,
		); err != nil {
			log.Fatalf("Frontend extension registration failed: %v", err)
		}
	}
	if err := router.RegisterAllRoutesAndUpdateFunctions(backend.Db); err != nil {
		log.Printf("virhe rekisteröidessä reittejä/päivittäessä funktioita: %v", err)
	}
	if err := router.SyncFunctions(backend.Db); err != nil {
		log.Printf("virhe synkronoitaessa funktioita: %v", err)
	}
	if err := router.ReactivateUIRoutes(backend.Db); err != nil {
		log.Printf("virhe UI-reittien aktivoinnissa: %v", err)
	}
	cleanupOptions := backend.PermissionCleanupOptions{
		RemoveMissingTables: true,
		RemoveDisabledFuncs: true,
		RemoveMismatchedUID: true,
	}
	if err := backend.CleanGroupTableFuncRights(backend.Db, cleanupOptions); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}
	if err := backend.EnsureAdminPermissions(backend.Db); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}
	if err := backend.EnsureAdminTablePermissions(backend.Db); err != nil {
		fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
	}

	go runDeferredMetadataMaintenance()

	baseMultiplexer := http.DefaultServeMux
	firewallWrappedHandler := firewall.FirewallHandler(baseMultiplexer)
	securityWrappedHandler := middlewares.WithSecurityHeaders(firewallWrappedHandler)
	wrappedHandler := middlewares.WithCSP(securityWrappedHandler)
	wrappedHandler = router.WithSystemActiveRequestTracking(wrappedHandler)
	wrappedHandler = router.WithSystemAPIDrainGate(wrappedHandler)
	wrappedHandler = middlewares.WithPanicRecovery(wrappedHandler)

	middlewares.InitMaintenanceMode()
	wrappedHandler = middlewares.WithMaintenanceMode(wrappedHandler)
	if middlewares.IsMaintenanceMode() {
		log.Println("\033[33m⚠ MAINTENANCE MODE ACTIVE — all requests return 503\033[0m")
	}

	if startMillisecondsText := os.Getenv("EASELECT_START_MS"); startMillisecondsText != "" {
		if startMilliseconds, err := strconv.ParseInt(startMillisecondsText, 10, 64); err == nil {
			elapsedMilliseconds := time.Now().UnixMilli() - startMilliseconds
			log.Printf("easelect startup completed in %d ms", elapsedMilliseconds)
		}
	}

	serverAddress := "0.0.0.0:" + port
	server := &http.Server{
		Addr:    serverAddress,
		Handler: wrappedHandler,
	}

	shutdownChannel := make(chan os.Signal, 1)
	signal.Notify(shutdownChannel, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		signalValue := <-shutdownChannel
		log.Printf("[INFO] Received signal %v — initiating graceful shutdown…", signalValue)
		contextWithTimeout, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := server.Shutdown(contextWithTimeout); err != nil {
			log.Printf("[WARN] Graceful shutdown error: %v", err)
		}
	}()

	if !backend.ShouldServeWithTLS(environmentType, os.Getenv("FILTEREST_LOCAL_TLS")) {
		log.Printf("[INFO] Server running on port %s (plain HTTP behind nginx TLS-terminator)…", port)
		if externalPort := os.Getenv("APP_PORT"); externalPort != "" && externalPort != port {
			log.Printf("[INFO] External port (Docker mapping): %s", externalPort)
		}
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
		}
	} else {
		if environmentType != "prod" {
			go func() {
				httpPort := portNumber + 1
				httpAddress := fmt.Sprintf("0.0.0.0:%d", httpPort)
				log.Printf("[INFO] Starting plain HTTP server for webhooks on %s...", httpAddress)
				if err := http.ListenAndServe(httpAddress, wrappedHandler); err != nil {
					log.Printf("Webhook server error: %v", err)
				}
			}()
		}

		certificateFile := os.Getenv("TLS_CERT_FILE")
		if certificateFile == "" {
			certificateFile = "dev-cert.crt"
		}
		keyFile := os.Getenv("TLS_KEY_FILE")
		if keyFile == "" {
			keyFile = "dev-cert.key"
		}

		log.Printf("[INFO] Server running on port %s with direct TLS…", port)
		if externalPort := os.Getenv("APP_PORT"); externalPort != "" && externalPort != port {
			log.Printf("[INFO] External port (Docker mapping): %s → access via https://localhost:%s", externalPort, externalPort)
		}
		if err := server.ListenAndServeTLS(certificateFile, keyFile); err != nil && err != http.ErrServerClosed {
			fmt.Printf("\033[31mvirhe: %s\033[0m\n", err.Error())
		}
	}

	log.Println("[INFO] Server stopped.")
}
