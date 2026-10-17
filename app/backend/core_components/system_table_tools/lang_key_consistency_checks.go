// lang_key_consistency_checks.go
// Checks consistency of language keys across the system.
// Bridges translation tables and the admin consistency-check endpoint.
// Exists to detect orphaned keys, missing sources, and unreferenced translation entries.
package system_table_tools

import (
	"database/sql"
	backend "easelect/backend/core_components"
	"easelect/backend/core_components/httpresponse"
	"easelect/backend/core_components/lang_key_naming"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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
	regexp.MustCompile(`(?:langKey|LangKey|TitleLangKey):\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`(?:const|let|var)\s+[A-Z0-9_]*LANG_KEY\s*=\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`data-html-lang-key["\s]*[=:]\s*["']([a-zA-Z0-9_-]+)["']`),
	regexp.MustCompile(`dataset\.langKeyFallback\s*=\s*["']([a-zA-Z0-9_-]+)["']`),

	// A module that gathers its copy into one catalogue passes a variable to the
	// translation call, so the key literal never sits beside it. The three
	// shapes below are what such a catalogue already looks like, which is why a
	// new module is scanned correctly without its author having to remember a
	// convention:
	//
	//     attach:   ["chat_attach_image", "Attach an image"]
	//     labelKey: "dataset_column_type_text"
	//     image_ready: { fi: "Kuva on valmis", en: "Image is ready" }
	//
	// Each one reads the name by its own snake_case shape, so an ordinary
	// identifier such as apiKey or a list such as ["png", "jpeg"] stays out.
	regexp.MustCompile(`[A-Za-z_$][\w$]*\s*:\s*\[\s*["'](` + snakeCaseLangKeySource + `)["']\s*,\s*["']`),
	regexp.MustCompile(`[A-Za-z_$][\w$]*[Kk]ey\s*:\s*["'](` + snakeCaseLangKeySource + `)["']`),
	regexp.MustCompile(`["']?(` + snakeCaseLangKeySource + `)["']?\s*:\s*\{\s*["']?(?:fi|en|ch|yue)["']?\s*:`),
}

// snakeCaseLangKeySource — how a product language key is written: lowercase
// words joined by underscores. The underscore is what separates a key from the
// ordinary identifiers and short values that share a catalogue with it.
const snakeCaseLangKeySource = `[a-z][a-z0-9]*(?:_[a-z0-9]+)+`

// treeNodeNamePattern — tunnistaa tree-rakenteen solmunimet JS-tiedostoista.
// Esim. nav_builder.js: { id: 'check_json_columns', name: 'Check JSON Columns' }
// Nämä nimet päätyvät lang key:ksi render_tree_node.js kautta.
var treeNodeNamePattern = regexp.MustCompile(`name:\s*'([^']+)'`)

// maxLangKeyNameCharacters is shared by garbage detection and orphan exclusion.
const maxLangKeyNameCharacters = 200

// countingLangKeySourceSQL ignores bookkeeping and exactly the translation
// storage FK. Unknown types and incomplete identities protect the key: SQL NULL
// must never turn uncertain evidence into an orphan candidate (WO-J35 B5).
const countingLangKeySourceSQL = `(live.source_type IS NULL OR live.source_high IS NULL OR (
    live.source_type NOT IN ('orphan', 'manual_crud')
    AND NOT (live.source_type = 'foreign_key'
             AND live.source_high = 'public.system_lang_key_translations.lang_key_id')))`

// countingLangKeySourceExistsSQL accepts only code-owned SQL column expressions,
// never request text. All lifecycle queries share this correlated source rule.
func countingLangKeySourceExistsSQL(keyIDColumn string) string {
	return `EXISTS (SELECT 1 FROM system_lang_key_sources live
        WHERE live.lang_key_id = ` + keyIDColumn + ` AND ` + countingLangKeySourceSQL + `)`
}

func garbageLangKeySQL() string {
	return fmt.Sprintf("(slk.lang_key ~ '[<>]' OR length(slk.lang_key) > %d)", maxLangKeyNameCharacters)
}

// The names of dynamically generated keys are defined once, in
// lang_key_naming, so the startup scan and the runtime ownership resolver
// cannot drift apart. Examples: button_factory.js builds "add_row_" +
// table_name, create_sort_dropdown.js builds col + "_asc".
var dynamicPrefixes = lang_key_naming.DynamicPrefixes()

