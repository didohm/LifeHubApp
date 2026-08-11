import { useState, useEffect, useRef, useCallback, memo } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  LogOut,
  Trash2,
  Camera,
  X,
  Loader2,
  Settings as SettingsIcon,
  User,
  Target,
  Bell,
  ChevronRight,
  ShieldCheck,
  Dumbbell,
  CheckCircle2,
  Droplets,
  Footprints,
  Calendar,
  Award,
  Volume2,
  VolumeX,
  BellRing,
  CalendarDays,
  Pencil,
  Headset,
  Instagram,
  Linkedin,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { UserAvatar } from "@/components/lifehub/UserAvatar";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { calculateAge, toDateInputValue } from "@/lib/utils";
import { sounds } from "@/lib/sound";
import { Notifications, readReminderSettings } from "@/lib/notifications-integration";
import { PermissionManager } from "@/lib/permissions";
import { Capacitor } from "@capacitor/core";
import { updateUserProfile, deleteUserAccount, getProfileStats, ProfileStats } from "@/lib/api";
import { uploadAvatar, validateFileSize, formatFileSize } from "@/lib/cloudinary";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [{ title: "Profile & Settings — LifeHub" }],
  }),
  component: ProfilePage,
});

interface StatCardProps {
  icon: React.ElementType;
  iconClassName: string;
  value: React.ReactNode;
  label: string;
  valueClassName?: string;
}

const StatCard = memo(function StatCard({
  icon: Icon,
  iconClassName,
  value,
  label,
  valueClassName,
}: StatCardProps) {
  return (
    <div className="card-soft bg-white p-3.5 border border-black/5 shadow-xs text-left flex items-center gap-3">
      <div
        className={`flex size-9 items-center justify-center rounded-2xl shrink-0 ${iconClassName}`}
      >
        <Icon className="size-4.5" />
      </div>
      <div>
        <span className={`text-base font-black text-[#12131A] ${valueClassName || ""}`}>
          {value}
        </span>
        <span className="block text-[11px] font-semibold text-[#6B7280]">{label}</span>
      </div>
    </div>
  );
});

interface MenuButtonProps {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
}

