// login_page_lang_key_creator.go
// Seeds startup-owned language keys for the standalone login page copy.
// Bridges server startup and the system_lang_keys table used by frontend localisation.
// Exists so the login page ships with stable multilingual intro and tour text
// instead of relying on missing-key fallback text or manual admin seeding.
package startup

import (
	"database/sql"
	"log"
)

const (
	loginPagePlatformStorySiteIntroFI = "<p><strong>Filterest</strong> on monikielinen alusta rakenteisille sivustoille ja työtiloille. Se yhdistää tietosisällön, haun, näkymät, käyttöoikeudet ja hallinnan samaan käyttöliittymään.</p>"
	loginPagePlatformStorySiteIntroEN = "<p><strong>Filterest</strong> is a multilingual platform for structured sites and workspaces. It brings content, search, views, permissions, and administration into one interface.</p>"
	loginPagePlatformStorySiteIntroCH = "<p><strong>Filterest</strong> 是面向结构化网站和工作区的多语言平台。它把内容、搜索、视图、权限和管理集中在同一个界面中。</p>"
	loginPagePlatformStorySiteHTMLFI  = loginPagePlatformStorySiteIntroFI +
		"<h3>Mihin se voi kasvaa</h3>" +
		"<p>Filterest voi toimia julkisena palvelukatalogina, sisäisenä palvelu-, tiketti- tai dokumentaatiotyötilana, uutis- tai tapahtumasivustona, erikoisalan hakutietokantana tai teknisenä tietopankkina. Sama perusmalli sopii sekä avoimeen selailuun että kirjautumista vaativaan yhteistyöhön.</p>" +
		"<h3>Yksi sisältö, monta käyttötapaa</h3>" +
		"<p>Tietoa voidaan näyttää kortteina, taulukoina, artikkeleina tai muina näkymänä tilanteen mukaan. Hakua, suodatusta, suhteita, mediaa ja monikielistä sisältöä voidaan käyttää ilman että sivustosta tulee erillisten työkalujen kokoelma.</p>" +
		"<h3>Hallittu julkaisu</h3>" +
		"<p>Julkiset lukijat, sisäiset käyttäjät, editorit ja ylläpitäjät voidaan erottaa oikeuksilla. Näin sama sivusto voi alkaa pienestä kuratoidusta tietokannasta ja kasvaa myöhemmin hallituksi yhteistyöalustaksi.</p>"
	loginPagePlatformStorySiteHTMLEN = loginPagePlatformStorySiteIntroEN +
		"<h3>What it can become</h3>" +
		"<p>Filterest can become a public service catalog, an internal service, ticket, or documentation workspace, a public news or event site, a specialist reference database, or a technical knowledge base. The same foundation can support open browsing, private collaboration, or a carefully moderated mix of both.</p>" +
		"<h3>One content model, several ways to use it</h3>" +
		"<p>Information can appear as cards, tables, articles, or other task-specific views. Search, filtering, relations, media, and multilingual content stay part of one coherent site instead of becoming a pile of separate tools.</p>" +
		"<h3>Publishing with control</h3>" +
		"<p>Public readers, internal users, editors, and administrators can be separated by permissions. That lets a site start as a small curated database and later grow into a managed collaborative workspace.</p>"
	loginPagePlatformStorySiteHTMLCH = loginPagePlatformStorySiteIntroCH +
		"<h3>它可以发展成什么</h3>" +
		"<p>Filterest 可以成为公共服务目录、内部服务/工单/文档工作区、公共新闻或活动网站、专业参考数据库，或技术知识库。同一个基础可以支持开放浏览、私有协作，或经过审核的混合模式。</p>" +
		"<h3>一个内容模型，多种使用方式</h3>" +
		"<p>信息可以按卡片、表格、文章或其他任务视图呈现。搜索、筛选、关联、媒体和多语言内容都保留在一个连贯的网站中，而不是散落在多个工具里。</p>" +
		"<h3>可控发布</h3>" +
		"<p>公开读者、内部用户、编辑和管理员可以通过权限区分。网站可以先从小型策展数据库开始，再逐步成长为受管理的协作工作区。</p>"
	previousLoginPagePlatformStorySiteFI   = "<p>Easelect on kompakti sovellusalusta rakenteiselle tiedolle: tietokanta, käyttöliittymä, haku, käyttöoikeudet ja hallinta elävät samassa tuotteessa.</p>"
	previousLoginPagePlatformStorySiteEN   = "<p>Easelect is a compact application platform for structured information, where database logic, UI, search, permissions, and administration live in one product.</p>"
	previousLoginPagePlatformStorySiteCH   = "<p><strong>$site_name</strong> 是用 Easelect 构建出来的一个示例。Easelect 是面向结构化信息的紧凑型应用平台，把数据库逻辑、界面、搜索、权限和管理集中在同一个产品里。</p>"
	legacyLoginPagePlatformStorySiteHTMLFI = "<p><strong>$site_name</strong> on yksi esimerkki siitä, mitä Easelectillä voidaan rakentaa. Easelect on kompakti sovellusalusta rakenteiselle tiedolle: tietokanta, käyttöliittymä, haku, käyttöoikeudet ja hallinta elävät samassa tuotteessa.</p>"
	legacyLoginPagePlatformStorySiteHTMLEN = "<p><strong>$site_name</strong> is one example of what can be built with Easelect. Easelect is a compact application platform for structured information, where database logic, UI, search, permissions, and administration live in one product.</p>"
)

