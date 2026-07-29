import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Check } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [
      { title: "Tasks — LifeHub" },
      {
        name: "description",
        content: "A simple daily checklist for today, this week and later, with priority cues.",
      },
      { property: "og:title", content: "Tasks — LifeHub" },
      { property: "og:description", content: "Quick-check daily task management." },
    ],
  }),
  component: Tasks,
});

const initial = [
  { group: "Today", text: "Refill blood pressure pills", time: "18:00", dot: "bg-tangerine" },
  { group: "Today", text: "Pay the electricity bill", time: "20:00", dot: "bg-blush" },
  { group: "Today", text: "Call the clinic", time: "", dot: "bg-sky" },
  { group: "This Week", text: "Upload insurance card", time: "Thu", dot: "bg-mint" },
  { group: "This Week", text: "Book dentist follow-up", time: "Fri", dot: "bg-lavender" },
  { group: "Later", text: "Renew passport", time: "Dec", dot: "bg-sky" },
];

function Tasks() {
  const [done, setDone] = useState<string[]>(["Call the clinic"]);
  const toggle = (t: string) =>
    setDone((d) => (d.includes(t) ? d.filter((x) => x !== t) : [...d, t]));

  const today = initial.filter((t) => t.group === "Today");
  const todayDone = today.filter((t) => done.includes(t.text)).length;

  return (
    <Screen>
      <ScreenHeader
        title="Tasks"
        subtitle={`${todayDone} of ${today.length} completed today`}
        action={
          <button className="tap flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-sm font-bold text-card active:scale-[0.97]">
            <Plus className="size-4" /> Add
          </button>
        }
      />

      <div className="h-2 w-full overflow-hidden rounded-full bg-card">
        <div
          className="h-full rounded-full bg-lavender transition-all"
          style={{ width: `${(todayDone / today.length) * 100}%` }}
        />
      </div>

      {["Today", "This Week", "Later"].map((group) => (
        <section key={group} className="mt-6">
          <h2 className="mb-3 text-sm font-extrabold text-muted-foreground">{group}</h2>
          <div className="card-soft divide-y divide-border bg-card px-4">
            {initial
              .filter((t) => t.group === group)
              .map((t) => {
                const isDone = done.includes(t.text);
                return (
                  <button
                    key={t.text}
                    onClick={() => toggle(t.text)}
                    className="flex w-full items-center gap-3 py-4 text-left"
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 ${
                        isDone ? "border-ink bg-ink text-card" : "border-border"
                      }`}
                    >
                      {isDone ? <Check className="size-3.5" /> : null}
                    </span>
                    <span
                      className={`flex-1 text-[14px] font-semibold ${
                        isDone ? "text-muted-foreground line-through" : ""
                      }`}
                    >
                      {t.text}
                    </span>
                    {t.time ? (
                      <span className="text-[12px] text-muted-foreground">{t.time}</span>
                    ) : null}
                    <span className={`size-2 rounded-full ${t.dot}`} />
                  </button>
                );
              })}
          </div>
        </section>
      ))}
    </Screen>
  );
}