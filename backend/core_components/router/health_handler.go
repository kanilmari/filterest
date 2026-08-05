// health_handler.go
// Exposes legacy health plus manager-facing system status and drain endpoints.
// Bridges the backend router and local/private manager callers such as native
// load balancers without involving application auth or business logic.
// Exists so managers can verify, drain, and route Easelect instances safely.

package router

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	productidentity "easelect/backend/core_components/product_identity"
)

var (
	systemProcessStartedAt         = time.Now()
	systemReadinessProbe           = buildSystemReadinessResponse
	systemActiveRequests           int64
	systemDesiredStateRuntimeValue atomic.Value
)

const (
	systemDesiredStateActive      = "active"
	systemDesiredStateStandby     = "standby"
	systemDesiredStateDraining    = "draining"
	systemDesiredStateInactive    = "inactive"
	systemDesiredStateMaintenance = "maintenance"
)

type systemHealthResponse struct {
	Status               string `json:"status"`
	Time                 string `json:"time"`
	InstanceID           string `json:"instance_id"`
	ProcessUptimeSeconds int64  `json:"process_uptime_seconds"`
}

type systemReadyResponse struct {
	Ready             bool     `json:"ready"`
	Status            string   `json:"status"`
	Reasons           []string `json:"reasons"`
	InstanceID        string   `json:"instance_id"`
	ProductName       string   `json:"product_name"`
	AppVersion        string   `json:"app_version"`
	AppVersionFile    string   `json:"app_version_file"`
	RequiredDBVersion string   `json:"required_db_version"`
	DBVersion         string   `json:"db_version"`
	DBCompatible      bool     `json:"db_compatible"`
	AcceptingNewWork  bool     `json:"accepting_new_work"`
	ActiveRequests    int      `json:"active_requests"`
	ActiveLongJobs    int      `json:"active_long_jobs"`
	DrainSupported    bool     `json:"drain_supported"`
}

type systemInstanceStatusResponse struct {
	Ready                 bool                                `json:"ready"`
	Status                string                              `json:"status"`
	Reasons               []string                            `json:"reasons"`
	InstanceID            string                              `json:"instance_id"`
	DesiredStateSeenByApp string                              `json:"desired_state_seen_by_app"`
	ProductName           string                              `json:"product_name"`
	AppVersion            string                              `json:"app_version"`
	AppVersionFile        string                              `json:"app_version_file"`
	RequiredDBVersion     string                              `json:"required_db_version"`
	DBVersion             string                              `json:"db_version"`
	DBCompatible          bool                                `json:"db_compatible"`
	AcceptingNewWork      bool                                `json:"accepting_new_work"`
	ActiveRequests        int                                 `json:"active_requests"`
	ActiveLongJobs        int                                 `json:"active_long_jobs"`
	BackgroundWorkerRole  string                              `json:"background_worker_role"`
	StorageRoot           string                              `json:"storage_root"`
	DatabasePools         []backend.DatabasePoolRuntimeStatus `json:"database_pools"`
	DatabasePoolHeadroom  backend.DatabasePoolHeadroomStatus  `json:"database_pool_headroom"`
	DrainSupported        bool                                `json:"drain_supported"`
	DrainState            string                              `json:"drain_state"`
	ProcessUptimeSeconds  int64                               `json:"process_uptime_seconds"`
	Time                  string                              `json:"time"`
}

type systemDrainRequest struct {
	DesiredState string `json:"desired_state"`
	Draining     *bool  `json:"draining,omitempty"`
}

type systemDrainResponse struct {
	DesiredStateSeenByApp string `json:"desired_state_seen_by_app"`
	AcceptingNewWork      bool   `json:"accepting_new_work"`
	ActiveRequests        int    `json:"active_requests"`
	DrainSupported        bool   `json:"drain_supported"`
	DrainState            string `json:"drain_state"`
	Time                  string `json:"time"`
}

