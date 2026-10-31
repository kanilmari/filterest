// image_dimensions_postgres_test.go
// Proves backfill guards, accounting and schema ownership on real PostgreSQL.
// Connects discovery and qualified SQL to an opted-in disposable cluster.
// Leaves no application data, persistent repair record or test dataset behind.
package missing_media_check

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/dbutils"
	"easelect/backend/core_components/media_utils"
	"easelect/backend/core_components/runtimepaths"
)

func dimensionDataset(t *testing.T, db *sql.DB, root string, rows int) {
	t.Helper()
	addMediaDataset(t, db, 117, "pictures", rows, "public", "filename")
	mediaCheckExec(t, db, `ALTER TABLE pictures_assets ADD COLUMN metadata_json jsonb`)
	for i := 1; i <= rows; i++ {
		dimensionPNG(t, root, fmt.Sprintf("117/%d/1000/117_%d_%d.jpg", i, i, i))
	}
}

func dimensionRun(t *testing.T, db *sql.DB, root string, dry bool, maxRows int) ImageDimensionsCounts {
	t.Helper()
	return runImageDimensionsBackfill(context.Background(), db, root, dbutils.NewRequestActorContext(2, "admin"), imageDimensionsRequest{DryRun: dry, MaxRows: maxRows})
}

func TestImageDimensionsDryRunDefaultIdempotenceAndFilenameGuardPostgres(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	root := t.TempDir()
	dimensionDataset(t, db, root, 1)
	mediaCheckExec(t, db, `UPDATE pictures_assets SET metadata_json='{"caption":"keep","image_source":{"url":"keep"},"recovered_from":"cached_image","logo":true}'`)
	var before string
	if err := db.QueryRow(`SELECT xmin::text FROM pictures_assets WHERE id=1`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	originalDB, originalPaths := backend.Db, runtimepaths.Current()
	backend.Db = db
	paths, err := runtimepaths.Resolve(t.TempDir(), t.TempDir(), true)
	if err != nil {
		t.Fatal(err)
	}
	paths.StorageRoot = root
	if err := runtimepaths.Configure(paths); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { backend.Db = originalDB; _ = runtimepaths.Configure(originalPaths) })
	request := httptest.NewRequest(http.MethodPost, "/api/admin/image-dimensions-backfill", strings.NewReader(`{}`))
	request = request.WithContext(dbutils.SetRequestActorContext(request.Context(), dbutils.NewRequestActorContext(2, "admin")))
	response := httptest.NewRecorder()
	AdminImageDimensionsBackfillHandler(response, request)
	var dry ImageDimensionsCounts
	if err := json.Unmarshal(response.Body.Bytes(), &dry); err != nil {
		t.Fatal(err)
	}
	if response.Code != 200 || dry.Written != 0 || dry.WouldWrite != 1 || dry.Galleries != 1 {
		t.Fatalf("dry run: %+v", dry)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body) != 13 {
		t.Fatalf("unexpected response fields: %d", len(body))
	}
	for _, value := range body {
		if _, ok := value.(float64); !ok {
			t.Fatal("response contains a value other than a count")
		}
	}
	if strings.Contains(response.Body.String(), "117_1_1") || strings.Contains(response.Body.String(), "caption") {
		t.Fatal("response disclosed row data")
	}
	var afterDry string
	if err := db.QueryRow(`SELECT xmin::text FROM pictures_assets WHERE id=1`).Scan(&afterDry); err != nil {
		t.Fatal(err)
	}
	if before != afterDry {
		t.Fatal("dry run changed xmin")
	}
	first := dimensionRun(t, db, root, false, 200)
	if first.Written != 1 || first.Failed != 0 {
		t.Fatalf("first pass: %+v", first)
	}
	var sizedXmin string
	var kept bool
	if err := db.QueryRow(`SELECT xmin::text, metadata_json-'displayed_image_size'='{"caption":"keep","image_source":{"url":"keep"},"recovered_from":"cached_image","logo":true}'::jsonb FROM pictures_assets WHERE id=1`).Scan(&sizedXmin, &kept); err != nil || !kept {
		t.Fatal("merge changed other keys", err)
	}
	second := dimensionRun(t, db, root, false, 200)
	if second.Written != 0 || second.WouldWrite != 0 || second.AlreadySized != 1 {
		t.Fatalf("second: %+v", second)
	}
	var repeatedXmin string
	if err := db.QueryRow(`SELECT xmin::text FROM pictures_assets WHERE id=1`).Scan(&repeatedXmin); err != nil {
		t.Fatal(err)
	}
	if sizedXmin != repeatedXmin {
		t.Fatal("idempotent pass touched xmin")
	}
	targets, _, err := dimensionGalleries(readOnlyQuerier{ctx: context.Background(), database: db})
	if err != nil {
		t.Fatal(err)
	}
	write := dimensionWrite{target: targets[0], id: 1, reference: "117_1_1.jpg", patch: media_utils.ImageSizePatch(&media_utils.DisplayedImageSize{WidthPx: 9, HeightPx: 5, File: "117_1_1.jpg"})}
	mediaCheckExec(t, db, `UPDATE pictures_assets SET filename='changed.png' WHERE id=1`)
	if written, err := commitDimensionBatch(context.Background(), db, dbutils.NewRequestActorContext(2, "admin"), []dimensionWrite{write}); err != nil || written != 0 {
		t.Fatal("stale filename was updated", written, err)
	}
}

