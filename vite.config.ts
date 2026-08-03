// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    environments: {
      // Load server-only secrets (ASSISTANT_API_KEY etc.) into the SSR build
      // only — they never reach the client bundle. Runtime bindings (Cloudflare
      // secrets) still win via process.env in the proxy route.
      ssr: {
        envPrefix: ["VITE_", "ASSISTANT_"],
      },
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
      ws: {
        path: "/__vite_hmr",
      },
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
