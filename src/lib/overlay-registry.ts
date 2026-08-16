/**
 * Global overlay registry.
 *
 * Any modal / dialog / bottom sheet / form popup registers itself here while
 * it is open. The Bottom Navigation subscribes to this registry and hides
 * itself whenever an overlay is open, so the nav bar can never appear above
 * or behind a modal — app-wide, with zero per-page wiring.
 */

type Listener = (openCount: number) => void;

let openCount = 0;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l(openCount));
}

/** Register an open overlay. Returns an unregister function (call on unmount/close). */
export function registerOverlay(): () => void {
  openCount += 1;
  emit();
  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    openCount = Math.max(0, openCount - 1);
    emit();
  };
}

export function isOverlayOpen(): boolean {
  return openCount > 0;
}

export function subscribeOverlays(cb: Listener): () => void {
  listeners.add(cb);
  cb(openCount);
  return () => {
    listeners.delete(cb);
  };
}

/** True when the on-screen keyboard is covering the bottom of the screen. */
export function isKeyboardOpen(): boolean {
  if (typeof window === "undefined" || !window.visualViewport) return false;
  const vv = window.visualViewport;
  const initial = window.innerHeight;
  return initial - vv.height > 60;
}
