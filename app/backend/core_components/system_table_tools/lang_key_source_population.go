// lang_key_source_population.go
// Populates lang_key_source records for translation keys missing source associations.
// Bridges dynamic table metadata, template references, and the lang_key_source table.
// Exists to back-fill source associations so orphaned translation keys become traceable.
package system_table_tools

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	backend "easelect/backend/core_components"
	"easelect/backend/core_components/runtimepaths"

	"github.com/lib/pq"
)

// lastSourceScan suojaa orpoavaintunnistusta ja stale-siivousta
// varmistamalla, ettei niitä ajeta ilman tuoretta skannausta.
// MarkOrphanLangKeys() ja cleanupStaleLangKeySources() tarkistavat tämän.
var (
	lastSourceScan                 time.Time
	lastSourceScanMu               sync.Mutex
	additionalLangKeySourceRoots   []string
	additionalLangKeySourceRootsMu sync.RWMutex
	currentLangKeyRuntimePaths     = runtimepaths.Current
	walkLangKeySourceTree          = filepath.Walk
)

// SourceScanIsFresh palauttaa true jos PopulateLangKeySources() on ajettu
// viimeisen 5 minuutin aikana. Kutsutaan MarkOrphanLangKeys():sta.
func SourceScanIsFresh() bool {
	lastSourceScanMu.Lock()
	defer lastSourceScanMu.Unlock()
	return !lastSourceScan.IsZero() && time.Since(lastSourceScan) < 5*time.Minute
}

func markSourceScanDone() {
	lastSourceScanMu.Lock()
	lastSourceScan = time.Now()
	lastSourceScanMu.Unlock()
}

func markSourceScanFailed() {
	lastSourceScanMu.Lock()
	lastSourceScan = time.Time{}
	lastSourceScanMu.Unlock()
}

// ConfigureAdditionalLangKeySourceRoots records composition-owned source roots.
// Public Filterest configures none; private compositions must opt in explicitly.
func ConfigureAdditionalLangKeySourceRoots(sourceRoots []string) error {
	normalizedRoots := make([]string, 0, len(sourceRoots))
	seenRoots := make(map[string]bool, len(sourceRoots))
	for _, sourceRoot := range sourceRoots {
		if strings.TrimSpace(sourceRoot) == "" {
			return fmt.Errorf("additional language-key source root must not be empty")
		}
		if !filepath.IsAbs(sourceRoot) {
			return fmt.Errorf("additional language-key source root must be absolute: %q", sourceRoot)
		}
		normalizedRoot := filepath.Clean(sourceRoot)
		if seenRoots[normalizedRoot] {
			continue
		}
		seenRoots[normalizedRoot] = true
		normalizedRoots = append(normalizedRoots, normalizedRoot)
	}
	sort.Strings(normalizedRoots)

	additionalLangKeySourceRootsMu.Lock()
	additionalLangKeySourceRoots = normalizedRoots
	additionalLangKeySourceRootsMu.Unlock()
	return nil
}

func configuredAdditionalLangKeySourceRoots() []string {
	additionalLangKeySourceRootsMu.RLock()
	defer additionalLangKeySourceRootsMu.RUnlock()

	result := make([]string, len(additionalLangKeySourceRoots))
	copy(result, additionalLangKeySourceRoots)
	return result
}

func pathIsInsideRoot(root string, candidate string) bool {
	relativePath, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	return relativePath == "." ||
		(relativePath != ".." && !filepath.IsAbs(relativePath) &&
			!strings.HasPrefix(relativePath, ".."+string(filepath.Separator)))
}

func validateLangKeySourceRoot(sourceRoot string, requireApplicationMarkers bool) error {
	rootInfo, err := os.Stat(sourceRoot)
	if err != nil {
		return fmt.Errorf("language-key source root %q: %w", sourceRoot, err)
	}
	if !rootInfo.IsDir() {
		return fmt.Errorf("language-key source root %q is not a directory", sourceRoot)
	}
	if requireApplicationMarkers {
		for _, marker := range []string{"go.mod", "VERSION_APP"} {
			markerInfo, markerErr := os.Stat(filepath.Join(sourceRoot, marker))
			if markerErr != nil {
				return fmt.Errorf("language-key application root marker %q: %w", marker, markerErr)
			}
			if !markerInfo.Mode().IsRegular() {
				return fmt.Errorf("language-key application root marker %q is not a regular file", marker)
			}
		}
	}
	for _, sourceDirectory := range []string{"frontend", "backend"} {
		directoryPath := filepath.Join(sourceRoot, sourceDirectory)
		directoryInfo, directoryErr := os.Stat(directoryPath)
		if directoryErr != nil {
			return fmt.Errorf("language-key source directory %q: %w", directoryPath, directoryErr)
		}
		if !directoryInfo.IsDir() {
			return fmt.Errorf("language-key source directory %q is not a directory", directoryPath)
		}
	}
	return nil
}