var loginPageLangKeySeeds = []startupLangKeySeed{
	{
		langKey: "login_page_intro_site_html",
		fi:      "<p>Tervetuloa palveluun <strong>$site_name</strong>. Kirjaudu sisään jatkaaksesi tähän monikieliseen työtilaan.</p>",
		en:      "<p>Welcome to <strong>$site_name</strong>. Sign in to continue to this multilingual workspace.</p>",
		ch:      "<p>欢迎使用 <strong>$site_name</strong>。登录后即可继续进入这个多语言工作区。</p>",
	},
	{
		langKey: "login_page_tab_tour",
		fi:      "Esittely",
		en:      "Tour",
		ch:      "导览",
	},
	{
		langKey: "login_page_platform_story_easelect_html",
		fi: "<p><strong>Easelect</strong> on monikielinen tietokantatyökalu ja sovellusalusta. Se kokoaa tietomallin, käyttöliittymän, haun, käyttöoikeudet ja hallinnan saman ytimen ympärille, jotta rakenteisesta tiedosta voidaan rakentaa kokonaisia tuotantokäyttöisiä järjestelmiä.</p>" +
			"<h3>Samasta ytimestä monta järjestelmää</h3>" +
			"<p>Easelect voi toimia palvelukatalogina, tikettijärjestelmänä, dokumentti- ja liitekirjastona, huoltohistoriana, rekisterinä, CRM-tyylisenä työtilana tai listauspohjaisena markkinapaikkana. Ideana ei ole yksi valmis sapluuna, vaan sovellusalusta, jonka päälle eri käyttötapaukset voidaan mallintaa nopeasti.</p>" +
			"<h3>Yksi tietojoukko, useita näkymiä</h3>" +
			"<p>Sama data voidaan avata kortteina, laajempina detail-kortteina, tauluna, 90 astetta käännettynä tauluna, puuna, tikettinäkymänä tai asetuksina. Käyttäjä ei joudu siirtymään eri työkalujen välillä vain siksi, että tarkastelutapa vaihtuu.</p>" +
			"<h3>Navigointi ja suodatus tekevät eri työn</h3>" +
			"<p>Navigoinnilla valitaan työtila, sovelluksen osa tai käsiteltävä tietojoukko. Filtteripalkki taas rajaa avoinna olevan sisällön sarake kerrallaan. Haku, lajittelu ja aktiiviset rajaukset pysyvät näkyvinä osana normaalia käyttöä myös mobiilissa.</p>" +
			"<h3>Monikieliset valikot ja monikielinen sisältö</h3>" +
			"<p>Valikot, napit ja järjestelmätekstit voidaan lokalisoida omana kerroksenaan. Lisäksi itse tallennettu sisältö voi olla kenttäkohtaisesti monikielistä. Näin sama sovellus voi palvella eri käyttäjäryhmiä ilman erillisiä kielikohtaisia kopioita.</p>" +
			"<h3>AI-haku ja tietosisällön rikastaminen</h3>" +
			"<p>Easelect yhdistää klassisen tekstihakemisen ja vektoripohjaisen semanttisen haun. Tekoälyä voidaan käyttää myös käännösten tukemiseen, sisällön rikastamiseen ja muihin työnkulkuihin juuri siellä, missä siitä syntyy käytännön hyötyä.</p>" +
			"<h3>Tietomalli ja CRUD suoraan käyttöliittymästä</h3>" +
			"<p>Tauluja, sarakkeita, rivejä, suhteita ja näkymäasetuksia voidaan hallita samassa ympäristössä, jossa dataa käytetään. Tämä tekee alustasta sopivan sekä varsinaiseen tuotantokäyttöön että uusien sovellusten iteratiiviseen rakentamiseen.</p>" +
			"<h3>Tietoturva kuuluu runkoon</h3>" +
			"<p>Palvelinreitit kulkevat keskitetyn käyttöoikeus- ja tietoturvakerroksen läpi. Käytössä ovat muun muassa roolit, keskitetty pääsynvalvonta, CSRF- ja fingerprint-tarkistukset, suojausotsakkeet, rate limiting, palomuuritoiminnot, IP-estot ja sähköpostivalmiit työnkulut.</p>" +
			"<h3>Suunta eteenpäin</h3>" +
			"<p>Easelectin seuraava luonnollinen askel on syvempi agenttityöskentely: MCP-tyylinen toimija, jolla on oma tietokantakontekstinsa mukana ja joka pystyy työskentelemään saman sovellusalustan päällä turvallisesti ja tarkoituksenmukaisesti.</p>",
		en: "<p><strong>Easelect</strong> is a multilingual database tool and application platform. It brings data modeling, UI, search, permissions, and administration into one core so structured information can become full production-ready systems instead of scattered parts.</p>" +
			"<h3>One core, many kinds of systems</h3>" +
			"<p>Easelect can power a service catalog, ticketing system, document and attachment library, maintenance log, registry, CRM-style workspace, or marketplace-style listing service. The point is not one rigid template, but an application platform that can be shaped into different products quickly.</p>" +
			"<h3>One dataset, multiple views</h3>" +
			"<p>The same data can open as cards, expanded record cards, tables, transposed tables, trees, ticket views, or dataset settings. Users do not need to jump between separate tools just because the presentation mode changes.</p>" +
			"<h3>Navigation and filtering do different jobs</h3>" +
			"<p>Navigation chooses the workspace, feature area, or dataset. The filter bar refines the currently open data column by column. Search, sorting, and active constraints stay visible as part of normal use on desktop and mobile.</p>" +
			"<h3>Multilingual menus and multilingual content</h3>" +
			"<p>Menus, controls, and system copy can be localized as one layer, while stored content can also be multilingual field by field. That makes it possible to serve different audiences from the same application without maintaining separate language-specific copies.</p>" +
			"<h3>AI search and content enrichment</h3>" +
			"<p>Easelect combines classic text retrieval with vector-based semantic search. AI can also support translation workflows, content enrichment, and other tasks exactly where it creates practical value instead of being bolted on for its own sake.</p>" +
			"<h3>Data modeling and CRUD inside the same interface</h3>" +
			"<p>Tables, columns, rows, relations, and view settings can be managed from the same environment where the data is used. That makes the platform suitable both for production operations and for iteratively building new applications.</p>" +
			"<h3>Security belongs to the foundation</h3>" +
			"<p>Server routes pass through a centralized access-control and security layer. The platform already includes roles, centralized authorization checks, CSRF and fingerprint validation, security headers, rate limiting, firewall features, IP blocking, and email-ready workflows.</p>" +
			"<h3>Where it goes next</h3>" +
			"<p>The natural next step for Easelect is deeper agentic work: an MCP-style actor that carries its own database-backed context and operates on top of the same platform in a controlled, useful way.</p>",
		ch: "<p><strong>Easelect</strong> 是一个多语言数据库工具与应用平台。它把数据建模、界面、搜索、权限和管理整合到同一个核心中，让结构化信息能够直接成长为可投入生产的系统。</p>" +
			"<h3>同一个核心，可以长成多种系统</h3>" +
			"<p>Easelect 可以承载服务目录、工单系统、文档与附件资料库、维护记录、登记系统、CRM 式工作区，或列表型交易平台。重点不是单一模板，而是一个可以快速塑形成不同产品的应用平台。</p>" +
			"<h3>同一份数据，多种视图</h3>" +
			"<p>同一份数据可以切换成卡片、扩展记录卡、表格、转置表格、树形视图、工单视图或设置视图。展示方式变化时，用户无需切换到完全不同的工具。</p>" +
			"<h3>导航与筛选各司其职</h3>" +
			"<p>导航负责选择工作区、功能区或数据集；筛选栏负责逐列收窄当前打开的数据。搜索、排序与当前约束会持续保持可见，在桌面和移动端都属于正常工作流的一部分。</p>" +
			"<h3>多语言菜单与多语言内容</h3>" +
			"<p>菜单、控件和系统文案可以单独本地化，而存储内容本身也可以按字段支持多语言。这样同一个应用无需维护多套语言副本，也能服务不同受众。</p>" +
			"<h3>AI 搜索与内容增强</h3>" +
			"<p>Easelect 结合了传统文本检索与向量语义搜索。AI 也可以用于翻译辅助、内容增强以及其他真正带来实际价值的流程，而不是表面叠加。</p>" +
			"<h3>在同一界面里完成数据建模与 CRUD</h3>" +
			"<p>表、列、行、关系与视图设置都可以在使用数据的同一环境中管理。这让平台既适合生产运行，也适合迭代式构建新应用。</p>" +
			"<h3>安全能力属于底层基础</h3>" +
			"<p>服务端路由会经过统一的权限与安全层。平台已经具备角色体系、集中鉴权、CSRF 与指纹校验、安全响应头、限流、防火墙能力、IP 封锁，以及邮件就绪的流程。</p>" +
			"<h3>下一步方向</h3>" +
			"<p>Easelect 的自然延伸是更深入的代理式工作流：让 MCP 风格的智能体带着自己的数据库上下文，在同一平台之上受控而高效地工作。</p>",
	},
	{
		langKey: "login_page_platform_story_site_html",
		fi:      loginPagePlatformStorySiteHTMLFI,
		en:      loginPagePlatformStorySiteHTMLEN,
		ch:      loginPagePlatformStorySiteHTMLCH,
	},
	{
		langKey: "login_page_tour_gallery_heading",
		fi:      "Kurkistuksia käyttöliittymään",
		en:      "Interface snapshots",
		ch:      "界面快照",
	},
	{
		langKey: "login_page_tour_gallery_intro",
		fi:      "Avaa kuvankaappaus suureksi nähdäksesi, miten navigointi, kortit, taulut ja filtterit toimivat samassa käyttöliittymässä.",
		en:      "Open a screenshot to inspect how navigation, cards, tables, and filters work together in the same UI.",
		ch:      "点开截图即可更清楚地查看导航、卡片、表格和筛选如何在同一个界面里协同工作。",
	},
	{
		langKey: "login_page_tour_image_full_shell_title",
		fi:      "Koko sovelluksen työtila",
		en:      "Full application workspace",
		ch:      "完整应用工作区",
	},
	{
		langKey: "login_page_tour_image_full_shell_caption",
		fi:      "Kortit, navigointi ja filtterit samassa näkymässä.",
		en:      "Cards, navigation, and filtering in one continuous workspace.",
		ch:      "卡片、导航与筛选在同一工作区里协同出现。",
	},
	{
		langKey: "login_page_tour_image_full_shell_alt",
		fi:      "Kuvankaappaus koko sovelluksen työtilasta.",
		en:      "Screenshot of the full application workspace.",
		ch:      "完整应用工作区截图。",
	},
	{
		langKey: "login_page_tour_image_navbar_title",
		fi:      "Navigointi ja työkalut",
		en:      "Navigation and tools",
		ch:      "导航与工具",
	},
	{
		langKey: "login_page_tour_image_navbar_caption",
		fi:      "Päävälilehdet, teemavaihto ja kielivalinta pysyvät aina lähellä.",
		en:      "Main tabs, theme switching, and language controls stay within easy reach.",
		ch:      "主标签、主题切换和语言控制始终触手可及。",
	},
	{
		langKey: "login_page_tour_image_navbar_alt",
		fi:      "Kuvankaappaus navigaatiopalkista.",
		en:      "Screenshot of the navigation bar.",
		ch:      "导航栏截图。",
	},
	{
		langKey: "login_page_tour_image_card_view_title",
		fi:      "Korttinäkymä",
		en:      "Card view",
		ch:      "卡片视图",
	},
	{
		langKey: "login_page_tour_image_card_view_caption",
		fi:      "Kortit tuovat yhteen tiiviin yleiskuvan, mediaelementit ja nopean siirtymän yksityiskohtiin.",
		en:      "Cards combine quick scanning, media, and a fast path into deeper record detail.",
		ch:      "卡片视图把快速浏览、媒体内容和深入详情入口结合在一起。",
	},
	{
		langKey: "login_page_tour_image_card_view_alt",
		fi:      "Kuvankaappaus korttinäkymästä.",
		en:      "Screenshot of the card view.",
		ch:      "卡片视图截图。",
	},
	{
		langKey: "login_page_tour_image_table_view_title",
		fi:      "Taulunäkymä",
		en:      "Table view",
		ch:      "表格视图",
	},
	{
		langKey: "login_page_tour_image_table_view_caption",
		fi:      "Taulu sopii vertailuun, nopeaan editointiin ja laajojen tietomassojen hallintaan.",
		en:      "Tables support comparison, quick editing, and dense information management.",
		ch:      "表格视图适合对比、快速编辑与高密度信息管理。",
	},
	{
		langKey: "login_page_tour_image_table_view_alt",
		fi:      "Kuvankaappaus taulunäkymästä.",
		en:      "Screenshot of the table view.",
		ch:      "表格视图截图。",
	},
	{
		langKey: "login_page_tour_image_filterbar_title",
		fi:      "Filtteripalkki",
		en:      "Filter bar",
		ch:      "筛选栏",
	},
	{
		langKey: "login_page_tour_image_filterbar_caption",
		fi:      "Haku, sarakekohtaiset suodattimet, lajittelu ja aktiiviset rajaukset toimivat yhdessä.",
		en:      "Search, column-level filters, sorting, and active constraints work together in one surface.",
		ch:      "搜索、列级筛选、排序与当前约束集中在同一块操作区中。",
	},
	{
		langKey: "login_page_tour_image_filterbar_alt",
		fi:      "Kuvankaappaus filtteripalkista.",
		en:      "Screenshot of the filter bar.",
		ch:      "筛选栏截图。",
	},
}

