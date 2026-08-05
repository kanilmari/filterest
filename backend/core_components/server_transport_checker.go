// server_transport_checker.go
// Selects direct HTTPS or reverse-proxy HTTP for the application server.
// Bridges the effective security environment with local admin and hosted deployment transport.
// Exists so production-safe Filterest binaries can still use secure cookies on localhost.
package backend

import "strings"

// ShouldServeWithTLS keeps development on local HTTPS and lets a production
// binary opt into direct local TLS without enabling any development routes.
func ShouldServeWithTLS(environmentType string, localTLSSetting string) bool {
	if strings.ToLower(strings.TrimSpace(environmentType)) != "prod" {
		return true
	}

	switch strings.ToLower(strings.TrimSpace(localTLSSetting)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
