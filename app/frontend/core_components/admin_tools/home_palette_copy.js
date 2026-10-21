// home_palette_copy.js
// Owns Finnish and English Home palette copy without a database language migration.
// Connects the shared shell, source-owned control labels and language changes.
// Provides a complete English fallback while existing hero translations stay in the catalogue.
export const HOME_PALETTE_COPY = Object.freeze({
    en: {
        button: 'Home palette', title: 'Home palette', close: 'Close', reset: 'Reset', save: 'Save',
        notice: 'Preview the title, slogan and description together. Reset restores the saved layout. Closing keeps the preview until you leave Home. Serif story: The title and slogan form one heading row – keep them short, e.g. "Travel news and deals" + "at a glance". A slogan of up to 40 characters joins the title in italics; a longer one is shown below the title as a smaller lead paragraph. Use **…** for whole emphasis lines and blank lines for sections.',
        anchor: 'Text block position', horizontalMargin: 'Horizontal margin', verticalMargin: 'Vertical margin',
        textStyle: 'Text style', default: 'Default', serif_story_v1: 'Serif story',
        lineReveal: 'Line reveal', none: 'Off', lines: 'Line by line',
        revealStart: 'Start delay (0–5000 ms)', revealInterval: 'Interval (200–2000 ms)',
        alignment: 'Text alignment', maxWidth: 'Maximum width',
        start: 'Start', center: 'Align centre', end: 'End', justify: 'Justify',
        phoneAlignment: 'On phones', inherit: 'As elsewhere',
        light: 'Light theme', dark: 'Dark theme', wash: 'Theme wash', opacity: 'Media opacity',
        'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right',
        'center-left': 'Centre left', 'center-center': 'Centre', 'center-right': 'Centre right',
        'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right',
        saving: 'Saving Home layout…', saved: 'Home layout saved.',
        saveFailed: 'Could not save Home layout. Another administrator may have changed it; reopen Home to load the saved layout.',
        loadFailed: 'Could not open the Home palette.',
    },
    fi: {
        button: 'Etusivun paletti', title: 'Etusivun paletti', close: 'Sulje', reset: 'Palauta', save: 'Tallenna',
        notice: 'Esikatsele otsikkoa, iskulausetta ja kuvausta yhtenä tekstilohkona. Palauta palauttaa tallennetun asettelun. Sulkeminen säilyttää esikatselun, kunnes poistut etusivulta. Serif-tarina: Otsikko ja iskulause muodostavat yhden otsikkorivin – pidä ne lyhyinä, esim. ”Matkatiedot ja -edut” + ”yhdellä silmäyksellä”. Enintään 40 merkin iskulause liittyy otsikkoon kursiivina; pidempi näytetään otsikon alla pienempänä johdantokappaleena. Merkitse kokonaiset korostusrivit **…** ja erota osiot tyhjällä rivillä.',
        anchor: 'Tekstilohkon sijainti', horizontalMargin: 'Vaakamarginaali', verticalMargin: 'Pystymarginaali',
        textStyle: 'Tekstityyli', default: 'Oletus', serif_story_v1: 'Serif-tarina',
        lineReveal: 'Rivien ilmestyminen', none: 'Pois', lines: 'Rivi kerrallaan',
        revealStart: 'Aloitusviive (0–5000 ms)', revealInterval: 'Riviväli (200–2000 ms)',
        alignment: 'Tekstin tasaus', maxWidth: 'Enimmäisleveys',
        start: 'Alkuun', center: 'Keskitä', end: 'Loppuun', justify: 'Tasaa molemmat reunat',
        phoneAlignment: 'Puhelimella', inherit: 'Kuten muualla',
        light: 'Vaalea teema', dark: 'Tumma teema', wash: 'Vahvuus kohti teemaväriä', opacity: 'Median peittävyys',
        'top-left': 'Ylhäällä vasemmalla', 'top-center': 'Ylhäällä keskellä', 'top-right': 'Ylhäällä oikealla',
        'center-left': 'Keskellä vasemmalla', 'center-center': 'Keskellä', 'center-right': 'Keskellä oikealla',
        'bottom-left': 'Alhaalla vasemmalla', 'bottom-center': 'Alhaalla keskellä', 'bottom-right': 'Alhaalla oikealla',
        saving: 'Tallennetaan etusivun asettelua…', saved: 'Etusivun asettelu tallennettu.',
        saveFailed: 'Etusivun asettelua ei voitu tallentaa. Toinen ylläpitäjä on voinut muuttaa sitä; avaa etusivu uudelleen ladataksesi tallennetun asettelun.',
        loadFailed: 'Etusivun palettia ei voitu avata.',
    },
});