// EnsureLoginPageLangKeys seeds the multilingual intro copy used by the login page.
func EnsureLoginPageLangKeys(db *sql.DB) {
	const upsertQuery = `
		INSERT INTO system_lang_keys (lang_key, fi, en, ch)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (lang_key) DO UPDATE
			SET fi = CASE WHEN system_lang_keys.fi IS NULL OR system_lang_keys.fi = '' THEN EXCLUDED.fi ELSE system_lang_keys.fi END,
			    en = CASE WHEN system_lang_keys.en IS NULL OR system_lang_keys.en = '' THEN EXCLUDED.en ELSE system_lang_keys.en END,
			    ch = CASE WHEN system_lang_keys.ch IS NULL OR system_lang_keys.ch = '' THEN EXCLUDED.ch ELSE system_lang_keys.ch END
	`

	for _, seed := range loginPageLangKeySeeds {
		_, err := db.Exec(upsertQuery, seed.langKey, seed.fi, seed.en, seed.ch)
		if err != nil {
			log.Printf("[STARTUP] Error upserting login page lang key %q: %v", seed.langKey, err)
		}
	}

	replacements := []struct {
		oldFI string
		newFI string
		oldEN string
		newEN string
		oldCH string
		newCH string
	}{
		{
			oldFI: legacyLoginPagePlatformStorySiteHTMLFI,
			newFI: loginPagePlatformStorySiteHTMLFI,
			oldEN: legacyLoginPagePlatformStorySiteHTMLEN,
			newEN: loginPagePlatformStorySiteHTMLEN,
			oldCH: previousLoginPagePlatformStorySiteCH,
			newCH: loginPagePlatformStorySiteHTMLCH,
		},
		{
			oldFI: previousLoginPagePlatformStorySiteFI,
			newFI: loginPagePlatformStorySiteHTMLFI,
			oldEN: previousLoginPagePlatformStorySiteEN,
			newEN: loginPagePlatformStorySiteHTMLEN,
			oldCH: previousLoginPagePlatformStorySiteCH,
			newCH: loginPagePlatformStorySiteHTMLCH,
		},
	}

	const replaceLegacyQuery = `
		UPDATE system_lang_keys
		SET fi = CASE
				WHEN fi LIKE $2 || '%' THEN $3
				ELSE fi
			END,
		    en = CASE
				WHEN en LIKE $4 || '%' THEN $5
				ELSE en
			END,
		    ch = CASE
				WHEN ch LIKE $6 || '%' THEN $7
				ELSE ch
			END
		WHERE lang_key = $1
	`
	for _, replacement := range replacements {
		if _, err := db.Exec(
			replaceLegacyQuery,
			"login_page_platform_story_site_html",
			replacement.oldFI,
			replacement.newFI,
			replacement.oldEN,
			replacement.newEN,
			replacement.oldCH,
			replacement.newCH,
		); err != nil {
			log.Printf("[STARTUP] Error replacing legacy login page story defaults: %v", err)
		}
	}
}