var dynamicSuffixes = lang_key_naming.DynamicSuffixes()

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
        SELECT slk.id, slk.lang_key FROM system_lang_keys slk
        WHERE ` + garbageLangKeySQL() + ` ORDER BY slk.id
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

// langKeyRow — sisäinen rakenne orpoavain-ehdokkaille (metadata mukaan lukien).
// hasLiveUsage kertoo, löytyykö avaimelle yhä koodi- tai skeemalähde. Synteettinen
// testavain voi olla siivousehdokas vaikka lähde on olemassa; automaattinen
// poisto ei koskaan koske sellaista avainta.
type langKeyRow struct {
	id           int
	key          string
	en           string
	langKeyType  string
	hasLiveUsage bool
	translated   bool
}

// Share these patterns between Go descriptions and PostgreSQL selection.
// Random tails need at least six alphanumeric characters and a digit; ordinary
// words such as test_connection are not evidence of a generated test name.
// Case is spelled out as ASCII classes and both engines match case-sensitively: Go's (?i) folds Unicode (ſ, K)
// differently from PostgreSQL's ~*, so neither engine's case-insensitive mode is used.
const syntheticE2ELangKeyPattern = `^[Ee]2[Ee]_.+$`
const syntheticNumericLangKeyPattern = `^[Tt][Ee][Ss][Tt]_([a-zA-Z0-9]+[_-])*[0-9]+$`
const syntheticRandomLangKeyPattern = `^[Tt][Ee][Ss][Tt]_([a-zA-Z0-9]+[_-])*[a-zA-Z0-9]{6,}$`
const syntheticRandomDigitPattern = `^[Tt][Ee][Ss][Tt]_.*[0-9][a-zA-Z0-9]*$`
const syntheticUUIDLangKeyPattern = `^[Tt][Ee][Ss][Tt]_([a-zA-Z0-9]+[_-])*([a-fA-F0-9]{32}|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12})$`

// (?s): PostgreSQL's "." also matches a newline, so Go's must too.
var syntheticTestLangKeyPatterns = []*regexp.Regexp{
	regexp.MustCompile("(?s)" + syntheticE2ELangKeyPattern),
	regexp.MustCompile("(?s)" + syntheticNumericLangKeyPattern),
	regexp.MustCompile("(?s)" + syntheticRandomLangKeyPattern),
	regexp.MustCompile("(?s)" + syntheticRandomDigitPattern),
	regexp.MustCompile("(?s)" + syntheticUUIDLangKeyPattern),
}

func isSyntheticTestLangKey(key string) bool {
	p := syntheticTestLangKeyPatterns
	return p[0].MatchString(key) || p[1].MatchString(key) ||
		(p[2].MatchString(key) && p[3].MatchString(key)) || p[4].MatchString(key)
}

func syntheticTestLangKeySQL(keyColumn string) string {
	return fmt.Sprintf(`(%s ~ '%s' OR %s ~ '%s' OR (%s ~ '%s' AND %s ~ '%s') OR %s ~ '%s')`,
		keyColumn, syntheticE2ELangKeyPattern, keyColumn, syntheticNumericLangKeyPattern,
		keyColumn, syntheticRandomLangKeyPattern, keyColumn, syntheticRandomDigitPattern,
		keyColumn, syntheticUUIDLangKeyPattern)
}

// buildLangKeyConsistencyDescription returns metadata only. All explanatory
// category-8 copy is carried separately as translation keys, including its age.
func buildLangKeyConsistencyDescription(r langKeyRow, orphanAges map[int]int) string {
	originParts := []string{}
	if r.en != "" {
		enPreview := r.en
		if len(enPreview) > 60 {
			enPreview = enPreview[:60] + "…"
		}
		originParts = append(originParts, fmt.Sprintf("en: %q", enPreview))
	}
	if r.langKeyType != "" {
		originParts = append(originParts, fmt.Sprintf("type: %s", r.langKeyType))
	}
	return strings.Join(originParts, " | ")
}

// The LangKey field names also expose this catalogue to today's source scanner.
// Keep seeded source_high aligned with this owning file; no new scan pattern is needed.
var orphanConsistencyCopy = struct {
	pausedLangKey, syntheticLangKey, ageLangKey, countingSourceLangKey string
}{
	pausedLangKey:         "consistency_orphan_archiving_paused",
	syntheticLangKey:      "consistency_synthetic_key_archiving_paused",
	ageLangKey:            "consistency_orphan_age_days",
	countingSourceLangKey: "consistency_lang_key_counting_source",
}

