// middlewares_for_apps.go
// Composes middleware chains for application (non-admin) routes.
// Bridges the route registrar and the individual middleware packages (auth, CSP, CSRF, etc.).
// Exists to apply the standard middleware stack to app endpoints in the correct order.
package middlewares
