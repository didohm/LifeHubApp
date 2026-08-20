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
  Flame,
} from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { UserAvatar } from "@/components/lifehub/UserAvatar";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { calculateAge, toDateInputValue } from "@/lib/utils";
import { sounds } from "@/lib/sound";
import { Notifications, readReminderSettings } from "@/lib/notifications-integration";
import { PermissionManager } from "@/lib/permissions";
import { Capacitor } from "@capacitor/core";
import { updateUserProfile, getProfileStats, ProfileStats } from "@/lib/api";
import { uploadAvatar, validateFileSize, formatFileSize } from "@/lib/cloudinary";
import { cn } from "@/lib/utils";

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
  sublabel?: string;
}

const StatCard = memo(function StatCard({
  icon: Icon,
  iconClassName,
  value,
  label,
  sublabel,
}: StatCardProps) {
  return (
    <div className="card-soft bg-white p-3.5 border border-border/60 shadow-2xs text-left flex items-center gap-3">
      <div
        className={cn(
          "flex size-10 items-center justify-center rounded-2xl shrink-0 shadow-2xs",
          iconClassName,
        )}
      >
        <Icon className="size-5" />
      </div>
      <div className="min-w-0 flex-1">
        <span className="text-base font-black text-[#12131A] block truncate leading-tight">
          {value}
        </span>
        <span className="block text-[11px] font-bold text-muted-foreground truncate">{label}</span>
        {sublabel && (
          <span className="block text-[10px] text-muted-foreground/80 truncate">{sublabel}</span>
        )}
      </div>
    </div>
  );
});

interface MenuRowProps {
  icon: React.ElementType;
  label: string;
  description?: string;
  onClick: () => void;
  variant?: "default" | "danger";
  badge?: string;
}

const MenuRow = memo(function MenuRow({
  icon: Icon,
  label,
  description,
  onClick,
  variant = "default",
  badge,
}: MenuRowProps) {
  return (
    <button
      onClick={() => {
        sounds.playClick();
        onClick();
      }}
      className={cn(
        "tap card-soft w-full p-3.5 flex items-center justify-between border shadow-2xs transition-all text-left group",
        variant === "danger"
          ? "bg-rose-50/40 border-rose-200/60 text-rose-600 hover:bg-rose-50"
          : "bg-white border-border/60 text-[#12131A] hover:bg-slate-50 hover:shadow-xs",
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105",
            variant === "danger"
              ? "bg-rose-100 text-rose-600"
              : "bg-slate-100 text-[#12131A]",
          )}
        >
          <Icon className="size-4.5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs sm:text-sm font-extrabold">{label}</span>
            {badge && (
              <span className="rounded-full bg-[#7C5CFC]/15 px-2 py-0.2 text-[10px] font-bold text-[#7C5CFC]">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <span className="block text-[11px] text-muted-foreground truncate">{description}</span>
          )}
        </div>
      </div>
      <ChevronRight
        className={cn(
          "size-4 opacity-50 shrink-0 group-hover:translate-x-0.5 transition-transform",
          variant === "danger" ? "text-rose-500" : "text-muted-foreground",
        )}
      />
    </button>
  );
});

