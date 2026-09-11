// dataset_cover_palette_copy.js
// Defines Finnish and English labels for the appearance palette.
// Connects palette controls and status messages to one local copy dictionary.
// Keeps presentation terminology consistent while the mounted editor changes language.

export const DATASET_COVER_PALETTE_COPY = Object.freeze({
    en: Object.freeze({
        button: 'Open appearance palette', title: 'Appearance settings', close: 'Close appearance settings',
        notice: 'Changes preview immediately. Save stores both light and dark theme values.',
        light: 'Light', dark: 'Dark', coverVisible: 'Show cover photo', maskEnabled: 'Use oval mask', reset: 'Reset to saved values',
        themeGroup: 'Selected theme', sharedGroup: 'Shared by both themes',
        themeImage: 'Image and overlay', ovalGeometry: 'Oval shape', ovalGradient: 'Oval gradient',
        heroLayout: 'Hero image and transition', cardLayout: 'Card layout', navigation: 'Dataset tabs',
        save: 'Save settings', saving: 'Saving…', saved: 'Settings saved.', saveFailed: 'Saving failed.',
        ovalX: 'Oval width', ovalY: 'Oval height', ovalPositionY: 'Oval vertical position',
        centerOpacity: 'Centre opacity', midOpacity: 'Mid opacity', edgeOpacity: 'Edge opacity',
        centerStop: 'Centre stop', midStop: 'Mid stop', edgeStop: 'Edge stop',
        imageOpacity: 'Whole image opacity', heroHeight: 'Hero extra height', heroBottomFade: 'Bottom fade height',
        overlayOpacity: 'Darkening overlay opacity', imageBlur: 'Cover and background blur',
        cardImageWidth: 'Card image width', cardDescriptionLines: 'Card description lines',
        activeTabFade: 'Active tab fade width',
        activeTabMaxOpacity: 'Active tab edge opacity (reserved)',
        activeTabGlowIntensity: 'Active tab glow intensity', activeTabGlowWidth: 'Active tab glow width',
        activeTabGlowBlur: 'Active tab glow blur', brandColor: 'Site brand colour',
    }),
    fi: Object.freeze({
        button: 'Avaa ulkoasun paletti', title: 'Ulkoasun asetukset', close: 'Sulje ulkoasun asetukset',
        notice: 'Muutokset näkyvät heti. Tallennus säilyttää vaalean ja tumman teeman arvot.',
        light: 'Vaalea', dark: 'Tumma', coverVisible: 'Näytä kansikuva', maskEnabled: 'Käytä ovaalimaskia', reset: 'Palauta tallennetut arvot',
        themeGroup: 'Valittu teema', sharedGroup: 'Molemmille teemoille yhteiset',
        themeImage: 'Kuva ja tummennus', ovalGeometry: 'Ovaalin muoto', ovalGradient: 'Ovaalin liukuväri',
        heroLayout: 'Kansikuva ja häivytys', cardLayout: 'Korttien asettelu', navigation: 'Aineistovälilehdet',
        save: 'Tallenna asetukset', saving: 'Tallennetaan…', saved: 'Asetukset tallennettu.', saveFailed: 'Tallennus epäonnistui.',
        ovalX: 'Ovaalin leveys', ovalY: 'Ovaalin korkeus', ovalPositionY: 'Ovaalin pystysijainti',
        centerOpacity: 'Keskustan peittävyys', midOpacity: 'Keskialueen peittävyys', edgeOpacity: 'Reunan peittävyys',
        centerStop: 'Liukuvärin keskustan kohta', midStop: 'Liukuvärin keskialueen kohta', edgeStop: 'Liukuvärin reunan kohta',
        imageOpacity: 'Koko kuvan peittävyys', heroHeight: 'Kansikuvan lisäkorkeus', heroBottomFade: 'Alahäivytyksen korkeus',
        overlayOpacity: 'Tummennuskerroksen peittävyys', imageBlur: 'Kansi- ja taustakuvan sumennus',
        cardImageWidth: 'Korttikuvan leveys', cardDescriptionLines: 'Kortin kuvaustekstin rivit',
        activeTabFade: 'Aktiivisen välilehden häivytysleveys',
        activeTabMaxOpacity: 'Aktiivisen välilehden reunan peittävyys (varattu)',
        activeTabGlowIntensity: 'Aktiivisen välilehden hohdon voimakkuus',
        activeTabGlowWidth: 'Aktiivisen välilehden hohdon leveys',
        activeTabGlowBlur: 'Aktiivisen välilehden hohdon sumennus', brandColor: 'Sivuston brändiväri',
    }),
});
