// lang_key_consistency_checks.go
// Checks consistency of language keys across the system.
// Bridges translation tables and the admin consistency-check endpoint.
// Exists to detect orphaned keys, missing sources, and unreferenced translation entries.
package system_table_tools

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/lib/pq"
)

// scanExtensions — tiedostopäätteet joista etsitään staattisia kieliavainviittauksia
var scanExtensions = map[string]bool{
	".js":   true,
	".go":   true,
	".html": true,
}

// langKeyPatterns — regex-kaavat joilla löydetään staattisia kieliavainviittauksia koodista.
// Avainnimet voivat sisältää kirjaimia, numeroita, alaviivoja ja väliviivoja.
//
// Standardikonventio: JS-koodissa käytetään aina dataset.langKey (ei setAttribute).
// HTML-tiedostoissa data-lang-key="..." -attribuutti sallitaan edelleen.
var langKeyPatterns = []*regexp.Regexp{
	regexp.MustCompile(`data-lang-key["\s]*[=:]\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`dataset\.langKey\s*=\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`getTranslationForKey\(\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`(?:Title)?LangKey:\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`data-html-lang-key["\s]*[=:]\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`dataset\.langKeyFallback\s*=\s*["']([a-zA-Z0-9_-]+)["']`),
}

// treeNodeNamePattern — tunnistaa tree-rakenteen solmunimet JS-tiedostoista.
// Esim. nav_builder.js: { id: 'check_json_columns', name: 'Check JSON Columns' }
// Nämä nimet päätyvät lang key:ksi render_tree_node.js kautta.
var treeNodeNamePattern = regexp.MustCompile(`name:\s*'([^']+)'`)

// htmlFragmentPattern — avaimet joissa itse avaimen nimi sisältää HTML-tageja tai on liian pitkä.
// Huom: data-html-lang-key -ominaisuus on tarkoituksellinen — se kääntää HTML-sisältöä
// käyttäen nimettyä avainta (esim. "privacy_notice_login_content"). Sen sijaan tässä
// löytyvät avaimet ovat tapauksia joissa raaka HTML on päätynyt avaimen nimeksi,
// esim. "<h2>Summary</h2>" avaimen nimenä.
var htmlFragmentPattern = regexp.MustCompile(`[<>]|^.{200,}$`)

// dynamicPrefixes — dynaamisesti generoitavien avainten etuliitteet.
// Frontendissä luodaan dynaamisia avaimia yhdistämällä etuliite + taulu/sarakenimi.
// Esim. button_factory.js: "add_row_" + table_name, create_filter_bar_text_search.js: "search_for_" + tableName
var dynamicPrefixes = []string{
	"add_row_",
	"search_for_",
	"search_slogan_",
}

// dynamicSuffixes — dynaamisesti generoitavien avainten loppuliitteet.
// Esim. create_sort_dropdown.js: col + "_asc"/"_desc", create_filter_bar.js: tableName + "_front_page"
var dynamicSuffixes = []string{
	"_asc",
	"_desc",
	"_front_page",
}

// goTemplateKeyPattern — Go-templaateissa käytetyt dynaamiset avaimet,
// esim. register.html: data-lang-key="{{.UsernameErr}}"
// Tunnistetaan Go-koodista registerErrors{Username: "key"} -tyyppiset arvot.
var goTemplateKeyPattern = regexp.MustCompile(`registerErrors\{[^}]*?:\s*"([a-zA-Z0-9_]+)"`)

// 7. HTML-fragmenttiavaimet — avaimet joissa itse avaimen nimi on HTML-koodia.
// Nämä ovat historiallisia artefakteja ajalta jolloin HTML-käännöstä kokeiltiin
// tallentamalla HTML suoraan avaimeksi. Nykyisin HTML-käännökset tehdään
// data-html-lang-key -attribuutilla ja nimetyllä avaimella (esim. privacy_notice_login_content),
// joten nämä raaka-HTML-avaimet ovat turhia.
func checkGarbageLangKeys() CategoryResult {
	cat := CategoryResult{
		Number:       7,
		Title:        "HTML-fragmenttiavaimet (HTML as lang key name)",
		TitleLangKey: "consistency_html_fragment_lang_keys",
		Issues:       []ConsistencyIssue{},
	}

	rows, err := backend.Db.Query(`
		SELECT id, lang_key 
		FROM system_lang_keys 
		WHERE lang_key ~ '[<>]' 
		   OR length(lang_key) > 200
		ORDER BY id
	`)
	if err != nil {
		log.Printf("[checkGarbageLangKeys] error: %v", err)
		return cat
	}
	defer rows.Close()

	for rows.Next() {
		var id int
		var key string
		if err := rows.Scan(&id, &key); err != nil {
			continue
		}
		preview := key
		if len(preview) > 60 {
			preview = preview[:60] + "..."
		}
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:          fmt.Sprintf("cat7_%d", id),
			Category:    7,
			Table:       preview,
			Description: fmt.Sprintf("Lang key id=%d: contains raw HTML as key name (historical artifact, now use data-html-lang-key + named key)", id),
		})
	}

	return cat
}

