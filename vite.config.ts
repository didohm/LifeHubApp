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
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
          if (id.includes("firebase")) return "vendor-firebase";
          if (id.includes("framer-motion")) return "vendor-motion";
          if (id.includes("@tanstack")) return "vendor-tanstack";
          if (id.includes("@radix-ui")) return "vendor-radix";
          if (id.includes("lucide-react") || id.includes("react-icons")) return "vendor-icons";
          if (id.includes("date-fns")) return "vendor-date";
          if (id.includes("react-hook-form")) return "vendor-forms";
          if (id.includes("zod")) return "vendor-utils";
          if (id.includes("embla-carousel") || id.includes("vaul") || id.includes("cmdk"))
            return "vendor-ui-components";
          return "vendor";
        },
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
