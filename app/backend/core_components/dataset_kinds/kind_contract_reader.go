// kind_contract_reader.go
// Owns the versioned, embedded dataset kind catalogue and schema evidence types.
// Connects registry intent with PostgreSQL structure without granting permissions.
package dataset_kinds

import (
	"bytes"
	_ "embed"
	"encoding/json"
)

const (
	Ordinary     = "ordinary"
	Embeddings   = "embeddings"
	Locations    = "locations"
	ChatMessages = "chat_messages"
	ChatSettings = "chat_settings"
)

//go:embed kind_contract_catalogue.json
var catalogueJSON []byte

type contract struct {
	Standard        bool                `json:"standard"`
	Actors          bool                `json:"actors"`
	BigIdentity     bool                `json:"big_identity"`
	Columns         map[string][]string `json:"columns"`
	Required        []string            `json:"required"`
	Unique          [][]string          `json:"unique"`
	Views           []string            `json:"views"`
	AdminOnly       bool                `json:"admin_only"`
	ParticipantOnly bool                `json:"participant_only"`
	References      map[string]string   `json:"references"`
}

var catalogue = func() map[string]map[int]contract {
	var result map[string]map[int]contract
	if err := json.Unmarshal(catalogueJSON, &result); err != nil {
		panic(err)
	}
	return result
}()

type Column struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	SQLType  string `json:"sql_type"`
	NotNull  bool   `json:"not_null"`
	Default  string `json:"default"`
	Identity string `json:"identity"`
}

type ForeignKey struct {
	Columns       []string `json:"columns"`
	Target        string   `json:"target"` // Schema-qualified physical identity, never a name guess.
	TargetColumns []string `json:"target_columns"`
	OnDelete      string   `json:"on_delete"`
}

type Shape struct {
	Name           string       `json:"name"`
	Columns        []Column     `json:"columns"`
	PrimaryKey     []string     `json:"primary_key"`
	Unique         [][]string   `json:"unique_keys"`
	ForeignKeys    []ForeignKey `json:"foreign_keys"`
	UpdateTriggers []string     `json:"update_triggers"`
}

// Relation names the target by table_uid; columns must match a real typed FK.
// For inline vectors/points, TableUID equals the host UID and RowColumn is empty.
type Relation struct {
	TableUID    int64  `json:"table_uid"`
	HostColumn  string `json:"host_column"`
	RowColumn   string `json:"row_column"`
	ValueColumn string `json:"value_column"`
}

type Configuration struct {
	Embeddings       *Relation `json:"embeddings,omitempty"`
	Locations        *Relation `json:"locations,omitempty"`
	VectorModel      string    `json:"vector_model,omitempty"`
	VectorDimensions int       `json:"vector_dimensions,omitempty"`
	Invalid          bool      `json:"invalid,omitempty"`
}

func (c *Configuration) UnmarshalJSON(raw []byte) error {
	type value Configuration
	var v value
	var keys map[string]json.RawMessage
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if json.Unmarshal(raw, &keys) != nil || keys == nil || decoder.Decode(&v) != nil {
		*c = Configuration{Invalid: true}
		return nil
	}
	for name := range keys {
		if name != "embeddings" && name != "locations" && name != "vector_model" && name != "vector_dimensions" {
			v.Invalid = true
		}
	}
	*c = Configuration(v)
	return nil
}

type Registration struct {
	UID                    int64         `json:"table_uid"`
	Name                   string        `json:"name"`
	Kind                   string        `json:"table_kind"`
	Version                int           `json:"kind_version"`
	Configuration          Configuration `json:"kind_config"`
	MultilingualEmbeddings bool          `json:"multi_lang_embeddings"`
}

type Snapshot struct {
	Registrations []Registration `json:"registrations"`
	Shapes        []Shape        `json:"shapes"`
	// Immutable stored evidence carries its once-computed fingerprint to readers.
	cachedEvidence map[int64]*snapshotEvidence
}

// Capabilities describe structural support only. Callers still check dataset,
// column, provider-consent, administrator and (later) conversation permissions.
// No rights, default view or retention setting is stored or changed here.
type Capabilities struct {
	TableUID         int64    `json:"table_uid"`
	Kind             string   `json:"table_kind"`
	Version          int      `json:"kind_version"`
	Conforming       bool     `json:"conforming"`
	Issues           []string `json:"issues"`
	Views            []string `json:"supported_views"`
	Map              bool     `json:"map"`
	Tree             bool     `json:"tree"`
	InlineEmbeddings bool     `json:"inline_embeddings"`
	ChildEmbeddings  bool     `json:"child_embeddings"`
	SemanticSearch   bool     `json:"semantic_search"`
	Chat             bool     `json:"chat"`
	AdminOnly        bool     `json:"admin_only"`
	ParticipantOnly  bool     `json:"participant_only"`
}