// langKeyRow — sisäinen rakenne orpoavain-ehdokkaille (metadata mukaan lukien)
type langKeyRow struct {
	id          int
	key         string
	en          string
	langKeyType string
}

var syntheticTestLangKeyPattern = regexp.MustCompile(`(^|_)(e2e|test)(_|-)`)

func isSyntheticTestLangKey(key string) bool {
	return syntheticTestLangKeyPattern.MatchString(strings.ToLower(strings.TrimSpace(key)))
}

func buildLangKeyConsistencyDescription(r langKeyRow, orphanAges map[int]int) string {
	originParts := []string{}
	if r.en != "" {
		enPreview := r.en
		if len(enPreview) > 60 {
			enPreview = enPreview[:60] + "…"
		}
		originParts = append(originParts, fmt.Sprintf("en: \"%s\"", enPreview))
	}
	if r.langKeyType != "" {
		originParts = append(originParts, fmt.Sprintf("type: %s", r.langKeyType))
	}
	if ageDays, ok := orphanAges[r.id]; ok {
		remaining := orphanTTLDays - ageDays
		if remaining < 0 {
			remaining = 0
		}
		originParts = append(originParts, fmt.Sprintf("orphan for %d days, will be deleted in %d day(s)", ageDays, remaining))
	}
	originInfo := ""
	if len(originParts) > 0 {
		originInfo = " | " + strings.Join(originParts, ", ")
	}

	if isSyntheticTestLangKey(r.key) {
		return fmt.Sprintf("Synthetic test lang key: cleanup candidate even if historical source rows still exist%s", originInfo)
	}

	return fmt.Sprintf("Orphan lang key: not found in code/schema%s", originInfo)
}

// findOrphanLangKeys — palauttaa listan orpoavaimista sources-taulun perusteella.
// Orpo = avain jolla ei ole yhtään merkityksellistä lähdettä (code/schema/db).
// Synteettiset testavaimet (e2e/test) palautetaan aina siivousehdokkaina,
// vaikka niille olisi jäänyt historiallisia code-lähderivejä.
// manual_crud-lähde yksinään ei estä orpoluokittelua, koska se kertoo vain
// "joku muokkasi tätä admin-UI:ssa" eikä "tätä avainta tarvitaan edelleen".
// PopulateLangKeySources() pitää ajaa ensin, jotta lähdetiedot ovat ajan tasalla.
// Kutsutaan sekä checkOrphanLangKeys():sta (UI) että MarkOrphanLangKeys():sta (UPSERT).
func findOrphanLangKeys() []langKeyRow {
	rows, err := backend.Db.Query(`
		SELECT slk.id, slk.lang_key,
		       COALESCE(slk.en, '') AS en,
		       COALESCE(slk.lang_key_type::text, '') AS lang_key_type
		FROM system_lang_keys slk
		WHERE NOT (slk.lang_key ~ '[<>]' OR length(slk.lang_key) > 200)
		  AND (
		    slk.lang_key ~* '(^|_)(e2e|test)(_|-)'
		    OR NOT EXISTS (
		      SELECT 1 FROM system_lang_key_sources src
		      WHERE src.lang_key_id = slk.id
		        AND src.source_type NOT IN ('orphan', 'manual_crud')
		    )
		  )
		ORDER BY slk.lang_key
	`)
	if err != nil {
		log.Printf("[findOrphanLangKeys] error: %v", err)
		return nil
	}
	defer rows.Close()

	var orphans []langKeyRow
	for rows.Next() {
		var r langKeyRow
		if err := rows.Scan(&r.id, &r.key, &r.en, &r.langKeyType); err != nil {
			continue
		}
		orphans = append(orphans, r)
	}
	return orphans
}

