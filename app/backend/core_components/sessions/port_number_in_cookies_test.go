// port_number_in_cookies_test.go
// Unit tests for listen-port suffixes on the authentication cookie family.
// Bridges environment defaults and PORT_NUMBER_IN_COOKIES with bound-port naming.
// Exists so local/test instances stay distinct in browsers that ignore ports.
package e_sessions

import (
	"strings"
	"testing"
)

func TestPortNumberInCookiesEnabledDefaultsAndOverrides(t *testing.T) {
	tests := []struct {
		name     string
		envType  string
		override string
		want     bool
	}{
		{name: "dev default on", envType: "dev", want: true},
		{name: "test default on", envType: "test", want: true},
		{name: "prod default off", envType: "prod", want: false},
		{name: "production default off", envType: "production", want: false},
		{name: "empty environment fails closed", envType: "", want: false},
		{name: "override on in prod", envType: "prod", override: "true", want: true},
		{name: "override off in dev", envType: "dev", override: "0", want: false},
		{name: "override on mixed case", envType: "prod", override: "ON", want: true},
		{name: "override off mixed case", envType: "dev", override: "No", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("ENVIRONMENT_TYPE", tt.envType)
			t.Setenv("PORT_NUMBER_IN_COOKIES", tt.override)
			if got := PortNumberInCookiesEnabled(); got != tt.want {
				t.Fatalf("PortNumberInCookiesEnabled() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestResolveAuthCookieConfigOmitsListenPortWhenFeatureOff(t *testing.T) {
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("INSTANCE_NAME", "port-cookie-off")
	t.Setenv("DB_HOST", "127.0.0.1")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "easelect_test")
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("PORT_NUMBER_IN_COOKIES", "")
	if err := SetHTTPListenPort("8090"); err != nil {
		t.Fatalf("SetHTTPListenPort() error = %v", err)
	}
	t.Cleanup(func() { _ = SetHTTPListenPort("") })

	config, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("resolveAuthCookieConfig() error = %v", err)
	}
	assertCookieFamilySharesNamespace(t, config.names)
	if strings.Contains(config.names.Session, "_8090") || strings.HasSuffix(config.names.Session, "_8090") {
		t.Fatalf("Session = %q, did not want listen port suffix when feature is off", config.names.Session)
	}
	if strings.HasSuffix(config.names.DeviceID, "_8090") || strings.HasSuffix(config.names.Fingerprint, "_8090") {
		t.Fatalf("cookie names = %#v, did not want listen port suffix when feature is off", config.names)
	}
}

func TestResolveAuthCookieConfigAppendsListenPortWhenFeatureOn(t *testing.T) {
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("INSTANCE_NAME", "port-cookie-on")
	t.Setenv("DB_HOST", "127.0.0.1")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "easelect_test")
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("PORT_NUMBER_IN_COOKIES", "")
	if err := SetHTTPListenPort("8082"); err != nil {
		t.Fatalf("SetHTTPListenPort() error = %v", err)
	}
	t.Cleanup(func() { _ = SetHTTPListenPort("") })

	config, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("resolveAuthCookieConfig() error = %v", err)
	}
	assertCookieFamilySharesNamespace(t, config.names)
	assertCookieFamilyHasPortSuffix(t, config.names, "8082")
}

func TestResolveAuthCookieConfigUsesActualListenPortNotStaleDefault(t *testing.T) {
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("INSTANCE_NAME", "port-cookie-bound")
	t.Setenv("DB_HOST", "127.0.0.1")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "easelect_test")
	t.Setenv("ENVIRONMENT_TYPE", "test")
	t.Setenv("PORT_NUMBER_IN_COOKIES", "")
	t.Setenv("PORT", "8082")
	if err := SetHTTPListenPort("8090"); err != nil {
		t.Fatalf("SetHTTPListenPort() error = %v", err)
	}
	t.Cleanup(func() { _ = SetHTTPListenPort("") })

	config, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("resolveAuthCookieConfig() error = %v", err)
	}
	assertCookieFamilyHasPortSuffix(t, config.names, "8090")
	if strings.HasSuffix(config.names.Session, "_8082") {
		t.Fatalf("Session = %q, used stale PORT default instead of bound listen port", config.names.Session)
	}
}

func TestResolveAuthCookieConfigSeparatesDifferentListenPorts(t *testing.T) {
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("INSTANCE_NAME", "shared-local-identity")
	t.Setenv("DB_HOST", "127.0.0.1")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "easelect_test")
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("PORT_NUMBER_IN_COOKIES", "1")
	t.Cleanup(func() { _ = SetHTTPListenPort("") })

	if err := SetHTTPListenPort("8082"); err != nil {
		t.Fatalf("SetHTTPListenPort(8082) error = %v", err)
	}
	first, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("first resolveAuthCookieConfig() error = %v", err)
	}
	if err := SetHTTPListenPort("8090"); err != nil {
		t.Fatalf("SetHTTPListenPort(8090) error = %v", err)
	}
	second, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("second resolveAuthCookieConfig() error = %v", err)
	}

	assertCookieFamilyHasPortSuffix(t, first.names, "8082")
	assertCookieFamilyHasPortSuffix(t, second.names, "8090")
	if first.names.Session == second.names.Session || first.names.DeviceID == second.names.DeviceID || first.names.Fingerprint == second.names.Fingerprint {
		t.Fatalf("different listen ports reused cookie names: first=%#v second=%#v", first.names, second.names)
	}
}

