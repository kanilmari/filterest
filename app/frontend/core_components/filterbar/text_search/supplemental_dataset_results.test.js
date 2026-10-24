// @vitest-environment jsdom
// supplemental_dataset_results.test.js
// Tests localized auxiliary links, shared card media and approval-aware navigation.
// Keeps colliding row IDs scoped to the target dataset and preserves modified clicks.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const mocks = vi.hoisted(() => ({
    navigate: vi.fn(), selected: vi.fn(), openArticle: vi.fn(), translate: vi.fn((_key, { fallback }) => fallback),
    avatar: vi.fn(), image: vi.fn(),
}));
vi.mock('../../table_views/card_view/card_avatar_builder.js', () => ({
    create_seeded_avatar: mocks.avatar, createImageElement: mocks.image,
}));
vi.mock("../../navigation/main_tabs/main_tab_printer.js", () => ({ openNavTab: mocks.navigate }));
vi.mock("../../state_stores/dataset_selection_saver.js", () => ({ getSelectedDataset: mocks.selected }));
vi.mock("../../table_views/card_view/row_article_opener.js", () => ({ openRowArticleView: mocks.openArticle }));
vi.mock("../../lang/translation_handler.js", () => ({ getTranslationForKey: mocks.translate }));
vi.mock("../../navigation/nav_engine/dataset_aliases.js", () => ({ buildDatasetPath: name => "/alias-" + name, getInternalDatasetName: name => name }));
vi.mock("../../table_views/card_view/row_article_opener_helpers.js", () => ({
    buildCardUrl: (_prefix, name, id) => "/alias-" + name + "/" + id,
}));
import {
    createSupplementalDatasetGroup,
    getSupplementalSearchCopy,
    renderExcerptWithMatchesMarked,
} from "../../table_views/compact_dataset_group.js";
import { getUnifiedTableState, setUnifiedTableState } from "../../state_stores/table_state_store.js";
import { getChosenDatasetView, setChosenDatasetView } from "../../state_stores/dataset_view_choice_saver.js";
import { refreshLocalizedDatasetValues } from "../../table_views/dataset_value_localizer.js";
import { datasetAppearanceState } from '../../table_views/dataset_appearance_state.js';
import { datasetAppearanceDefaultsForPlace } from '../../../shared/dataset_appearance/validator.js';
const types = { title: { card_element: "header+lang_key", is_multilingual: true, show_value_on_card: true },
    description: { card_element: "description2", is_multilingual: true, show_value_on_card: true } };
const rows = [{ id: 1, title: JSON.stringify({ fi: "Suomen otsikko", en: "English title" }),
    description: JSON.stringify({ fi: "<p>Lyhyt <b>kuvaus</b><script>bad()</script></p>", en: "<p>Brief <b>description</b></p>" }) }];
function mount(dataset = "other", options = {}) {
    const group = createSupplementalDatasetGroup({ dataset, text: "Other", langKey: "other" }, "shared query", options);
    document.body.append(group.element);
    group.render(rows, ["id", "title", "description"], types);
    return group;
}
beforeEach(() => {
    datasetAppearanceState.clear();
    document.body.replaceChildren(); localStorage.clear(); sessionStorage.clear(); vi.clearAllMocks();
    sessionStorage.setItem('user_permissions', JSON.stringify(['/ui/view/article_view']));
    mocks.navigate.mockResolvedValue({ abort: false });
    mocks.selected.mockReturnValue("other");
    mocks.avatar.mockResolvedValue(document.createElement('div'));
    mocks.image.mockImplementation((_src, _large, options) => {
        const image = document.createElement('img');
        image.alt = options.rowLabel;
        image.dataset.langKey = 'picture_of_target';
        // Like card_avatar_builder.js's shared handler: a missing picture gets a translatable key and context.
        image.addEventListener('error', () => {
            image.alt = 'Picture missing';
            image.dataset.langKey = 'picture_missing';
            image.dataset.langAltContext = options.rowLabel;
        });
        return image;
    });
});
test('reserves equal 76px media and text boxes before the seeded avatar is ready', async () => {
    let finishAvatar;
    mocks.avatar.mockImplementation(() => new Promise(resolve => { finishAvatar = resolve; }));
    const group = mount('other', { includeThumbnails: true });
    const media = group.element.querySelector('.supplemental-dataset-thumbnail');
    expect(media.querySelector('.card_small_image')).not.toBeNull();
    expect(media.querySelector('.card_small_image_inner')).toBeNull();
    expect(media.getAttribute('aria-hidden')).toBe('true');
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'supplemental_dataset_results.css'), 'utf8');
    expect(css).toMatch(/\.supplemental-dataset-result\s*\{[^}]*align-items: center/s);
    expect(css).toMatch(/\.supplemental-dataset-thumbnail,\s*\.supplemental-dataset-thumbnail \.card_small_image\s*\{[^}]*width: 76px;[^}]*height: 76px/s);
    expect(css).toMatch(/\.supplemental-dataset-result-text\s*\{[^}]*justify-content: center;[^}]*height: 76px/s);
    expect(group.element.querySelector('.supplemental-dataset-result-text > a')).not.toBeNull();
    await vi.waitFor(() => expect(mocks.avatar).toHaveBeenCalledWith('1_', expect.any(String), false));
    const avatar = document.createElement('div');
    finishAvatar(avatar);
    await vi.waitFor(() => expect(media.querySelector('.card_small_image_inner')).toBe(avatar));
    expect(group.element.querySelectorAll('li a')).toHaveLength(1);
    expect(media.querySelector('[tabindex], a, button')).toBeNull();
});

