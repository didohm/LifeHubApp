import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { ChevronLeft } from "lucide-react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";

// Unauthenticated / pre-onboarding screens that must not show the floating
// bottom navigation bar (e.g. the "Get Started with Google" login screen).
const PUBLIC_PATHS = ["/auth", "/onboarding"];

export function Screen({
  children,
  className,
}: {
  children: ReactNode;
  /** Optional classes applied to the full-bleed page background. */
  className?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading } = useAuth();

  // Only show the bottom nav on protected routes while a user is signed in.
  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const showBottomNav = !isPublicPath && !loading && !!user;

  return (
    <div
      className={`min-h-screen bg-[#F7F7FA] font-sans antialiased text-[#12131A] selection:bg-[#7C5CFC]/20 ${
        className ?? ""
      }`}
    >
      <div
        className={`mx-auto w-full max-w-md px-5 pt-6 ${
          showBottomNav ? "pb-32" : "pb-8"
        }`}
      >
        {children}
      </div>
      {showBottomNav && <BottomNav />}
    </div>
  );
}

export function ScreenHeader({
  title,
  action,
  subtitle,
  showBack,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  showBack?: boolean;
}) {
  const navigate = useNavigate();
  const router = useRouter();

  const handleBack = () => {
    // Follow the normal navigation stack (previous in-app screen). Falls
    // back to Home only when there's no previous entry (deep link / refresh).
    if (router.history.canGoBack()) {
      router.history.back();
    } else {
      navigate({ to: "/" });
    }
  };

  return (
    <header className="mb-5 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={handleBack}
            className="tap flex size-9 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5 hover:bg-black/5"
            aria-label="Go Back"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        <div>
          <h1 className="text-xl font-extrabold text-[#12131A] tracking-tight">{title}</h1>
          {subtitle ? <p className="text-xs text-[#6B7280] font-medium">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </header>
  );
}