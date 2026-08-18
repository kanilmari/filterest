// auth_cookie_identity.go
// Defines the instance-scoped authentication-cookie identity and lifecycle.
// Bridges runtime instance configuration with session, device, and fingerprint cookies.
// Exists to prevent browser cookie sharing across same-host Easelect instances while
// allowing an explicitly declared replica pool to share one authenticated session.
package e_sessions

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	authCookieModeIsolated    = "isolated"
	authCookieModeReplicaPool = "replica-pool"
	authCookieLifetime        = 7 * 24 * time.Hour
	maxExplicitCookieNameLen  = 128
)

// AuthCookieNames contains the complete browser-cookie namespace owned by one
// isolated instance or one explicitly shared replica pool.
type AuthCookieNames struct {
	Session     string
	DeviceID    string
	Fingerprint string
}

type authCookieConfig struct {
	mode            string
	stableIdentity  string
	keyDeriveScope  string
	cookieNamespace string
	names           AuthCookieNames
}

var currentAuthCookieConfig = legacyAuthCookieConfig()

func legacyAuthCookieConfig() authCookieConfig {
	return authCookieConfig{
		mode:            authCookieModeIsolated,
		stableIdentity:  "legacy",
		keyDeriveScope:  "instance:legacy",
		cookieNamespace: "legacy",
		names: AuthCookieNames{
			Session:     "session",
			DeviceID:    "device_id",
			Fingerprint: "fingerprint",
		},
	}
}

// ValidateAuthCookieEnvironment validates the startup contract without exposing
// cookie secrets. Isolated instances must derive their cookie namespace from a
// stable instance/database identity; shared names require an explicit replica-pool mode.
func ValidateAuthCookieEnvironment() error {
	_, err := resolveAuthCookieConfig()
	return err
}

// CurrentAuthCookieNames returns the initialized names that every authentication
// path must use. Call InitSessionStore before serving HTTP requests.
func CurrentAuthCookieNames() AuthCookieNames {
	return currentAuthCookieConfig.names
}

// DeviceIDCookieName returns the current instance's device identifier cookie name.
func DeviceIDCookieName() string {
	return currentAuthCookieConfig.names.DeviceID
}

// FingerprintCookieName returns the current instance's browser fingerprint cookie name.
func FingerprintCookieName() string {
	return currentAuthCookieConfig.names.Fingerprint
}

// DeriveCurrentAuthKey derives a purpose-specific key inside the initialized
// instance or replica-pool boundary. Callers must not persist the returned key.
func DeriveCurrentAuthKey(rawSecret, purpose string) []byte {
	return deriveScopedCookieKey(rawSecret, purpose, currentAuthCookieConfig)
}

// SetDeviceIDCookie writes an instance-scoped, server-only device cookie.
func SetDeviceIDCookie(w http.ResponseWriter, value string) {
	setPersistentAuthCookie(w, DeviceIDCookieName(), value)
}

// SetFingerprintCookie writes an instance-scoped, server-only fingerprint cookie.
func SetFingerprintCookie(w http.ResponseWriter, value string) {
	setPersistentAuthCookie(w, FingerprintCookieName(), value)
}

// ExpireCurrentAuthCookies expires only the cookies owned by this instance or
// replica pool. It deliberately never scans or clears sibling session_* cookies.
func ExpireCurrentAuthCookies(w http.ResponseWriter) {
	for _, name := range []string{
		currentAuthCookieConfig.names.Session,
		currentAuthCookieConfig.names.DeviceID,
		currentAuthCookieConfig.names.Fingerprint,
	} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			Expires:  time.Unix(0, 0),
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   ShouldUseSecureCookies(),
			SameSite: http.SameSiteLaxMode,
		})
	}
}

func setPersistentAuthCookie(w http.ResponseWriter, name, value string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		Expires:  time.Now().Add(authCookieLifetime),
		MaxAge:   int(authCookieLifetime.Seconds()),
		HttpOnly: true,
		Secure:   ShouldUseSecureCookies(),
		SameSite: http.SameSiteLaxMode,
	})
}

