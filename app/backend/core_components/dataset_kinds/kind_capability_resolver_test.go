// kind_capability_resolver_test.go
// Proves fresh/legacy classification, typed relations and fail-closed drift.
// Uses schema-only evidence so an empty location table behaves like a populated one.
package dataset_kinds

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"
)

func baseShape(name string) Shape {
	return Shape{Name: name, PrimaryKey: []string{"id"}, Columns: []Column{
		{Name: "id", Type: "int8", NotNull: true, Identity: "a"},
		{Name: "created", Type: "timestamptz", NotNull: true, Default: "now()"},
		{Name: "updated", Type: "timestamptz", NotNull: true, Default: "now()"},
	}, UpdateTriggers: []string{"BEGIN NEW.updated := now(); RETURN NEW; END"}}
}

func ordinaryShape(name string) Shape {
	s := baseShape(name)
	for _, field := range []string{"created_by", "owner_id"} {
		s.Columns = append(s.Columns, Column{Name: field, Type: "int4"})
		s.ForeignKeys = append(s.ForeignKeys, ForeignKey{Columns: []string{field}, Target: "public.system_users", TargetColumns: []string{"id"}, OnDelete: "n"})
	}
	return s
}

func legacyEmbeddings(host string) Shape {
	return Shape{Name: "public.arbitrary_vectors", Columns: []Column{
		{Name: "host_row_id", Type: "int8"}, {Name: "language_code", Type: "text"},
		{Name: "embedding", Type: "vector", SQLType: "vector"},
		{Name: "updated", Type: "timestamp", NotNull: true, Default: "now()"}, {Name: "content_md5", Type: "text"},
	}, ForeignKeys: []ForeignKey{{Columns: []string{"host_row_id"}, Target: host, TargetColumns: []string{"id"}, OnDelete: "c"}}}
}

func fixtureSnapshot() Snapshot {
	host := ordinaryShape("public.host")
	return Snapshot{Registrations: []Registration{{UID: 1, Name: host.Name, Kind: Ordinary, MultilingualEmbeddings: true},
		{UID: 2, Name: "public.arbitrary_vectors", Kind: Ordinary},
		{UID: 3, Name: "public.empty_points", Kind: Ordinary}},
		Shapes: []Shape{host, legacyEmbeddings(host.Name), {Name: "public.empty_points", Columns: []Column{
			{Name: "position", Type: "geometry", SQLType: "postgis.geometry(Point,4326)"},
		}}}}
}

func TestKindFreshAndLegacyShapes(t *testing.T) {
	s := fixtureSnapshot()
	for _, test := range []struct {
		uid               int64
		kind              string
		mapSupport, child bool
	}{
		{1, Ordinary, false, true}, {2, Embeddings, false, false}, {3, Locations, true, false},
	} {
		c := Resolve(s, test.uid)
		if !c.Conforming || c.Kind != test.kind || c.Map != test.mapSupport || c.ChildEmbeddings != test.child || c.Chat {
			t.Fatalf("uid %d: %+v", test.uid, c)
		}
	}
	s.Registrations[0].Version = 1
	if c := Resolve(s, 1); !c.Conforming || c.ChildEmbeddings {
		t.Fatalf("canonical host requires explicit relation: %+v", c)
	}
	s.Registrations[0].Configuration = Configuration{Embeddings: &Relation{TableUID: 2, HostColumn: "id", RowColumn: "host_row_id", ValueColumn: "embedding"}, VectorModel: "fixture-model", VectorDimensions: 768}
	if c := Resolve(s, 1); !c.Conforming || !c.ChildEmbeddings || !c.SemanticSearch {
		t.Fatalf("explicit legacy child: %+v", c)
	}
	// Canonical embeddings add identity/timestamps and the missing historical uniqueness.
	child := baseShape(s.Shapes[1].Name)
	for _, c := range s.Shapes[1].Columns {
		if c.Name == "updated" {
			continue
		}
		c.NotNull = c.Name == "host_row_id" || c.Name == "language_code"
		child.Columns = append(child.Columns, c)
	}
	child.Unique, child.ForeignKeys = [][]string{{"host_row_id", "language_code"}}, s.Shapes[1].ForeignKeys
	s.Shapes[1] = child
	s.Registrations[1].Kind, s.Registrations[1].Version = Embeddings, 1
	s.Registrations[1].Configuration = Configuration{VectorModel: "fixture-model", VectorDimensions: 768}
	if c := Resolve(s, 2); !c.Conforming || c.Chat || c.Map || c.SemanticSearch {
		t.Fatalf("canonical embedding storage: %+v", c)
	}
	locations := ordinaryShape(s.Shapes[2].Name)
	locations.Columns = append(locations.Columns, s.Shapes[2].Columns[0], Column{Name: "title", Type: "jsonb"}, Column{Name: "address", Type: "text"})
	s.Shapes[2] = locations
	s.Registrations[2].Kind, s.Registrations[2].Version = Locations, 1
	if c := Resolve(s, 3); !c.Conforming || !c.Map {
		t.Fatalf("fresh empty locations: %+v", c)
	}
}

