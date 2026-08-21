import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * @deprecated Centralized auth routing now lives in `src/routes/__root.tsx`
 * (MainContentGate). Per-page `useAuthGuard` caused duplicate
 * `navigate({to: "/auth"})` effects that raced with the root gate and with
 * `src/routes/auth.tsx`, leading to login -> bounce-back-to-/auth.
 * Kept only for backward compatibility; new code should rely on the root gate.
 *
 * Vercel best-practice: deduplicate global event listeners / navigation
 * effects (`client-event-listeners`).
 */
export function useAuthGuard(user: any, authLoading: boolean) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth", replace: true });
    }
  }, [user, authLoading, navigate]);
}
