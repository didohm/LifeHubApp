import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, MapPin, Clock } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";

export const Route = createFileRoute("/appointments")({
  head: () => ({
    meta: [
      { title: "Appointments — LifeHub" },
      {
        name: "description",
        content: "See upcoming, past and cancelled doctor appointments and book new visits.",
      },
      { property: "og:title", content: "Appointments — LifeHub" },
      { property: "og:description", content: "Track and book your doctor appointments." },
    ],
  }),
  component: Appointments,
});

const tabs = ["Upcoming", "Past", "Cancelled"] as const;

const data = [
  {
    specialty: "Dentist",
    doctor: "Dr. Amina Hale",
    when: "25 Nov · 14:00",
    place: "City Clinic, Room 4",
    tint: "bg-tangerine",
  },
  {
    specialty: "Cardiologist",
    doctor: "Dr. Omar Reed",
    when: "02 Dec · 09:30",
    place: "Heart Center",
    tint: "bg-sky",
  },
  {
    specialty: "Dermatologist",
    doctor: "Dr. Lina Faris",
    when: "11 Dec · 16:15",
    place: "Skin Studio",
    tint: "bg-mint",
  },
];

function Appointments() {
  const [tab, setTab] = useState<(typeof tabs)[number]>("Upcoming");

  return (
    <Screen>
      <ScreenHeader
        title="Appointments"
        subtitle="3 visits scheduled"
        action={
          <button className="tap flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-sm font-bold text-card active:scale-[0.97]">
            <Plus className="size-4" /> New
          </button>
        }
      />

      <div className="flex gap-2">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tap rounded-full px-4 py-2 text-[13px] font-bold ${
              tab === t ? "bg-lavender text-ink" : "bg-card text-muted-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-4">
        {(tab === "Upcoming" ? data : []).map((a) => (
          <article key={a.doctor} className={`card-soft ${a.tint} p-5 text-ink`}>
            <span className="rounded-full bg-card/70 px-3 py-1 text-[11px] font-bold">
              {a.specialty}
            </span>
            <div className="mt-3 flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-card text-xs font-extrabold">
                {a.doctor.split(" ")[1]?.[0] ?? "D"}
              </span>
              <p className="text-lg font-extrabold">{a.doctor}</p>
            </div>
            <p className="mt-3 flex items-center gap-2 text-[13px] text-ink/75">
              <Clock className="size-4" /> {a.when}
            </p>
            <p className="mt-1 flex items-center gap-2 text-[13px] text-ink/75">
              <MapPin className="size-4" /> {a.place}
            </p>
            <div className="mt-4 flex gap-2">
              <button className="tap flex-1 rounded-full bg-card py-2 text-[13px] font-bold active:scale-[0.97]">
                Reschedule
              </button>
              <button className="tap flex-1 rounded-full border border-ink/15 py-2 text-[13px] font-bold active:scale-[0.97]">
                Cancel
              </button>
            </div>
          </article>
        ))}
        {tab !== "Upcoming" && (
          <p className="rounded-3xl bg-card p-8 text-center text-sm text-muted-foreground">
            No {tab.toLowerCase()} appointments.
          </p>
        )}
      </div>
    </Screen>
  );
}