func TestKindInlineVectorsCoordinatePairsAndGeometryChildren(t *testing.T) {
	s := fixtureSnapshot()
	s.Registrations[0].MultilingualEmbeddings = false
	s.Shapes[0].Columns = append(s.Shapes[0].Columns, Column{Name: "embedding_vector", Type: "vector", SQLType: "vector(768)"})
	if c := Resolve(s, 1); !c.InlineEmbeddings || c.ChildEmbeddings || !c.SemanticSearch {
		t.Fatal(c)
	}
	s.Shapes[2].Columns = []Column{{Name: "lat", Type: "float8"}, {Name: "lng", Type: "numeric"}, {Name: "parent_id", Type: "int8"}}
	s.Shapes[2].ForeignKeys = []ForeignKey{{Columns: []string{"parent_id"}, Target: s.Shapes[0].Name, TargetColumns: []string{"id"}}}
	if c := Resolve(s, 1); !c.Map {
		t.Fatalf("legacy child location: %+v", c)
	}
	if c := Resolve(s, 3); c.Kind != Locations || !c.Map {
		t.Fatalf("legacy coordinate pair: %+v", c)
	}
	s.Shapes[2].Columns[0].Type = "text"
	if c := Resolve(s, 3); c.Map || c.Kind != Ordinary {
		t.Fatalf("untyped coordinate labels: %+v", c)
	}
	s.Shapes[2].Columns = []Column{{Name: "position", Type: "geometry", SQLType: "geometry(Polygon,4326)"}}
	if c := Resolve(s, 3); c.Map {
		t.Fatalf("unsupported polygon: %+v", c)
	}
	s.Shapes[2].Columns[0].SQLType = "geometry(Point,3857)"
	if c := Resolve(s, 3); c.Map {
		t.Fatalf("wrong SRID: %+v", c)
	}
}