func resolveAuthCookieConfig() (authCookieConfig, error) {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("SESSION_COOKIE_MODE")))
	if mode == "" {
		mode = authCookieModeIsolated
	}
	if mode != authCookieModeIsolated && mode != authCookieModeReplicaPool {
		return authCookieConfig{}, fmt.Errorf("SESSION_COOKIE_MODE must be %q or %q", authCookieModeIsolated, authCookieModeReplicaPool)
	}

	explicitSessionName := strings.TrimSpace(os.Getenv("SESSION_COOKIE_NAME"))
	databaseIdentity, err := configuredDatabaseIdentity()
	if err != nil {
		return authCookieConfig{}, err
	}

	if mode == authCookieModeReplicaPool {
		if explicitSessionName == "" {
			return authCookieConfig{}, fmt.Errorf("SESSION_COOKIE_NAME is required when SESSION_COOKIE_MODE=%s", authCookieModeReplicaPool)
		}
		sessionName := canonicalExplicitCookieName(explicitSessionName)
		if sessionName == "" || sessionName != explicitSessionName || len(sessionName) > maxExplicitCookieNameLen {
			return authCookieConfig{}, fmt.Errorf("SESSION_COOKIE_NAME must contain only letters, numbers, dots, underscores, or hyphens and be at most %d characters", maxExplicitCookieNameLen)
		}
		if strings.TrimSpace(os.Getenv("SESSION_SECRET_KEY")) == "" {
			return authCookieConfig{}, fmt.Errorf("SESSION_SECRET_KEY is required when SESSION_COOKIE_MODE=%s", authCookieModeReplicaPool)
		}
		namespace := canonicalCookieNamespace("replica-pool:" + explicitSessionName)
		return authCookieConfig{
			mode:            mode,
			stableIdentity:  explicitSessionName,
			keyDeriveScope:  "replica-pool:" + explicitSessionName + "|database:" + databaseIdentity,
			cookieNamespace: namespace,
			names: AuthCookieNames{
				Session:     sessionName,
				DeviceID:    "device_id_" + namespace,
				Fingerprint: "fingerprint_" + namespace,
			},
		}, nil
	}

	if explicitSessionName != "" {
		return authCookieConfig{}, fmt.Errorf("SESSION_COOKIE_NAME is allowed only when SESSION_COOKIE_MODE=%s", authCookieModeReplicaPool)
	}

	stableIdentity := strings.TrimSpace(os.Getenv("INSTANCE_NAME"))
	identitySource := "instance:"
	if stableIdentity == "" {
		stableIdentity = databaseIdentity
		identitySource = "database:"
	}
	namespace := canonicalCookieNamespace(identitySource + stableIdentity)
	return authCookieConfig{
		mode:            mode,
		stableIdentity:  stableIdentity,
		keyDeriveScope:  identitySource + stableIdentity + "|database:" + databaseIdentity,
		cookieNamespace: namespace,
		names: AuthCookieNames{
			Session:     "session_" + namespace,
			DeviceID:    "device_id_" + namespace,
			Fingerprint: "fingerprint_" + namespace,
		},
	}, nil
}

func configuredDatabaseIdentity() (string, error) {
	host := strings.TrimSpace(os.Getenv("DB_HOST"))
	port := strings.TrimSpace(os.Getenv("DB_PORT"))
	name := strings.TrimSpace(os.Getenv("DB_NAME"))
	if host == "" || port == "" || name == "" {
		return "", fmt.Errorf("DB_HOST, DB_PORT, and DB_NAME are required for authentication-cookie isolation")
	}
	return host + ":" + port + "/" + name, nil
}

func canonicalExplicitCookieName(raw string) string {
	return sanitizeSessionCookieName(raw)
}

func canonicalCookieNamespace(raw string) string {
	readable := strings.ToLower(sanitizeSessionCookieName(raw))
	readable = strings.Trim(readable, "._-")
	if readable == "" {
		readable = "instance"
	}
	if len(readable) > 36 {
		readable = readable[:36]
	}
	digest := sha256.Sum256([]byte(raw))
	return readable + "_" + hex.EncodeToString(digest[:])[:10]
}

func deriveScopedCookieKey(rawSecret, purpose string, config authCookieConfig) []byte {
	mac := hmac.New(sha256.New, []byte(rawSecret))
	_, _ = mac.Write([]byte("easelect-auth-cookie|" + purpose + "|" + config.keyDeriveScope))
	return mac.Sum(nil)
}