test('uses authorized card-support cached media with the shared image renderer', async () => {
    const group = mount('other', { includeThumbnails: true });
    mocks.avatar.mockClear();
    group.render([{ ...rows[0], cached_image: './storage/test/300/picture.jpg' }], ['title', 'description'], types);
    await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledWith('./storage/test/300/picture.jpg', false,
        expect.objectContaining({ tableName: 'other', renderSlot: 'card_media', rowLabel: expect.any(String) })));
    await vi.waitFor(() => expect(group.element.querySelector('.card_small_image_inner')).not.toBeNull());
    expect(mocks.avatar).not.toHaveBeenCalled();
    const image = group.element.querySelector('img');
    expect(image.alt).toBe('');
    expect(image.dataset.langKey).toBeUndefined();
    // Gate 254a: without a lang key, the translation observer has nothing to refill alt from.
    const decorative = () => {
        expect(image.alt).toBe('');
        expect(image.dataset.langKey).toBeUndefined();
        expect(image.dataset.langAltContext).toBeUndefined();
    };
    image.dispatchEvent(new Event('error'));
    decorative();
    image.dispatchEvent(new Event('error'));
    decorative();
    await refreshLocalizedDatasetValues('fi');
    decorative();
    await refreshLocalizedDatasetValues('en');
    decorative();
});

test('compact thumbnails resolve all three datasets independently with focal points and unchanged letter fallback', async () => {
    const { createImageElement } = await vi.importActual('../../table_views/card_view/card_avatar_builder.js');
    mocks.image.mockImplementation(createImageElement);
    mocks.avatar.mockImplementation(async (_seed, letter) => {
        const avatar = document.createElement('div'); avatar.textContent = letter; return avatar;
    });
    const groups = ['contain', 'cover', 'contain_blur'].map((mode, index) => {
        const dataset = `compact_${mode}`;
        expect(datasetAppearanceState.accept(dataset, { schema_version: 2, dataset_uid: 562 + index,
            shared_version: 'site', version: '1', tab_values: datasetAppearanceDefaultsForPlace('tab_only'),
            site_values: datasetAppearanceDefaultsForPlace('site_only'), defaults: datasetAppearanceDefaultsForPlace('site_default'),
            overrides: { 'shared.card_image_presentation': mode } })).toBe(true);
        const group = mount(dataset, { includeThumbnails: true });
        group.render([{ ...rows[0], cached_image: './storage/test/300/picture.jpg',
            cached_image_focal_x: 0.2, cached_image_focal_y: 0.3 }, { ...rows[0], id: 2 }],
        ['title', 'description'], types);
        return { group, mode };
    });
    for (const { group, mode } of groups) {
        await vi.waitFor(() => expect(group.element.querySelector('.card_photo_presentation')).not.toBeNull());
        const wrapper = group.element.querySelector('.card_photo_presentation');
        expect(wrapper.dataset.cardImagePresentation).toBe(mode);
        expect(wrapper.dataset.cardImageSource).toBe('dataset');
        expect(wrapper.style.getPropertyValue('--card-photo-focal')).toBe(mode === 'cover' ? '20% 30%' : '');
        const image = wrapper.querySelector('img');
        image.dispatchEvent(new Event('load'));
        expect(wrapper.style.getPropertyValue('--card-photo-source').includes('picture.jpg')).toBe(mode === 'contain_blur');
        expect(image.alt).toBe('');
        const letter = group.element.querySelectorAll('li')[1];
        await vi.waitFor(() => expect(letter.querySelector('.card_small_image_inner')).not.toBeNull());
        expect(letter.querySelector('img, .card_photo_presentation')).toBeNull();
        expect(letter.querySelector('.card_small_image_inner').textContent).toBe(Array.from(letter.querySelector('a').textContent)[0]);
        expect(mocks.avatar).toHaveBeenCalledWith('2_', expect.any(String), false);
    }
});