// WithSystemActiveRequestTracking records live application requests for manager
// status probes while excluding the probe endpoints themselves from the count.
func WithSystemActiveRequestTracking(next http.Handler) http.Handler {
	if next == nil {
		next = http.NotFoundHandler()
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if shouldSkipSystemActiveRequestTracking(r) {
			next.ServeHTTP(w, r)
			return
		}

		atomic.AddInt64(&systemActiveRequests, 1)
		defer atomic.AddInt64(&systemActiveRequests, -1)

		next.ServeHTTP(w, r)
	})
}

// healthHandler returns a simple readiness payload for infrastructure probes.
func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}

	httpresponse.RespondWithJSON(w, http.StatusOK, map[string]string{
		"status": "ok",
	})
}

func systemHealthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if rejectDisallowedSystemManagerRequest(w, r) {
		return
	}

	now := time.Now().UTC()
	httpresponse.RespondWithJSON(w, http.StatusOK, systemHealthResponse{
		Status:               "ok",
		Time:                 now.Format(time.RFC3339),
		InstanceID:           currentSystemInstanceID(),
		ProcessUptimeSeconds: int64(now.Sub(systemProcessStartedAt).Seconds()),
	})
}

func systemReadyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if rejectDisallowedSystemManagerRequest(w, r) {
		return
	}

	response := systemReadinessProbe()
	if response.Reasons == nil {
		response.Reasons = []string{}
	}

	statusCode := http.StatusOK
	if !response.Ready {
		statusCode = http.StatusServiceUnavailable
	}
	httpresponse.RespondWithJSON(w, statusCode, response)
}

func systemInstanceStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if rejectDisallowedSystemManagerRequest(w, r) {
		return
	}

	now := time.Now().UTC()
	readiness := systemReadinessProbe()
	if readiness.Reasons == nil {
		readiness.Reasons = []string{}
	}

	drainState := "unsupported"
	if readiness.DrainSupported {
		drainState = currentSystemDrainState()
	}
	databasePools, databasePoolHeadroom := backend.CurrentDatabasePoolRuntimeStatus()

	httpresponse.RespondWithJSON(w, http.StatusOK, systemInstanceStatusResponse{
		Ready:                 readiness.Ready,
		Status:                readiness.Status,
		Reasons:               readiness.Reasons,
		InstanceID:            readiness.InstanceID,
		DesiredStateSeenByApp: currentSystemDesiredState(),
		ProductName:           readiness.ProductName,
		AppVersion:            readiness.AppVersion,
		AppVersionFile:        readiness.AppVersionFile,
		RequiredDBVersion:     readiness.RequiredDBVersion,
		DBVersion:             readiness.DBVersion,
		DBCompatible:          readiness.DBCompatible,
		AcceptingNewWork:      readiness.AcceptingNewWork,
		ActiveRequests:        currentSystemActiveRequests(),
		ActiveLongJobs:        readiness.ActiveLongJobs,
		BackgroundWorkerRole:  currentSystemBackgroundWorkerRole(),
		StorageRoot:           currentSystemStorageRoot(),
		DatabasePools:         databasePools,
		DatabasePoolHeadroom:  databasePoolHeadroom,
		DrainSupported:        readiness.DrainSupported,
		DrainState:            drainState,
		ProcessUptimeSeconds:  int64(now.Sub(systemProcessStartedAt).Seconds()),
		Time:                  now.Format(time.RFC3339),
	})
}