func TestImageDimensionsMaxRowsActorAndCommittedBatchesPostgres(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	root := t.TempDir()
	dimensionDataset(t, db, root, 205)
	mediaCheckExec(t, db, `CREATE FUNCTION require_dimension_actor() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('app.user_id',true) IS DISTINCT FROM '2' OR current_setting('app.user_role',true) IS DISTINCT FROM 'admin' OR current_setting('app.is_admin',true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'actor missing'; END IF;
 RETURN NEW; END $$;
 CREATE TRIGGER dimension_actor BEFORE UPDATE ON pictures_assets FOR EACH ROW EXECUTE FUNCTION require_dimension_actor()`)
	first := dimensionRun(t, db, root, false, 200)
	if first.Written != 200 || first.WouldWrite != 200 || first.Failed != 0 {
		t.Fatalf("max_rows: %+v", first)
	}
	second := dimensionRun(t, db, root, false, 200)
	if second.Written != 5 || second.AlreadySized != 200 {
		t.Fatalf("next call did not advance: %+v", second)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	canceled := runImageDimensionsBackfill(ctx, db, root, dbutils.NewRequestActorContext(2, "admin"), imageDimensionsRequest{MaxRows: 200})
	if canceled.Written != 0 || canceled.Failed != 0 {
		t.Fatalf("canceled: %+v", canceled)
	}
}

func TestImageDimensionsSkippedTablesAndStructuralDiscoveryPostgres(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	root := t.TempDir()
	addMediaDataset(t, db, 10, "no_metadata", 1, "public", "filename")
	addMediaDataset(t, db, 20, "not_jsonb", 1, "public", "filename")
	mediaCheckExec(t, db, `ALTER TABLE not_jsonb_assets ADD COLUMN metadata_json json`)
	addMediaDataset(t, db, 30, "row_skips", 4, "public", "filename")
	mediaCheckExec(t, db, `ALTER TABLE row_skips_assets ADD COLUMN metadata_json jsonb;
 UPDATE row_skips_assets SET metadata_json='[]' WHERE id=1;
 UPDATE row_skips_assets SET filename='{"fi":"photo.png"}' WHERE id=2;
 UPDATE row_skips_assets SET filename='' WHERE id=3`)
	// This gallery has a plain FK definition and no upload configuration.
	mediaCheckExec(t, db, `CREATE TABLE structural(id bigint PRIMARY KEY);
 CREATE TABLE structural_assets(id serial PRIMARY KEY, structural_id bigint, filename text, asset_kind text, metadata_json jsonb);
 INSERT INTO system_db_tables VALUES(40,'structural','public'),(41,'structural_assets','public');
 INSERT INTO system_foreign_key_relations_1_m VALUES(40,41,40,'structural_id','{}');
 INSERT INTO structural_assets(structural_id,filename,asset_kind) VALUES(1,'40_1_1.png','image')`)
	dimensionPNG(t, root, "40/1/original/40_1_1.png")
	counts := dimensionRun(t, db, root, true, 200)
	if counts.Galleries != 4 || counts.SkippedNoMetadataColumn != 1 || counts.SkippedNotJSONB != 1 || counts.SkippedNonObjectMetadata != 1 || counts.SkippedUnresolvedReference != 1 || counts.SkippedNoFile != 2 || counts.WouldWrite != 1 || counts.Failed != 0 {
		t.Fatalf("discovery/skip counts: %+v", counts)
	}
}

func TestImageDimensionsFailedBatchCountsOnlyCommittedRowsPostgres(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	root := t.TempDir()
	dimensionDataset(t, db, root, 101)
	mediaCheckExec(t, db, `ALTER TABLE pictures_assets ADD CONSTRAINT reject_last_size CHECK(id<>101 OR NOT (metadata_json ? 'displayed_image_size'))`)
	counts := dimensionRun(t, db, root, false, 200)
	if counts.Written != 100 || counts.Failed != 1 {
		t.Fatalf("batch result: %+v", counts)
	}
	var stored int
	if err := db.QueryRow(`SELECT count(*) FROM pictures_assets WHERE metadata_json ? 'displayed_image_size'`).Scan(&stored); err != nil || stored != 100 {
		t.Fatal("committed count differs", stored, err)
	}
}

// The registered gallery is restricted; the compatible public namesake is unrelated.
// Image capability and asset_kind exercise both canonical and upload discovery.
func dimensionArchiveNamesakes(t *testing.T, db *sql.DB, root string) {
	t.Helper()
	addMediaDataset(t, db, 100, "archive", 1, "public", "filename")
	mediaCheckExec(t, db, `CREATE SCHEMA restricted;
 ALTER TABLE public.archive_assets ADD COLUMN metadata_json jsonb;
 ALTER TABLE public.archive_assets ADD COLUMN asset_kind text DEFAULT 'image';
 UPDATE public.archive_assets SET metadata_json='{"caption":"keep"}';
 ALTER TABLE public.archive_assets SET SCHEMA restricted;
 UPDATE public.system_db_tables SET schema_name='restricted' WHERE table_uid=101;
 UPDATE public.system_foreign_key_relations_1_m SET target_insert_specs=
 '{"file_upload":{"enabled":true,"profile_key":"image","asset_kinds":["image"],"filename_column":"filename"}}';
 CREATE TABLE public.archive_assets (LIKE restricted.archive_assets INCLUDING ALL);
 INSERT INTO public.archive_assets SELECT * FROM restricted.archive_assets`)
	dimensionPNG(t, root, "100/1/1000/100_1_1.jpg")
}

func TestImageDimensionsNonPublicGalleryNeverWritesPublicNamesakePostgres(t *testing.T) {
	for _, discovery := range []string{"upload", "structural"} {
		t.Run(discovery, func(t *testing.T) {
			db := mediaCheckDisposableDB(t)
			root := t.TempDir()
			dimensionArchiveNamesakes(t, db, root)
			if discovery == "structural" {
				mediaCheckExec(t, db, `UPDATE public.system_foreign_key_relations_1_m SET target_insert_specs='{}'`)
			}
			var before string
			if err := db.QueryRow(`SELECT xmin::text FROM public.archive_assets WHERE id=1`).Scan(&before); err != nil {
				t.Fatal(err)
			}
			counts := dimensionRun(t, db, root, false, 200)
			if counts.Galleries != 1 || counts.SkippedUnsupportedGallery != 1 || counts.RowsSeen != 0 || counts.WouldWrite != 0 || counts.Written != 0 || counts.Failed != 0 {
				t.Fatalf("non-public target: %+v", counts)
			}
			var after string
			var unchanged bool
			if err := db.QueryRow(`SELECT xmin::text, metadata_json='{"caption":"keep"}'::jsonb FROM public.archive_assets WHERE id=1`).Scan(&after, &unchanged); err != nil || !unchanged || before != after {
				t.Fatalf("unrelated public table changed: xmin %s -> %s, metadata unchanged %v, error %v", before, after, unchanged, err)
			}
			if err := db.QueryRow(`SELECT metadata_json='{"caption":"keep"}'::jsonb FROM restricted.archive_assets WHERE id=1`).Scan(&unchanged); err != nil || !unchanged {
				t.Fatal("non-public gallery changed", err)
			}
		})
	}
}

func TestImageDimensionsNonPublicStructuralGalleryWithoutPublicNamesakePostgres(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	root := t.TempDir()
	// No public gallery or upload configuration can supply this identity.
	mediaCheckExec(t, db, `CREATE SCHEMA restricted;
 CREATE TABLE public.archive(id bigint PRIMARY KEY);
 CREATE TABLE restricted.archive_assets(id bigint PRIMARY KEY, archive_id bigint, filename text, asset_kind text, metadata_json jsonb);
 INSERT INTO public.system_db_tables VALUES(100,'archive','public'),(101,'archive_assets','restricted');
 INSERT INTO public.system_foreign_key_relations_1_m VALUES(100,101,100,'archive_id','{}');
 INSERT INTO restricted.archive_assets VALUES(1,1,'100_1_1.jpg','image','{"caption":"keep"}')`)
	for _, dry := range []bool{true, false} {
		t.Run(fmt.Sprintf("dry_run=%t", dry), func(t *testing.T) {
			counts := dimensionRun(t, db, root, dry, 200)
			if counts != (ImageDimensionsCounts{SkippedUnsupportedGallery: 1}) {
				t.Fatalf("unlisted non-public gallery: %+v", counts)
			}
		})
	}
}

func TestImageDimensionsSameNamedGalleriesRetainSeparateIdentitiesPostgres(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	root := t.TempDir()
	dimensionArchiveNamesakes(t, db, root)
	mediaCheckExec(t, db, `INSERT INTO public.system_db_tables VALUES(102,'archive_assets','public');
 INSERT INTO public.system_foreign_key_relations_1_m
 SELECT 102,102,target_table_uid,source_column_name,target_insert_specs FROM public.system_foreign_key_relations_1_m WHERE id=100`)
	targets, unsupported, err := dimensionGalleries(readOnlyQuerier{ctx: context.Background(), database: db})
	if err != nil {
		t.Fatal(err)
	}
	if unsupported != 0 || len(targets) != 2 || targets[0].Schema != "public" || targets[1].Schema != "restricted" || targets[0].AssetTable != "archive_assets" || targets[1].AssetTable != "archive_assets" {
		t.Fatalf("same-named galleries collapsed: %+v", targets)
	}
	counts := dimensionRun(t, db, root, false, 200)
	if counts.Galleries != 2 || counts.SkippedUnsupportedGallery != 1 || counts.RowsSeen != 1 || counts.Written != 1 || counts.Failed != 0 {
		t.Fatalf("public/non-public target counts: %+v", counts)
	}
	var correct bool
	if err := db.QueryRow(`SELECT metadata_json='{"caption":"keep","displayed_image_size":{"width_px":7,"height_px":4,"file":"100_1_1.jpg"}}'::jsonb FROM public.archive_assets WHERE id=1`).Scan(&correct); err != nil || !correct {
		t.Fatal("public gallery did not receive the displayed size", err)
	}
	if err := db.QueryRow(`SELECT metadata_json='{"caption":"keep"}'::jsonb FROM restricted.archive_assets WHERE id=1`).Scan(&correct); err != nil || !correct {
		t.Fatal("same-named non-public gallery changed", err)
	}
}

func TestImageDimensionsMissingAndAmbiguousGalleriesAreCountedPostgres(t *testing.T) {
	db := mediaCheckDisposableDB(t)
	root := t.TempDir()
	dimensionDataset(t, db, root, 1)
	// One physical gallery with conflicting parent storage identities is ambiguous.
	mediaCheckExec(t, db, `CREATE TABLE public.other_parent(id bigint PRIMARY KEY);
 INSERT INTO public.system_db_tables VALUES(119,'other_parent','public');
 INSERT INTO public.system_foreign_key_relations_1_m
 SELECT 119,source_table_uid,119,source_column_name,target_insert_specs FROM public.system_foreign_key_relations_1_m WHERE id=117`)
	addMediaDataset(t, db, 200, "missing_table", 1, "public", "filename")
	mediaCheckExec(t, db, `DROP TABLE public.missing_table_assets`)
	addMediaDataset(t, db, 300, "view_target", 1, "public", "filename")
	mediaCheckExec(t, db, `DROP TABLE public.view_target_assets;
 CREATE VIEW public.view_target_assets AS SELECT 1 AS id, 1 AS view_target_id, '117_1_1.jpg'::text AS filename, '{}'::jsonb AS metadata_json`)
	// Canonical discovery can infer a conventional gallery without a registry FK.
	// Its table name alone must not authorize any read or write.
	mediaCheckExec(t, db, `CREATE TABLE public.orphan(id bigint PRIMARY KEY);
 CREATE TABLE public.orphan_assets(id bigint PRIMARY KEY, orphan_id bigint, filename text, asset_kind text, metadata_json jsonb);
 INSERT INTO public.system_db_tables VALUES(400,'orphan','public'),(401,'orphan_assets','public');
 INSERT INTO public.system_foreign_key_relations_1_m VALUES(500,NULL,117,NULL,'{}')`)
	counts := dimensionRun(t, db, root, false, 200)
	if counts.Galleries != 4 || counts.SkippedUnsupportedGallery != 4 || counts.RowsSeen != 0 || counts.Written != 0 || counts.Failed != 0 {
		t.Fatalf("unsupported target accounting: %+v", counts)
	}
	var unchanged bool
	if err := db.QueryRow(`SELECT metadata_json IS NULL FROM public.pictures_assets WHERE id=1`).Scan(&unchanged); err != nil || !unchanged {
		t.Fatal("ambiguously owned gallery changed", err)
	}
}
