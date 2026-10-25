// session_encryption_test.go
// Keeps store initialization consistent with startup's shared session-key rule.
// Uses dummy material and signed cookies to prove warnings without database access.
// Covers blank signing refusals and development's placeholder fallback behavior.
package e_sessions

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"

	"github.com/gorilla/sessions"
)

func captureSessionStoreOutput(t *testing.T, action func()) string {
	t.Helper()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	previous := os.Stdout
	os.Stdout = writer
	t.Cleanup(func() {
		os.Stdout = previous
		_ = writer.Close()
		_ = reader.Close()
	})
	action()
	os.Stdout = previous
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	output, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return string(output)
}

func assertSessionKeyDiagnosticsPrivate(t *testing.T, output string, keys ...string) {
	t.Helper()
	for _, key := range append(keys, testSessionKey, testSessionSecretKey) {
		if trimmed := strings.TrimSpace(key); trimmed != "" && strings.Contains(output, trimmed) {
			t.Fatal("session-store diagnostics exposed dummy key material")
		}
	}
}

func TestInitSessionStoreWarnsForMissingEncryptionKey(t *testing.T) {
	for _, key := range []struct {
		name, value string
		missing     bool
	}{
		{"empty", "", true}, {"spaces", "   ", true}, {"whitespace", "\t\r\n", true},
		{"unicode whitespace", "\u2003", true},
		{"template", "replace-me-with-32-plus-random-characters", true},
		{"placeholder prefix", "replace-me-custom-placeholder", true},
		{"trimmed placeholder", "\u2003replace-me\t", true},
		{"short real key", "short-dummy-key", false},
		{"padded real key", "\u2003padded-dummy-key\t", false},
	} {
		t.Run(key.name, func(t *testing.T) {
			initSessionTestStore(t)
			Store = nil
			t.Setenv("ENVIRONMENT_TYPE", "dev")
			t.Setenv("SESSION_SECRET_KEY", key.value)
			output := captureSessionStoreOutput(t, InitSessionStore)
			assertSessionKeyDiagnosticsPrivate(t, output, key.value)
			warned := strings.Contains(output, "SESSION_SECRET_KEY is not set — session data will be stored unencrypted")
			if Store == nil || warned != key.missing {
				t.Fatal("encryption warning must match the shared missing-key rule")
			}
			request := newRequestWithSessionCookie(t, func(_ *http.Request, session *sessions.Session) {
				session.Values["user_id"] = 42
			})
			config, err := resolveAuthCookieConfig()
			if err != nil {
				t.Fatal(err)
			}
			signing := deriveScopedCookieKey(testSessionKey, "session-signing", config)
			signedOnly := sessions.NewCookieStore(signing)
			decoded, err := signedOnly.New(request, SessionName)
			if (err == nil) != key.missing || (key.missing && decoded.Values["user_id"] != 42) {
				t.Fatal("cookie must be signed but unencrypted exactly when the warning says so")
			}
			if !key.missing {
				// Real keys retain their original bytes, including boundary whitespace.
				expected := sessions.NewCookieStore(signing, deriveScopedCookieKey(key.value, "session-encryption", config))
				decoded, err := expected.New(request, SessionName)
				if err != nil || decoded.Values["user_id"] != 42 {
					t.Fatal("existing encryption key bytes changed")
				}
			}
		})
	}
}

func TestInitSessionStoreRefusesBlankSigningKeysInEveryMode(t *testing.T) {
	for _, mode := range []string{"dev", "prod", "test", ""} {
		for _, key := range []struct{ name, value string }{
			{"empty", ""}, {"spaces", "   "}, {"whitespace", "\t\r\n"}, {"unicode whitespace", "\u2003"},
		} {
			t.Run(mode+"/"+key.name, func(t *testing.T) {
				initSessionTestStore(t)
				Store = nil
				t.Setenv("ENVIRONMENT_TYPE", mode)
				t.Setenv("SESSION_KEY", key.value)
				var recovered any
				output := captureSessionStoreOutput(t, func() {
					defer func() { recovered = recover() }()
					InitSessionStore()
				})
				diagnostic := output + fmt.Sprint(recovered)
				assertSessionKeyDiagnosticsPrivate(t, diagnostic)
				if recovered == nil || Store != nil || !strings.Contains(diagnostic, "SESSION_KEY") {
					t.Fatal("blank signing keys must panic before creating a store in every mode")
				}
			})
		}
	}
}

