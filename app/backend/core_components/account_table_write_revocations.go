// account_table_write_revocations.go
// Keeps the existing trigger-editor guard on the shared protected-object closure.
// Startup ACL application now belongs exclusively to runtime_grants.
package backend

import "easelect/backend/core_components/runtime_grants"

func AccountTableWriteTarget(q rowQueryer, relationName string) (bool, error) {
	return runtime_grants.ProtectedWriteTarget(q, relationName)
}
