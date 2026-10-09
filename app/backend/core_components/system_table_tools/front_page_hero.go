// front_page_hero.go
// Reads and saves the Home title, slogan and description as fixed Finnish/English language keys.
// Connects the existing language-key editor to both canonical translation stores.
// Keeps empty copy intentional and all administrator writes in the request transaction.
package system_table_tools

import (
	"database/sql"
	"strings"
	"unicode/utf8"

	"easelect/backend/core_components/dbutils"
)

const frontPageTitleKey = "site_front_page_title"
const frontPageSloganKey = "site_front_page_slogan"
const frontPageDescriptionKey = "site_front_page_description"

type frontPageHeroText struct {
	LangKey          string `json:"lang_key,omitempty"`
	Fi               string `json:"fi"`
	En               string `json:"en"`
	UsageExplanation string `json:"usage_explanation"`
}

type frontPageHero struct {
	Title       *frontPageHeroText `json:"title"`
	Slogan      *frontPageHeroText `json:"slogan"`
	Description *frontPageHeroText `json:"description"`
}

func readFrontPageHero(q dbutils.Querier) (frontPageHero, error) {
	hero := frontPageHero{Title: &frontPageHeroText{LangKey: frontPageTitleKey}, Slogan: &frontPageHeroText{LangKey: frontPageSloganKey}, Description: &frontPageHeroText{LangKey: frontPageDescriptionKey}}
	for _, text := range []*frontPageHeroText{hero.Title, hero.Slogan, hero.Description} {
		err := q.QueryRow(`SELECT COALESCE(fi,''), COALESCE(en,'')
            FROM public.system_lang_keys WHERE lang_key=$1`, text.LangKey).Scan(&text.Fi, &text.En)
		if err != nil && err != sql.ErrNoRows {
			return hero, err
		}
	}
	return hero, nil
}

// Public readers need only operational language rows, never private usage notes.
func readFrontPageHeroForAdmin(q dbutils.Querier) (frontPageHero, error) {
	hero, err := readFrontPageHero(q)
	if err != nil {
		return hero, err
	}
	for _, text := range []*frontPageHeroText{hero.Title, hero.Slogan, hero.Description} {
		err := q.QueryRow(`SELECT COALESCE(usage_explanation,'')
            FROM public.system_lang_key_sources WHERE source_type='front_page_hero' AND source_high=$1
            AND lang_key_id=(SELECT id FROM public.system_lang_keys WHERE lang_key=$1)
            ORDER BY id LIMIT 1`, text.LangKey).Scan(&text.UsageExplanation)
		if err != nil && err != sql.ErrNoRows {
			return hero, err
		}
	}
	return hero, nil
}

func validateFrontPageHero(hero frontPageHero) error {
	for index, text := range []*frontPageHeroText{hero.Title, hero.Slogan, hero.Description} {
		if text == nil {
			return errFrontPageInput
		}
		expected := []string{frontPageTitleKey, frontPageSloganKey, frontPageDescriptionKey}[index]
		if text.LangKey != "" && text.LangKey != expected {
			return errFrontPageInput
		}
		for _, value := range []string{text.Fi, text.En, text.UsageExplanation} {
			if !utf8.ValidString(value) || utf8.RuneCountInString(value) > 2000 || strings.ContainsRune(value, '\x00') {
				return errFrontPageInput
			}
		}
	}
	return nil
}

func saveFrontPageHero(tx *sql.Tx, hero frontPageHero) error {
	if err := validateFrontPageHero(hero); err != nil {
		return err
	}
	for index, text := range []*frontPageHeroText{hero.Title, hero.Slogan, hero.Description} {
		key := []string{frontPageTitleKey, frontPageSloganKey, frontPageDescriptionKey}[index]
		var id int64
		err := tx.QueryRow(`INSERT INTO public.system_lang_keys(lang_key,fi,en,creation_spec)
   VALUES($1,$2,$3,'Site-wide Home hero copy.') ON CONFLICT(lang_key) DO UPDATE
   SET fi=EXCLUDED.fi,en=EXCLUDED.en,updated=now() RETURNING id`, key, strings.TrimSpace(text.Fi), strings.TrimSpace(text.En)).Scan(&id)
		if err != nil {
			return err
		}
		// The served catalog and legacy language columns must agree, including removal.
		for language, value := range map[string]string{"fi": text.Fi, "en": text.En} {
			value = strings.TrimSpace(value)
			if value == "" {
				_, err = tx.Exec(`DELETE FROM public.system_lang_key_translations WHERE lang_key_id=$1 AND language_code=$2`, id, language)
			} else {
				_, err = tx.Exec(`INSERT INTO public.system_lang_key_translations(lang_key_id,language_code,translation,source_kind,review_status)
     VALUES($1,$2,$3,'manual','approved') ON CONFLICT(lang_key_id,language_code) DO UPDATE
     SET translation=EXCLUDED.translation,source_kind='manual',review_status='approved',updated=now()`, id, language, value)
			}
			if err != nil {
				return err
			}
		}
		_, err = tx.Exec(`INSERT INTO public.system_lang_key_sources(lang_key_id,source_type,source_high,source_low,last_seen,usage_explanation)
   VALUES($1,'front_page_hero',$2,'front_page_hero',CURRENT_DATE,$3) ON CONFLICT(lang_key_id,source_type,source_high) DO UPDATE
   SET last_seen=CURRENT_DATE,usage_explanation=EXCLUDED.usage_explanation`, id, key, strings.TrimSpace(text.UsageExplanation))
		if err != nil {
			return err
		}
	}
	return nil
}