test('shared group and raster thumbnail radii use theme tokens with stronger thumbnail scrim variables', () => {
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'supplemental_dataset_results.css'), 'utf8');
    expect(css).toMatch(/\.supplemental-dataset-group\s*\{[^}]*--home-block-radius: var\(--fw-radius-lg\);/);
    expect(css).toMatch(/\.supplemental-dataset-thumbnail \.wrapper\s*\{[^}]*border-radius: var\(--fw-radius-md\) !important;/);
    expect(css).toMatch(/\.supplemental-dataset-thumbnail \.card_photo_presentation\s*\{[^}]*--card-photo-blur: 48px;[^}]*--card-photo-scrim-inset: -144px;/);
});

test('hydrates a retained group while its primary result host is temporarily detached', async () => {
    const group = createSupplementalDatasetGroup({ dataset: 'other', langKey: 'other' }, 'shared', {
        includeThumbnails: true,
    });
    group.render(rows, ['title', 'description'], types);
    expect(group.element.isConnected).toBe(false);
    await vi.waitFor(() => expect(group.element.querySelector('.card_small_image_inner')).not.toBeNull());
    document.body.append(group.element);
    expect(group.element.querySelector('.supplemental-dataset-result-text a').textContent).not.toBe('');
});
test("refreshes one-language titles and plain descriptions without JSON, markup or script output", async () => {
    const group = mount();
    mocks.translate.mockReturnValue("Muut");
    await refreshLocalizedDatasetValues("fi");
    expect(group.element.querySelector("h3").textContent).toBe("Muut");
    expect(group.element.querySelector("li a").textContent).toBe("Suomen otsikko");
    expect(group.element.querySelector("p").textContent).toBe("Lyhyt kuvaus");
    expect(group.element.querySelector("script,b")).toBeNull();
    expect(group.element.textContent).not.toContain("bad()");
    await refreshLocalizedDatasetValues("en");
    expect(group.element.querySelector("li a").textContent).toBe("English title");
    expect(group.element.querySelector("p").textContent).toBe("Brief description");
});
test("shows a short extract around the matching words instead of the document beginning", () => {
    const longBeginning = "Opening material without the searched phrase. ".repeat(8);
    const longEnding = " Closing material after the searched phrase.".repeat(8);
    const fullText = `${longBeginning}Claude appears in the relevant sentence.${longEnding}`;
    const group = createSupplementalDatasetGroup(
        { dataset: "tickets", text: "Tickets", langKey: "tickets" }, "claude"
    );
    document.body.append(group.element);
    group.render(
        [{ id: 9, title: "Matching ticket", description: fullText }],
        ["id", "title", "description"],
        {
            title: { card_element: "header", show_value_on_card: true },
            description: { card_element: "description", show_value_on_card: true },
        }
    );
    const excerpt = group.element.querySelector("li p").textContent;

    expect(excerpt.toLowerCase()).toContain("claude");
    expect(excerpt).not.toContain(longBeginning.trim());
    expect(excerpt).not.toBe(fullText);
    expect(excerpt.length).toBeLessThanOrEqual(180);
    expect(excerpt.startsWith("…")).toBe(true);
    expect(excerpt.endsWith("…")).toBe(true);
});
test.each(["fi", "en", "ch", "yue", "zh-Hant"])("localizes Show all in %s", async language => {
    const group = mount();
    await refreshLocalizedDatasetValues(language);
    expect(group.element.querySelector(".supplemental-dataset-show-all").textContent).toBe(getSupplementalSearchCopy(language).showAll);
});
test("links use the target alias, target row identity, and exact shared query", () => {
    const a = mount("first").element.querySelector("li a");
    const b = mount("second").element.querySelector("li a");
    expect(new URL(a.href).pathname).toBe("/alias-first/1");
    expect(new URL(b.href).pathname).toBe("/alias-second/1");
    expect(new URL(b.href).searchParams.get("search")).toBe("shared query");
});
test("Home cancellation restores the remembered row and dataset view", async () => {
    const group = mount("other", { preselectArticle: true });
    setChosenDatasetView("other", "card");
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockResolvedValue({ abort: true, reason: "dirty_check_failed" });
    group.element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    await vi.waitFor(() => expect(getUnifiedTableState("other").articleView.expandedId).toBe(99));
    expect(mocks.navigate).toHaveBeenCalledWith("other", {
        forceReload: true, skipUrlUpdate: true, replacementParams: { search: "shared query", view: "article_view" },
    });
    expect(getChosenDatasetView("other")).toBe("card");
    expect(mocks.openArticle).not.toHaveBeenCalled();
});
test("Home row navigation pre-sets the exact article before loading without a dataset history entry", async () => {
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockImplementation(async () => {
        expect(getChosenDatasetView("other")).toBe("article_view");
        expect(getUnifiedTableState("other").articleView.expandedId).toBe(1);
        return { abort: false };
    });
    mount("other", { preselectArticle: true }).element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.openArticle).not.toHaveBeenCalled();
});
test("search row links keep their existing dataset entry and approved article open", async () => {
    mount().element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.openArticle).toHaveBeenCalled());
    expect(mocks.navigate).toHaveBeenCalledWith("other", { forceReload: true, replacementParams: { search: "shared query" } });
    expect(mocks.openArticle).toHaveBeenCalledWith({ id: 1 }, "other", null, expect.any(Object));
});
test("search row cancellation keeps the existing state and never opens an article", async () => {
    setChosenDatasetView("other", "card");
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockResolvedValue({ abort: true });
    mount().element.querySelector("li a").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(getChosenDatasetView("other")).toBe("card");
    expect(getUnifiedTableState("other").articleView.expandedId).toBe(99);
    expect(mocks.openArticle).not.toHaveBeenCalled();
});
test("Show all keeps the search collection behavior", async () => {
    mount().element.querySelector(".supplemental-dataset-show-all").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    expect(mocks.navigate).toHaveBeenCalledWith("other", {
        forceReload: true, replacementParams: { search: "shared query" },
    });
});
test("the shared group accepts a row cap while search still defaults to three", () => {
    const manyRows = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, title: "Row " + i }));
    const search = mount();
    search.render(manyRows, ["title"], types);
    expect(search.element.querySelectorAll("li")).toHaveLength(3);
    const home = createSupplementalDatasetGroup({ dataset: "other", langKey: "other" }, "", { rowCap: 5 });
    home.render(manyRows, ["title"], types);
    expect(home.element.querySelectorAll("li")).toHaveLength(5);
});
test("Home Show all clears remembered articles and opens the newest-first card collection", async () => {
    const group = createSupplementalDatasetGroup({ dataset: "other", langKey: "other" }, "", {
        rowCap: 5, preselectArticle: true, emptyKey: "front_page_no_results", showAllKey: "front_page_show_all",
        replacementParams: { sort_column: "__newest", sort_order: "DESC", view: "card" },
    });
    document.body.append(group.element);
    group.render([], [], {});
    expect(group.element.hidden).toBe(false);
    setChosenDatasetView("other", "article_view");
    setUnifiedTableState("other", { articleView: { collapsed: true, expandedId: 99 }, cardView: { collapsed: true, expandedId: 99 } });
    mocks.navigate.mockImplementation(async () => {
        expect(getChosenDatasetView("other")).toBe("card");
        expect(getUnifiedTableState("other").articleView.expandedId).toBeNull();
        expect(getUnifiedTableState("other").cardView.expandedId).toBeNull();
        return { abort: false };
    });
    group.element.querySelector(".supplemental-dataset-show-all").click();
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("other", {
        forceReload: true, replacementParams: { sort_column: "__newest", sort_order: "DESC", view: "card" },
    }));
});
test("modified-click keeps native href behavior without touching navigation state", () => {
    const anchor = mount().element.querySelector("li a");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    anchor.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
});