func codebaseSourceRoots(paths runtimepaths.Paths) ([]string, error) {
	installationRoot := strings.TrimSpace(paths.InstallationRoot)
	applicationRoot := strings.TrimSpace(paths.ApplicationRoot)
	if installationRoot == "" || !filepath.IsAbs(installationRoot) {
		return nil, fmt.Errorf("configured Filterest installation root is unresolved")
	}
	if applicationRoot == "" || !filepath.IsAbs(applicationRoot) {
		return nil, fmt.Errorf("configured Filterest application root is unresolved")
	}
	installationRoot = filepath.Clean(installationRoot)
	applicationRoot = filepath.Clean(applicationRoot)
	if !pathIsInsideRoot(installationRoot, applicationRoot) {
		return nil, fmt.Errorf("configured Filterest application root %q is outside installation root %q", applicationRoot, installationRoot)
	}
	if err := validateLangKeySourceRoot(applicationRoot, true); err != nil {
		return nil, err
	}

	sourceRoots := []string{applicationRoot}
	for _, sourceRoot := range configuredAdditionalLangKeySourceRoots() {
		if !pathIsInsideRoot(installationRoot, sourceRoot) {
			return nil, fmt.Errorf("additional language-key source root %q is outside installation root %q", sourceRoot, installationRoot)
		}
		if err := validateLangKeySourceRoot(sourceRoot, false); err != nil {
			return nil, err
		}
		sourceRoots = append(sourceRoots, sourceRoot)
	}
	return sourceRoots, nil
}

// sourceEntry — yksi avain-lähde -pari koodiskannauksesta
type sourceEntry struct {
	langKey  string
	filePath string // suhteellinen polku projektin juuresta
}

// scanCodebaseForLangKeySources skannaa frontend/ ja backend/ -hakemistot
// ja palauttaa listan avain→tiedostopolku -pareista. Skipaa dist/-kansion.
// Tunnistaa samat kaavat kuin scanCodebaseForLangKeys() mutta säilyttää tiedostopolun.
func scanCodebaseForLangKeySources() ([]sourceEntry, error) {
	var results []sourceEntry

	paths := currentLangKeyRuntimePaths()
	sourceRoots, err := codebaseSourceRoots(paths)
	if err != nil {
		return nil, err
	}

	var scanDirs []string
	for _, sourceRoot := range sourceRoots {
		scanDirs = append(
			scanDirs,
			filepath.Join(sourceRoot, "frontend"),
			filepath.Join(sourceRoot, "backend"),
		)
	}

	for _, dir := range scanDirs {
		walkErr := walkLangKeySourceTree(dir, func(path string, info os.FileInfo, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if info.IsDir() {
				if path != dir && (info.Name() == "dist" || info.Name() == "node_modules") {
					return filepath.SkipDir
				}
				return nil
			}
			ext := filepath.Ext(path)
			if !scanExtensions[ext] {
				return nil
			}
			data, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			content := string(data)
			relPath, relErr := filepath.Rel(paths.InstallationRoot, path)
			if relErr != nil || !pathIsInsideRoot(paths.InstallationRoot, path) {
				if relErr != nil {
					return relErr
				}
				return fmt.Errorf("language-key source file %q is outside installation root %q", path, paths.InstallationRoot)
			}
			relPath = filepath.ToSlash(relPath)

			// Kerätään kustakin tiedostosta löytyneet avaimet (deduplikoitu per tiedosto)
			foundInFile := make(map[string]bool)

			// Staattiset kieliavainviittaukset (data-lang-key, dataset.langKey, jne.)
			for _, pattern := range langKeyPatterns {
				for _, match := range pattern.FindAllStringSubmatch(content, -1) {
					if len(match) > 1 && !foundInFile[match[1]] {
						foundInFile[match[1]] = true
						results = append(results, sourceEntry{langKey: match[1], filePath: relPath})
					}
				}
			}
			// Go-tiedostoista: registerErrors{...} -tyyppiset avaimet
			if ext == ".go" {
				for _, match := range goTemplateKeyPattern.FindAllStringSubmatch(content, -1) {
					if len(match) > 1 && !foundInFile[match[1]] {
						foundInFile[match[1]] = true
						results = append(results, sourceEntry{langKey: match[1], filePath: relPath})
					}
				}
			}
			// JS-tiedostoista: tree-solmunimet (name: 'xxx')
			if ext == ".js" {
				for _, match := range treeNodeNamePattern.FindAllStringSubmatch(content, -1) {
					if len(match) > 1 && !foundInFile[match[1]] {
						foundInFile[match[1]] = true
						results = append(results, sourceEntry{langKey: match[1], filePath: relPath})
					}
				}
			}
			return nil
		})
		if walkErr != nil {
			return nil, fmt.Errorf("scan language-key source directory %q: %w", dir, walkErr)
		}
	}

	return results, nil
}

