// protected_write_target.go
// Lets configuration editors share the audit's protected view/table closure.
// Uses a bound relation identity and performs only catalogue inspection.
package runtime_grants

import "database/sql"

type targetQueryer interface{ QueryRow(string, ...any) *sql.Row }

func ProtectedWriteTarget(q targetQueryer, identifier string) (bool, error) {
	var protected bool
	err := q.QueryRow(`SELECT COALESCE(bool_or(protected),false) FROM (`+objectsSQL+`) AS o(object_oid,schema_name,object_name,kind,protected,extension)
 WHERE object_oid=to_regclass(btrim($1::text))::oid AND kind='table'`, identifier).Scan(&protected)
	return protected, err
}
