import { createFileRoute } from "@tanstack/react-router";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";

export const Route = createFileRoute("/bills")({
  head: () => ({
    meta: [
      { title: "Bills — LifeHub" },
      {
        name: "description",
        content: "Track bills that are due, paid or overdue and pay them in a tap.",
      },
      { property: "og:title", content: "Bills — LifeHub" },
      { property: "og:description", content: "Due, paid and overdue bills in one view." },
    ],
  }),
  component: Bills,
});

const bills = [
  { name: "City Power", amount: "$84.20", due: "Overdue · 21 Nov", tint: "bg-tangerine" },
  { name: "Fiber Internet", amount: "$45.00", due: "Due 27 Nov", tint: "bg-lavender-soft" },
  { name: "Water Utility", amount: "$22.60", due: "Due 30 Nov", tint: "bg-lavender-soft" },
  { name: "Health Insurance", amount: "$130.00", due: "Paid 12 Nov", tint: "bg-mint" },
];

function Bills() {
  return (
    <Screen>
      <ScreenHeader title="Bills" subtitle="$281.80 due this month" />

      <section className="card-soft grid grid-cols-3 bg-card p-5 text-center">
        {[
          ["Due", "$151.80"],
          ["Paid", "$130.00"],
          ["Overdue", "$84.20"],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-[12px] text-muted-foreground">{label}</p>
            <p className="mt-1 text-base font-extrabold">{value}</p>
          </div>
        ))}
      </section>

      <div className="mt-5 space-y-3">
        {bills.map((b) => (
          <article
            key={b.name}
            className={`card-soft flex items-center gap-4 ${b.tint} p-4 text-ink`}
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-card text-sm font-extrabold">
              {b.name[0]}
            </span>
            <div className="flex-1">
              <p className="text-[15px] font-extrabold">{b.name}</p>
              <p className="text-[12px] text-ink/70">{b.due}</p>
            </div>
            <div className="text-right">
              <p className="text-[15px] font-extrabold">{b.amount}</p>
              <button className="tap mt-1 rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-card active:scale-[0.97]">
                Pay Now
              </button>
            </div>
          </article>
        ))}
      </div>
    </Screen>
  );
}