// PopulateLangKeySources skannaa koodipohjan ja skeeman ja täyttää
// system_lang_key_sources-taulun lähdetiedoilla. Palauttaa lisättyjen rivien määrän.
// Kutsutaan startupissa ENNEN MarkOrphanLangKeys():ta, koska orphan-tunnistus
// perustuu sources-taulun sisältöön.
func PopulateLangKeySources() (total int, scanErr error) {
	// A new attempt invalidates any previous success immediately. Otherwise a
	// failed retry within the five-minute freshness window could still permit
	// stale cleanup and orphan deletion against an incomplete source snapshot.
	markSourceScanFailed()

	// Resolve and scan immutable sources before any database write. Missing or
	// unreadable source trees are a hard safety failure, never an empty scan.
	codeSources, err := scanCodebaseForLangKeySources()
	if err != nil {
		return 0, fmt.Errorf("scan codebase language-key sources: %w", err)
	}

	// Haetaan kaikki lang_key → id
	keyToID := make(map[string]int64)
	rows, err := backend.Db.Query("SELECT id, lang_key FROM system_lang_keys")
	if err != nil {
		log.Printf("[PopulateLangKeySources] lang_keys query: %v", err)
		return 0, err
	}
	for rows.Next() {
		var id int64
		var key string
		if err := rows.Scan(&id, &key); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan language-key registry row: %w", err)
		}
		keyToID[key] = id
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, fmt.Errorf("scan language-key registry: %w", err)
	}
	rows.Close()

	// ── 1. Koodipohjan lähteet (JS, HTML, Go -tiedostot) ─────────────
	codeCount := 0
	for _, src := range codeSources {
		id, ok := keyToID[src.langKey]
		if !ok {
			continue // avain ei ole tietokannassa
		}
		if upsertSource(id, "code", src.filePath, "") {
			codeCount++
			continue
		}
		return codeCount, fmt.Errorf("save code language-key source %q from %q", src.langKey, src.filePath)
	}

	// ── 2. Skeeman lähteet (sarake- ja taulunimet) ───────────────────
	// columnToTables: {"created": ["app_service_catalog", "system_users", ...], ...}
	// → jokaiselle taululle jossa sarake esiintyy, luodaan oma lähderivi.
	columnToTables := fetchSchemaColumnToTables()
	tableNames := fetchSchemaTableNames()
	schemaCount := 0

	for key, id := range keyToID {
		// Suora sarakenimi: "name", "email", "home_address"
		// → yksi rivi per taulu jossa sarake esiintyy
		if tables, ok := columnToTables[key]; ok {
			for _, tbl := range tables {
				if upsertSource(id, "column", tbl, key) {
					schemaCount++
				}
				updateSourceUsageExplanationIfEmpty(id, "column", tbl, fmt.Sprintf("Column '%s' in table '%s'", key, tbl))
			}
		}
		// Suora taulunimi: "users", "system_db_tables"
		// → source_high = taulun nimi itse
		if tableNames[key] {
			if upsertSource(id, "table", key, key) {
				schemaCount++
			}
			updateSourceUsageExplanationIfEmpty(id, "table", key, fmt.Sprintf("Table '%s'", key))
		}
		// Dynaaminen etuliite + sarake/taulu: "add_row_users", "search_for_name"
		for _, prefix := range dynamicPrefixes {
			if strings.HasPrefix(key, prefix) {
				remainder := key[len(prefix):]
				if tables, ok := columnToTables[remainder]; ok {
					for _, tbl := range tables {
						if upsertSource(id, "column", tbl, remainder) {
							schemaCount++
						}
						updateSourceUsageExplanationIfEmpty(id, "column", tbl, fmt.Sprintf("Column '%s' in table '%s'", remainder, tbl))
					}
				}
				if tableNames[remainder] {
					if upsertSource(id, "table", remainder, remainder) {
						schemaCount++
					}
					updateSourceUsageExplanationIfEmpty(id, "table", remainder, fmt.Sprintf("Table '%s'", remainder))
				}
			}
		}
		// Dynaaminen loppuliite + sarake/taulu: "name_asc", "users_front_page"
		for _, suffix := range dynamicSuffixes {
			if strings.HasSuffix(key, suffix) {
				base := key[:len(key)-len(suffix)]
				if tables, ok := columnToTables[base]; ok {
					for _, tbl := range tables {
						if upsertSource(id, "column", tbl, base) {
							schemaCount++
						}
						updateSourceUsageExplanationIfEmpty(id, "column", tbl, fmt.Sprintf("Column '%s' in table '%s'", base, tbl))
					}
				}
				if tableNames[base] {
					if upsertSource(id, "table", base, base) {
						schemaCount++
					}
					updateSourceUsageExplanationIfEmpty(id, "table", base, fmt.Sprintf("Table '%s'", base))
				}
			}
		}
	}

	// ── 3. Tietokantapohjaiset lähteet (views, groups) ──────────────
	dbCount := 0

	// Custom view -nimet (nav_builder.js käyttää view.name:a lang key:nä)
	viewRows, vErr := backend.Db.Query("SELECT DISTINCT name FROM system_table_views WHERE name IS NOT NULL AND name != ''")
	if vErr == nil {
		defer viewRows.Close()
		for viewRows.Next() {
			var name string
			if err := viewRows.Scan(&name); err == nil {
				if id, ok := keyToID[name]; ok {
					if upsertSource(id, "view", "system_table_views", name) {
						dbCount++
					}
				}
			}
		}
		viewRows.Close()
	}

	// Käyttäjäryhmien nimet (nav_builder.js käyttää group_name:a lang key:nä)
	groupRows, gErr := backend.Db.Query("SELECT DISTINCT name FROM system_user_groups WHERE name IS NOT NULL AND name != ''")
	if gErr == nil {
		defer groupRows.Close()
		for groupRows.Next() {
			var name string
			if err := groupRows.Scan(&name); err == nil {
				if id, ok := keyToID[name]; ok {
					if upsertSource(id, "group", "system_user_groups", name) {
						dbCount++
					}
				}
			}
		}
		groupRows.Close()
	}

	// Kansioiden nimet (nav_builder.js käyttää folder_name:a lang key:nä)
	folderRows, fErr := backend.Db.Query("SELECT DISTINCT folder_name FROM system_table_folders WHERE folder_name IS NOT NULL AND folder_name != ''")
	if fErr == nil {
		defer folderRows.Close()
		for folderRows.Next() {
			var name string
			if err := folderRows.Scan(&name); err == nil {
				if id, ok := keyToID[name]; ok {
					if upsertSource(id, "folder", name, name) {
						dbCount++
					}
					updateSourceUsageExplanationIfEmpty(id, "folder", name, fmt.Sprintf("Folder '%s'", name))
				}
			}
		}
		folderRows.Close()
	}

	// ── 4. system_lang_keys-FK-sarakkeiden arvot ────────────────────
	// Some domain tables store language-key IDs directly. These references are
	// runtime sources even when the corresponding key is absent from code and
	// schema-name scans.
	foreignKeyCount := scanForeignKeyLangKeyReferences(keyToID)

	// ── 5. hasLangKey-sarakkeiden arvot (card_element sisältää '+lang_key') ──
	// Kun card_element = 'header+lang_key' tms., frontend käyttää sarakkeen arvoja
	// kieliavaimina (dataset.langKey = value). Skannataan näiden sarakkeiden
	// DISTINCT-arvot ja rekisteröidään ne lähteiksi.
	langKeyColCount := scanHasLangKeyColumns(keyToID)

	total = codeCount + schemaCount + dbCount + foreignKeyCount + langKeyColCount
	markSourceScanDone()

	if deletedCount := cleanupStaleLangKeySources(); deletedCount > 0 {
		log.Printf("[PopulateLangKeySources] stale source cleanup removed %d outdated source rows", deletedCount)
	}
	log.Printf("[PopulateLangKeySources] %d source(s) saved (code: %d, schema: %d, db: %d, foreign_keys: %d, lang_key_cols: %d)",
		total, codeCount, schemaCount, dbCount, foreignKeyCount, langKeyColCount)
	return total, nil
}

