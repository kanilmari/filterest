# Golden Sample: CSS Styles

This file serves as a reference implementation for CSS styles.
It is stored as a `.md` file to prevent inclusion in the build, but the code block below is valid CSS.

```css
/* 
 * golden_sample_styles.css
 * 
 * This file defines the visual styling for the Golden Sample component.
 * It operates between the HTML structure and the browser's rendering engine.
 * It exists to apply the project's design system (colors, spacing, typography)
 * to the component, ensuring visual consistency and responsiveness.
 *
 * Key Principles:
 * 1. Use CSS Variables: Never hardcode colors, especially theme colors.
 * 2. Theming: Support both light and dark modes.
 * 3. Scoping: Use specific class names to avoid collisions.
 * 4. Layout: Be careful with grid/flex to ensure stability.
 */

/* =========================================
   Component Variables
   ========================================= */
.golden-sample-container {
    /* Define local variables mapped to global theme variables */
    --container-bg: var(--bg-surface);
    --container-text: var(--text-main);
    --container-border: var(--border-subtle);
    
    /* 
     * CRITICAL: Do not hardcode blue hues. 
     * Use the configured global brand colour, recomputed in the active theme.
     */
    --accent-color: var(--color-brand);
}

/* =========================================
   Base Styles
   ========================================= */
.golden-sample-container {
    background-color: var(--container-bg);
    color: var(--container-text);
    border: 1px solid var(--container-border);
    padding: 1rem;
    border-radius: 8px;
    transition: background-color 0.3s ease;
}

.golden-sample-button {
    background-color: var(--accent-color);
    color: var(--color-brand-text);
    padding: 0.5rem 1rem;
    border: none;
    cursor: pointer;
}

/* =========================================
   Dark Mode Overrides (if not handled by vars)
   ========================================= */
/* 
 * Ideally, variables handle this. But if specific overrides are needed:
 * Use the application's body.dark-mode selector. System mode also resolves
 * to an explicit body class; data-theme is not the application theme owner.
 */
body.dark-mode .golden-sample-container {
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}
```

The source-owned [style-package contract](../../frontend/shared/style_package/README.md)
defines approved scope/token mappings. Keep fallbacks at their consumers so
theme-derived defaults resolve on the consuming element. Package authors supply
typed values, never selectors or CSS strings. Focus, visibility and interaction
geometry remain application-owned.