// orphanTTLDays — kuinka monta päivää orpoavain saa olla orvoksi merkittynä
// ennen kuin se arkistoidaan ja poistetaan automaattisesti.
const orphanTTLDays = 90

// MarkOrphanLangKeys merkitsee orpoavaimet system_lang_key_sources-tauluun
// (source_type='orphan', source_high='consistency_scan') ja poistaa vanhat
// orphan-merkinnät avaimista jotka eivät enää ole orvoja.
// Arkistoi ja poistaa yli 90 päivää vanhat orpoavaimet automaattisesti.
// Kutsutaan startupissa ja consistency checkissä. DRY: käyttää findOrphanLangKeys().
func MarkOrphanLangKeys() (orphanCount int, deOrphanedCount int) {
	if !SourceScanIsFresh() {
		log.Printf("[MarkOrphanLangKeys] skipped: source scan not fresh — run PopulateLangKeySources() first")
		return 0, 0
	}

	orphans := findOrphanLangKeys()
	orphanCount = len(orphans)
	orphanLangKeyIDs := make([]int64, 0, len(orphans))

	// Begin a transaction so all UPSERT/DELETE operations are atomic
	tx, err := backend.Db.Begin()
	if err != nil {
		log.Printf("[MarkOrphanLangKeys] failed to begin transaction: %v", err)
		return 0, 0
	}

	// 1. INSERT orphan-merkinnät löydetyille orvoille.
	// DO NOTHING = säilytetään alkuperäinen last_seen (= "first seen as orphan"),
	// jotta ikääntyminen (90 pv TTL) voidaan laskea last_seen-kentästä.
	for _, r := range orphans {
		orphanLangKeyIDs = append(orphanLangKeyIDs, int64(r.id))
	}

	if len(orphanLangKeyIDs) > 0 {
		_, err := tx.Exec(`
			INSERT INTO system_lang_key_sources (lang_key_id, source_type, source_high, source_low, last_seen)
			SELECT orphan_id::integer, 'orphan', 'consistency_scan', '', CURRENT_DATE
			FROM UNNEST($1::bigint[]) AS orphan_id
			ON CONFLICT (lang_key_id, source_type, source_high) DO NOTHING
		`, pq.Array(orphanLangKeyIDs))
		if err != nil {
			log.Printf("[MarkOrphanLangKeys] bulk mark error for %d orphan ids: %v", len(orphanLangKeyIDs), err)
			tx.Rollback()
			return 0, 0
		}
	}

	// 2. Poista vanhat orphan-merkinnät avaimista jotka eivät enää ole orvoja
	// (esim. koodi on lisännyt viittauksen vanhaan avaimeen tai skeema on muuttunut)
	deleteQuery := `
		DELETE FROM system_lang_key_sources
		WHERE source_type = 'orphan' AND source_high = 'consistency_scan'
	`
	deleteArgs := []interface{}{}
	if len(orphanLangKeyIDs) > 0 {
		deleteQuery += `
			AND NOT (lang_key_id::bigint = ANY($1::bigint[]))
		`
		deleteArgs = append(deleteArgs, pq.Array(orphanLangKeyIDs))
	}
	deleteResult, err := tx.Exec(deleteQuery, deleteArgs...)
	if err != nil {
		log.Printf("[MarkOrphanLangKeys] error deleting stale orphan records: %v", err)
		tx.Rollback()
		return 0, 0
	}
	if rowsAffected, err := deleteResult.RowsAffected(); err == nil {
		deOrphanedCount = int(rowsAffected)
	}

	// 3. Arkistoi ja poista yli 90 päivää vanhat orpoavaimet
	archived := archiveExpiredOrphans(tx)
	if archived < 0 {
		tx.Rollback()
		return 0, 0
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[MarkOrphanLangKeys] transaction commit failed: %v", err)
		return 0, 0
	}

	if archived > 0 {
		log.Printf("[MarkOrphanLangKeys] %d expired orphan keys archived and deleted (TTL %d days)", archived, orphanTTLDays)
	}
	log.Printf("[MarkOrphanLangKeys] %d orphan keys total, %d de-orphaned", orphanCount, deOrphanedCount)
	return orphanCount, deOrphanedCount
}