// upsertSource tekee UPSERT:n system_lang_key_sources-tauluun.
// Palauttaa true jos operaatio onnistui.
func upsertSource(langKeyID int64, sourceType, sourceHigh, sourceLow string) bool {
	if langKeyID == 0 {
		return false
	}
	_, err := backend.Db.Exec(`
		INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
		VALUES ($1, $2, $3, $4, CURRENT_DATE)
		ON CONFLICT (lang_key_id, source_type, source_high) DO UPDATE
		  SET source_low = EXCLUDED.source_low,
		      last_seen = CURRENT_DATE
	`, langKeyID, sourceType, sourceHigh, sourceLow)
	if err != nil {
		log.Printf("[upsertSource] error id=%d type=%s high=%s: %v", langKeyID, sourceType, sourceHigh, err)
		return false
	}
	return true
}

// updateSourceUsageExplanationIfEmpty sets usage_explanation on a specific
// source record, but only if it's currently empty. This preserves manually
// set explanations from seed migrations while auto-populating schema-based
// explanations like "Column 'name' in table 'customers'".
func updateSourceUsageExplanationIfEmpty(langKeyID int64, sourceType, sourceHigh, explanation string) {
	if langKeyID == 0 || strings.TrimSpace(explanation) == "" {
		return
	}
	_, err := backend.Db.Exec(`
		UPDATE system_lang_key_sources
		SET usage_explanation = $1
		WHERE lang_key_id = $2
		  AND source_type = $3
		  AND source_high = $4
		  AND (usage_explanation IS NULL OR usage_explanation = '')
	`, explanation, langKeyID, sourceType, sourceHigh)
	if err != nil {
		log.Printf("[updateSourceUsageExplanationIfEmpty] error id=%d type=%s high=%s: %v",
			langKeyID, sourceType, sourceHigh, err)
	}
}

