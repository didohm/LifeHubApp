import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    // Preloaded route data stays reusable for 60s, so bouncing between
    // bottom-nav tabs reuses the cached payload instead of re-running the
    // loader every switch. Loaders that must always be fresh refresh on
    // navigation once this window passes.
    defaultPreloadStaleTime: 60_000,
  });

  return router;
};
