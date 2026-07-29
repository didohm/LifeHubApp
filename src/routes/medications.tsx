import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pill, Check, Flame } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";

export const Route = createFileRoute("/medications")({
  head: () => ({
    meta: [
      { title: "Medications — LifeHub" },
      {
        name: "description",
        content: "A daily medication schedule with dosage times and intake confirmation.",
      },
      { property: "og:title", content: "Medications — LifeHub" },
      { property: "og:description", content: "Never miss a dose with daily reminders." },
    ],
  }),
  component: Medications,
});

const groups = [
  {
    part: "Morning",
    items: [
      { name: "Vitamin D", dose: "1 pill · 08:00", tint: "bg-tangerine" },
      { name: "Omega 3", dose: "2 caps · 08:30", tint: "bg-sky" },
    ],
  },
  {
    part: "Afternoon",
    items: [{ name: "Iron", dose: "1 pill · 14:00", tint: "bg-blush" }],
  },
  {
    part: "Evening",
    items: [{ name: "Magnesium", dose: "1 pill · 21:00", tint: "bg-mint" }],
  },
];

function Medications() {
  const [taken, setTaken] = useState<string[]>(["Vitamin D"]);
  const toggle = (n: string) =>
    setTaken((t) => (t.includes(n) ? t.filter((x) => x !== n) : [...t, n]));

  return (
    <Screen>
      <ScreenHeader
        title="Medications"
        subtitle="4 doses today"
        action={
          <button className="tap flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-sm font-bold text-card active:scale-[0.97]">
            <Plus className="size-4" /> Add
          </button>
        }
      />

      <div className="card-soft flex items-center gap-3 bg-lavender p-4 text-ink">
        <Flame className="size-5" />
        <p className="text-sm font-extrabold">5-day streak — keep it going!</p>
      </div>

      {groups.map((g) => (
        <section key={g.part} className="mt-6">
          <h2 className="mb-3 text-sm font-extrabold text-muted-foreground">{g.part}</h2>
          <div className="space-y-3">
            {g.items.map((m) => {
              const done = taken.includes(m.name);
              return (
                <button
                  key={m.name}
                  onClick={() => toggle(m.name)}
                  className="card-soft tap flex w-full items-center gap-4 bg-card p-4 text-left active:scale-[0.97]"
                >
                  <span
                    className={`flex size-11 items-center justify-center rounded-2xl ${m.tint} text-ink`}
                  >
                    <Pill className="size-5" />
                  </span>
                  <span className="flex-1">
                    <span className="block text-[15px] font-extrabold">{m.name}</span>
                    <span className="block text-[12px] text-muted-foreground">{m.dose}</span>
                  </span>
                  <span
                    className={`flex size-7 items-center justify-center rounded-full border-2 ${
                      done ? "border-ink bg-ink text-card" : "border-border"
                    }`}
                  >
                    {done ? <Check className="size-4" /> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </Screen>
  );
}