func TestInitSessionStoreReadAndWriteSharePortCookieNames(t *testing.T) {
	resetSessionTestGlobals()
	t.Setenv("SESSION_KEY", testSessionKey)
	t.Setenv("SESSION_SECRET_KEY", testSessionSecretKey)
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("INSTANCE_NAME", "port-cookie-rw")
	t.Setenv("DB_HOST", "127.0.0.1")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "easelect_test")
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("PORT_NUMBER_IN_COOKIES", "")
	if err := SetHTTPListenPort("8111"); err != nil {
		t.Fatalf("SetHTTPListenPort() error = %v", err)
	}
	defer resetSessionTestGlobals()

	InitSessionStore()

	resolved, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("resolveAuthCookieConfig() error = %v", err)
	}
	current := CurrentAuthCookieNames()
	if current != resolved.names {
		t.Fatalf("CurrentAuthCookieNames() = %#v, want %#v from the same naming rule", current, resolved.names)
	}
	if SessionName != current.Session {
		t.Fatalf("SessionName = %q, want %q", SessionName, current.Session)
	}
	if DeviceIDCookieName() != current.DeviceID || FingerprintCookieName() != current.Fingerprint {
		t.Fatalf("read helpers diverged from CurrentAuthCookieNames(): device=%q fingerprint=%q current=%#v", DeviceIDCookieName(), FingerprintCookieName(), current)
	}
	assertCookieFamilyHasPortSuffix(t, current, "8111")
}

func TestResolveAuthCookieConfigAppendsListenPortToReplicaPoolNames(t *testing.T) {
	t.Setenv("SESSION_COOKIE_MODE", "replica-pool")
	t.Setenv("SESSION_COOKIE_NAME", "lb_pool_session")
	t.Setenv("SESSION_SECRET_KEY", testSessionSecretKey)
	t.Setenv("INSTANCE_NAME", "node-a")
	t.Setenv("DB_HOST", "db.internal")
	t.Setenv("DB_PORT", "5432")
	t.Setenv("DB_NAME", "shared_app")
	t.Setenv("ENVIRONMENT_TYPE", "prod")
	t.Setenv("PORT_NUMBER_IN_COOKIES", "true")
	if err := SetHTTPListenPort("8443"); err != nil {
		t.Fatalf("SetHTTPListenPort() error = %v", err)
	}
	t.Cleanup(func() { _ = SetHTTPListenPort("") })

	config, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("resolveAuthCookieConfig() error = %v", err)
	}
	if config.names.Session != "lb_pool_session_8443" {
		t.Fatalf("Session = %q, want lb_pool_session_8443", config.names.Session)
	}
	assertCookieFamilyHasPortSuffix(t, config.names, "8443")
}

func TestResolveAuthCookieConfigUsesPORTEnvWhenListenPortUnpinned(t *testing.T) {
	t.Setenv("SESSION_COOKIE_MODE", "isolated")
	t.Setenv("SESSION_COOKIE_NAME", "")
	t.Setenv("INSTANCE_NAME", "port-cookie-env")
	t.Setenv("DB_HOST", "127.0.0.1")
	t.Setenv("DB_PORT", "5433")
	t.Setenv("DB_NAME", "easelect_test")
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("PORT_NUMBER_IN_COOKIES", "")
	t.Setenv("PORT", "8123")
	if err := SetHTTPListenPort(""); err != nil {
		t.Fatalf("SetHTTPListenPort() error = %v", err)
	}

	config, err := resolveAuthCookieConfig()
	if err != nil {
		t.Fatalf("resolveAuthCookieConfig() error = %v", err)
	}
	assertCookieFamilyHasPortSuffix(t, config.names, "8123")
}

func TestResolveHTTPListenPortPrefersBoundPortOverEnvDefault(t *testing.T) {
	t.Setenv("PORT", "8082")
	if err := SetHTTPListenPort("9099"); err != nil {
		t.Fatalf("SetHTTPListenPort() error = %v", err)
	}
	t.Cleanup(func() { _ = SetHTTPListenPort("") })

	got, err := ResolveHTTPListenPort()
	if err != nil {
		t.Fatalf("ResolveHTTPListenPort() error = %v", err)
	}
	if got != "9099" {
		t.Fatalf("ResolveHTTPListenPort() = %q, want bound port 9099", got)
	}
}

func assertCookieFamilySharesNamespace(t *testing.T, names AuthCookieNames) {
	t.Helper()
	sessionSuffix := strings.TrimPrefix(names.Session, "session_")
	if names.DeviceID != "device_id_"+sessionSuffix || names.Fingerprint != "fingerprint_"+sessionSuffix {
		t.Fatalf("cookie family is not coherent: %#v", names)
	}
}

func assertCookieFamilyHasPortSuffix(t *testing.T, names AuthCookieNames, port string) {
	t.Helper()
	suffix := "_" + port
	if !strings.HasSuffix(names.Session, suffix) || !strings.HasSuffix(names.DeviceID, suffix) || !strings.HasSuffix(names.Fingerprint, suffix) {
		t.Fatalf("cookie names = %#v, want suffix %q on the whole family", names, suffix)
	}
	if strings.Count(names.Session, suffix) != 1 {
		t.Fatalf("Session = %q, want exactly one %q suffix", names.Session, suffix)
	}
}