// archiveExpiredOrphans siirtää yli orphanTTLDays päivää vanhat orpoavaimet
// system_lang_keys_archive-tauluun ja poistaa ne system_lang_keys:stä.
// Palauttaa arkistoitujen avainten lukumäärän.
func archiveExpiredOrphans(tx *sql.Tx) int {
	// Hae orpoavaimet joiden orphan-merkintä on yli TTL päivää vanha
	rows, err := tx.Query(fmt.Sprintf(`
		SELECT src.lang_key_id, src.last_seen
		FROM system_lang_key_sources src
		WHERE src.source_type = 'orphan'
		  AND src.source_high = 'consistency_scan'
		  AND src.last_seen < CURRENT_DATE - INTERVAL '%d days'
	`, orphanTTLDays))
	if err != nil {
		log.Printf("[archiveExpiredOrphans] query error: %v", err)
		return 0
	}
	defer rows.Close()

	type expiredOrphan struct {
		langKeyID   int
		orphanSince string // DATE as string
	}
	var expired []expiredOrphan
	for rows.Next() {
		var e expiredOrphan
		if err := rows.Scan(&e.langKeyID, &e.orphanSince); err == nil {
			expired = append(expired, e)
		}
	}
	rows.Close()

	if len(expired) == 0 {
		return 0
	}

	archived := 0
	for _, e := range expired {
		// Kopioi avain arkistotauluun
		_, err := tx.Exec(`
			INSERT INTO system_lang_keys_archive
				(original_id, lang_key, fi, en, ch, yue, lang_key_type, creation_spec,
				 original_created, original_updated, orphan_since)
			SELECT id, lang_key, fi, en, ch, yue, lang_key_type, creation_spec,
			       created, updated, $2
			FROM system_lang_keys WHERE id = $1
		`, e.langKeyID, e.orphanSince)
		if err != nil {
			log.Printf("[archiveExpiredOrphans] archive error id=%d: %v — aborting archive batch", e.langKeyID, err)
			return -1 // signaloi virhe kutsujalle → rollback
		}
		// Poista avain (CASCADE poistaa myös sources-rivit)
		_, err = tx.Exec("DELETE FROM system_lang_keys WHERE id = $1", e.langKeyID)
		if err != nil {
			log.Printf("[archiveExpiredOrphans] delete error id=%d: %v — aborting archive batch", e.langKeyID, err)
			return -1
		}
		archived++
	}

	return archived
}

// 8. Orpoavaimet: ei löydy koodista eikä skeemasta, eikä koskaan käytetty.
// Mukaan otetaan myös synteettiset testavaimet (e2e/test), joita ei haluta
// säilyttää system_lang_keys-taulussa vaikka niille olisi jäänyt source-rivejä.
// Kutsuu findOrphanLangKeys() (DRY) ja muotoilee tulokset UI:ta varten.
// Näyttää ikääntymistiedon (kuinka kauan orvoksi merkittynä) ja TTL-countdown.
func checkOrphanLangKeys() CategoryResult {
	cat := CategoryResult{
		Number:       8,
		Title:        "Orphan lang keys",
		TitleLangKey: "consistency_orphan_lang_keys",
		Issues:       []ConsistencyIssue{},
	}

	orphans := findOrphanLangKeys()

	// Haetaan orphan-merkintöjen ikä (last_seen = first detected as orphan)
	orphanAges := fetchOrphanAges()

	for _, r := range orphans {
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:          fmt.Sprintf("cat8_%d", r.id),
			Category:    8,
			Table:       r.key,
			Description: buildLangKeyConsistencyDescription(r, orphanAges),
		})
	}

	return cat
}

