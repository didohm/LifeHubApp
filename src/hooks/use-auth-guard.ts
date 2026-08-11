import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Custom hook to guard routes that require authentication
 * Redirects to /auth if user is not authenticated
 *
 * @param user - The current user object (null if not authenticated)
 * @param authLoading - Whether authentication is still loading
 */
export function useAuthGuard(user: any, authLoading: boolean) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);
}
