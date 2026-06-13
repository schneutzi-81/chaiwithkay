import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// NOTE: `base` must match your GitHub repo name for GitHub Pages.
// If your repo is github.com/<you>/chaiwithkay, leave this as-is.
export default defineConfig({
  base: "/chaiwithkay/",
  // HarfBuzz (the writing-guide shaper) ships top-level await, which needs a
  // modern target both for dep pre-bundling (dev) and the final build.
  build: { target: "esnext" },
  // Don't pre-bundle HarfBuzz: the optimizer breaks its `new URL('harfbuzz.wasm',
  // import.meta.url)` lookup (the wasm 404s to index.html). Served as-is, the wasm
  // resolves from node_modules in dev and is emitted as an asset in the build.
  optimizeDeps: { exclude: ["harfbuzzjs"], esbuildOptions: { target: "esnext" } },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
      // Precache the writing-guide assets too (HarfBuzz wasm + Devanagari font),
      // which aren't in the default glob, so "Write it" works offline.
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,wasm,ttf}"],
      },
      manifest: {
        name: "Chai with Kay",
        short_name: "Chai",
        description: "Learn Hindi — speak, read, listen.",
        theme_color: "#241712",
        background_color: "#241712",
        display: "standalone",
        start_url: "/chaiwithkay/",
        scope: "/chaiwithkay/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ]
      }
    })
  ]
});
