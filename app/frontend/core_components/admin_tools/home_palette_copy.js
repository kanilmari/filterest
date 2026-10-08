// home_palette_copy.js
// Owns Finnish and English Home palette copy without a database language migration.
// Connects the shared shell, source-owned control labels and language changes.
// Provides a complete English fallback while existing hero translations stay in the catalogue.
export const HOME_PALETTE_COPY = Object.freeze({
    en: {
        button: 'Home palette', title: 'Home palette', close: 'Close', reset: 'Reset', save: 'Save',
        notice: 'Preview the title and description together. Reset restores the saved layout. Closing keeps the preview until you leave Home.',
        anchor: 'Text block position', margin: 'Margin', paragraphLayout: 'Paragraph layout', maxWidth: 'Maximum width',
        normal: 'Normal', artistic: 'Artistic',
        'top-left': 'Top left', 'top-center': 'Top centre', 'top-right': 'Top right',
        'center-left': 'Centre left', 'center-center': 'Centre', 'center-right': 'Centre right',
        'bottom-left': 'Bottom left', 'bottom-center': 'Bottom centre', 'bottom-right': 'Bottom right',
        saving: 'Saving Home layout…', saved: 'Home layout saved.',
        saveFailed: 'Could not save Home layout. Another administrator may have changed it; reopen Home to load the saved layout.',
        loadFailed: 'Could not open the Home palette.',
    },
    fi: {
        button: 'Etusivun paletti', title: 'Etusivun paletti', close: 'Sulje', reset: 'Palauta', save: 'Tallenna',
        notice: 'Esikatsele otsikkoa ja kuvausta yhtenä tekstilohkona. Palauta palauttaa tallennetun asettelun. Sulkeminen säilyttää esikatselun, kunnes poistut etusivulta.',
        anchor: 'Tekstilohkon sijainti', margin: 'Marginaali', paragraphLayout: 'Kappaleiden asettelu', maxWidth: 'Enimmäisleveys',
        normal: 'Normaali', artistic: 'Taiteellinen',
        'top-left': 'Ylhäällä vasemmalla', 'top-center': 'Ylhäällä keskellä', 'top-right': 'Ylhäällä oikealla',
        'center-left': 'Keskellä vasemmalla', 'center-center': 'Keskellä', 'center-right': 'Keskellä oikealla',
        'bottom-left': 'Alhaalla vasemmalla', 'bottom-center': 'Alhaalla keskellä', 'bottom-right': 'Alhaalla oikealla',
        saving: 'Tallennetaan etusivun asettelua…', saved: 'Etusivun asettelu tallennettu.',
        saveFailed: 'Etusivun asettelua ei voitu tallentaa. Toinen ylläpitäjä on voinut muuttaa sitä; avaa etusivu uudelleen ladataksesi tallennetun asettelun.',
        loadFailed: 'Etusivun palettia ei voitu avata.',
    },
});
