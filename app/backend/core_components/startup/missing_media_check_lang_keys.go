// missing_media_check_lang_keys.go
// Seeds the interface text of the missing-media-files check in every supported language.
// Bridges server startup and the system_lang_keys rows the media maintenance screen reads.
// Exists so the new administration section ships translated instead of falling back to
// its English placeholder copy or waiting for someone to type the translations by hand.
package startup

import (
	"database/sql"
	"log"
)

// missingMediaCheckLangKeySeed carries all four supported languages, unlike the
// older three-language startup seeds, because this screen is new in every one.
type missingMediaCheckLangKeySeed struct {
	langKey string
	fi      string
	en      string
	ch      string
	yue     string
}

var missingMediaCheckLangKeySeeds = []missingMediaCheckLangKeySeed{
	{
		langKey: "missing_media_check",
		fi:      "Puuttuvat mediatiedostot",
		en:      "Missing media files",
		ch:      "缺失的媒体文件",
		yue:     "唔見咗嘅媒體檔案",
	},
	{
		langKey: "missing_media_check_description",
		fi:      "Tarkistaa, ovatko rivien käyttämät kuvat ja liitteet yhä levyllä. Ei korjaa eikä poista mitään, vaan kertoo mikä puuttuu.",
		en:      "Checks whether the pictures and attachments that rows use are still on disk. It repairs nothing and deletes nothing; it only reports what is missing.",
		ch:      "检查各行所使用的图片和附件是否仍在磁盘上。它不会修复或删除任何内容，只报告缺失的文件。",
		yue:     "檢查各行用緊嘅圖片同附件係咪仲喺磁碟上。佢唔會修復或者刪除任何嘢，只係報告咩唔見咗。",
	},
	{
		langKey: "missing_media_check_run_now",
		fi:      "Tarkista nyt",
		en:      "Check now",
		ch:      "立即检查",
		yue:     "即刻檢查",
	},
	{
		langKey: "missing_media_check_running",
		fi:      "Tarkistus on käynnissä…",
		en:      "The check is running…",
		ch:      "检查进行中…",
		yue:     "檢查進行緊…",
	},
	{
		langKey: "missing_media_check_never_run",
		fi:      "Tarkistusta ei ole vielä ajettu.",
		en:      "The check has not run yet.",
		ch:      "检查尚未运行。",
		yue:     "檢查仲未執行過。",
	},
	{
		langKey: "missing_media_check_disabled",
		fi:      "Tarkistus on poistettu käytöstä asetuksista.",
		en:      "The check is switched off in the settings.",
		ch:      "该检查已在设置中关闭。",
		yue:     "呢個檢查喺設定入面已經閂咗。",
	},
	{
		langKey: "missing_media_check_last_run",
		fi:      "Viimeisin tarkistus",
		en:      "Last check",
		ch:      "上次检查",
		yue:     "上次檢查",
	},
	{
		langKey: "missing_media_check_rows_checked",
		fi:      "Tarkistettuja rivejä",
		en:      "Rows checked",
		ch:      "已检查的行数",
		yue:     "已檢查嘅行數",
	},
	{
		langKey: "missing_media_check_datasets_checked",
		fi:      "Tarkistettuja aineistoja",
		en:      "Datasets checked",
		ch:      "已检查的数据集",
		yue:     "已檢查嘅資料集",
	},
	{
		langKey: "missing_media_check_missing_files",
		fi:      "Puuttuvia tiedostoja",
		en:      "Missing files",
		ch:      "缺失的文件",
		yue:     "唔見咗嘅檔案",
	},
	{
		langKey: "missing_media_check_all_present",
		fi:      "Jokainen tarkistettu tiedosto löytyi levyltä.",
		en:      "Every checked file was found on disk.",
		ch:      "所有已检查的文件都在磁盘上找到。",
		yue:     "所有已檢查嘅檔案都喺磁碟上搵到。",
	},
	{
		langKey: "missing_media_check_row_budget_reached",
		fi:      "Työmäärän yläraja tuli vastaan: tarkistettiin otos, ei kaikkia rivejä.",
		en:      "The work limit was reached: a sample was checked instead of every row.",
		ch:      "已达到工作量上限：检查的是样本，而不是全部行。",
		yue:     "已經到咗工作量上限：檢查嘅係樣本，唔係全部行。",
	},
	{
		langKey: "missing_media_check_time_budget_reached",
		fi:      "Aikaraja tuli vastaan, joten tarkistus jäi kesken.",
		en:      "The time limit was reached, so the check stopped early.",
		ch:      "已达到时间上限，因此检查提前停止。",
		yue:     "已經到咗時間上限，所以檢查提早停咗。",
	},
	{
		langKey: "missing_media_check_datasets_exceed_budget",
		fi:      "Aineistoja on enemmän kuin työmäärän yläraja sallii rivejä, joten osa aineistoista jäi kokonaan tarkistamatta. Nosta ylärajaa.",
		en:      "There are more datasets than the work limit allows rows, so some datasets were not checked at all. Raise the limit.",
		ch:      "数据集数量超过了工作量上限所允许的行数，因此有些数据集完全没有被检查。请提高上限。",
		yue:     "資料集嘅數量多過工作量上限容許嘅行數，所以有啲資料集完全冇檢查過。請調高上限。",
	},
	{
		langKey: "missing_media_check_enabled_setting",
		fi:      "Tarkistus käytössä",
		en:      "Check switched on",
		ch:      "启用检查",
		yue:     "開啟檢查",
	},
	{
		langKey: "missing_media_check_max_rows_setting",
		fi:      "Rivien yläraja yhdessä ajossa",
		en:      "Row limit for one run",
		ch:      "单次运行的行数上限",
		yue:     "單次執行嘅行數上限",
	},
	{
		langKey: "missing_media_check_max_seconds_setting",
		fi:      "Aikaraja sekunteina",
		en:      "Time limit in seconds",
		ch:      "时间上限（秒）",
		yue:     "時間上限（秒）",
	},
	{
		langKey: "missing_media_check_unused_files_setting",
		fi:      "Kerro myös tiedostoista, joita mikään rivi ei käytä",
		en:      "Also report files that no row uses",
		ch:      "同时报告没有任何行使用的文件",
		yue:     "同時報告冇任何行用緊嘅檔案",
	},
	{
		langKey: "missing_media_check_unused_files",
		fi:      "Käyttämättömiä tiedostoja",
		en:      "Unused files",
		ch:      "未使用的文件",
		yue:     "冇用到嘅檔案",
	},
	{
		langKey: "missing_media_check_save_settings",
		fi:      "Tallenna asetukset",
		en:      "Save settings",
		ch:      "保存设置",
		yue:     "儲存設定",
	},
	{
		langKey: "missing_media_check_settings_saved",
		fi:      "Asetukset tallennettu.",
		en:      "Settings saved.",
		ch:      "设置已保存。",
		yue:     "設定已儲存。",
	},
	{
		langKey: "missing_media_check_legacy_filename",
		fi:      "vanha tiedostonimimuoto",
		en:      "retired filename form",
		ch:      "旧的文件名格式",
		yue:     "舊嘅檔案名格式",
	},
	{
		langKey: "missing_media_check_unresolved_reference",
		fi:      "viittausta ei voi paikantaa levyltä",
		en:      "the reference cannot be placed on disk",
		ch:      "无法在磁盘上定位该引用",
		yue:     "喺磁碟上定位唔到呢個引用",
	},
}

