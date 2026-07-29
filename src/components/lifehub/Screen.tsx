import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";

export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto w-full max-w-md px-5 pt-6 pb-32">{children}</div>
      <BottomNav />
    </div>
  );
}

export function ScreenHeader({
  title,
  action,
  subtitle,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}