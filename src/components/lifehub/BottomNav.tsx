import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LayoutGrid, Bot, Activity, User } from "lucide-react";
import { motion } from "framer-motion";

const items = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/services", label: "Services", Icon: LayoutGrid },
  { to: "/ai", label: "AI Assistant", Icon: Bot },
  { to: "/analytics", label: "Progress", Icon: Activity },
  { to: "/profile", label: "Profile", Icon: User },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="fixed inset-x-0 bottom-6 z-50 flex justify-center pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full bg-slate-900/85 px-3 py-2 shadow-2xl border border-white/10 backdrop-blur-md">
        {items.map(({ to, label, Icon }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              title={label}
              className="relative flex size-11 items-center justify-center rounded-full transition-all duration-200"
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