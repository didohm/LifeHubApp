/**
 * Profile-photo cache.
 *
 * The user's real profile image URL is persisted to localStorage (survives
 * restarts) and mirrored in memory, so the avatar renders instantly on every
 * screen — right after login or app start — with zero placeholder flicker.
 * Photos are also preloaded in the background so the browser never has to
 * re-fetch them.
 */

export const PHOTO_URL_CACHE_KEY = "lifehub_google_photo_url";

const memoryCache = new Map<string, string>();
const preloaded = new Set<string>();

/** Synchronously read the cached photo URL (memory first, then localStorage). */
export function getCachedPhotoUrl(): string | null {
  const fromMemory = memoryCache.get(PHOTO_URL_CACHE_KEY);
  if (fromMemory) return fromMemory;
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(PHOTO_URL_CACHE_KEY);
  } catch {
    return null;
  }
}

/** Persist a photo URL for instant display on future renders/restarts. */
export function cachePhotoUrl(url: string | null | undefined): void {
  if (!url) return;
  memoryCache.set(PHOTO_URL_CACHE_KEY, url);
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(PHOTO_URL_CACHE_KEY, url);
    } catch {
      /* storage unavailable — in-memory cache still applies */
    }
  }
}

/** Warm the browser image cache in the background (never blocks the UI). */
export function preloadPhoto(url: string | null | undefined): void {
  if (!url || preloaded.has(url) || typeof window === "undefined") return;
  preloaded.add(url);
  const img = new Image();
  img.decoding = "async";
  img.fetchPriority = "high";
  img.src = url;
}

/** Remove the cached photo (used on logout). */
export function clearPhotoCache(): void {
  memoryCache.delete(PHOTO_URL_CACHE_KEY);
  preloaded.clear();
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(PHOTO_URL_CACHE_KEY);
    } catch {
      /* ignore */
    }
  }
}
