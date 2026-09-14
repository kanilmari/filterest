// Runs synchronously before stylesheets so a known public brand paints immediately.
// Only finite numeric HSL components from our versioned cache become CSS values.
(() => {
    try {
        const cached = JSON.parse(localStorage.getItem('filterest_public_presentation_v1') || 'null');
        const brand = cached?.brand;
        if (cached?.schema_version !== 1 || !brand) return;
        const valid = (value, max) => Number.isFinite(value) && value >= 0 && value <= max;
        if (!valid(brand.hue, 360) || !valid(brand.saturation, 100) || !valid(brand.lightness, 100)) return;
        const root = document.documentElement;
        root.style.setProperty('--brand-hue', String(brand.hue));
        root.style.setProperty('--brand-sat', `${brand.saturation}%`);
        root.style.setProperty('--brand-light', `${brand.lightness}%`);
    } catch { /* Missing, blocked or corrupt storage keeps the normal first-visit fallback. */ }
})();
