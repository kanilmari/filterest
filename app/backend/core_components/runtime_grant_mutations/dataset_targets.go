// dataset_targets.go
// Captures the datasets named by dedicated schema and configuration requests.
// Connects request names to the pre-mutation stable identities in the policy.
// Retains deleted and renamed targets without widening scope to every registry row.
package runtime_grant_mutations

// IncludeTables records existing named datasets before their physical identity changes.
func (m *Mutation) IncludeTables(names ...string) {
	for _, name := range names {
		for _, object := range m.before.Objects {
			if object.Schema == "public" && object.Name == name && object.DatasetUID > 0 {
				m.targets = append(m.targets, object.DatasetUID)
			}
		}
	}
}