function ProfilePage() {
  const { user, logout, updateUserField, deleteAccount } = useAuth();
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

    const MAX_AVATAR_SIZE = 5 * 1024 * 1024;
    if (!validateFileSize(file, MAX_AVATAR_SIZE)) {
      toast.error(`Image is too large. Maximum size is ${formatFileSize(MAX_AVATAR_SIZE)}.`);
      return;
    }

    setUploadingAvatar(true);
    setUploadProgress(0);

    try {
      const result = await uploadAvatar(file, (progress) => {
        setUploadProgress(progress);
      });

      setAvatarPreview(result.secure_url);
      toast.success("Profile photo uploaded! Click Save Changes to apply.");
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
          toast.error("Notifications are disabled in system settings.");
          return;
        }
        await Notifications.scheduleDailyReminder(daily.hour, daily.minute);
        toast.success(
          `Daily reminder ON at ${daily.hour.toString().padStart(2, "0")}:${daily.minute.toString().padStart(2, "0")}`,
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
      await deleteAccount();
      toast.success("Account deleted successfully.");
      navigate({ to: "/auth" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete account.");
    } finally {
      setDeleting(false);
    }
  }, [user, deleteAccount, navigate]);

  const handleLogout = useCallback(async () => {
    await logout();
    toast.success("Logged out safely");
    navigate({ to: "/auth" });
  }, [logout, navigate]);

  const openEdit = () => {
    sounds.playActionClick();
    setEditModalOpen(true);
  };
  const openSettings = () => {
    sounds.playActionClick();
    setSettingsModalOpen(true);
  };
  const openHelp = () => {
    sounds.playActionClick();
    setHelpModalOpen(true);
  };

  const statsData = (val: number | string | undefined, fallback = "—") =>
    statsLoading ? "..." : (val ?? fallback);

  return (
    <Screen>
      <ScreenHeader
        title="Profile"
        subtitle="Manage personal settings & health profile"
        showBack
        action={
          <button
            onClick={openSettings}
            className="tap flex size-9 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-border/60 hover:bg-accent"
            title="Settings"
          >
            <SettingsIcon className="size-4.5" />
          </button>
        }
      />

      {/* ════════════════════════════════════════════════════════════
          HERO IDENTITY CARD
          ════════════════════════════════════════════════════════════ */}
      <motion.section
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="card-soft mt-1 bg-gradient-to-br from-[#EAE6FF] via-[#F4F1FF] to-[#FAF8FF] p-5 border border-[#7C5CFC]/20 shadow-xs text-center relative overflow-hidden"
      >
        <div className="relative mx-auto size-24">
          <UserAvatar
            name={user?.full_name}
            src={avatarPreview}
            alt={user?.full_name || "Profile avatar"}
            className="size-full rounded-full border-4 border-white shadow-md"
            initialsClassName="text-2xl font-black"
          />
          <button
            onClick={openEdit}
            className="tap absolute bottom-0 right-0 flex size-7 items-center justify-center rounded-full bg-[#7C5CFC] text-white shadow-md hover:scale-105 active:scale-95 transition-transform"
            title="Change photo"
          >
            <Camera className="size-3.5" />
          </button>
        </div>

        <div className="mt-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-0.5 text-[11px] font-black text-[#7C5CFC] shadow-2xs">
            <ShieldCheck className="size-3 text-[#7C5CFC]" /> LifeHub Member
          </span>
          <h2 className="mt-1.5 text-xl font-black text-[#12131A] tracking-tight">
            {user?.full_name || "Account User"}
          </h2>
          {user?.email ? (
            <p className="text-xs font-semibold text-muted-foreground">{user.email}</p>
          ) : null}
        </div>

        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            onClick={openEdit}
            className="tap inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-1.5 text-xs font-extrabold text-white shadow-xs hover:bg-[#12131A]/90 transition-transform active:scale-95"
          >
            <Pencil className="size-3" /> Edit Profile
          </button>
          <button
            onClick={openSettings}
            className="tap inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-bold text-foreground shadow-2xs border border-border/60 hover:bg-slate-50 transition-transform"
          >
            <SettingsIcon className="size-3 text-[#7C5CFC]" /> Preferences
          </button>
        </div>
      </motion.section>

      {/* ════════════════════════════════════════════════════════════
          LIFETIME HEALTH & HABIT METRICS
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-5 flex items-center justify-between px-1">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Lifetime Summary
        </h3>
        <button
          onClick={() => navigate({ to: "/analytics" })}
          className="text-xs font-bold text-[#7C5CFC] hover:underline"
        >
          Detailed Progress
        </button>
      </div>

      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <StatCard
          icon={Dumbbell}
          iconClassName="bg-orange-500/15 text-orange-600"
          value={statsData(realStats?.totalWorkoutsCompleted)}
          label="Workouts"
          sublabel="Completed sessions"
        />
        <StatCard
          icon={CheckCircle2}
          iconClassName="bg-emerald-500/15 text-emerald-600"
          value={statsData(realStats ? `${realStats.avgTaskCompletion}%` : undefined)}
          label="Task Rate"
          sublabel="Average completion"
        />
        <StatCard
          icon={Droplets}
          iconClassName="bg-sky-500/15 text-sky-600"
          value={statsData(realStats ? `${realStats.waterGoalStreak}d` : undefined)}
          label="Water Streak"
          sublabel="Daily hydration 🔥"
        />
        <StatCard
          icon={Footprints}
          iconClassName="bg-emerald-500/15 text-emerald-600"
          value={
            statsLoading
              ? "..."
              : realStats
                ? `${(realStats.totalWalkingDistanceMeters / 1000).toFixed(1)} km`
                : "—"
          }
          label="Walk Distance"
          sublabel="Tracked on map"
        />
        <StatCard
          icon={Calendar}
          iconClassName="bg-purple-500/15 text-purple-600"
          value={statsData(realStats?.totalAppointments)}
          label="Appointments"
          sublabel="Doctor & health"
        />
        <StatCard
          icon={Award}
          iconClassName="bg-amber-500/15 text-amber-600"
          value={statsData(realStats?.currentAchievementLevel)}
          label="Achievement"
          sublabel="Current tier rank"
        />
      </div>

      {/* ════════════════════════════════════════════════════════════
          MENU & NAVIGATION SECTIONS
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-6 flex items-center justify-between px-1">
        <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
          Account & App Settings
        </h3>
      </div>

      <section className="mt-2.5 space-y-2">
        <MenuRow
          icon={User}
          label="Personal Info & Health Data"
          description="Name, birthday, height & weight"
          onClick={openEdit}
        />
        <MenuRow
          icon={Target}
          label="Goals & Analytics Hub"
          description="View detailed charts and streaks"
          onClick={() => navigate({ to: "/analytics" })}
          badge="Live"
        />
        <MenuRow
          icon={Bell}
          label="Reminders & Preferences"
          description="Sound effects, notification schedules"
          onClick={openSettings}
        />
        <MenuRow
          icon={Headset}
          label="Help & Developer Info"
          description="Support, social channels & feedback"
          onClick={openHelp}
        />
        <MenuRow
          icon={LogOut}
          label="Log Out"
          description="Safely sign out from this device"
          onClick={handleLogout}
          variant="danger"
        />
      </section>

      {/* ════════════════════════════════════════════════════════════
          SETTINGS MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-full bg-[#7C5CFC]/15 text-[#7C5CFC]">
              <SettingsIcon className="size-4" />
            </div>
            <h3 className="text-base font-extrabold text-foreground">Preferences</h3>
          </div>
          <button
            onClick={() => setSettingsModalOpen(false)}
            className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Sound & Audio
            </h4>
            <button
              onClick={() => {
                const newVal = !soundsEnabled;
                setSoundsEnabled(newVal);
                sounds.setEnabled(newVal);
                if (newVal) sounds.playClick();
              }}
              className="tap flex w-full items-center justify-between rounded-2xl bg-slate-50 p-3.5 hover:bg-slate-100 transition-colors border border-border/60"
            >
              <div className="flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-white shadow-2xs text-[#7C5CFC]">
                  {soundsEnabled ? <Volume2 className="size-4.5" /> : <VolumeX className="size-4.5 text-muted-foreground" />}
                </div>
                <div className="text-left">
                  <span className="block text-xs font-bold text-foreground">Sound Effects</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Haptic & interface click audio
                  </span>
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-black",
                  soundsEnabled ? "bg-emerald-500/15 text-emerald-700" : "bg-slate-200 text-muted-foreground",
                )}
              >
                {soundsEnabled ? "Enabled" : "Muted"}
              </span>
            </button>
          </div>

          {Capacitor.isNativePlatform() && (
            <div>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Daily Notifications
              </h4>
              <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3.5 border border-border/60">
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-xl bg-white shadow-2xs text-[#7C5CFC]">
                    <BellRing className="size-4.5" />
                  </div>
                  <div>
                    <span className="block text-xs font-bold text-foreground">Daily Reminder</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {reminderSettings.daily.enabled ? "Active daily check-in" : "Turned off"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={`${reminderSettings.daily.hour.toString().padStart(2, "0")}:${reminderSettings.daily.minute.toString().padStart(2, "0")}`}
                    onChange={handleTimeChange}
                    className="rounded-lg border border-border bg-white px-2 py-1 text-xs font-bold text-foreground outline-none"
                  />
                  <button
                    role="switch"
                    aria-checked={reminderSettings.daily.enabled}
                    onClick={handleToggleDailyReminder}
                    className={cn(
                      "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                      reminderSettings.daily.enabled ? "bg-emerald-500" : "bg-slate-300",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-0.5 size-5 rounded-full bg-white shadow-xs transition-all",
                        reminderSettings.daily.enabled ? "left-[22px]" : "left-0.5",
                      )}
                    />
                  </button>
                </div>
              </div>
            </div>
          )}

          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-rose-500">
              Danger Zone
            </h4>
            <button
              onClick={() => {
                setSettingsModalOpen(false);
                setDeleteModalOpen(true);
              }}
              className="tap flex w-full items-center justify-between rounded-2xl bg-rose-50 p-3.5 text-rose-600 hover:bg-rose-100/70 border border-rose-200/60 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Trash2 className="size-4 text-rose-600" />
                <span className="text-xs font-bold">Delete My Account</span>
              </div>
              <ChevronRight className="size-4 opacity-60" />
            </button>
          </div>
        </div>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          EDIT PERSONAL INFO MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div className="flex items-center justify-between border-b border-border/40 pb-3">
            <h3 className="text-base font-extrabold text-foreground">Edit Profile Info</h3>
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex flex-col items-center rounded-2xl bg-slate-50 p-4 border border-border/60">
            <div className="relative">
              <UserAvatar
                name={user?.full_name}
                src={avatarPreview}
                alt="Profile Avatar"
                className="size-20 rounded-full border-2 border-white shadow-sm"
                initialsClassName="text-xl font-bold"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Change photo"
                className="tap absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full bg-[#7C5CFC] text-white shadow-md hover:scale-105"
              >
                <Camera className="size-3.5" />
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="tap rounded-full bg-white px-3 py-1 text-xs font-bold text-[#7C5CFC] shadow-2xs border border-[#7C5CFC]/30 hover:bg-[#7C5CFC]/5"
              >
                <Pencil className="inline size-3 mr-1" /> Upload Photo
              </button>
              {avatarPreview ? (
                <button
                  type="button"
                  onClick={() => setAvatarPreview("")}
                  className="tap rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-500 shadow-2xs border border-rose-200 hover:bg-rose-50"
                >
                  Remove
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
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                  <span>Uploading photo...</span>
                  <span className="font-bold">{uploadProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#7C5CFC] transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-foreground">Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your name"
              className="mt-1 w-full rounded-xl border border-border bg-slate-50 px-3.5 py-2 text-xs font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white"
            />
          </div>

          {dob && (
            <div>
              <label className="text-xs font-bold text-foreground">Date of Birth</label>
              <input
                type="date"
                readOnly
                value={dob}
                className="mt-1 w-full cursor-not-allowed rounded-xl border border-border bg-slate-100 px-3.5 py-2 text-xs font-semibold text-muted-foreground outline-none"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Age: {calculateAge(dob)} years old (set during registration)
              </p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              className="w-1/2 rounded-xl border border-border py-2 text-xs font-bold text-foreground hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-[#7C5CFC] py-2 text-xs font-bold text-white shadow-xs hover:bg-[#6C4CE8] disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {submitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          HELP & SUPPORT MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={helpModalOpen}
        onClose={() => setHelpModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h3 className="text-base font-extrabold text-foreground">Help & Support</h3>
          <button
            onClick={() => setHelpModalOpen(false)}
            className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5">
          <div className="rounded-2xl bg-slate-50 p-4 text-center border border-border/60">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-[#7C5CFC]/15 text-[#7C5CFC]">
              <ShieldCheck className="size-5" />
            </div>
            <p className="mt-2 text-xs font-extrabold text-foreground">LifeHub Care & Support</p>
            <p className="text-[11px] text-muted-foreground">Version 1.0.0 • Verified App</p>
          </div>

          <div className="space-y-2">
            <a
              href="https://www.instagram.com/didohm_/"
              target="_blank"
              rel="noopener noreferrer"
              className="tap flex items-center justify-between rounded-xl bg-slate-50 p-3 hover:bg-slate-100 border border-border/60 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Instagram className="size-4.5 text-pink-600" />
                <span className="text-xs font-bold text-foreground">Instagram Support</span>
              </div>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </a>

            <a
              href="https://www.linkedin.com/in/boumedienhimich/"
              target="_blank"
              rel="noopener noreferrer"
              className="tap flex items-center justify-between rounded-xl bg-slate-50 p-3 hover:bg-slate-100 border border-border/60 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Linkedin className="size-4.5 text-blue-600" />
                <span className="text-xs font-bold text-foreground">LinkedIn Network</span>
              </div>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </a>
          </div>
        </div>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          DELETE ACCOUNT CONFIRMATION MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        className="p-5 max-w-sm bg-white rounded-3xl"
      >
        <div className="text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-rose-100 text-rose-600 mb-3">
            <Trash2 className="size-6" />
          </div>
          <h3 className="text-base font-extrabold text-foreground">Delete Account?</h3>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            This permanently erases your LifeHub data and removes your account. For security, you may need to sign in again first.
          </p>

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => setDeleteModalOpen(false)}
              disabled={deleting}
              className="w-1/2 rounded-xl border border-border py-2 text-xs font-bold text-foreground hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleDeleteAccount}
              disabled={deleting}
              className="w-1/2 rounded-xl bg-rose-600 py-2 text-xs font-bold text-white shadow-xs hover:bg-rose-700 disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Yes, Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </Screen>
  );
}