// EnsureMissingMediaCheckLangKeys fills in any language that is still empty.
// Existing values stay untouched, so an administrator's own wording survives a
// restart while a language nobody has translated yet gets the shipped copy.
func EnsureMissingMediaCheckLangKeys(db *sql.DB) {
	const upsertQuery = `
		INSERT INTO system_lang_keys (lang_key, fi, en, ch, yue)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (lang_key) DO UPDATE
			SET fi = CASE WHEN system_lang_keys.fi IS NULL OR system_lang_keys.fi = '' THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
			    en = CASE WHEN system_lang_keys.en IS NULL OR system_lang_keys.en = '' THEN EXCLUDED.en ELSE system_lang_keys.en END,
			    ch = CASE WHEN system_lang_keys.ch IS NULL OR system_lang_keys.ch = '' THEN EXCLUDED.ch ELSE system_lang_keys.ch END,
			    yue = CASE WHEN system_lang_keys.yue IS NULL OR system_lang_keys.yue = '' THEN EXCLUDED.yue ELSE system_lang_keys.yue END
	`

	for _, seed := range missingMediaCheckLangKeySeeds {
		if _, err := db.Exec(upsertQuery, seed.langKey, seed.fi, seed.en, seed.ch, seed.yue); err != nil {
			log.Printf("[STARTUP] Error upserting missing media check lang key %q: %v", seed.langKey, err)
		}
	}
}