// scanForeignKeyLangKeyReferences registers domain-table values whose foreign
// keys target system_lang_keys.id. The source table itself is excluded because
// its bookkeeping rows must not make every orphan appear live.
func scanForeignKeyLangKeyReferences(keyToID map[string]int64) int {
	referencedIDs := make(map[int64]bool, len(keyToID))
	for _, id := range keyToID {
		referencedIDs[id] = true
	}

	rows, err := backend.Db.Query(`
		SELECT src_ns.nspname, src.relname, src_col.attname
		FROM pg_constraint con
		JOIN pg_class src ON src.oid = con.conrelid
		JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
		JOIN pg_class ref ON ref.oid = con.confrelid
		JOIN pg_namespace ref_ns ON ref_ns.oid = ref.relnamespace
		JOIN pg_attribute src_col
		  ON src_col.attrelid = src.oid
		 AND src_col.attnum = con.conkey[1]
		JOIN pg_attribute ref_col
		  ON ref_col.attrelid = ref.oid
		 AND ref_col.attnum = con.confkey[1]
		WHERE con.contype = 'f'
		  AND ref_ns.nspname = 'public'
		  AND ref.relname = 'system_lang_keys'
		  AND ref_col.attname = 'id'
		  AND array_length(con.conkey, 1) = 1
		  AND NOT (
		    src_ns.nspname = 'public'
		    AND src.relname = 'system_lang_key_sources'
		  )
		ORDER BY src_ns.nspname, src.relname, src_col.attname
	`)
	if err != nil {
		log.Printf("[scanForeignKeyLangKeyReferences] constraint query error: %v", err)
		return 0
	}

	type foreignKeyRef struct {
		schema string
		table  string
		column string
	}
	var refs []foreignKeyRef
	for rows.Next() {
		var ref foreignKeyRef
		if err := rows.Scan(&ref.schema, &ref.table, &ref.column); err == nil {
			refs = append(refs, ref)
		}
	}
	rows.Close()

	count := 0
	for _, ref := range refs {
		qSchema := pq.QuoteIdentifier(ref.schema)
		qTable := pq.QuoteIdentifier(ref.table)
		qColumn := pq.QuoteIdentifier(ref.column)
		valueRows, err := backend.Db.Query(fmt.Sprintf(
			"SELECT DISTINCT %s::bigint FROM %s.%s WHERE %s IS NOT NULL",
			qColumn, qSchema, qTable, qColumn,
		))
		if err != nil {
			log.Printf("[scanForeignKeyLangKeyReferences] error scanning %s.%s.%s: %v",
				ref.schema, ref.table, ref.column, err)
			continue
		}

		var langKeyIDs []int64
		for valueRows.Next() {
			var langKeyID int64
			if err := valueRows.Scan(&langKeyID); err != nil || !referencedIDs[langKeyID] {
				continue
			}
			langKeyIDs = append(langKeyIDs, langKeyID)
		}
		valueRows.Close()

		sourceHigh := fmt.Sprintf("%s.%s.%s", ref.schema, ref.table, ref.column)
		for _, langKeyID := range langKeyIDs {
			if upsertSource(langKeyID, "foreign_key", sourceHigh, ref.column) {
				count++
			}
			updateSourceUsageExplanationIfEmpty(
				langKeyID,
				"foreign_key",
				sourceHigh,
				fmt.Sprintf("Foreign-key value in '%s'", sourceHigh),
			)
		}
	}

	return count
}

