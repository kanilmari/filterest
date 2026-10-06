// grant_snapshot.go
// Defines the input and output of the runtime database privilege policy.
// Connects catalogue discovery to a pure policy without database or handler globals.
// Keeps credentials and named people's memberships out of the grant model.
package runtime_grants

import (
	"fmt"
	"sort"
	"strings"

	"github.com/lib/pq"
)

// Operation names an application data requirement, independent of old ACLs.
type Operation uint8

const (
	Read Operation = 1 << iota
	Insert
	Update
	Delete
)

// Role binds a stable pool label to the resolved database identity.
type Role struct {
	Label string
	Name  string // Database identity, never a password; output uses Label only.
	OID   int64
}

// Column contains only metadata needed for labels and sequence requirements.
type Column struct {
	Name     string
	Text     bool
	Identity bool
}

// Object identifies one physical catalogue target and its classification evidence.
type Object struct {
	OID           int64
	Schema        string
	Name          string
	Kind          string   // table, sequence, schema, function
	Columns       []Column // physical ordinal order
	DatasetUID    int64
	DisplayColumn string
	Protected     bool // account-view/sequence closure or privilege-editing view
	Extension     bool
}

// Identifier quotes each component, as the stage-1/2a reconcilers do.
func (o Object) Identifier() string {
	if o.Kind == "schema" {
		return pq.QuoteIdentifier(o.Name)
	}
	return pq.QuoteIdentifier(o.Schema) + "." + pq.QuoteIdentifier(o.Name)
}

func (o Object) hasColumn(name string) bool {
	for _, column := range o.Columns {
		if column.Name == name {
			return true
		}
	}
	return false
}

// Function models the route checker's ordinary false-or-NULL activation rule.
type Function struct {
	ID           int64
	Route        string
	Disabled     *bool // false OR NULL is active, matching the ordinary route checker
	UIOnly       bool
	TableRelated bool
}

// Right is a declared group capability, including groups with no members.
type Right struct{ GroupID, FunctionID, DatasetUID int64 }

// Dependency expresses a real consumer operation and an independently checked target.
type Dependency struct {
	SourceOID, TargetOID int64
	Kind                 string // label, lock, child, bridge, cache, gallery, gallery_insert, gallery_read, automation, embedding
	When                 Operation
	Requires             Operation // strict-false target capability, combined across groups
	Columns              []string
	ReadColumns          []string // Predicate/readback columns required beside a narrow write.
	SourceUpdateColumns  []string // UPDATE OF attachment columns; empty means every UPDATE.
	RelatedOID           int64    // M:M read target; bridge has its independent add right
}

// SequenceUse records both owned and default-referenced sequences without expressions.
type SequenceUse struct {
	TableOID, SequenceOID int64
	Column                string
	NextValue             bool // defaults call nextval; identity ownership alone needs no USAGE
}

// GrantSnapshot contains metadata only, read within one caller-owned transaction.
// A dataset result aggregates all inbound consumers, so shared targets survive
// removing one right. ACLs are deliberately absent from this input.
type GrantSnapshot struct {
	Roles         []Role
	Objects       map[int64]Object
	Functions     map[int64]Function
	Groups        map[int64]bool
	GuestGroups   map[int64]bool // site's named guests group plus user 1's memberships; IDs are installation-specific
	GuestGroupID  int64          // named guests group belongs to the guest pool, independently of ordinary groups
	Rights        []Right
	Dependencies  []Dependency
	Sequences     []SequenceUse
	AdminRecovery bool
	Blockers      []Finding
	Findings      []Finding // Non-blocking metadata rows preserved outside dataset scope.
}

// Grant is one desired privilege, using a role label rather than an identity in output.
type Grant struct {
	Role      string `json:"label"`
	Kind      string `json:"kind"`
	ObjectOID int64  `json:"object_oid"`
	Column    string `json:"column_name"`
	Privilege string `json:"privilege"`
	Reason    string `json:"reason"`
}

// GrantSet is sorted and deduplicated for deterministic comparisons.
type GrantSet []Grant

func grantKey(g Grant) string {
	return fmt.Sprintf("%s/%s/%d/%s/%s", g.Role, g.Kind, g.ObjectOID, g.Column, g.Privilege)
}

func sortedGrants(entries map[string]Grant) GrantSet {
	result := make(GrantSet, 0, len(entries))
	for _, grant := range entries {
		result = append(result, grant)
	}
	sort.Slice(result, func(i, j int) bool { return grantKey(result[i]) < grantKey(result[j]) })
	return result
}

// RoleConfiguration contains the same role-name keys as database.go; no secret
// key is consulted. The loader resolves names to OIDs in its own database.
type RoleConfiguration struct {
	Names          map[string]string
	ProtectedNames []string
	AdminRecovery  bool
}

// ConfiguredRoles adapts installation configuration without importing backend.
func ConfiguredRoles(lookup func(string) string) RoleConfiguration {
	configuration := RoleConfiguration{Names: map[string]string{}}
	for label, key := range map[string]string{"basic": "DB_BASIC_USER", "guest": "DB_GUEST_USER", "readonly": "DB_READONLY_USER", "confidential": "DB_CONFIDENTIAL_USER"} {
		configuration.Names[label] = strings.TrimSpace(lookup(key))
	}
	configuration.ProtectedNames = []string{"postgres", strings.TrimSpace(lookup("DB_ADMIN_USER")), strings.TrimSpace(lookup("DB_USER"))}
	if lookup("ENVIRONMENT_TYPE") == "dev" {
		switch strings.ToLower(strings.TrimSpace(lookup("FILTEREST_ADMIN_PERMISSION_RECOVERY_MODE"))) {
		case "1", "true", "yes", "on":
			configuration.AdminRecovery = true
		}
	}
	return configuration
}