const MenuButton = memo(function MenuButton({
  icon: Icon,
  label,
  onClick,
  variant = "default",
}: MenuButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`tap card-soft w-full bg-white p-4 flex items-center justify-between border shadow-xs transition-all ${
        variant === "danger"
          ? "border-rose-100 text-rose-600 hover:bg-rose-50/50 mt-4"
          : "border-black/5 text-[#12131A] hover:shadow-md"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`flex size-9 items-center justify-center rounded-full ${
            variant === "danger" ? "bg-rose-100 text-rose-600" : "bg-[#F0F0F5] text-[#12131A]"
          }`}
        >
          <Icon className="size-4.5" />
        </div>
        <span className="text-sm font-extrabold">{label}</span>
      </div>
      <ChevronRight className="size-4 opacity-50" />
    </button>
  );
});

function ProfilePage() {
  const { user, logout, updateUserField } = useAuth();
  const navigate = useNavigate();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [helpModalOpen, setHelpModalOpen] = useState(false);

  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string>(() => user?.avatar_url || "");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [soundsEnabled, setSoundsEnabled] = useState(sounds.isEnabled());
  const [reminderSettings, setReminderSettings] = useState(readReminderSettings);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [realStats, setRealStats] = useState<ProfileStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const statsRequestId = useRef(0);

  // Sync user fields only when the relevant fields actually change
  useEffect(() => {
    if (!user) return;
    setFullName((prev) => (prev !== user.full_name ? user.full_name || "" : prev));
    setDob((prev) => (prev !== user.date_of_birth ? user.date_of_birth || "" : prev));
    setAvatarPreview((prev) => (prev !== user.avatar_url ? user.avatar_url || "" : prev));
  }, [user]);

  // Load stats when user id changes
  useEffect(() => {
    if (!user) return;
    statsRequestId.current += 1;
    const myId = statsRequestId.current;
    setStatsLoading(true);
    getProfileStats(user.id)
      .then((data) => {
        if (myId === statsRequestId.current) setRealStats(data);
      })
      .catch((err) => console.error("Failed to load profile stats:", err))
      .finally(() => {
        if (myId === statsRequestId.current) setStatsLoading(false);
      });
  }, [user]);

  const handleImageFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file.");
      return;
    }

    // Validate file size (max 5MB for avatars)
    const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
    if (!validateFileSize(file, MAX_AVATAR_SIZE)) {
      toast.error(`Image is too large. Maximum size is ${formatFileSize(MAX_AVATAR_SIZE)}.`);
      return;
    }

    setUploadingAvatar(true);
    setUploadProgress(0);

    try {
      // Upload to Cloudinary
      const result = await uploadAvatar(file, (progress) => {
        setUploadProgress(progress);
      });

      setAvatarPreview(result.secure_url);
      toast.success("Profile photo uploaded! Click Save to apply.");
    } catch (error) {
      console.error("Avatar upload failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to upload avatar.");
    } finally {
      setUploadingAvatar(false);
      setUploadProgress(0);
    }
  }, []);

  const handleUpdateProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user) return;
      if (dob && dob > toDateInputValue()) {
        toast.error("Date of birth can't be in the future.");
        return;
      }
      setSubmitting(true);
      try {
        await updateUserProfile(user.id, { full_name: fullName, avatar_url: avatarPreview });
        updateUserField("full_name", fullName);
        updateUserField("avatar_url", avatarPreview || null);
        setEditModalOpen(false);
        toast.success("Profile updated successfully!");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to update profile.");
      } finally {
        setSubmitting(false);
      }
    },
    [user, dob, fullName, avatarPreview, updateUserField],
  );

  const handleToggleDailyReminder = useCallback(async () => {
    const daily = reminderSettings.daily;
    const next = !daily.enabled;
    try {
      if (next) {
        const granted = await PermissionManager.ensurePermission("notification");
        if (!granted) {
          toast.error(
            "Notifications are disabled. Enable them in Android Settings to receive reminders.",
          );
          return;
        }
        await Notifications.scheduleDailyReminder(daily.hour, daily.minute);
        toast.success(
          `Daily reminder ON — every day at ${daily.hour.toString().padStart(2, "0")}:${daily.minute.toString().padStart(2, "0")}`,
        );
      } else {
        await Notifications.cancelDailyReminder();
        toast.success("Daily reminder turned off");
      }
      setReminderSettings(readReminderSettings);
    } catch {
      toast.error("Could not update reminder");
    }
  }, [reminderSettings.daily]);

  const handleTimeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const [h, m] = e.target.value.split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      setReminderSettings((prev) => {
        const next = { ...prev, daily: { ...prev.daily, hour: h, minute: m } };
        if (next.daily.enabled) void Notifications.scheduleDailyReminder(h, m);
        return next;
      });
    }
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    if (!user) return;
    setDeleting(true);
    try {
      await deleteUserAccount(user.id);
      await logout();
      toast.success("Account deleted successfully.");
      navigate({ to: "/auth" });
    } catch {
      toast.error("Could not delete account.");
    } finally {
      setDeleting(false);
    }
  }, [user, logout, navigate]);

  const handleLogout = useCallback(async () => {
    await logout();
    toast.success("Logged out safely");
    navigate({ to: "/auth" });
  }, [logout, navigate]);

  const openEdit = () => setEditModalOpen(true);
  const openSettings = () => setSettingsModalOpen(true);
  const openHelp = () => setHelpModalOpen(true);

  const statsData = (val: number | string | undefined, fallback = "—") =>
    statsLoading ? "..." : (val ?? fallback);

  return (
    <Screen>
      <ScreenHeader
        title="Profile"
        showBack
        action={
          <button
            onClick={openSettings}
            className="tap flex size-9 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5"
            title="Settings"
          >
            <SettingsIcon className="size-4.5" />
          </button>
        }
      />

      {/* Profile Avatar Card */}
      <section className="mt-2 text-center">
        <div className="relative mx-auto size-24">
          <UserAvatar
            name={user?.full_name}
            src={avatarPreview}
            alt={user?.full_name || "Profile avatar"}
            className="size-full rounded-full border-4 border-white shadow-md"
            initialsClassName="text-2xl"
          />
          <button
            onClick={openEdit}
            className="absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full bg-[#7C5CFC] text-white shadow-sm hover:scale-105"
            title="Edit avatar"
          >
            <Camera className="size-3.5" />
          </button>
        </div>

        <h2 className="mt-3 text-xl font-extrabold text-[#12131A]">
          {user?.full_name || "Account"}
        </h2>
        {user?.email ? <p className="text-xs font-semibold text-[#6B7280]">{user.email}</p> : null}

        {/* Real Database Statistics Grid */}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <StatCard
            icon={Dumbbell}
            iconClassName="bg-orange-500/10 text-orange-600"
            value={statsData(realStats?.totalWorkoutsCompleted)}
            label="Workouts"
          />
          <StatCard
            icon={CheckCircle2}
            iconClassName="bg-emerald-500/10 text-emerald-600"
            value={statsData(realStats ? `${realStats.avgTaskCompletion}%` : undefined)}
            label="Avg Task Done"
          />
          <StatCard
            icon={Droplets}
            iconClassName="bg-sky-500/10 text-sky-600"
            value={statsData(realStats ? `${realStats.waterGoalStreak}d` : undefined)}
            label="Water Streak"
          />
          <StatCard
            icon={Footprints}
            iconClassName="bg-emerald-500/10 text-emerald-600"
            value={
              statsLoading
                ? "..."
                : realStats
                  ? `${(realStats.totalWalkingDistanceMeters / 1000).toFixed(2)}km`
                  : "—"
            }
            label="Walk Distance"
          />
          <StatCard
            icon={Calendar}
            iconClassName="bg-purple-500/10 text-purple-600"
            value={statsData(realStats?.totalAppointments)}
            label="Appointments"
          />
          <StatCard
            icon={Award}
            iconClassName="bg-amber-500/10 text-amber-600"
            value={
              <span className="text-sm font-black text-[#12131A] truncate block max-w-[85px]">
                {statsData(realStats?.currentAchievementLevel)}
              </span>
            }
            label="Level"
            valueClassName="text-sm"
          />
        </div>
      </section>

      {/* Menu Options List */}
      <section className="mt-5 space-y-2">
        <MenuButton icon={User} label="Personal Info" onClick={openEdit} />
        <MenuButton
          icon={Target}
          label="Goals & Progress"
          onClick={() => navigate({ to: "/analytics" })}
        />
        <MenuButton icon={Bell} label="Notifications" onClick={openSettings} />
        <MenuButton icon={Headset} label="Support / Help" onClick={openHelp} />
        <MenuButton icon={LogOut} label="Log Out" onClick={handleLogout} variant="danger" />
      </section>

      {/* Settings Modal */}
      <Modal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        className="bg-card"
        backdropClassName="px-3"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <h2 className="text-lg font-extrabold tracking-tight text-foreground">Settings</h2>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="size-8 flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              General
            </h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 p-3.5">
                <span className="text-sm font-bold text-foreground">Units</span>
                <span className="flex shrink-0 items-center gap-1 text-xs font-extrabold text-primary">
                  Metric (kg, cm) <ChevronRight className="size-3" />
                </span>
              </div>
            </div>
          </div>

          <div>
            <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Preferences
            </h4>
            <div className="space-y-2">
              <button
                onClick={() => {
                  const newVal = !soundsEnabled;
                  setSoundsEnabled(newVal);
                  sounds.setEnabled(newVal);
                  if (newVal) sounds.playClick();
                }}
                className="tap flex w-full items-center justify-between gap-3 rounded-xl bg-muted/30 p-3.5 transition-colors hover:bg-muted"
              >
                <span className="text-sm font-bold text-foreground">Sound Effects</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`text-xs font-extrabold ${soundsEnabled ? "text-emerald-600" : "text-muted-foreground"}`}
                  >
                    {soundsEnabled ? "On" : "Off"}
                  </span>
                  {soundsEnabled ? (
                    <Volume2 className="size-4 text-emerald-600" />
                  ) : (
                    <VolumeX className="size-4 text-muted-foreground" />
                  )}
                </div>
              </button>

              {Capacitor.isNativePlatform() && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 p-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <BellRing className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <span className="block truncate text-sm font-bold text-foreground">
                        Daily Reminder
                      </span>
                      <span className="block truncate text-xs font-medium text-muted-foreground">
                        {reminderSettings.daily.enabled
                          ? `Every day at ${reminderSettings.daily.hour.toString().padStart(2, "0")}:${reminderSettings.daily.minute.toString().padStart(2, "0")}`
                          : "Off — one check-in per day"}
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <input
                      type="time"
                      value={`${reminderSettings.daily.hour.toString().padStart(2, "0")}:${reminderSettings.daily.minute.toString().padStart(2, "0")}`}
                      onChange={handleTimeChange}
                      className="rounded-lg border border-input bg-card px-2.5 py-2 text-xs font-bold text-foreground outline-none"
                    />
                    <button
                      role="switch"
                      aria-checked={reminderSettings.daily.enabled}
                      aria-label="Toggle daily reminder"
                      onClick={handleToggleDailyReminder}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        reminderSettings.daily.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 size-5 rounded-full bg-card shadow transition-all ${
                          reminderSettings.daily.enabled ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              About
            </h4>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 p-3.5">
              <span className="text-sm font-bold text-foreground">Version</span>
              <span className="shrink-0 text-xs font-semibold text-muted-foreground">1.0.0</span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Help & Support dialog */}
      <Modal open={helpModalOpen} onClose={() => setHelpModalOpen(false)} className="bg-card">
        <div className="flex items-center justify-between border-b border-border/40 pb-4">
          <h2 className="text-lg font-extrabold tracking-tight text-foreground">Help & Support</h2>
          <button
            onClick={() => setHelpModalOpen(false)}
            className="size-8 flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-muted/70"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div className="flex flex-col items-center gap-2 rounded-2xl bg-muted/30 px-5 py-6 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ShieldCheck className="size-5" />
            </div>
            <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Developed by
            </p>
            <p className="text-lg font-extrabold tracking-tight text-foreground">
              Boumedien Himich
            </p>
          </div>

          <div className="space-y-2.5">
            <a
              href="https://www.instagram.com/didohm_/"
              target="_blank"
              rel="noopener noreferrer"
              className="tap flex w-full items-center justify-between gap-3 rounded-xl bg-muted/30 p-3.5 transition-colors hover:bg-muted"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white">
                  <Instagram className="size-4.5" />
                </div>
                <span className="text-sm font-bold text-foreground">Instagram</span>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </a>

            <a
              href="https://www.linkedin.com/in/boumedienhimich/"
              target="_blank"
              rel="noopener noreferrer"
              className="tap flex w-full items-center justify-between gap-3 rounded-xl bg-muted/30 p-3.5 transition-colors hover:bg-muted"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#0A66C2] text-white">
                  <Linkedin className="size-4.5" />
                </div>
                <span className="text-sm font-bold text-foreground">LinkedIn</span>
              </div>
              <ChevronRight className="size-4 text-muted-foreground" />
            </a>
          </div>

          <p className="text-center text-[11px] font-semibold text-muted-foreground">
            Questions or feedback? Reach out on any platform above.
          </p>
        </div>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal open={editModalOpen} onClose={() => setEditModalOpen(false)} className="bg-card">
        <form onSubmit={handleUpdateProfile} className="mt-4 space-y-3">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h2 className="text-lg font-extrabold text-foreground">Edit Personal Info</h2>
            <button
              onClick={() => setEditModalOpen(false)}
              className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="relative flex flex-col items-center overflow-hidden rounded-xl border border-border/40 bg-muted/30 px-5 py-6">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_60%_at_50%_30%,oklch(0.75_0.09_292/0.1),transparent_70%)]"
            />
            <div className="relative">
              <div className="rounded-full bg-card p-1.5 shadow-md">
                <UserAvatar
                  name={user?.full_name}
                  src={avatarPreview}
                  alt={user?.full_name || "Profile avatar"}
                  className="size-24 rounded-full border-2 border-primary/10"
                  initialsClassName="text-2xl"
                />
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Change profile photo"
                className="tap absolute -bottom-0.5 -right-0.5 flex size-9 items-center justify-center rounded-full bg-ink text-card shadow-md ring-4 ring-card transition-transform hover:scale-105 active:scale-95"
              >
                <Camera className="size-4" />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="tap flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-xs font-bold text-primary shadow-sm ring-1 ring-primary/20 transition-all hover:bg-primary/5 hover:ring-primary/30 active:scale-95"
              >
                <Pencil className="size-3" /> Change photo
              </button>
              {avatarPreview ? (
                <button
                  type="button"
                  onClick={() => {
                    setAvatarPreview("");
                    toast.success("Photo removed — click Save to apply.");
                  }}
                  className="tap flex items-center gap-1.5 rounded-full bg-card px-4 py-2 text-xs font-bold text-rose-500 shadow-sm ring-1 ring-rose-200 transition-all hover:bg-rose-50 hover:ring-rose-300 active:scale-95"
                >
                  <Trash2 className="size-3" /> Remove
                </button>
              ) : null}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageFileChange}
              className="hidden"
            />

            {uploadingAvatar && uploadProgress > 0 && (
              <div className="mt-3 w-full">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                  <span>Uploading to Cloudinary...</span>
                  <span className="font-bold">{uploadProgress}%</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-foreground">Full Name</label>
            <div className="relative mt-1">
              <User className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your full name"
                className="w-full rounded-xl border border-input bg-muted/30 py-2.5 pl-9 pr-4 text-sm font-semibold text-foreground outline-none transition-all placeholder:font-medium placeholder:text-muted-foreground/60 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/15"
              />
            </div>
          </div>

          {dob ? (
            <div>
              <label className="text-xs font-bold text-foreground">Date of Birth</label>
              <div className="relative mt-1">
                <CalendarDays className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground/60" />
                <input
                  type="date"
                  readOnly
                  value={dob}
                  className="w-full cursor-not-allowed rounded-xl border border-input bg-muted/50 py-2.5 pl-9 pr-4 text-sm font-semibold text-foreground/60 outline-none"
                />
                <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[10px] font-bold text-muted-foreground">
                  <ShieldCheck className="size-3" /> Locked
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-extrabold text-primary">
                  {calculateAge(dob)} years old
                </span>
                <span className="text-[11px] font-medium text-muted-foreground">
                  Set during onboarding
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2 pt-3">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              className="w-1/2 rounded-xl border border-border py-2.5 text-xs font-bold text-foreground"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-ink py-2.5 text-xs font-bold text-card shadow-md disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>
    </Screen>
  );
}
