// Build config for the native mobile (Capacitor) distribution.
//
// Unlike the main web config (Nitro node-server SSR), this produces a purely
// static, client-rendered app:
//   - nitro is skipped entirely — a phone can't run a Node server.
//   - TanStack Start's SPA mode prerenders every static page into plain HTML
//     plus the SPA shell at `/`, so the WebView always boots from index.html
//     and all navigation happens client-side.
//   - Output lands in dist-capacitor/client (see capacitor.config.ts webDir).
//
// Server-only routes (/api/assistant, /sitemap.xml) are compiled out of the
// static bundle. The assistant proxy gets deployed separately (e.g. Render)
// and the APK points at it via VITE_ASSISTANT_ENDPOINT at build time.
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      // Keep the SSR error wrapper as the server entry: it is still used to
      // prerender pages at build time (never at runtime on device).
      server: { entry: "server" },
      // SPA shell: every route falls back to a client-rendered shell, so deep
      // links inside the WebView always boot the router. outputPath "/index"
      // writes the shell as index.html — the file Capacitor's WebView loads at
      // https://localhost/ (a hosting server would normally rewrite / → shell).
      spa: {
        enabled: true,
        maskPath: "/",
        prerender: { outputPath: "/index" },
      },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    react(),
  ],
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    tsconfigPaths: true,
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  build: {
    // Client output: dist-capacitor/client — the Capacitor webDir.
    outDir: "dist-capacitor",
  },
});