func TestKindCanonicalDriftAndTypedRelationshipRefusal(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(*Snapshot)
	}{
		{"primary key", func(s *Snapshot) { s.Shapes[0].PrimaryKey = nil }},
		{"null timestamp", func(s *Snapshot) { s.Shapes[0].Columns[1].NotNull = false }},
		{"timestamp type", func(s *Snapshot) { s.Shapes[0].Columns[2].Type = "timestamp" }},
		{"timestamp default", func(s *Snapshot) { s.Shapes[0].Columns[2].Default = "NULL" }},
		{"disabled update trigger", func(s *Snapshot) { s.Shapes[0].UpdateTriggers = nil }},
		{"actor fk", func(s *Snapshot) { s.Shapes[0].ForeignKeys = nil }},
		{"missing table", func(s *Snapshot) { s.Shapes = s.Shapes[1:] }},
		{"unknown version", func(s *Snapshot) { s.Registrations[0].Version = 7 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := fixtureSnapshot()
			s.Registrations[0].Version = 1
			test.mutate(&s)
			c := Resolve(s, 1)
			if c.Conforming || c.Chat || c.Map || c.SemanticSearch || !slices.Contains(c.Views, "table") || len(c.Issues) == 0 {
				t.Fatal(c)
			}
		})
	}
	for _, test := range []struct {
		name   string
		mutate func(*Snapshot)
	}{
		{"type mismatch", func(s *Snapshot) { s.Shapes[1].Columns[0].Type = "text" }},
		{"missing fk", func(s *Snapshot) { s.Shapes[1].ForeignKeys = nil }},
		{"wrong host column", func(s *Snapshot) { s.Registrations[0].Configuration.Embeddings.HostColumn = "created" }},
		{"wrong uid", func(s *Snapshot) { s.Registrations[0].Configuration.Embeddings.TableUID = 999 }},
		{"model mismatch", func(s *Snapshot) { s.Shapes[1].Columns[2].SQLType = "vector(384)" }},
		{"missing model", func(s *Snapshot) { s.Registrations[0].Configuration.VectorModel = "" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			s := fixtureSnapshot()
			s.Registrations[0].Version = 1
			s.Registrations[0].Configuration = Configuration{Embeddings: &Relation{TableUID: 2, HostColumn: "id", RowColumn: "host_row_id", ValueColumn: "embedding"}, VectorModel: "fixture", VectorDimensions: 768}
			test.mutate(&s)
			c := Resolve(s, 1)
			if c.Conforming || c.SemanticSearch || c.ChildEmbeddings {
				t.Fatal(c)
			}
		})
	}
}

func chatSnapshot() Snapshot {
	s := fixtureSnapshot()
	users := Shape{Name: "public.system_users", PrimaryKey: []string{"id"}, Columns: []Column{{Name: "id", Type: "int4", NotNull: true}}}
	participants := baseShape("public.system_chat_participants")
	registry := Shape{Name: "public.system_db_tables", Unique: [][]string{{"table_uid"}}, Columns: []Column{{Name: "table_uid", Type: "int4", NotNull: true}}}
	s.Shapes = append(s.Shapes, users, participants, registry)
	for i, kind := range []string{ChatSettings, ChatMessages} {
		uid := int64(i + 4)
		reg := Registration{UID: uid, Name: "public.system_" + kind, Kind: kind, Version: 1}
		shape := baseShape(reg.Name)
		references := map[string]string{"message_table_uid": registry.Name, "created_by": users.Name}
		if kind == ChatSettings {
			shape.Columns = append(shape.Columns, Column{Name: "title", Type: "text", NotNull: true}, Column{Name: "message_table_uid", Type: "int4", NotNull: true},
				Column{Name: "mode", Type: "text", NotNull: true}, Column{Name: "created_by", Type: "int4", NotNull: true}, Column{Name: "archived", Type: "bool", NotNull: true},
				Column{Name: "revision", Type: "int8", NotNull: true}, Column{Name: "configuration", Type: "jsonb", NotNull: true})
		} else {
			shape.Columns = append(shape.Columns, Column{Name: "chat_id", Type: "int8", NotNull: true}, Column{Name: "sequence", Type: "int8", NotNull: true},
				Column{Name: "sender_participant_id", Type: "int8", NotNull: true}, Column{Name: "sender_name", Type: "text", NotNull: true}, Column{Name: "kind", Type: "text", NotNull: true},
				Column{Name: "body", Type: "text", NotNull: true}, Column{Name: "payload", Type: "jsonb", NotNull: true}, Column{Name: "payload_version", Type: "int4", NotNull: true},
				Column{Name: "client_request_id", Type: "uuid", NotNull: true}, Column{Name: "reply_to_id", Type: "int8"}, Column{Name: "answer_to_id", Type: "int8"}, Column{Name: "supersedes_id", Type: "int8"})
			shape.Unique = [][]string{{"chat_id", "sequence"}, {"chat_id", "sender_participant_id", "client_request_id"}}
			references = map[string]string{"chat_id": "public.system_chat_settings", "sender_participant_id": participants.Name, "reply_to_id": reg.Name, "answer_to_id": reg.Name, "supersedes_id": reg.Name}
		}
		for col, target := range references {
			key := "id"
			if target == registry.Name {
				key = "table_uid"
			}
			shape.ForeignKeys = append(shape.ForeignKeys, ForeignKey{Columns: []string{col}, Target: target, TargetColumns: []string{key}, OnDelete: "a"})
		}
		s.Registrations = append(s.Registrations, reg)
		s.Shapes = append(s.Shapes, shape)
	}
	return s
}

