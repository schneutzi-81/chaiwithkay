import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// NOTE: `base` must match your GitHub repo name for GitHub Pages.
// If your repo is github.com/<you>/chaiwithkay, leave this as-is.
export default defineConfig({
  base: "/chaiwithkay/",
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png"],
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
