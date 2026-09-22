/**
 * Stylelint keeps design tokens the single source of truth: raw color
 * literals fail everywhere except the token stylesheet
 * (`src/assets/styles.css`).
 */
export default {
  extends: ["stylelint-config-standard"],
  rules: {
    "color-no-hex": true,
    "color-named": "never",
    "function-disallowed-list": [
      "rgb",
      "rgba",
      "hsl",
      "hsla",
      "hwb",
      "lab",
      "lch",
      "oklab",
      "oklch",
      "color",
    ],
  },
  overrides: [
    {
      files: ["**/*.vue"],
      customSyntax: "postcss-html",
    },
    {
      files: ["src/assets/styles.css"],
      rules: {
        "color-no-hex": null,
        "color-named": null,
        "function-disallowed-list": null,
      },
    },
    {
      // Vendored reset: never edited, so its cosmetic formatting is not policed.
      files: ["src/assets/reset.css"],
      rules: {
        "comment-empty-line-before": null,
        "rule-empty-line-before": null,
        "selector-id-pattern": null,
      },
    },
  ],
};
