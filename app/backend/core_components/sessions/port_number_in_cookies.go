// port_number_in_cookies.go
// Gates and applies HTTP listen-port suffixes on authentication cookie names.
// Bridges ENVIRONMENT_TYPE / PORT_NUMBER_IN_COOKIES with the bound listen port
// used by auth_cookie_identity.
// Exists because browsers do not isolate cookies by port, so concurrent
// localhost processes would otherwise overwrite one another's session family.
package e_sessions

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
)

const (
	portNumberInCookiesEnv = "PORT_NUMBER_IN_COOKIES"
	defaultHTTPListenPort  = "8082"
)

var (
	listenPortMu         sync.RWMutex
	configuredListenPort string
)

// SetHTTPListenPort pins the port the HTTP server is bound to so cookie names
// can include that value instead of an independent default.
func SetHTTPListenPort(port string) error {
	port = strings.TrimSpace(port)
	if port == "" {
		listenPortMu.Lock()
		configuredListenPort = ""
		listenPortMu.Unlock()
		return nil
	}
	if err := validateHTTPListenPort(port); err != nil {
		return err
	}
	listenPortMu.Lock()
	configuredListenPort = port
	listenPortMu.Unlock()
	return nil
}

// ResolveHTTPListenPort returns the listen port cookie naming and the HTTP
// server share: an explicit bound port, then PORT, then the process default.
func ResolveHTTPListenPort() (string, error) {
	listenPortMu.RLock()
	port := configuredListenPort
	listenPortMu.RUnlock()
	if port == "" {
		port = strings.TrimSpace(os.Getenv("PORT"))
	}
	if port == "" {
		port = defaultHTTPListenPort
	}
	if err := validateHTTPListenPort(port); err != nil {
		return "", err
	}
	return port, nil
}

// PortNumberInCookiesEnabled reports whether cookie names should include the
// HTTP listen port. Dev and test default on; production defaults off.
// PORT_NUMBER_IN_COOKIES overrides the environment default.
func PortNumberInCookiesEnabled() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(portNumberInCookiesEnv))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("ENVIRONMENT_TYPE"))) {
	case "dev", "test":
		return true
	default:
		return false
	}
}

func validateHTTPListenPort(port string) error {
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return fmt.Errorf("HTTP listen port %q must be a number between 1 and 65535", port)
	}
	return nil
}

func withListenPortCookieNames(names AuthCookieNames) (AuthCookieNames, error) {
	if !PortNumberInCookiesEnabled() {
		return names, nil
	}
	port, err := ResolveHTTPListenPort()
	if err != nil {
		return AuthCookieNames{}, err
	}
	return applyListenPortToCookieNames(names, port), nil
}

func applyListenPortToCookieNames(names AuthCookieNames, port string) AuthCookieNames {
	suffix := "_" + port
	names.Session += suffix
	names.DeviceID += suffix
	names.Fingerprint += suffix
	return names
}
