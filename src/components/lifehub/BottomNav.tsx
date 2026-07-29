import { Link, useRouterState } from "@tanstack/react-router";
import { Home, LayoutGrid, Receipt, User } from "lucide-react";

const items = [
  { to: "/", label: "Home", Icon: Home },
  { to: "/services", label: "Services", Icon: LayoutGrid },
  { to: "/bills", label: "Bills", Icon: Receipt },
  { to: "/profile", label: "Profile", Icon: User },
] as const;

export function BottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex justify-center pb-5">
      <div className="flex items-center gap-1 rounded-full bg-ink px-2 py-2 shadow-[var(--shadow-pill)]">
        {items.map(({ to, label, Icon }) => {
          const active = pathname === to;
          return (
            <Link
              key={to}
              to={to}
              aria-label={label}
              className={`tap flex size-12 items-center justify-center rounded-full ${
                active ? "bg-card text-ink" : "text-card/70"
              }`}
            >
              <Icon className="size-5" strokeWidth={2} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}