// systemDrainHandler lets a local/private manager toggle app-side drain state.
func systemDrainHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if rejectDisallowedSystemManagerRequest(w, r) {
		return
	}

	desiredState := systemDesiredStateDraining
	if r.Body != nil && r.Body != http.NoBody {
		decodedRequest := systemDrainRequest{}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&decodedRequest); err != nil && !errors.Is(err, io.EOF) {
			httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid drain request")
			return
		}

		if strings.TrimSpace(decodedRequest.DesiredState) != "" {
			desiredState = decodedRequest.DesiredState
		} else if decodedRequest.Draining != nil && !*decodedRequest.Draining {
			desiredState = systemDesiredStateActive
		}
	}

	normalizedState, ok := normalizeSystemDesiredState(desiredState)
	if !ok {
		httpresponse.RespondWithError(w, http.StatusBadRequest, "Invalid desired_state")
		return
	}
	setSystemDesiredState(normalizedState)
	httpresponse.RespondWithJSON(w, http.StatusOK, buildSystemDrainResponse(time.Now().UTC()))
}

func buildSystemReadinessResponse() systemReadyResponse {
	desiredState := currentSystemDesiredState()
	acceptingNewWork := systemDesiredStateAcceptsNewWork(desiredState)
	response := systemReadyResponse{
		Ready:            true,
		Status:           "ready",
		Reasons:          []string{},
		InstanceID:       currentSystemInstanceID(),
		AcceptingNewWork: acceptingNewWork,
		ActiveRequests:   currentSystemActiveRequests(),
		ActiveLongJobs:   0,
		DrainSupported:   true,
	}
	if !acceptingNewWork {
		response.addNotReadyReason(systemNotReadyReasonForDesiredState(desiredState))
	}

	identity := productidentity.DetectFromWorkingDirectory()
	response.ProductName = identity.Name
	response.AppVersion = identity.Version
	response.AppVersionFile = identity.AppVersionFile
	if strings.TrimSpace(response.AppVersion) == "" {
		response.addNotReadyReason("app_version_unavailable")
	}

	requiredDBVersion, err := readRequiredDBVersion()
	response.RequiredDBVersion = requiredDBVersion
	if err != nil {
		response.addNotReadyReason("required_db_version_unavailable")
	}

	dbVersion, err := readRuntimeDBVersion(backend.Db)
	response.DBVersion = dbVersion
	if err != nil {
		response.addNotReadyReason("database_unavailable")
	}

	if response.RequiredDBVersion != "" && response.DBVersion != "" {
		response.DBCompatible = systemVersionsCompatible(response.RequiredDBVersion, response.DBVersion)
		if !response.DBCompatible {
			response.addNotReadyReason("db_version_incompatible")
		}
	}

	if len(response.Reasons) > 0 {
		response.Ready = false
		response.Status = "not_ready"
	}
	return response
}

func (response *systemReadyResponse) addNotReadyReason(reason string) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return
	}
	response.Reasons = append(response.Reasons, reason)
}

func readRequiredDBVersion() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	content, err := os.ReadFile(filepath.Join(cwd, "VERSION_DB"))
	if err != nil {
		return "", err
	}
	version := strings.TrimSpace(string(content))
	if version == "" {
		return "", errors.New("VERSION_DB is empty")
	}
	return version, nil
}

