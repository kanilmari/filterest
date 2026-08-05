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
    --container-bg: var(--bg-primary);
    --container-text: var(--text-primary);
    --container-border: var(--border-subtle);
    
    /* 
     * CRITICAL: Do not hardcode blue hues. 
     * Use the global variable for the primary brand color (HSL 207).
     */
    --accent-color: var(--brand-blue-500); 
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
    color: white;
    padding: 0.5rem 1rem;
    border: none;
    cursor: pointer;
}

/* =========================================
   Dark Mode Overrides (if not handled by vars)
   ========================================= */
/* 
 * Ideally, variables handle this. But if specific overrides are needed:
 * Use [data-theme="dark"] selector.
 */
[data-theme="dark"] .golden-sample-container {
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
}
```