test.each([
    { show_value_on_card: false }, { hide_everywhere: true }, { hide_on_small_card: true },
    { card_element: "hidden,header" },
])("respects real streamed field-visibility metadata: %o", hidden => {
    const group = mount();
    group.render([{ id: 1, title: "HIDDEN TITLE", description: "HIDDEN DESCRIPTION" }], ["id", "title", "description"], {
        title: { ...types.title, ...hidden },
        description: { ...types.description, ...hidden },
    });
    expect(group.element.textContent).not.toContain("HIDDEN");
});

describe("renderExcerptWithMatchesMarked", () => {
    test("marks the searched word and leaves the rest as plain text", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "a domain name is registered", "domain");

        expect(element.textContent).toBe("a domain name is registered");
        const marks = element.querySelectorAll("mark");
        expect(marks).toHaveLength(1);
        expect(marks[0].textContent).toBe("domain");
    });

    test("marks every occurrence, not only the first", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "report on the report", "report");

        expect(element.querySelectorAll("mark")).toHaveLength(2);
        expect(element.textContent).toBe("report on the report");
    });

    test("never inserts stored text as markup", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "<img src=x onerror=alert(1)> domain", "domain");

        expect(element.querySelector("img")).toBeNull();
        expect(element.textContent).toContain("<img src=x onerror=alert(1)>");
    });

    test("leaves an extract with no match untouched", () => {
        const element = document.createElement("p");
        renderExcerptWithMatchesMarked(element, "nothing of note here", "domain");

        expect(element.querySelectorAll("mark")).toHaveLength(0);
        expect(element.textContent).toBe("nothing of note here");
    });
});