func readRuntimeDBVersion(db *sql.DB) (string, error) {
	if db == nil {
		return "", errors.New("database handle is nil")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	if err := db.PingContext(ctx); err != nil {
		return "", err
	}

	var tableExists bool
	if err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = 'system_db_version'
		)
	`).Scan(&tableExists); err != nil {
		return "", err
	}
	if !tableExists {
		return "0.0.0", nil
	}

	var version string
	if err := db.QueryRowContext(ctx, `
		SELECT version FROM system_db_version
		ORDER BY applied_at DESC NULLS LAST, id DESC
		LIMIT 1
	`).Scan(&version); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "0.0.0", nil
		}
		return "", err
	}
	return strings.TrimSpace(version), nil
}

func currentSystemInstanceID() string {
	for _, value := range []string{os.Getenv("INSTANCE_NAME"), os.Getenv("HOSTNAME")} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}

	if hostname, err := os.Hostname(); err == nil {
		if trimmed := strings.TrimSpace(hostname); trimmed != "" {
			return trimmed
		}
	}
	return "unknown"
}

func shouldSkipSystemActiveRequestTracking(r *http.Request) bool {
	if r == nil || r.URL == nil {
		return true
	}

	switch r.URL.Path {
	case "/health", "/system/health", "/system/ready", "/system/instance-status", "/system/drain":
		return true
	default:
		return false
	}
}

func currentSystemActiveRequests() int {
	active := atomic.LoadInt64(&systemActiveRequests)
	if active < 0 {
		return 0
	}
	return int(active)
}

func currentSystemDesiredState() string {
	if runtimeState, ok := systemDesiredStateRuntimeValue.Load().(string); ok {
		if normalizedState, valid := normalizeSystemDesiredState(runtimeState); valid {
			return normalizedState
		}
	}
	if desiredState := strings.TrimSpace(os.Getenv("EASELECT_DESIRED_STATE")); desiredState != "" {
		if normalizedState, valid := normalizeSystemDesiredState(desiredState); valid {
			return normalizedState
		}
	}
	return systemDesiredStateActive
}

// currentSystemDrainState maps the app desired state into the manager contract.
func currentSystemDrainState() string {
	desiredState := currentSystemDesiredState()
	if desiredState == systemDesiredStateDraining {
		return systemDesiredStateDraining
	}
	return systemDesiredStateActive
}

// setSystemDesiredState stores the runtime app-side desired state for probes.
func setSystemDesiredState(desiredState string) {
	systemDesiredStateRuntimeValue.Store(desiredState)
}

// normalizeSystemDesiredState keeps manager state strings stable and bounded.
func normalizeSystemDesiredState(desiredState string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(desiredState)) {
	case systemDesiredStateActive:
		return systemDesiredStateActive, true
	case systemDesiredStateStandby:
		return systemDesiredStateStandby, true
	case systemDesiredStateDraining:
		return systemDesiredStateDraining, true
	case systemDesiredStateInactive:
		return systemDesiredStateInactive, true
	case systemDesiredStateMaintenance:
		return systemDesiredStateMaintenance, true
	default:
		return "", false
	}
}

// systemDesiredStateAcceptsNewWork decides whether readiness may stay true.
func systemDesiredStateAcceptsNewWork(desiredState string) bool {
	switch desiredState {
	case systemDesiredStateDraining, systemDesiredStateInactive, systemDesiredStateMaintenance:
		return false
	default:
		return true
	}
}

// systemNotReadyReasonForDesiredState converts manager state into probe reasons.
func systemNotReadyReasonForDesiredState(desiredState string) string {
	switch desiredState {
	case systemDesiredStateDraining:
		return "draining"
	case systemDesiredStateInactive:
		return "instance_inactive"
	case systemDesiredStateMaintenance:
		return "maintenance"
	default:
		return "not_accepting_new_work"
	}
}

// buildSystemDrainResponse returns the drain command result snapshot.
func buildSystemDrainResponse(now time.Time) systemDrainResponse {
	desiredState := currentSystemDesiredState()
	return systemDrainResponse{
		DesiredStateSeenByApp: desiredState,
		AcceptingNewWork:      systemDesiredStateAcceptsNewWork(desiredState),
		ActiveRequests:        currentSystemActiveRequests(),
		DrainSupported:        true,
		DrainState:            currentSystemDrainState(),
		Time:                  now.Format(time.RFC3339),
	}
}

// rejectDisallowedSystemManagerRequest blocks public access to manager endpoints.
func rejectDisallowedSystemManagerRequest(w http.ResponseWriter, r *http.Request) bool {
	if systemManagerRequestAllowed(r) {
		return false
	}
	httpresponse.RespondWithError(w, http.StatusForbidden, "System manager endpoint is not available from this network")
	return true
}

// systemManagerRequestAllowed accepts loopback/private manager network calls.
func systemManagerRequestAllowed(r *http.Request) bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("EASELECT_SYSTEM_ENDPOINTS_ALLOW_PUBLIC")), "true") {
		return true
	}
	if r == nil {
		return false
	}
	if systemRequestHasPublicForwardedClient(r) {
		return false
	}

	remoteHost := strings.TrimSpace(r.RemoteAddr)
	if host, _, err := net.SplitHostPort(remoteHost); err == nil {
		remoteHost = host
	}
	if strings.EqualFold(remoteHost, "localhost") {
		return true
	}

	remoteIP := net.ParseIP(remoteHost)
	if remoteIP == nil {
		return false
	}
	return systemManagerIPAllowed(remoteIP)
}

func systemRequestHasPublicForwardedClient(r *http.Request) bool {
	for _, headerName := range []string{"X-Forwarded-For", "X-Real-IP", "X-Client-IP"} {
		for _, headerValue := range r.Header.Values(headerName) {
			if systemHeaderValueHasPublicClientIP(headerValue) {
				return true
			}
		}
	}

	for _, headerValue := range r.Header.Values("Forwarded") {
		for _, forwardedEntry := range strings.Split(headerValue, ",") {
			for _, forwardedPart := range strings.Split(forwardedEntry, ";") {
				key, value, ok := strings.Cut(forwardedPart, "=")
				if !ok || !strings.EqualFold(strings.TrimSpace(key), "for") {
					continue
				}
				if systemHeaderValueHasPublicClientIP(value) {
					return true
				}
			}
		}
	}
	return false
}

func systemHeaderValueHasPublicClientIP(headerValue string) bool {
	for _, candidate := range strings.Split(headerValue, ",") {
		ip, ok := parseSystemManagerHeaderIP(candidate)
		if ok && !systemManagerIPAllowed(ip) {
			return true
		}
	}
	return false
}

func parseSystemManagerHeaderIP(candidate string) (net.IP, bool) {
	value := strings.Trim(strings.TrimSpace(candidate), `"`)
	if value == "" || strings.EqualFold(value, "unknown") {
		return nil, false
	}
	if strings.HasPrefix(value, "[") {
		if closing := strings.Index(value, "]"); closing >= 0 {
			value = value[1:closing]
		}
	} else if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}

	ip := net.ParseIP(strings.TrimSpace(value))
	if ip == nil {
		return nil, false
	}
	return ip, true
}

