// doc.go
// Defines the offline release package boundary.
// Connects release awareness, operator trust and authenticated requirements.
// Keeps release verification separate from installation/database execution.

// Package release_updates checks release availability and authenticates offline
// release manifests. Trust must be provisioned independently in an operator-owned
// policy; adjacent bundle keys cannot establish trust. Authentication declares
// release requirements and never claims database eligibility or execution readiness.
package release_updates
