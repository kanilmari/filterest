// eslint.config.mjs
import js from "@eslint/js";
import globals from "globals";
import importPlugin from "eslint-plugin-import-x";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/frontend/dist/**",
      "**/dist-public/**",
      "**/agent_tasks/_artifacts/**",
      "**/.wrangler/**",
      "apps/**/dist/**",
      "apps/**/.astro/**",
      "**/data/others/**",
      "**/docs/design_ideas/**",
      "**/docs/design_ideas/favefox/**",
      "**/data/storage/**",
      ".venv/**",
      "apps/**/.venv/**"
    ]
  },
  js.configs.recommended,
  {
    // ESLint 10 added these rules to its recommended set. Keep the previous
    // lint contract until their existing findings are reviewed separately.
    rules: {
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "error",
    },
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        Sortable: "readonly", // External lib often used
      },
    },
    plugins: {
      import: importPlugin,
    },
    rules: {
      "import/no-unresolved": "off", // Often fails without complex resolver config in simple projects
      "import/named": "error",
      "import/namespace": "error",
      "import/default": "error",
      "import/export": "error",
      "import/no-duplicates": "warn",
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrorsIgnorePattern": "^_" }],
      "no-undef": "error",
    },
  },
];
