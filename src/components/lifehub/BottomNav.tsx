import { useEffect, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LayoutGrid, Bot, Activity, User } from "lucide-react";
import { motion } from "framer-motion";
import { sounds } from "@/lib/sound";
import { subscribeOverlays } from "@/lib/overlay-registry";

const items = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/services", label: "Services", Icon: LayoutGrid },
  { to: "/ai", label: "AI Assistant", Icon: Bot },
  { to: "/analytics", label: "Progress", Icon: Activity },
  { to: "/profile", label: "Profile", Icon: User },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [overlaysOpen, setOverlaysOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Hide whenever any modal / dialog / bottom sheet is open — the nav bar
  // must never appear above or behind a modal, app-wide.
  useEffect(() => {
    return subscribeOverlays((count) => setOverlaysOpen(count > 0));
  }, []);

  // Hide when the on-screen keyboard opens (visualViewport shrinks).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      setKeyboardOpen(window.innerHeight - vv.height > 60);
    };
    onResize();
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  if (overlaysOpen || keyboardOpen) return null;

  return (
    <nav className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/85 px-4 py-3 shadow-2xl border border-white/10 backdrop-blur-md">
        {items.map(({ to, label, Icon }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              title={label}
              onClick={() => sounds.playNavClick()}
              className="relative flex size-12 items-center justify-center rounded-full transition-all duration-200"
            >
              {active && (
                <motion.div
                  layoutId="activeTabBadge"
                  className="absolute inset-0 rounded-full bg-white shadow-md"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <Icon
                className={`relative z-10 size-5 transition-all duration-200 ${
                  active ? "scale-110 text-[#12131A]" : "text-white/70 hover:text-white"
                }`}
                strokeWidth={active ? 2.5 : 2}
              />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
