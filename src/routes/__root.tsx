import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useLocation,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Toaster } from "sonner";

import appCss from "../styles.css?url";
import { AuthProvider, useAuth } from "../hooks/use-auth";
import { DataProvider } from "../lib/data-context";
import { PermissionManager } from "../lib/permissions";
import { useNotifications } from "../hooks/use-notifications";

function NotFoundComponent() {
  return (
    <div className="flex min-h-viewport items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Startup errors are silently recovered: the boundary auto-resets instead of
 * flashing a "Try again, this page didn't load" screen. The error UI only
 * appears when the same crash keeps happening (genuine failure).
 */
let consecutiveStartupErrors = 0;

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  useEffect(() => {
    if (consecutiveStartupErrors < 3) {
      consecutiveStartupErrors += 1;
      // Auto-recover silently — never let a transient startup error flash an
      // error page (e.g. Firestore offline on first paint).
      const timer = setTimeout(() => {
        router.invalidate();
        reset();
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [error, router, reset]);

  // Recovering silently — render nothing rather than an error page.
  if (consecutiveStartupErrors < 3) return null;

  return (
    <div className="flex min-h-viewport items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "LifeHub — All your daily life services, in one place" },
      {
        name: "description",
        content:
          "LifeHub brings appointments, bills, medications, documents and to-dos into one calm, friendly app.",
      },
      { name: "author", content: "LifeHub" },
      { property: "og:title", content: "LifeHub" },
      { property: "og:description", content: "All your daily life services, in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:site", content: "@lifehubapp" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Amiri:wght@400;700&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function AuthLoadingSplash() {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center bg-white">
      <div className="flex flex-col items-center gap-4">
        <div className="relative size-20">
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-[#E8E2FF] border-t-[#7C5CFC]" />
          <div className="absolute inset-0 flex items-center justify-center">
            <img src="/illustration/LifeHub icon.webp" alt="" className="size-12 object-contain" />
          </div>
        </div>
        <p className="text-sm font-semibold text-[#6B7280]">Loading…</p>
      </div>
    </div>
  );
}

/**
 * Auth & Onboarding Gate:
 * Controls root level layout rendering.
 *
 * 1. While loading (Firebase auth state unknown): renders the splash screen —
 *    the ONLY moment a loading screen is allowed, and it lasts milliseconds.
 * 2. Unauthenticated: renders nothing and redirects immediately to /auth —
 *    no loading screen, no user data is loaded.
 * 3. Authenticated: mounts DataProvider immediately (cached profile shows
 *    instantly); Firestore data streams in the background.
 * 4. Brand-new account (no Firestore profile document) with missing DOB:
 *    redirects to /onboarding without flashing the home page. Existing
 *    accounts are NEVER sent to onboarding, even without a saved DOB.
 */
function MainContentGate() {
  const { user, loading, profileReady, isNewUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  // The Birthday (Date of Birth) screen is shown ONLY for brand-new accounts
  // whose profile is missing the date of birth.
  const missingDob = !!user && !user.date_of_birth;
  const shouldOnboard = !!user && isNewUser && missingDob;

  useEffect(() => {
    if (loading) return;

    if (!user) {
      if (location.pathname !== "/auth") {
        navigate({ to: "/auth", replace: true });
      }
      return;
    }

    // App rendered successfully — clear any transient startup error counter.
    consecutiveStartupErrors = 0;

    if (shouldOnboard && location.pathname !== "/onboarding") {
      navigate({ to: "/onboarding", replace: true });
    } else if (
      !shouldOnboard &&
      (location.pathname === "/onboarding" || location.pathname === "/auth")
    ) {
      navigate({ to: "/", replace: true });
    }
  }, [user, loading, shouldOnboard, location.pathname, navigate]);

  // 1. Splash ONLY while Firebase auth state is unknown (milliseconds) or
  //    while the Firestore profile read that decides onboarding is pending.
  //    This guarantees the onboarding screen is only ever shown to users
  //    whose profile is truly missing the date of birth — never to users who
  //    already completed it, even when the device cache is cold.
  if (loading || (user && !profileReady)) {
    return <AuthLoadingSplash />;
  }

  // 2. Signed out: never mount protected pages or DataProvider. Render nothing
  //    for the instant the redirect effect takes; the user lands on /auth
  //    immediately with zero loading screens.
  if (!user) {
    if (location.pathname === "/auth") {
      return <Outlet />;
    }
    return null;
  }

  // 3. Brand-new account with missing DOB → onboarding (only new users).
  if (shouldOnboard) {
    if (location.pathname === "/onboarding") {
      return (
        <DataProvider userId={user.id}>
          <Outlet />
        </DataProvider>
      );
    }
    return null;
  }

  // 4. Fully authenticated with complete profile → protected routes, data
  //    loads in the background via Firestore listeners.
  return (
    <DataProvider userId={user.id}>
      <Outlet />
    </DataProvider>
  );
}

/**
 * Global listener for OS notification taps. Mounted once at the root — works
 * whether the app is open, backgrounded, or cold-started from a notification.
 */
function NotificationTapListener() {
  useNotifications();
  return null;
}

function RootComponent() {
  // Ask for the OS permissions (notifications, location, activity, media,
  // audio) once per install — fire-and-forget and spaced out so dialogs
  // never stack. Denied ones are re-asked when the feature is actually used.
  useEffect(() => {
    PermissionManager.requestAllPermissions();
  }, []);

  return (
    <AuthProvider>
      <MainContentGate />
      <NotificationTapListener />
      <Toaster position="top-right" richColors closeButton />
    </AuthProvider>
  );
}