func TestInitSessionStoreReplacesDevPlaceholderSigningKeys(t *testing.T) {
	for _, key := range []string{"replace-me-with-32-plus-random-characters", "replace-me-custom", "\u2003replace-me\t"} {
		t.Run(fmt.Sprint(len(key)), func(t *testing.T) {
			initSessionTestStore(t)
			Store = nil
			t.Setenv("ENVIRONMENT_TYPE", "dev")
			t.Setenv("SESSION_KEY", key)
			output := captureSessionStoreOutput(t, InitSessionStore)
			assertSessionKeyDiagnosticsPrivate(t, output, key)
			if !strings.Contains(output, "SESSION_KEY is a placeholder — using a temporary signing key for this process") {
				t.Fatal("placeholder signing keys must warn in development")
			}
			request := newRequestWithSessionCookie(t, func(_ *http.Request, session *sessions.Session) {
				session.Values["user_id"] = 42
			})
			config, err := resolveAuthCookieConfig()
			if err != nil {
				t.Fatal(err)
			}
			published := sessions.NewCookieStore(deriveScopedCookieKey(key, "session-signing", config),
				deriveScopedCookieKey(testSessionSecretKey, "session-encryption", config))
			if _, err := published.New(request, SessionName); err == nil {
				t.Fatal("development cookies must not use the published signing key")
			}
			previous := Store
			InitSessionStore()
			if Store != previous {
				t.Fatal("repeated initialization must keep the process signing key")
			}
			Store = nil
			output = captureSessionStoreOutput(t, InitSessionStore)
			assertSessionKeyDiagnosticsPrivate(t, output, key)
			if _, err := Store.New(request, SessionName); err == nil {
				t.Fatal("a new development store must receive a fresh temporary signing key")
			}
		})
	}
}

func TestReplicaPoolRefusesPlaceholderEncryptionKey(t *testing.T) {
	initSessionTestStore(t)
	t.Setenv("ENVIRONMENT_TYPE", "dev")
	t.Setenv("SESSION_COOKIE_MODE", "replica-pool")
	t.Setenv("SESSION_COOKIE_NAME", "dummy_shared_session")
	t.Setenv("SESSION_SECRET_KEY", "replace-me-dummy-encryption")
	_, err := resolveAuthCookieConfig()
	if err == nil || !strings.Contains(err.Error(), "SESSION_SECRET_KEY is required") {
		t.Fatal("replica pools must still require encryption, including in dev")
	}
	assertSessionKeyDiagnosticsPrivate(t, err.Error(), "replace-me-dummy-encryption")
}

func TestInitSessionStoreKeepsRealSigningKeyBytes(t *testing.T) {
	for _, key := range []string{"x", "\u2003padded-dummy-signing-key\t"} {
		t.Run(fmt.Sprint(len(key)), func(t *testing.T) {
			initSessionTestStore(t)
			Store = nil
			t.Setenv("ENVIRONMENT_TYPE", "prod")
			t.Setenv("SESSION_KEY", key)
			output := captureSessionStoreOutput(t, InitSessionStore)
			assertSessionKeyDiagnosticsPrivate(t, output, key)
			if output != "" {
				t.Fatal("real signing keys must not warn, regardless of length")
			}
			request := newRequestWithSessionCookie(t, func(_ *http.Request, session *sessions.Session) {
				session.Values["user_id"] = 42
			})
			config, err := resolveAuthCookieConfig()
			if err != nil {
				t.Fatal(err)
			}
			expected := sessions.NewCookieStore(deriveScopedCookieKey(key, "session-signing", config),
				deriveScopedCookieKey(testSessionSecretKey, "session-encryption", config))
			decoded, err := expected.New(request, SessionName)
			if err != nil || decoded.Values["user_id"] != 42 {
				t.Fatal("short and padded real signing keys must keep their original bytes")
			}
		})
	}
}
