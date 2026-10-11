// dataset_kind_cost_postgres_test.go
// Proves cold catalogue work remains local and warm evidence follows cache TTL.
// Connects warm classification to returned evidence size in disposable PostgreSQL.
// Detects installation-wide gathering and hashing without relying on timing noise.
package system_table_tools

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"easelect/backend/core_components/dataset_kinds"
	read "easelect/backend/core_components/dynamic_table_tools/dtt_1_row_crud/dtt_1_row_read"
)

func TestDatasetKindPostgresScopedEvidenceIgnoresUnrelatedCatalogues(t *testing.T) {
	db := frontPageDisposableDB(t)
	frontPageExec(t, db, `CREATE TABLE kind_scoped_host(id bigint PRIMARY KEY);
 CREATE TABLE kind_scoped_vectors(host_row_id bigint REFERENCES kind_scoped_host(id),
  language_code text,embedding vector,updated timestamp,content_md5 text);
 INSERT INTO system_db_tables(table_name,schema_name,folder_id,multi_lang_embeddings)
 VALUES('kind_scoped_host','public',1,true),('kind_scoped_vectors','public',1,false);`)
	var uid int64
	if err := db.QueryRow(`SELECT table_uid FROM system_db_tables WHERE table_name='kind_scoped_host'`).Scan(&uid); err != nil {
		t.Fatal(err)
	}
	before, err := dataset_kinds.ReadSnapshot(context.Background(), db, uid)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Registrations) != 2 || len(before.Shapes) != 2 {
		t.Fatal("scoped host read unrelated catalogue evidence", len(before.Registrations), len(before.Shapes))
	}
	if c := kindRead(t, db, "kind_scoped_host"); !c.ChildEmbeddings {
		t.Fatal(c)
	}
	frontPageExec(t, db, `DO $$ BEGIN FOR n IN 1..200 LOOP
 EXECUTE format('CREATE TABLE kind_unrelated_%s(id bigint PRIMARY KEY,value text)',n);
 INSERT INTO system_db_tables(table_name,schema_name,folder_id)
 VALUES('kind_unrelated_'||n,'public',1);
 END LOOP; END $$;`)
	// Dataset creation invalidates all kind evidence after commit. Force a cold
	// read here so bounded evidence is proved against the expanded catalogue.
	read.InvalidateSchemaCache("kind_unrelated_1")
	for warm := 0; warm < 2; warm++ {
		after, err := dataset_kinds.ReadSnapshot(context.Background(), db, uid)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before.Registrations, after.Registrations) || !reflect.DeepEqual(before.Shapes, after.Shapes) {
			t.Fatal("unrelated datasets changed per-request evidence")
		}
		raw, _ := json.Marshal(after)
		t.Logf("warm request: %d registrations, %d shapes, %d evidence bytes with 200 unrelated tables", len(after.Registrations), len(after.Shapes), len(raw))
		if c := kindRead(t, db, "kind_scoped_host"); !c.ChildEmbeddings {
			t.Fatal("warm classification changed", c)
		}
	}
	// External DDL remains warm within TTL; application FK changes invalidate
	// after commit through the shared mutation completion boundary.
	frontPageExec(t, db, `ALTER TABLE kind_scoped_vectors DROP CONSTRAINT kind_scoped_vectors_host_row_id_fkey`)
	if c := kindRead(t, db, "kind_scoped_host"); !c.ChildEmbeddings {
		t.Fatal("external DDL bypassed the evidence TTL", c)
	}
	kindAppSchemaChange(t, db, "kind_scoped_vectors", `ALTER TABLE kind_scoped_vectors
 ADD CONSTRAINT kind_scoped_vectors_host_row_id_fkey FOREIGN KEY(host_row_id) REFERENCES kind_scoped_host(id);
 ALTER TABLE kind_scoped_vectors DROP CONSTRAINT kind_scoped_vectors_host_row_id_fkey`)
	if c := kindRead(t, db, "kind_scoped_host"); c.ChildEmbeddings {
		t.Fatal("committed child invalidation left drift cached", c)
	}
}
