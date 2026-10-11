// dataset_kind_upgrade_proof_test.go
// Compares complete application schema contracts after a real release upgrade.
// Connects the 9.3.23 bootstrap ledger, production migration runner and fresh install.
// Runs only inside the opt-in disposable cluster; never uses installation credentials.
package system_table_tools

import (
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"testing"
)

func kindProofDatabase(t *testing.T, cluster *sql.DB, name string) *sql.DB {
	t.Helper()
	var socket, port string
	if err := cluster.QueryRow(`SELECT current_setting('unix_socket_directories'),current_setting('port')`).Scan(&socket, &port); err != nil {
		t.Fatal(err)
	}
	frontPageExec(t, cluster, `CREATE DATABASE `+name)
	db, err := sql.Open("postgres", fmt.Sprintf("host=%s port=%s user=fixture_owner dbname=%s sslmode=disable", socket, port, name))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

func kindImportBootstrap(t *testing.T, db *sql.DB, previous bool) {
	t.Helper()
	for _, name := range []string{"schema.sql", "seed_data.sql"} {
		var raw []byte
		var err error
		if previous {
			raw, err = exec.Command("git", "show", "v9.3.23:app/server_tools/public_bootstrap/"+name).Output()
		} else {
			raw, err = os.ReadFile(filepath.Join("..", "..", "..", "server_tools", "public_bootstrap", name))
		}
		if err != nil {
			t.Fatal(err)
		}
		frontPageExec(t, db, string(raw))
	}
}

// Compare all non-extension relations and functions in both application schemas.
// Catalogue OIDs and sequence counters differ between installs and are not schema.
// Compare columns by name; upgrade ADD COLUMN placement is informational here.
// Preserve physical order separately, without claiming presentation-order parity.
const kindSchemaContractQuery = `
WITH relations AS (
 SELECT c.oid,c.relkind,n.nspname||'.'||c.relname AS name
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','restricted') AND c.relkind IN ('r','p','v','m','S')
 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass
   AND d.objid=c.oid AND d.deptype='e')
)
SELECT 'relation:'||r.name,jsonb_build_object(
 'kind',r.relkind,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),
   'not_null',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
   'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY a.attname)
   FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
   WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(pg_get_constraintdef(k.oid) ORDER BY pg_get_constraintdef(k.oid))
   FROM pg_constraint k WHERE k.conrelid=r.oid),
 'indexes',(SELECT jsonb_agg(pg_get_indexdef(i.indexrelid) ORDER BY pg_get_indexdef(i.indexrelid))
   FROM pg_index i WHERE i.indrelid=r.oid),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
   ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid=r.oid AND NOT t.tgisinternal),
 'view',CASE WHEN r.relkind IN ('v','m') THEN pg_get_viewdef(r.oid) END,
 'sequence',(SELECT jsonb_build_object('type',format_type(s.seqtypid,NULL),'start',s.seqstart,
   'increment',s.seqincrement,'max',s.seqmax,'min',s.seqmin,'cache',s.seqcache,'cycle',s.seqcycle)
   FROM pg_sequence s WHERE s.seqrelid=r.oid))::text,
 (SELECT jsonb_agg(a.attname ORDER BY a.attnum)::text FROM pg_attribute a
   WHERE a.attrelid=r.oid AND a.attnum>0 AND NOT a.attisdropped)
FROM relations r
UNION ALL
SELECT 'function:'||n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
 to_jsonb(pg_get_functiondef(p.oid))::text,NULL::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','restricted') AND p.prokind IN ('f','p')
 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass
   AND d.objid=p.oid AND d.deptype='e')`

func assertKindSchemaParity(t *testing.T, fresh, upgraded *sql.DB) {
	t.Helper()
	read := func(db *sql.DB) (map[string]string, map[string]string) {
		result := map[string]string{}
		columnOrders := map[string]string{}
		rows, err := db.Query(kindSchemaContractQuery)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		for rows.Next() {
			var name, contract string
			var columnOrder sql.NullString
			if err := rows.Scan(&name, &contract, &columnOrder); err != nil {
				t.Fatal(err)
			}
			result[name] = contract
			if columnOrder.Valid {
				columnOrders[name] = columnOrder.String
			}
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return result, columnOrders
	}
	want, freshOrders := read(fresh)
	got, upgradedOrders := read(upgraded)
	for name, order := range freshOrders {
		if upgradedOrder, found := upgradedOrders[name]; found && order != upgradedOrder {
			t.Logf("physical column order differs for %s (informational)\nfresh order: %s\nupgraded order: %s", name, order, upgradedOrder)
		}
	}
	if reflect.DeepEqual(want, got) {
		return
	}
	for name, contract := range want {
		if got[name] != contract {
			t.Errorf("fresh/upgraded schema differs for %s\nfresh: %s\nupgraded: %s", name, contract, got[name])
		}
	}
	for name := range got {
		if _, found := want[name]; !found {
			t.Errorf("upgrade-only schema object: %s", name)
		}
	}
}