func TestKindChatRequiresExplicitIntentAndCompleteContract(t *testing.T) {
	s := chatSnapshot()
	if c := Resolve(s, 4); !c.Conforming || c.Chat || !c.AdminOnly {
		t.Fatal(c)
	}
	if c := Resolve(s, 5); !c.Conforming || !c.Chat || !c.AdminOnly || !c.ParticipantOnly || c.Map || c.SemanticSearch {
		t.Fatal(c)
	}
	before, _ := json.Marshal(s)
	for _, reg := range s.Registrations {
		Resolve(s, reg.UID)
	}
	after, _ := json.Marshal(s)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("classification mutated registry/schema")
	}
	s.Registrations[len(s.Registrations)-1].Kind, s.Registrations[len(s.Registrations)-1].Version = Ordinary, 0
	if c := Resolve(s, 5); c.Chat || c.Kind != Ordinary {
		t.Fatalf("chat-like name/schema must not grant chat: %+v", c)
	}
	s.Registrations[len(s.Registrations)-1].Kind, s.Registrations[len(s.Registrations)-1].Version = ChatMessages, 1
	s.Shapes[len(s.Shapes)-1].Unique = nil
	if c := Resolve(s, 5); c.Conforming || c.Chat {
		t.Fatalf("missing sequencing/idempotency uniqueness: %+v", c)
	}
	s.Shapes[len(s.Shapes)-1].Unique = [][]string{{"chat_id", "sequence"}, {"chat_id", "sender_participant_id", "client_request_id"}}
	s.Shapes[len(s.Shapes)-1].ForeignKeys = nil
	if c := Resolve(s, 5); c.Conforming || c.Chat {
		t.Fatalf("missing chat references: %+v", c)
	}
}

func TestKindCapabilityCacheDetectsDriftMetadataChangesAndInvalidation(t *testing.T) {
	s := fixtureSnapshot()
	var cache Cache
	if !cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("legacy child missing")
	}
	c := cache.Resolve(s, 3)
	c.Views[0] = "chat"
	if cache.Resolve(s, 3).Views[0] == "chat" {
		t.Fatal("caller mutated cached capabilities")
	}
	s.Shapes[1].ForeignKeys = nil
	if cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("child drift stayed cached")
	}
	s = fixtureSnapshot()
	cache.Resolve(s, 1)
	s.Registrations[0].MultilingualEmbeddings = false
	if cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("registry drift stayed cached")
	}
	s = fixtureSnapshot()
	cache.Resolve(s, 1)
	cache.Invalidate()
	if cache.values != nil {
		t.Fatal("explicit invalidation must clear all dependent UIDs")
	}
	if !cache.Resolve(s, 1).ChildEmbeddings {
		t.Fatal("cache did not refill")
	}
	s.Registrations[0].Name = "public.renamed"
	if cache.Resolve(s, 1).Conforming {
		t.Fatal("rename/missing table retained stale contract")
	}
	capabilityCache.Resolve(fixtureSnapshot(), 1)
	InvalidateAll()
	if capabilityCache.values != nil {
		t.Fatal("shared invalidation did not clear cache")
	}
}
