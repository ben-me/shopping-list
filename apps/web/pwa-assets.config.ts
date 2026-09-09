import { defineConfig, minimal2023Preset as preset } from "@vite-pwa/assets-generator/config";

// The source (public/favicon.svg) is full-bleed and its glyph sits inside
// the maskable safe zone, so no generator padding is wanted: with the
// default padding the maskable and apple variants would be shrunk onto a
// white background instead of filling the canvas.
export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...preset,
    transparent: { ...preset.transparent, padding: 0 },
    maskable: { ...preset.maskable, padding: 0 },
    apple: { ...preset.apple, padding: 0 },
  },
  images: ["public/favicon.svg"],
});