// fetchOrphanAges palauttaa lang_key_id → ikä päivissä -mappauksen
// orphan-merkintöjen perusteella. last_seen = päivä jolloin avain merkittiin orvoksi.
func fetchOrphanAges() map[int]int {
	result := make(map[int]int)
	rows, err := backend.Db.Query(`
		SELECT lang_key_id, CURRENT_DATE - last_seen AS age_days
		FROM system_lang_key_sources
		WHERE source_type = 'orphan' AND source_high = 'consistency_scan'
	`)
	if err != nil {
		log.Printf("[fetchOrphanAges] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var id, days int
		if err := rows.Scan(&id, &days); err == nil {
			result[id] = days
		}
	}
	return result
}

// fetchSchemaColumnNames hakee kaikki sarakkeiden nimet system_column_details-taulusta
func fetchSchemaColumnNames() map[string]bool {
	result := make(map[string]bool)
	rows, err := backend.Db.Query("SELECT DISTINCT column_name FROM system_column_details")
	if err != nil {
		log.Printf("[fetchSchemaColumnNames] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			result[name] = true
		}
	}
	return result
}

// fetchSchemaColumnToTables hakee sarake→taulut -mappauksen.
// Palauttaa: {"created": ["app_service_catalog", "system_users", ...], ...}
// Käytetään lang_key_source_population.go:ssa tarkkojen lähdetietojen tallentamiseen.
func fetchSchemaColumnToTables() map[string][]string {
	result := make(map[string][]string)
	rows, err := backend.Db.Query(`
		SELECT cd.column_name, dt.table_name
		FROM system_column_details cd
		JOIN system_db_tables dt ON cd.table_uid = dt.table_uid
		ORDER BY cd.column_name, dt.table_name
	`)
	if err != nil {
		log.Printf("[fetchSchemaColumnToTables] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var colName, tableName string
		if err := rows.Scan(&colName, &tableName); err == nil {
			result[colName] = append(result[colName], tableName)
		}
	}
	return result
}

// fetchSchemaTableNames hakee kaikki taulujen nimet system_db_tables-taulusta
func fetchSchemaTableNames() map[string]bool {
	result := make(map[string]bool)
	rows, err := backend.Db.Query("SELECT DISTINCT table_name FROM system_db_tables")
	if err != nil {
		log.Printf("[fetchSchemaTableNames] error: %v", err)
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err == nil {
			result[name] = true
		}
	}
	return result
}

// findProjectRoot etsii projektin juurihakemiston kulkemalla ylöspäin
// ja etsimällä go.mod-tiedostoa.
// Strategia: 1) os.Getwd() (paras kun palvelin käynnistetään ./ctl:llä)
//  2. os.Executable() (binäärin sijainti, fallback)
func findProjectRoot() string {
	// Ensisijainen: nykyinen työhakemisto (./ctl käynnistää palvelimen projektin juuresta)
	wd, wdErr := os.Getwd()
	if wdErr == nil {
		if found := findGoModDir(wd); found != "" {
			return found
		}
	}

	// Varasuunnitelma: binäärin sijainnista ylöspäin
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		if found := findGoModDir(dir); found != "" {
			return found
		}
	}

	return ""
}

// findGoModDir kulkee hakemistopuuta ylöspäin etsien go.mod-tiedostoa
func findGoModDir(startDir string) string {
	dir := startDir
	for i := 0; i < 10; i++ {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// ScanLangSourcesHandler ajaa PopulateLangKeySources() + MarkOrphanLangKeys()
// on-demand ilman palvelimen uudelleenkäynnistystä. Palauttaa JSON-tuloksen.
// POST /api/scan-lang-sources
func ScanLangSourcesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpresponse.RespondWithError(w, http.StatusMethodNotAllowed, "only POST allowed")
		return
	}

	sourceCount := PopulateLangKeySources()
	orphanCount, deOrphaned := MarkOrphanLangKeys()

	result := map[string]interface{}{
		"sources_saved": sourceCount,
		"orphan_count":  orphanCount,
		"de_orphaned":   deOrphaned,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