func systemManagerIPAllowed(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
}

func currentSystemBackgroundWorkerRole() string {
	for _, value := range []string{os.Getenv("EASELECT_BACKGROUND_WORKER_ROLE"), os.Getenv("BACKGROUND_WORKER_ROLE")} {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return "unspecified"
}

func currentSystemStorageRoot() string {
	for _, value := range []string{localStorageDir, os.Getenv("EASELECT_STORAGE_ROOT")} {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if absolute, err := filepath.Abs(trimmed); err == nil {
			return absolute
		}
		return trimmed
	}

	if absolute, err := filepath.Abs("storage"); err == nil {
		return absolute
	}
	return "storage"
}

func systemVersionsCompatible(required string, actual string) bool {
	requiredParts := parseSystemVersion(required)
	actualParts := parseSystemVersion(actual)

	for index := range requiredParts {
		if actualParts[index] < requiredParts[index] {
			return false
		}
		if actualParts[index] > requiredParts[index] {
			return true
		}
	}
	return true
}

func parseSystemVersion(version string) [3]int {
	var parts [3]int
	for index, rawPart := range strings.Split(version, ".") {
		if index >= len(parts) {
			break
		}
		trimmed := strings.TrimSpace(rawPart)
		if trimmed == "" {
			continue
		}
		var parsed int
		for _, char := range trimmed {
			if char < '0' || char > '9' {
				parsed = 0
				break
			}
			parsed = parsed*10 + int(char-'0')
		}
		parts[index] = parsed
	}
	return parts
}
