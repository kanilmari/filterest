// kind_contract_validator.go
// Validates canonical shapes and explicit version-zero compatibility contracts.
// Drift removes specialized capabilities while generic browsing remains available.
package dataset_kinds

import (
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// Version one recognizes the protocol's simple, unconditional setter. A
// conditional/commented assignment is insufficient evidence of maintenance.
var updatedAssignment = regexp.MustCompile(`(?is)\bbegin\s+new\s*\.\s*updated\s*(?::=|=)\s*(?:now\s*\(\s*\)|current_timestamp|transaction_timestamp\s*\(\s*\)|clock_timestamp\s*\(\s*\))\s*;\s*return\s+new\s*;\s*end\s*;?\s*(?:\$[a-z_]*\$|$)`)

func columns(shape Shape) map[string]Column {
	result := make(map[string]Column, len(shape.Columns))
	for _, c := range shape.Columns {
		result[c.Name] = c
	}
	return result
}

func hasKey(keys [][]string, key []string) bool {
	for _, found := range keys {
		if len(found) == len(key) {
			all := true
			for _, c := range key {
				all = all && slices.Contains(found, c)
			}
			if all {
				return true
			}
		}
	}
	return false
}

func generated(c Column) bool { return c.Identity != "" || strings.Contains(c.Default, "nextval(") }
func timestampDefault(c Column) bool {
	d := strings.ToLower(strings.TrimSpace(c.Default))
	return d == "now()" || d == "current_timestamp" || d == "transaction_timestamp()"
}

func validateContract(reg Registration, shape Shape, spec contract, snapshot Snapshot) []string {
	issues := []string{}
	if reg.Configuration.Invalid {
		issues = append(issues, "kind_config")
	}
	cols := columns(shape)
	for name, types := range spec.Columns {
		if c, ok := cols[name]; !ok || !slices.Contains(types, c.Type) {
			issues = append(issues, "column:"+name)
		}
	}
	for _, name := range spec.Required {
		if !cols[name].NotNull {
			issues = append(issues, "not_null:"+name)
		}
	}
	for _, key := range spec.Unique {
		if !hasKey(append([][]string{shape.PrimaryKey}, shape.Unique...), key) {
			issues = append(issues, "unique:"+strings.Join(key, ","))
		}
	}
	for column, target := range spec.References {
		valid := false
		for _, fk := range shape.ForeignKeys {
			if !slices.Equal(fk.Columns, []string{column}) {
				continue
			}
			// Messages/settings retain their references; deleting a related row
			// must never cascade into deleting retained conversation history.
			if fk.OnDelete != "a" && fk.OnDelete != "r" {
				continue
			}
			parent, exists := snapshot.shape(fk.Target)
			if !exists || !typedReference(shape, parent, fk) {
				continue
			}
			if target == "self" {
				valid = fk.Target == shape.Name
			} else if target == ChatSettings {
				for _, r := range snapshot.Registrations {
					valid = valid || (r.Name == parent.Name && r.Kind == target && r.Version == 1 && len(validateContract(r, parent, catalogue[ChatSettings][1], snapshot)) == 0)
				}
			} else {
				valid = fk.Target == target
			}
			if valid {
				break
			}
		}
		if !valid {
			issues = append(issues, "foreign_key:"+column)
		}
	}
	if spec.Standard {
		id := cols["id"]
		if !slices.Equal(shape.PrimaryKey, []string{"id"}) || !id.NotNull || !slices.Contains([]string{"int4", "int8"}, id.Type) || !generated(id) {
			issues = append(issues, "generated_primary_key:id")
		}
		if spec.BigIdentity && (id.Type != "int8" || id.Identity == "") {
			issues = append(issues, "bigint_identity:id")
		}
		for _, name := range []string{"created", "updated"} {
			c := cols[name]
			if c.Type != "timestamptz" || !c.NotNull || !timestampDefault(c) {
				issues = append(issues, "timestamp:"+name)
			}
		}
		maintained := false
		for _, source := range shape.UpdateTriggers {
			maintained = maintained || updatedAssignment.MatchString(source)
		}
		if !maintained {
			issues = append(issues, "updated_trigger")
		}
	}
	if spec.Actors {
		for _, name := range []string{"created_by", "owner_id"} {
			valid := false
			for _, fk := range shape.ForeignKeys {
				valid = valid || (slices.Equal(fk.Columns, []string{name}) && fk.Target == "public.system_users" && slices.Equal(fk.TargetColumns, []string{"id"}) && fk.OnDelete == "n" && !cols[name].NotNull && slices.Contains([]string{"int4", "int8"}, cols[name].Type))
			}
			if !valid {
				issues = append(issues, "actor_reference:"+name)
			}
		}
	}
	switch reg.Kind {
	case Embeddings:
		if !embeddingHost(shape, snapshot) {
			issues = append(issues, "embedding_host_reference")
		}
		if reg.Version == 1 {
			if !embeddingHostCascade(shape) {
				issues = append(issues, "embedding_host_cascade")
			}
			if reg.Configuration.VectorModel == "" || reg.Configuration.VectorDimensions <= 0 || !vectorDimension(cols["embedding"], reg.Configuration.VectorDimensions) {
				issues = append(issues, "vector_model_dimensions")
			}
		}
	case Locations:
		if reg.Version == 1 {
			if !pointColumn(cols["position"]) || cols["position"].NotNull {
				issues = append(issues, "nullable_wgs84_point:position")
			}
		} else if !locationShape(shape) {
			issues = append(issues, "location_shape")
		}
	}
	slices.Sort(issues)
	return issues
}

func vectorDimension(c Column, n int) bool {
	// An unconstrained legacy vector accepts any configured model dimension.
	return c.Type == "vector" && (c.SQLType == "vector" || strings.HasSuffix(c.SQLType, ".vector") || strings.HasSuffix(c.SQLType, fmt.Sprintf("vector(%d)", n)))
}

func pointColumn(c Column) bool {
	t := strings.ToLower(strings.ReplaceAll(c.SQLType, " ", ""))
	return c.Type == "geometry" && strings.HasSuffix(t, "geometry(point,4326)")
}

func locationShape(shape Shape) bool {
	cols := columns(shape)
	for _, c := range cols {
		if pointColumn(c) {
			return true
		}
	}
	// Keep the browser's historical coordinate-pair aliases; unlike row-based
	// detection, typed schema evidence also works when there are no records.
	for _, pair := range [][2]string{{"latitude", "longitude"}, {"lat", "lng"}, {"lat", "lon"}, {"y", "x"}, {"latitude", "lon"}, {"latitude", "lng"}, {"lat", "longitude"}} {
		if numeric(cols[pair[0]]) && numeric(cols[pair[1]]) {
			return true
		}
	}
	return false
}

func numeric(c Column) bool {
	return slices.Contains([]string{"int2", "int4", "int8", "float4", "float8", "numeric"}, c.Type)
}

func embeddingHost(shape Shape, snapshot Snapshot) bool {
	for _, fk := range shape.ForeignKeys {
		if !slices.Equal(fk.Columns, []string{"host_row_id"}) || len(fk.TargetColumns) != 1 {
			continue
		}
		host, ok := snapshot.shape(fk.Target)
		if !ok {
			continue
		}
		if typedReference(shape, host, fk) {
			return true
		}
	}
	return false
}

func embeddingHostCascade(shape Shape) bool {
	for _, fk := range shape.ForeignKeys {
		if slices.Equal(fk.Columns, []string{"host_row_id"}) && fk.OnDelete == "c" {
			return true
		}
	}
	return false
}

func typedReference(child, host Shape, fk ForeignKey) bool {
	if len(fk.Columns) != 1 || len(fk.TargetColumns) != 1 {
		return false
	}
	a, b := columns(child)[fk.Columns[0]], columns(host)[fk.TargetColumns[0]]
	return a.Type != "" && a.Type == b.Type && hasKey(append([][]string{host.PrimaryKey}, host.Unique...), fk.TargetColumns)
}
