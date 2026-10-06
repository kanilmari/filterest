// metadata_findings.go
// Records unusable metadata rows without stopping snapshot discovery.
// Shares identity checks across relation readers so each row is reported once.
// Keeps diagnostics limited to catalogue identifiers and anonymized role labels.
package runtime_grants

import (
	"database/sql"
	"fmt"
	"strings"
)

func metadataFinding(snapshot *GrantSnapshot, table, row, state, reason string) {
	oid := oidByName(snapshot, table)
	finding := Finding{Role: "policy", Kind: "table", ObjectOID: oid,
		Object:  (Object{Schema: "public", Name: table}).Identifier(),
		Finding: state, Reason: "row " + row + ": " + reason}
	if state == "blocker" {
		snapshot.Blockers = append(snapshot.Blockers, finding)
	} else {
		snapshot.Findings = append(snapshot.Findings, finding)
	}
}

type metadataUID struct {
	column string
	value  sql.NullInt64
}

// Callers must establish that their application reader joins every supplied UID.
// NULL rows cannot reach that path; a non-NULL unresolved UID requires repair.
func metadataUIDObjects(snapshot *GrantSnapshot, table, row string, identities ...metadataUID) ([]int64, bool) {
	missing := []string{}
	for _, identity := range identities {
		if !identity.value.Valid {
			missing = append(missing, identity.column)
		}
	}
	if len(missing) > 0 {
		metadataFinding(snapshot, table, row, "preserved_outside_scope", "no table identity (NULL "+strings.Join(missing, ", ")+"); no dataset dependency or grant follows")
		return nil, false
	}
	oids := make([]int64, len(identities))
	for i, identity := range identities {
		oids[i] = oidByUID(snapshot, identity.value.Int64)
		if oids[i] == 0 {
			missing = append(missing, fmt.Sprintf("%s=%d", identity.column, identity.value.Int64))
		}
	}
	if len(missing) > 0 {
		metadataFinding(snapshot, table, row, "blocker", "missing snapshot identity "+strings.Join(missing, ", "))
		return nil, false
	}
	return oids, true
}

// Database/scan errors are useful for metadata repair. Runtime identity names
// are never output, even if a driver includes one in its error text.
func metadataReaderError(reader string, err error, roles []Role) error {
	reason := err.Error()
	for _, role := range roles {
		if role.Name != "" {
			reason = strings.ReplaceAll(reason, role.Name, "["+role.Label+"]")
		}
	}
	return fmt.Errorf("%s: %s", reader, reason)
}
