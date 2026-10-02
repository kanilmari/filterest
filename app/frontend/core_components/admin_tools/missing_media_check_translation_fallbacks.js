// missing_media_check_translation_fallbacks.js
// Bootstrap copy of the missing media files section of the media maintenance screen.
// Bridges the section's data-lang-key elements with an installation whose language keys
// are still missing: the site's own reviewed translations always take precedence.
// Exists so every text of the section has Finnish, English, Chinese (ch) and Cantonese
// (yue) copy. The migration 20260929000005 seeds exactly this copy, and a test keeps the
// two equal. The `key: { fi: ... }` shape is one the startup language-key scan recognises.

export const MISSING_MEDIA_CHECK_TRANSLATION_FALLBACKS = Object.freeze({
    // --- Heading, actions and status ---
    missing_media_check: {
        fi: "Puuttuvat mediatiedostot",
        en: "Missing media files",
        ch: "缺失的媒体文件",
        yue: "唔見咗嘅媒體檔案",
    },
    missing_media_check_description: {
        fi: "Tarkistaa, ovatko rivien käyttämät kuvat ja liitteet yhä levyllä. Ei korjaa eikä poista mitään, vaan kertoo mikä puuttuu.",
        en: "Checks whether the pictures and attachments that rows use are still on disk. It repairs nothing and deletes nothing; it only reports what is missing.",
        ch: "检查各行所使用的图片和附件是否仍在磁盘上。它不会修复或删除任何内容，只报告缺失的文件。",
        yue: "檢查各行用緊嘅圖片同附件係咪仲喺磁碟上。佢唔會修復或者刪除任何嘢，只係報告咩唔見咗。",
    },
    missing_media_check_run_now: { fi: "Tarkista nyt", en: "Check now", ch: "立即检查", yue: "即刻檢查" },
    missing_media_check_save_settings: { fi: "Tallenna asetukset", en: "Save settings", ch: "保存设置", yue: "儲存設定" },
    missing_media_check_settings_saved: { fi: "Asetukset tallennettu.", en: "Settings saved.", ch: "设置已保存。", yue: "設定已儲存。" },
    missing_media_check_running: {
        fi: "Tarkistus on käynnissä…",
        en: "The check is running…",
        ch: "检查进行中…",
        yue: "檢查進行緊…",
    },
    missing_media_check_never_run: {
        fi: "Tarkistusta ei ole vielä ajettu.",
        en: "The check has not run yet.",
        ch: "检查尚未运行。",
        yue: "檢查仲未執行過。",
    },
    missing_media_check_disabled: {
        fi: "Tarkistus on poistettu käytöstä asetuksista.",
        en: "The check is switched off in the settings.",
        ch: "该检查已在设置中关闭。",
        yue: "呢個檢查喺設定入面已經閂咗。",
    },
    missing_media_check_settings_problem: {
        fi: "Tallennettuja asetuksia ei voitu lukea, joten näkyvissä ovat oletusarvot eikä tarkistusta ajeta. Asetusten tallentaminen korvaa tallennetun arvon.",
        en: "The stored settings could not be read, so the shipped defaults are shown and the check does not run. Saving the settings replaces the stored value.",
        ch: "无法读取已保存的设置，因此显示的是默认值，检查也不会运行。保存设置会替换已保存的值。",
        yue: "讀取唔到已儲存嘅設定，所以而家顯示緊預設值，檢查亦唔會執行。儲存設定會取代已儲存嘅值。",
    },

    // --- Settings ---
    missing_media_check_enabled_setting: { fi: "Tarkistus käytössä", en: "Check switched on", ch: "启用检查", yue: "開啟檢查" },
    missing_media_check_max_rows_setting: {
        fi: "Rivien yläraja yhdessä ajossa",
        en: "Row limit for one run",
        ch: "单次运行的行数上限",
        yue: "單次執行嘅行數上限",
    },
    missing_media_check_min_rows_setting: {
        fi: "Tarkistettavia rivejä vähintään kustakin aineistosta",
        en: "Rows checked at least in each dataset",
        ch: "每个数据集至少检查的行数",
        yue: "每個資料集最少檢查嘅行數",
    },
    missing_media_check_sampling_setting: {
        fi: "Miten suuren aineiston rivit valitaan",
        en: "How rows of a large dataset are picked",
        ch: "如何挑选大型数据集中的行",
        yue: "點樣揀大型資料集入面嘅行",
    },
    missing_media_check_sampling_even: {
        fi: "Tasaisesti vanhimmasta uusimpaan",
        en: "Evenly from oldest to newest",
        ch: "从最旧到最新均匀挑选",
        yue: "由最舊到最新平均咁揀",
    },
    missing_media_check_sampling_random: { fi: "Satunnaisesti", en: "At random", ch: "随机挑选", yue: "隨機揀" },
    missing_media_check_max_seconds_setting: {
        fi: "Aikaraja sekunteina",
        en: "Time limit in seconds",
        ch: "时间上限（秒）",
        yue: "時間上限（秒）",
    },
    missing_media_check_run_after_update_setting: {
        fi: "Tarkista kerran jokaisen päivityksen jälkeen",
        en: "Check once after every update",
        ch: "每次更新后检查一次",
        yue: "每次更新之後檢查一次",
    },
    missing_media_check_run_on_startup_setting: {
        fi: "Tarkista jokaisella palvelimen käynnistyksellä",
        en: "Check at every server start",
        ch: "每次服务器启动时检查",
        yue: "每次伺服器啟動嗰陣檢查",
    },
    missing_media_check_startup_delay_setting: {
        fi: "Odotus palvelimen käynnistyksen jälkeen sekunteina",
        en: "Wait after the server starts, in seconds",
        ch: "服务器启动后等待的秒数",
        yue: "伺服器啟動之後等候嘅秒數",
    },
    missing_media_check_exact_count_setting: {
        fi: "Yhden aineiston rivit lasketaan tarkasti enintään",
        en: "Rows counted exactly in one dataset, at most",
        ch: "每个数据集最多精确计数的行数",
        yue: "每個資料集最多準確計算嘅行數",
    },
    missing_media_check_unused_files_setting: {
        fi: "Kerro myös tiedostoista, joihin mikään tunnistettu viittaus ei osoita",
        en: "Also report files no recognised reference uses",
        ch: "同时报告没有被任何已识别引用使用的文件",
        yue: "同時報告冇任何已識別引用用到嘅檔案",
    },
    missing_media_check_max_reported_missing_setting: {
        fi: "Puuttuvia tiedostoja luetellaan enintään",
        en: "Missing files listed, at most",
        ch: "最多列出的缺失文件数",
        yue: "最多列出嘅唔見咗檔案數目",
    },
    missing_media_check_max_reported_unused_setting: {
        fi: "Tiedostoja, joihin mikään tunnistettu viittaus ei osoita, luetellaan enintään",
        en: "Files no recognised reference uses, listed at most",
        ch: "最多列出的没有被任何已识别引用使用的文件数",
        yue: "最多列出嘅冇任何已識別引用用到嘅檔案數目",
    },

    // --- Summary of the last check ---
    missing_media_check_last_run: { fi: "Viimeisin tarkistus", en: "Last check", ch: "上次检查", yue: "上次檢查" },
    missing_media_check_trigger: { fi: "Käynnistäjä", en: "Started by", ch: "启动方式", yue: "啟動方式" },
    missing_media_check_trigger_manual: { fi: "ylläpitäjä", en: "an administrator", ch: "管理员", yue: "管理員" },
    missing_media_check_trigger_startup: {
        fi: "palvelimen käynnistys",
        en: "the server start",
        ch: "服务器启动",
        yue: "伺服器啟動",
    },
    missing_media_check_trigger_update: { fi: "päivitys", en: "an update", ch: "更新", yue: "更新" },
    missing_media_check_app_version: { fi: "Sovelluksen versio", en: "Application version", ch: "应用程序版本", yue: "應用程式版本" },
    missing_media_check_db_version: { fi: "Tietokannan versio", en: "Database version", ch: "数据库版本", yue: "資料庫版本" },
    missing_media_check_datasets_checked: {
        fi: "Tarkistettuja aineistoja",
        en: "Datasets checked",
        ch: "已检查的数据集",
        yue: "已檢查嘅資料集",
    },
    missing_media_check_rows_checked: { fi: "Tarkistettuja rivejä", en: "Rows checked", ch: "已检查的行数", yue: "已檢查嘅行數" },
    missing_media_check_missing_files: { fi: "Puuttuvia tiedostoja", en: "Missing files", ch: "缺失的文件", yue: "唔見咗嘅檔案" },
    missing_media_check_card_pictures_checked: {
        fi: "Tarkistettuja korttikuvia",
        en: "Card pictures checked",
        ch: "已检查的卡片图片",
        yue: "已檢查嘅卡片圖片",
    },
    missing_media_check_missing_card_pictures: {
        fi: "Puuttuvia korttikuvia",
        en: "Missing card pictures",
        ch: "缺失的卡片图片",
        yue: "唔見咗嘅卡片圖片",
    },
    missing_media_check_unused_files: {
        fi: "Tiedostoja, joihin mikään tunnistettu viittaus ei osoita",
        en: "Files no recognised reference uses",
        ch: "没有被任何已识别引用使用的文件",
        yue: "冇任何已識別引用用到嘅檔案",
    },
    missing_media_check_all_present: {
        fi: "Jokainen tarkistettu tiedosto löytyi levyltä.",
        en: "Every checked file was found on disk.",
        ch: "所有已检查的文件都在磁盘上找到。",
        yue: "所有已檢查嘅檔案都喺磁碟上搵到。",
    },
    missing_media_check_legacy_filename: {
        fi: "vanha tiedostonimimuoto",
        en: "retired filename form",
        ch: "旧的文件名格式",
        yue: "舊嘅檔案名格式",
    },
    missing_media_check_unresolved_reference: {
        fi: "viittausta ei voi paikantaa levyltä",
        en: "the reference cannot be placed on disk",
        ch: "无法在磁盘上定位该引用",
        yue: "喺磁碟上定位唔到呢個引用",
    },

    // --- Notices about how far the last check reached ---
    missing_media_check_run_failed: {
        fi: "Viimeisin tarkistus epäonnistui ennen kuin se valmistui. Syyt ovat alla olevissa tiedoissa.",
        en: "The last check failed before it finished. The reasons are in the details below.",
        ch: "上次检查在完成前失败。原因见下方详情。",
        yue: "上次檢查喺完成之前失敗咗。原因喺下面嘅詳情入面。",
    },
    missing_media_check_datasets_exceed_budget: {
        fi: "Aineistoja on enemmän kuin työmäärän yläraja sallii rivejä, joten osa aineistoista jäi kokonaan tarkistamatta. Nosta ylärajaa.",
        en: "There are more datasets than the work limit allows rows, so some datasets were not checked at all. Raise the limit.",
        ch: "数据集数量超过了工作量上限所允许的行数，因此有些数据集完全没有被检查。请提高上限。",
        yue: "資料集嘅數量多過工作量上限容許嘅行數，所以有啲資料集完全冇檢查過。請調高上限。",
    },
    missing_media_check_minimum_not_met: {
        fi: "Rivien yläraja oli liian pieni, jotta jokaisesta aineistosta olisi tarkistettu vähimmäismäärä rivejä.",
        en: "The row limit was too small to check the minimum number of rows in every dataset.",
        ch: "行数上限太小，无法在每个数据集中检查最少行数。",
        yue: "行數上限太細，冇辦法喺每個資料集檢查最少嘅行數。",
    },
    missing_media_check_time_budget_reached: {
        fi: "Aikaraja tuli vastaan, joten tarkistus jäi kesken.",
        en: "The time limit was reached, so the check stopped early.",
        ch: "已达到时间上限，因此检查提前停止。",
        yue: "已經到咗時間上限，所以檢查提早停咗。",
    },
    missing_media_check_row_budget_reached: {
        fi: "Työmäärän yläraja tuli vastaan: tarkistettiin otos, ei kaikkia rivejä.",
        en: "The work limit was reached: a sample was checked instead of every row.",
        ch: "已达到工作量上限：检查的是样本，而不是全部行。",
        yue: "已經到咗工作量上限：檢查嘅係樣本，唔係全部行。",
    },
    missing_media_check_row_count_estimated: {
        fi: "Osa aineistoista on niin suuria, että niiden rivimäärä arvioitiin laskematta, joten niitä ei koskaan ilmoiteta kokonaan tarkistetuiksi.",
        en: "Some datasets are so large that their rows were estimated instead of counted, so they are never reported as fully checked.",
        ch: "有些数据集太大，其行数是估算而非计数得出的，因此它们永远不会被报告为已完全检查。",
        yue: "有啲資料集太大，佢哋嘅行數係估算出嚟而唔係數出嚟，所以佢哋永遠唔會被報告為完全檢查過。",
    },
    missing_media_check_card_pass_incomplete: {
        fi: "Korttikuvien tarkistus pysähtyi ennen kuin se oli lukenut jokaisen kuvakentän, joten osa korttikuvista jäi tarkistamatta. Sen pysäytti rivien yläraja, aikaraja tai alla olevissa tiedoissa näkyvä virhe.",
        en: "The card picture check stopped before it had read every picture field, so some card pictures were not checked. The row limit, the time limit or an error shown in the details below stopped it.",
        ch: "卡片图片检查在读完每个图片字段之前就停止了，因此有些卡片图片没有被检查。导致停止的是行数上限、时间上限或下方详情中显示的错误。",
        yue: "卡片圖片檢查喺讀晒每個圖片欄位之前已經停咗，所以有啲卡片圖片冇檢查到。令佢停低嘅係行數上限、時間上限，或者下面詳情入面顯示嘅錯誤。",
    },
    missing_media_check_missing_list_truncated: {
        fi: "Puuttuvista tiedostoista luetellaan vain ensimmäiset $count.",
        en: "Only the first $count missing files are listed.",
        ch: "只列出前 $count 个缺失的文件。",
        yue: "只列出頭 $count 個唔見咗嘅檔案。",
    },
    missing_media_check_unused_list_truncated: {
        fi: "Tiedostoista, joihin mikään tunnistettu viittaus ei osoita, luetellaan vain ensimmäiset $count.",
        en: "Only the first $count files no recognised reference uses are listed.",
        ch: "只列出前 $count 个没有被任何已识别引用使用的文件。",
        yue: "只列出頭 $count 個冇任何已識別引用用到嘅檔案。",
    },
    missing_media_check_unused_walk_incomplete: {
        fi: "Aikaraja loppui kesken sellaisten tiedostojen etsinnän, joihin mikään tunnistettu viittaus ei osoita, joten niiden luettelo on vajaa.",
        en: "The time limit ran out while files no recognised reference uses were being looked for, so their list is incomplete.",
        ch: "查找没有被任何已识别引用使用的文件期间，时间上限已到，因此该列表不完整。",
        yue: "搵緊冇任何已識別引用用到嘅檔案嗰陣，時間上限已經到咗，所以呢份清單唔完整。",
    },
    missing_media_check_unused_withheld_datasets_incomplete: {
        fi: "Tiedostoja, joihin mikään tunnistettu viittaus ei osoita, ei etsitty, koska kaikkia aineistoja ei tarkistettu kokonaan. Minkä tahansa aineiston rivi voi osoittaa mihin tahansa kansioon, joten luettelo edellyttää jokaisen aineiston ja jokaisen kuvakentän lukemista kokonaan.",
        en: "Files no recognised reference uses were not looked for, because not every dataset was checked completely. A row of any dataset can point into any folder, so that list needs every dataset and every picture field read in full.",
        ch: "本次未查找“没有被任何已识别引用使用的文件”，因为并非每个数据集都已完全检查。任何数据集的行都可能指向任何文件夹，因此必须完整读取每个数据集和每个图片字段，才能列出这些文件。",
        yue: "今次冇去搵「冇任何已識別引用用到嘅檔案」，因為唔係每個資料集都完全檢查過。任何資料集嘅行都可能指向任何資料夾，所以一定要完整讀晒每個資料集同每個圖片欄位，先可以列出呢啲檔案。",
    },
    missing_media_check_unused_withheld_card_pass_incomplete: {
        fi: "Tiedostoja, joihin mikään tunnistettu viittaus ei osoita, ei etsitty, koska kaikkia kuvakenttiä ei luettu. Minkä tahansa aineiston rivi voi osoittaa mihin tahansa kansioon, joten luettelo edellyttää jokaisen aineiston ja jokaisen kuvakentän lukemista kokonaan.",
        en: "Files no recognised reference uses were not looked for, because not every picture field was read. A row of any dataset can point into any folder, so that list needs every dataset and every picture field read in full.",
        ch: "本次未查找“没有被任何已识别引用使用的文件”，因为并非每个图片字段都已读取。任何数据集的行都可能指向任何文件夹，因此必须完整读取每个数据集和每个图片字段，才能列出这些文件。",
        yue: "今次冇去搵「冇任何已識別引用用到嘅檔案」，因為唔係每個圖片欄位都讀過。任何資料集嘅行都可能指向任何資料夾，所以一定要完整讀晒每個資料集同每個圖片欄位，先可以列出呢啲檔案。",
    },

    // --- Details disclosure ---
    missing_media_check_details: {
        fi: "Viimeisimmän tarkistuksen tiedot",
        en: "Details of the last check",
        ch: "上次检查的详情",
        yue: "上次檢查嘅詳情",
    },
    missing_media_check_errors: { fi: "Virheet", en: "Errors", ch: "错误", yue: "錯誤" },
    missing_media_check_unreached_datasets: {
        fi: "Aineistot, joita ei tarkistettu",
        en: "Datasets that were not checked",
        ch: "未被检查的数据集",
        yue: "冇檢查到嘅資料集",
    },
    missing_media_check_unreached_lookup_failed: {
        fi: "sen tallennuskansiota ei löytynyt",
        en: "its storage folder could not be found",
        ch: "找不到其存储文件夹",
        yue: "搵唔到佢嘅儲存資料夾",
    },
    missing_media_check_unreached_count_failed: {
        fi: "sen rivejä ei voitu laskea",
        en: "its rows could not be counted",
        ch: "无法统计其行数",
        yue: "數唔到佢嘅行數",
    },
    missing_media_check_unreached_read_failed: {
        fi: "sen rivejä ei voitu lukea",
        en: "its rows could not be read",
        ch: "无法读取其行",
        yue: "讀取唔到佢嘅行",
    },
    missing_media_check_unreached_time_limit: {
        fi: "aikaraja loppui ensin",
        en: "the time limit ran out first",
        ch: "时间上限先到了",
        yue: "時間上限先到咗",
    },
    missing_media_check_unreached_no_budget: {
        fi: "rivien yläraja ei jättänyt sille rivejä",
        en: "the row limit left no rows for it",
        ch: "行数上限没有给它留下任何行",
        yue: "行數上限冇留低任何行畀佢",
    },
    missing_media_check_column_dataset: { fi: "Aineisto", en: "Dataset", ch: "数据集", yue: "資料集" },
    missing_media_check_column_rows: { fi: "Rivejä", en: "Rows", ch: "行数", yue: "行數" },
    missing_media_check_column_planned: { fi: "Suunniteltu", en: "Planned", ch: "计划", yue: "計劃" },
    missing_media_check_column_checked: { fi: "Tarkistettu", en: "Checked", ch: "已检查", yue: "已檢查" },
    missing_media_check_column_missing: { fi: "Puuttuu", en: "Missing", ch: "缺失", yue: "唔見咗" },
    missing_media_check_column_complete: { fi: "Kokonaan tarkistettu", en: "Fully checked", ch: "已完全检查", yue: "完全檢查過" },
    missing_media_check_column_unused: {
        fi: "Ei tunnistettua viittausta",
        en: "No recognised reference",
        ch: "无已识别引用",
        yue: "冇已識別引用",
    },
    missing_media_check_yes: { fi: "kyllä", en: "yes", ch: "是", yue: "係" },
    missing_media_check_no: { fi: "ei", en: "no", ch: "否", yue: "唔係" },
    missing_media_check_estimated: { fi: "arvio", en: "estimated", ch: "估算", yue: "估算" },
    missing_media_check_unused_skipped: { fi: "ei etsitty", en: "not looked for", ch: "未查找", yue: "冇搵" },
    missing_media_check_kept_card_pictures: {
        fi: "Toisen rivin kansiosta säilytetyt korttikuvat",
        en: "Card pictures kept from another row's folder",
        ch: "来自其他行文件夹并被保留的卡片图片",
        yue: "嚟自其他行資料夾、仍然保留緊嘅卡片圖片",
    },
    missing_media_check_kept_card_pictures_explanation: {
        fi: "Tällainen korttikuva pysyy kortissa silloinkin, kun rivillä on omia kuvia, kunnes ylläpitäjä tyhjentää korttikuvakentän.",
        en: "Such a card picture stays on its card, even when the row has pictures of its own, until an administrator clears the card picture field.",
        ch: "这类卡片图片会一直留在卡片上，即使该行有自己的图片也是如此，直到管理员清空卡片图片字段为止。",
        yue: "呢類卡片圖片會一直留喺卡片上，就算嗰行有自己嘅圖片都係噉，直到管理員清空卡片圖片欄位為止。",
    },
    missing_media_check_unchecked_card_pictures: {
        fi: "Kuvat, joita ei voitu tarkistaa",
        en: "Pictures that could not be checked",
        ch: "无法检查的图片",
        yue: "檢查唔到嘅圖片",
    },
    missing_media_check_unchecked_files: {
        fi: "Tiedostot, joita ei voitu tarkistaa",
        en: "Files that could not be checked",
        ch: "无法检查的文件",
        yue: "檢查唔到嘅檔案",
    },
    missing_media_check_unchecked_card_pictures_explanation: {
        fi: "Levy- tai käyttöoikeusvirhe esti selvittämästä, onko tiedosto olemassa, joten näitä kuvia ei ilmoiteta puuttuviksi.",
        en: "A disk or permission error kept the check from telling whether these files exist, so they are not reported as missing.",
        ch: "磁盘或权限错误使检查无法确定这些文件是否存在，因此它们不会被报告为缺失。",
        yue: "磁碟或者權限錯誤令檢查判斷唔到呢啲檔案係咪存在，所以佢哋唔會被報告為唔見咗。",
    },
    missing_media_check_card_list_truncated: {
        fi: "Näistä luetellaan vain ensimmäiset $count.",
        en: "Only the first $count of these are listed.",
        ch: "这里只列出前 $count 项。",
        yue: "呢度只列出頭 $count 項。",
    },
    missing_media_check_unused_files_note: {
        fi: "Pelkästään vapaassa tekstissä, esimerkiksi kuvauksen sisällä, olevaa kuvalinkkiä ei tunnisteta, joten varmista jokainen luettelon tiedosto ennen kuin poistat sen. Tarkistus itse ei poista mitään.",
        en: "A picture linked only from free text, for example inside a description, is not recognised, so verify each file on this list before you remove it. The check itself never deletes anything.",
        ch: "仅在自由文本中链接的图片，例如描述中的图片，不会被识别，因此在删除此列表中的文件之前，请先逐一核实。检查本身从不删除任何内容。",
        yue: "只喺自由文字入面連結嘅圖片，例如描述入面嘅圖片，唔會被識別，所以刪除呢個清單入面嘅檔案之前，請先逐個核實。檢查本身從來唔會刪除任何嘢。",
    },
    missing_media_check_sampling_seed: { fi: "Satunnaisuuden siemen", en: "Random seed", ch: "随机种子", yue: "隨機種子" },
});

/**
 * The English copy for a key, with `$count` filled in. It is only the first paint:
 * the page translator replaces it with the reader's language as soon as the element
 * carrying the key is added.
 *
 * @param {string} langKey
 * @param {string|number|null} [variable=null]
 * @returns {string}
 */
export function englishMissingMediaCheckCopy(langKey, variable = null) {
    const copy = MISSING_MEDIA_CHECK_TRANSLATION_FALLBACKS[langKey]?.en ?? langKey;
    return variable === null ? copy : copy.split("$count").join(String(variable));
}

/**
 * Creates an element whose text comes from a language key of this section, `$count`
 * filled from variable, so the table above is the section's only English.
 *
 * @param {string} tagName
 * @param {string} langKey
 * @param {string|number|null} [variable=null]
 * @returns {HTMLElement}
 */
export function missingMediaCheckTextElement(tagName, langKey, variable = null) {
    const element = document.createElement(tagName);
    element.dataset.langKey = variable === null ? langKey : `${langKey}+${variable}`;
    element.textContent = englishMissingMediaCheckCopy(langKey, variable);
    return element;
}