// scanHasLangKeyColumns etsii sarakkeet joiden card_element sisältää '+lang_key'
// ja rekisteröi niiden DISTINCT-arvot kieliavainlähteiksi.
// Esim. card_element='header+lang_key' sarakkeessa 'status' → arvot 'active', 'pending'
// rekisteröidään source_type='column_value'.
func scanHasLangKeyColumns(keyToID map[string]int64) int {
	// Hae sarakkeet joissa card_element sisältää 'lang_key' (case insensitive)
	colRows, err := backend.Db.Query(`
		SELECT cd.column_name, dt.table_name
		FROM system_column_details cd
		JOIN system_db_tables dt ON cd.table_uid = dt.table_uid
		WHERE cd.card_element ILIKE '%lang_key%' OR cd.card_element ILIKE '%lang-key%'
	`)
	if err != nil {
		log.Printf("[scanHasLangKeyColumns] query error: %v", err)
		return 0
	}
	defer colRows.Close()

	type colRef struct {
		column string
		table  string
	}
	var cols []colRef
	for colRows.Next() {
		var c colRef
		if err := colRows.Scan(&c.column, &c.table); err == nil {
			cols = append(cols, c)
		}
	}
	colRows.Close()

	count := 0
	for _, c := range cols {
		// Hae DISTINCT-arvot tästä sarakkeesta (vain ne jotka ovat olemassa lang keyinä)
		qCol := pq.QuoteIdentifier(c.column)
		qTbl := pq.QuoteIdentifier(c.table)
		valRows, err := backend.Db.Query(fmt.Sprintf(
			"SELECT DISTINCT %s FROM %s WHERE %s IS NOT NULL AND %s != ''",
			qCol, qTbl, qCol, qCol,
		))
		if err != nil {
			log.Printf("[scanHasLangKeyColumns] error scanning %s.%s: %v", c.table, c.column, err)
			continue
		}
		for valRows.Next() {
			var val string
			if err := valRows.Scan(&val); err == nil {
				if id, ok := keyToID[val]; ok {
					sourceHigh := fmt.Sprintf("%s.%s", c.table, c.column)
					if upsertSource(id, "column_value", sourceHigh, val) {
						count++
					}
					updateSourceUsageExplanationIfEmpty(id, "column_value", sourceHigh,
						fmt.Sprintf("Value '%s' in column '%s.%s' (hasLangKey)", val, c.table, c.column))
				}
			}
		}
		valRows.Close()
	}

	return count
}

// cleanupStaleLangKeySources removes lang key source entries not seen in the last 7 days.
// We use a 7-day window (instead of same-day) to tolerate server downtime and maintenance.
// Only runs if PopulateLangKeySources() completed recently (SourceScanIsFresh guard).
func cleanupStaleLangKeySources() int64 {
	if !SourceScanIsFresh() {
		log.Printf("[cleanupStaleLangKeySources] skipped: source scan not fresh")
		return 0
	}
	result, err := backend.Db.Exec(`
		DELETE FROM system_lang_key_sources
		WHERE source_type IN ('code', 'column', 'table', 'prefix', 'suffix', 'view', 'group', 'folder', 'db', 'foreign_key', 'column_value')
		  AND last_seen < CURRENT_DATE - INTERVAL '7 days'
	`)
	if err != nil {
		log.Printf("[cleanupStaleLangKeySources] error: %v", err)
		return 0
	}

	deletedRows, err := result.RowsAffected()
	if err != nil {
		return 0
	}
	return deletedRows
}
