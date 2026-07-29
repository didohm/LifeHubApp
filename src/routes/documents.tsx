import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Upload, Search, FileText, IdCard, ShieldCheck, Stethoscope } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents — LifeHub" },
      {
        name: "description",
        content: "Keep IDs, insurance papers, medical reports and prescriptions safely in one place.",
      },
      { property: "og:title", content: "Documents — LifeHub" },
      { property: "og:description", content: "Secure storage for your important documents." },
    ],
  }),
  component: Documents,
});

const chips = ["All", "ID", "Insurance", "Medical", "Other"] as const;

const docs = [
  { title: "National ID", date: "12 Mar 2025", cat: "ID", tint: "bg-lavender-soft", Icon: IdCard },
  {
    title: "Health Insurance",
    date: "04 Jan 2025",
    cat: "Insurance",
    tint: "bg-mint",
    Icon: ShieldCheck,
  },
  {
    title: "Blood Test",
    date: "18 Oct 2025",
    cat: "Medical",
    tint: "bg-sky",
    Icon: Stethoscope,
  },
  { title: "Prescription", date: "21 Nov 2025", cat: "Medical", tint: "bg-blush", Icon: FileText },
];

function Documents() {
  const [cat, setCat] = useState<(typeof chips)[number]>("All");
  const list = cat === "All" ? docs : docs.filter((d) => d.cat === cat);

  return (
    <Screen>
      <ScreenHeader
        title="My Documents"
        subtitle={`${docs.length} files stored`}
        action={
          <div className="flex gap-2">
            <button
              aria-label="Search documents"
              className="tap flex size-10 items-center justify-center rounded-full bg-card"
            >
              <Search className="size-4" />
            </button>
            <button
              aria-label="Upload document"
              className="tap flex size-10 items-center justify-center rounded-full bg-ink text-card"
            >
              <Upload className="size-4" />
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`tap rounded-full px-4 py-2 text-[13px] font-bold ${
              cat === c ? "bg-lavender text-ink" : "bg-card text-muted-foreground"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {list.map(({ title, date, tint, Icon }) => (
          <button
            key={title}
            className={`card-soft tap ${tint} p-4 text-left text-ink active:scale-[0.97]`}
          >
            <span className="flex size-11 items-center justify-center rounded-2xl bg-card">
              <Icon className="size-5" />
            </span>
            <span className="mt-4 block text-[15px] font-extrabold leading-5">{title}</span>
            <span className="mt-1 block text-[12px] text-ink/70">{date}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}