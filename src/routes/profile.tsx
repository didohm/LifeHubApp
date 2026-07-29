import { createFileRoute } from "@tanstack/react-router";
import { Bell, Lock, Globe, LifeBuoy } from "lucide-react";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import avatar from "@/assets/avatar-user.jpg";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Profile — LifeHub" },
      {
        name: "description",
        content: "Manage reminders, privacy, language and support settings for your LifeHub.",
      },
      { property: "og:title", content: "Profile — LifeHub" },
      { property: "og:description", content: "Your LifeHub account and preferences." },
    ],
  }),
  component: Profile,
});

const rows = [
  { label: "Reminders & notifications", Icon: Bell },
  { label: "Privacy & document lock", Icon: Lock },
  { label: "Language (English / العربية)", Icon: Globe },
  { label: "Help & support", Icon: LifeBuoy },
];

function Profile() {
  return (
    <Screen>
      <ScreenHeader title="Profile" />
      <section className="card-soft flex items-center gap-4 bg-lavender p-5 text-ink">
        <img
          src={avatar}
          alt="Sandra's profile"
          width={512}
          height={512}
          loading="lazy"
          className="size-16 rounded-full object-cover"
        />
        <div>
          <p className="text-lg font-extrabold">Sandra Miles</p>
          <p className="text-[13px] text-ink/70">sandra@lifehub.app</p>
        </div>
      </section>

      <div className="card-soft mt-5 divide-y divide-border bg-card px-4">
        {rows.map(({ label, Icon }) => (
          <button key={label} className="flex w-full items-center gap-3 py-4 text-left">
            <span className="flex size-9 items-center justify-center rounded-xl bg-muted">
              <Icon className="size-4" />
            </span>
            <span className="text-[14px] font-semibold">{label}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}