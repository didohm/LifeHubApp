import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { ChevronLeft } from "lucide-react";
import { useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

// Unauthenticated / pre-onboarding screens that must not show the floating
// bottom navigation bar (e.g. the "Get Started with Google" login screen).
const PUBLIC_PATHS = ["/auth", "/onboarding"];

export function Screen({
  children,
  className,
  contentClassName,
  fullHeight = false,
  noBottomPadding = false,
  hideBottomNav = false,
}: {
  children: ReactNode;
  /** Optional classes applied to the full-bleed page background. */
  className?: string;
  /** Optional classes applied to the inner centered container. */
  contentClassName?: string;
  /** Use fixed full-viewport height without outer document scrolling (chat screens). */
  fullHeight?: boolean;
  /** Disable default bottom padding (for custom bottom docked bars). */
  noBottomPadding?: boolean;
  /** Explicitly suppress floating bottom navigation bar. */
  hideBottomNav?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading } = useAuth();

  // Only show the bottom nav on protected routes while a user is signed in.
  const isPublicPath = PUBLIC_PATHS.includes(pathname);
  const showBottomNav = !hideBottomNav && !isPublicPath && !loading && !!user;

  return (
    <div
      className={cn(
        "bg-[#F7F7FA] font-sans antialiased text-[#12131A] selection:bg-[#7C5CFC]/20",
        fullHeight ? "h-viewport overflow-hidden flex flex-col" : "min-h-viewport",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto w-full max-w-md px-5 page-fade-enter",
          fullHeight
            ? "flex-1 flex flex-col min-h-0 pt-[calc(1rem+env(safe-area-inset-top))] pb-[env(safe-area-inset-bottom)]"
            : "pt-[calc(1.5rem+env(safe-area-inset-top))] ",
          !noBottomPadding &&
            (showBottomNav ? "pb-[calc(8rem+env(safe-area-inset-bottom))]" : "pb-[calc(2rem+env(safe-area-inset-bottom))]"),
          contentClassName,
        )}
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
    <header className="mb-5 flex items-center justify-between gap-3 gap-x-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {showBack && (
          <button
            onClick={handleBack}
            className="tap flex size-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7C5CFC] focus-visible:ring-offset-2"
            aria-label="Go Back"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-extrabold text-[#12131A] tracking-tight truncate">{title}</h1>
          {subtitle ? <p className="text-xs text-[#6B7280] font-medium truncate">{subtitle}</p> : null}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
