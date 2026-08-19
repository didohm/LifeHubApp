import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this
      server: { entry: "server" },
      importProtection: {
        behavior: "error",
        client: {
          files: ["**/server/**"],
          specifiers: ["server-only"],
        },
      },
    }),
    // Build for a plain Node.js server (node-server preset), or Vercel's
    // native serverless output when deployed through Vercel (VERCEL=1).
    nitro({ preset: process.env.VERCEL ? "vercel" : "node-server" }),
    react(),
  ],
  envPrefix: ["VITE_", "ASSISTANT_"],
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    tsconfigPaths: true,
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/router-core",
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
    rollupOptions: {
      output: {
        // No manualChunks: Rolldown's automatic splitting already isolates
        // route-lazy dependencies (leaflet → RouteMap) and shared vendors
        // (react, recharts, firebase) into their own chunks without pulling
        // them into the always-loaded bundle or duplicating shared modules.
      },
    },
  },
  server: {
    host: "::",
    port: 8080,
    ws: {
      path: "/__vite_hmr",
    },
  },
});