func orphanDescriptionLangKeys(r langKeyRow, orphanAges map[int]int) []string {
	keys := []string{orphanConsistencyCopy.pausedLangKey}
	if isSyntheticTestLangKey(r.key) {
		keys[0] = orphanConsistencyCopy.syntheticLangKey
	}
	if ageDays, ok := orphanAges[r.id]; ok {
		keys = append(keys, fmt.Sprintf("%s+%d", orphanConsistencyCopy.ageLangKey, ageDays))
	}
	if r.hasLiveUsage {
		keys = append(keys, orphanConsistencyCopy.countingSourceLangKey)
	}
	return keys
}

// findOrphanLangKeys — palauttaa listan orpoavaimista sources-taulun perusteella.
// Orpo = avain jolla ei ole yhtään merkityksellistä lähdettä (code/schema/db).
// Generated names beginning e2e_ or test_ are also listed for review, even
// with counting sources. Ordinary test words follow the normal source rule.
// manual_crud-lähde yksinään ei estä orpoluokittelua, koska se kertoo vain
// "joku muokkasi tätä admin-UI:ssa" eikä "tätä avainta tarvitaan edelleen".
// PopulateLangKeySources() pitää ajaa ensin, jotta lähdetiedot ovat ajan tasalla.
// Kutsutaan sekä checkOrphanLangKeys():sta (UI) että MarkOrphanLangKeys():sta (UPSERT).
func findOrphanLangKeys() []langKeyRow {
	rows, err := backend.Db.Query(`
        SELECT slk.id, slk.lang_key,
               COALESCE(slk.en, '') AS en,
               COALESCE(slk.lang_key_type::text, '') AS lang_key_type,
               ` + countingLangKeySourceExistsSQL("slk.id") + ` AS has_live_usage,
               EXISTS (SELECT 1 FROM system_lang_key_translations translation
                       WHERE translation.lang_key_id = slk.id
                         AND NULLIF(btrim(translation.translation), '') IS NOT NULL) AS translated
        FROM system_lang_keys slk
        WHERE NOT ` + garbageLangKeySQL() + `
          AND (` + syntheticTestLangKeySQL("slk.lang_key") + `
               OR NOT ` + countingLangKeySourceExistsSQL("slk.id") + `)
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
		if err := rows.Scan(&r.id, &r.key, &r.en, &r.langKeyType, &r.hasLiveUsage, &r.translated); err != nil {
			continue
		}
		orphans = append(orphans, r)
	}
	return orphans
}

// orphanTTLDays is the retained legacy archive threshold. No automatic caller
// uses it while language-key archiving is paused (WO-J35 B1).
const orphanTTLDays = 90

// MarkOrphanLangKeys merkitsee orpoavaimet system_lang_key_sources-tauluun
// (source_type='orphan', source_high='consistency_scan') ja poistaa vanhat
// orphan-merkinnät avaimista jotka eivät enää ole orvoja.
// Marking only: automatic archiving and deletion are paused (WO-J35 B1).
// Kutsutaan startupissa ja consistency checkissä. DRY: käyttää findOrphanLangKeys().
func MarkOrphanLangKeys() (orphanCount int, deOrphanedCount int) {
	sourceMaintenanceMu.Lock()
	defer sourceMaintenanceMu.Unlock()
	if !SourceScanIsFresh() {
		log.Printf("[MarkOrphanLangKeys] skipped: %s", sourceScanSkipReason())
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

	// Archiving is paused. Keep marking and de-orphaning in this transaction.

	if err := tx.Commit(); err != nil {
		log.Printf("[MarkOrphanLangKeys] transaction commit failed: %v", err)
		return 0, 0
	}

	log.Printf("[MarkOrphanLangKeys] %d orphan keys total, %d de-orphaned", orphanCount, deOrphanedCount)
	return orphanCount, deOrphanedCount
}

// archiveExpiredOrphans siirtää yli orphanTTLDays päivää vanhat orpoavaimet
// system_lang_keys_archive-tauluun ja poistaa ne system_lang_keys:stä.
// Palauttaa arkistoitujen avainten lukumäärän.
// Retained for later WO-J35 work; no automatic or category-8 caller is enabled.
//
// A key is retired only when nothing outside the orphan bookkeeping refers to
// it any more. A synthetic test key is listed as a cleanup candidate even while
// code still references it, and automatic retirement must not act on that
// listing: removing a key the interface still asks for would lose its copy.
func archiveExpiredOrphans(tx *sql.Tx) int {
	// Hae orpoavaimet joiden orphan-merkintä on yli TTL päivää vanha
	rows, err := tx.Query(fmt.Sprintf(`
		SELECT src.lang_key_id, src.last_seen
		FROM system_lang_key_sources src
		WHERE src.source_type = 'orphan'
		  AND src.source_high = 'consistency_scan'
		  AND src.last_seen < CURRENT_DATE - INTERVAL '%d days'
		  AND NOT %s
    `, orphanTTLDays, countingLangKeySourceExistsSQL("src.lang_key_id")))
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
		// Repeat the rule for evidence visible when DELETE starts. Before
		// re-enabling this helper, WO-J35 B8 must coordinate concurrent writers;
		// this statement alone cannot see another transaction's uncommitted use.
		deleteResult, err := tx.Exec(`
			DELETE FROM system_lang_keys
			WHERE id = $1
			  AND NOT `+countingLangKeySourceExistsSQL("system_lang_keys.id"), e.langKeyID)
		if err != nil {
			log.Printf("[archiveExpiredOrphans] delete error id=%d: %v — aborting archive batch", e.langKeyID, err)
			return -1
		}
		if deletedRows, rowsErr := deleteResult.RowsAffected(); rowsErr == nil && deletedRows == 0 {
			log.Printf("[archiveExpiredOrphans] key id=%d gained a source during the batch — aborting so it is not archived without being retired", e.langKeyID)
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
// Reports age and the archiving pause; no retirement countdown or fix action.
func checkOrphanLangKeys() CategoryResult {
	cat := CategoryResult{
		Number:       8,
		Title:        "Orphan lang keys",
		TitleLangKey: "consistency_orphan_lang_keys",
		Issues:       []ConsistencyIssue{},
	}

	orphans := findOrphanLangKeys()

	// Haetaan orphan-merkintöjen ikä (last_seen = first detected as orphan)
	orphanAges, currentUsage := fetchOrphanAges()

	for _, r := range orphans {
		if hasCountingSource, ok := currentUsage[r.id]; ok {
			r.hasLiveUsage = hasCountingSource
		}
		cat.Issues = append(cat.Issues, ConsistencyIssue{
			ID:                  fmt.Sprintf("cat8_%d", r.id),
			Category:            8,
			Table:               r.key,
			Description:         buildLangKeyConsistencyDescription(r, orphanAges),
			DescriptionLangKeys: orphanDescriptionLangKeys(r, orphanAges),
			Translated:          &r.translated,
		})
	}

	return cat
}

// fetchOrphanAges palauttaa lang_key_id → ikä päivissä -mappauksen
// orphan-merkintöjen perusteella. last_seen = päivä jolloin avain merkittiin orvoksi.
// Also reads current counting-source status for the description through the shared rule.
func fetchOrphanAges() (map[int]int, map[int]bool) {
	result := make(map[int]int)
	usage := make(map[int]bool)
	rows, err := backend.Db.Query(`
        SELECT src.lang_key_id, CURRENT_DATE - src.last_seen AS age_days,
               ` + countingLangKeySourceExistsSQL("src.lang_key_id") + ` AS has_counting_source
        FROM system_lang_key_sources src
        WHERE src.source_type = 'orphan' AND src.source_high = 'consistency_scan'
    `)
	if err != nil {
		log.Printf("[fetchOrphanAges] error: %v", err)
		return result, usage
	}
	defer rows.Close()
	for rows.Next() {
		var id, days int
		var hasCountingSource bool
		if err := rows.Scan(&id, &days, &hasCountingSource); err == nil {
			result[id] = days
			usage[id] = hasCountingSource
		}
	}
	return result, usage
}

// ScanLangSourcesHandler ajaa PopulateLangKeySources() + MarkOrphanLangKeys()
// on-demand ilman palvelimen uudelleenkäynnistystä. Palauttaa JSON-tuloksen.
// POST /api/scan-lang-sources
func ScanLangSourcesHandler(w http.ResponseWriter, r *http.Request) {

	sourceCount, err := PopulateLangKeySources()
	if err != nil {
		log.Printf("[ScanLangSourcesHandler] language-key source scan failed; orphan maintenance skipped: %v", err)
		httpresponse.RespondWithError(w, http.StatusInternalServerError, "language-key source scan failed")
		return
	}
	orphanCount, deOrphaned := MarkOrphanLangKeys()
	scanState, _ := sourceScanOutcome()

	result := map[string]interface{}{
		"sources_saved":     sourceCount,
		"orphan_count":      orphanCount,
		"de_orphaned":       deOrphaned,
		"source_scan_state": scanState,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
