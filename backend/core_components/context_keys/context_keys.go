// context_keys.go
// Shared request-context key types used by middleware layers.
// Between firewall, rate limiter, and other middleware that set or read context values.
// Exists to centralise context keys and prevent import cycles.
package context_keys

// ClientIPKey is the context key under which the firewall middleware stores the
// real client IP after resolving proxy headers (CF-Connecting-IP, X-Real-IP, etc.).
// Downstream middleware should read this value instead of r.RemoteAddr so that
// per-user rate limits work correctly behind Nginx or Cloudflare.
type ClientIPKey struct{}
