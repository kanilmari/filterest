// Runs the existing insert dependency through its policy and real narrow grants.
package runtime_grants

import (
	"strings"
	"testing"

	"easelect/backend/core_components/media_utils"
	"github.com/lib/pq"
)

func imageUploadSnapshot(t *testing.T) GrantSnapshot {
	t.Helper()
	return reviewDependencySnapshot(t, func(s *GrantSnapshot) {
		s.Rights = []Right{{2, 2, 3}}
		object := s.Objects[12]
		object.Columns = append(object.Columns, Column{Name: "metadata_json"})
		s.Objects[12] = object
	}, nil, nil)
}

func TestUploadOnlyDimensionsGrantIsNarrowAndFollowsConsumer(t *testing.T) {
	s := imageUploadSnapshot(t)
	grants := grantsFor(t, s)
	for _, column := range []string{"filename", "metadata_json"} {
		if !containsGrant(grants, "basic", 12, column, "UPDATE") {
			t.Fatal("upload dependency missing", column)
		}
	}
	if containsGrant(grants, "basic", 12, "", "UPDATE") || containsGrant(grants, "basic", 12, "parent_id", "UPDATE") || containsGrant(grants, "guest", 12, "metadata_json", "UPDATE") {
		t.Fatal("upload right widened")
	}
	s.Rights = []Right{{2, 1, 3}}
	grants = grantsFor(t, s)
	if containsGrant(grants, "basic", 12, "metadata_json", "UPDATE") || containsGrant(grants, "basic", 12, "filename", "UPDATE") {
		t.Fatal("dependency survived removal of upload right")
	}
}

func TestUploadOnlyDimensionsGrantExecutesPostgres(t *testing.T) {
	owner, connect := grantDisposableDB(t)
	fixtureExec(t, owner, `CREATE ROLE dimensions_uploader LOGIN;
 CREATE TABLE fresh_bridge(id integer PRIMARY KEY, filename text, parent_id integer, metadata_json jsonb);
 INSERT INTO fresh_bridge VALUES(1,NULL,4,'{"caption":"keep"}');
 GRANT USAGE ON SCHEMA public TO dimensions_uploader`)
	s := imageUploadSnapshot(t)
	grants := grantsFor(t, s)
	for _, grant := range grants {
		if grant.Role != "basic" || grant.ObjectOID != 12 {
			continue
		}
		privilege := grant.Privilege
		if grant.Column != "" {
			privilege += " (" + pq.QuoteIdentifier(grant.Column) + ")"
		}
		fixtureExec(t, owner, "GRANT "+privilege+" ON TABLE fresh_bridge TO dimensions_uploader")
	}
	db := connect("dimensions_uploader")
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE fresh_bridge SET filename='saved.png' WHERE id=1`); err != nil {
		t.Fatal(err)
	}
	if err := media_utils.MergeUploadedImageSize(tx, "fresh_bridge", 1, &media_utils.DisplayedImageSize{WidthPx: 7, HeightPx: 4, File: "saved.png"}); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var sized bool
	if err := owner.QueryRow(`SELECT metadata_json->'displayed_image_size'->>'file'='saved.png' AND metadata_json->>'caption'='keep' FROM fresh_bridge WHERE id=1`).Scan(&sized); err != nil || !sized {
		t.Fatal("upload-only role did not save dimensions", err)
	}
	if _, err := db.Exec(`UPDATE fresh_bridge SET parent_id=9 WHERE id=1`); err == nil || !strings.Contains(err.Error(), "permission denied") {
		t.Fatal("other UPDATE right widened", err)
	}
}
