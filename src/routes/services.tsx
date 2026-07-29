import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarHeart, Wallet, Pill, FolderClosed, ListChecks } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";

export const Route = createFileRoute("/services")({
  head: () => ({
    meta: [
      { title: "Services — LifeHub" },
      {
        name: "description",
        content: "All LifeHub services: appointments, bills, medications, documents and tasks.",
      },
      { property: "og:title", content: "Services — LifeHub" },
      { property: "og:description", content: "Every daily life service in one grid." },
    ],
  }),
  component: Services,
});

const services = [
  { to: "/appointments", label: "Appointments", tint: "bg-tangerine", Icon: CalendarHeart },
  { to: "/bills", label: "Bills", tint: "bg-blush", Icon: Wallet },
  { to: "/medications", label: "Medications", tint: "bg-sky", Icon: Pill },
  { to: "/documents", label: "Documents", tint: "bg-mint", Icon: FolderClosed },
  { to: "/tasks", label: "To-Do List", tint: "bg-lavender", Icon: ListChecks },
] as const;

function Services() {
  return (
    <Screen>
      <ScreenHeader title="Services" subtitle="Everything in one place" />
      <div className="grid grid-cols-2 gap-3">
        {services.map(({ to, label, tint, Icon }) => (
          <Link
            key={to}
            to={to}
            className={`card-soft tap ${tint} p-5 text-ink active:scale-[0.97]`}
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-card">
              <Icon className="size-5" />
            </span>
            <span className="mt-4 block text-[15px] font-extrabold">{label}</span>
          </Link>
        ))}
      </div>
    </Screen>
  );
}