import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Wallet, FolderClosed, ListChecks } from "lucide-react";
import { Screen } from "@/components/lifehub/Screen";
import hero3d from "@/assets/hero-3d.png";
import avatar from "@/assets/avatar-user.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LifeHub — Your daily life, in one place" },
      {
        name: "description",
        content:
          "LifeHub keeps appointments, bills, medications, documents and to-dos together in one calm, friendly app.",
      },
      { property: "og:title", content: "LifeHub — Your daily life, in one place" },
      {
        property: "og:description",
        content: "Appointments, bills, medications, documents and tasks in one friendly app.",
      },
    ],
  }),
  component: Index,
});

const days = [
  { d: "Sun", n: 22, dot: false },
  { d: "Mon", n: 23, dot: true },
  { d: "Tue", n: 24, dot: false },
  { d: "Wed", n: 25, dot: true, active: true },
  { d: "Thu", n: 26, dot: false },
  { d: "Fri", n: 27, dot: true },
  { d: "Sat", n: 28, dot: false },
];

const quickActions = [
  { to: "/bills", label: "Pay Bills", Icon: Wallet },
  { to: "/documents", label: "Documents", Icon: FolderClosed },
  { to: "/tasks", label: "To-Do List", Icon: ListChecks },
] as const;

function Index() {
  return (
    <Screen>
      <header className="flex items-center justify-between">
        <img
          src={avatar}
          alt="Your profile"
          width={512}
          height={512}
          className="size-11 rounded-full object-cover"
        />
        <div className="text-center">
          <p className="text-base font-extrabold">Hello, Sandra</p>
          <p className="text-xs text-muted-foreground">Today 25 Nov.</p>
        </div>
        <button
          aria-label="Search"
          className="tap flex size-11 items-center justify-center rounded-full bg-card shadow-[var(--shadow-soft)]"
        >
          <Search className="size-4" />
        </button>
      </header>

      <section className="card-soft relative mt-5 overflow-hidden bg-lavender p-5">
        <div className="max-w-[58%]">
          <h1 className="text-[27px] leading-8 font-extrabold text-ink">
            Today&apos;s
            <br />
            Reminders
          </h1>
          <p className="mt-2 text-[13px] text-ink/70">Complete your tasks before 9:00 PM</p>
          <div className="mt-4 flex items-center">
            {["A", "M", "J"].map((i, idx) => (
              <span
                key={i}
                style={{ marginLeft: idx === 0 ? 0 : -10 }}
                className="flex size-8 items-center justify-center rounded-full border-2 border-lavender bg-card text-xs font-bold"
              >
                {i}
              </span>
            ))}
            <span className="-ml-2.5 flex size-8 items-center justify-center rounded-full border-2 border-lavender bg-ink text-[11px] font-bold text-card">
              +4
            </span>
          </div>
        </div>
        <img
          src={hero3d}
          alt="Medication and appointment illustration"
          width={768}
          height={768}
          className="pointer-events-none absolute -right-4 top-1/2 w-44 -translate-y-1/2"
        />
      </section>

      <section className="mt-4 flex justify-between gap-1.5">
        {days.map((day) => (
          <div
            key={day.d}
            className={`flex w-[13%] flex-col items-center gap-0.5 rounded-2xl py-2.5 ${
              day.active ? "bg-ink text-card" : "bg-card text-foreground"
            }`}
          >
            {day.dot ? (
              <span
                className={`size-1 rounded-full ${day.active ? "bg-card" : "bg-lavender"}`}
              />
            ) : (
              <span className="size-1" />
            )}
            <span className="text-[11px] font-semibold opacity-70">{day.d}</span>
            <span className="text-[13px] font-bold">{day.n}</span>
          </div>
        ))}
      </section>

      <h2 className="mt-7 text-xl font-extrabold">Your Plan Today</h2>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          to="/appointments"
          className="card-soft tap flex flex-col bg-tangerine p-4 text-ink active:scale-[0.97]"
        >
          <span className="w-fit rounded-full bg-card/70 px-3 py-1 text-[11px] font-bold">
            Medium Priority
          </span>
          <span className="mt-4 text-lg font-extrabold leading-6">
            Doctor
            <br />
            Appointment
          </span>
          <span className="mt-3 text-[13px] leading-5 text-ink/75">
            25 Nov.
            <br />
            14:00–15:00
            <br />
            City Clinic
          </span>
          <span className="mt-6 flex items-center gap-2 border-t border-ink/10 pt-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-card text-[11px] font-bold">
              DR
            </span>
            <span className="text-[13px] font-bold">Dr. Hale</span>
          </span>
        </Link>

        <div className="flex flex-col gap-3">
          <Link
            to="/medications"
            className="card-soft tap bg-sky p-4 text-ink active:scale-[0.97]"
          >
            <span className="w-fit rounded-full bg-card/70 px-3 py-1 text-[11px] font-bold">
              Light
            </span>
            <span className="mt-3 block text-lg font-extrabold">Medication</span>
            <span className="mt-2 block text-[13px] leading-5 text-ink/75">
              25 Nov.
              <br />
              18:00
              <br />
              Vitamin D · 1 pill
            </span>
          </Link>

          <div className="card-soft bg-blush p-4">
            <div className="flex items-center justify-between">
              {quickActions.map(({ to, label, Icon }) => (
                <Link
                  key={to}
                  to={to}
                  aria-label={label}
                  title={label}
                  className="tap flex size-10 items-center justify-center rounded-full bg-card text-ink active:scale-[0.97]"
                >
                  <Icon className="size-4" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Screen>
  );
}
