import { useState, useEffect, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  LogOut,
  Download,
  Trash2,
  Camera,
  X,
  Loader2,
  Settings as SettingsIcon,
  User,
  Target,
  Bell,
  HelpCircle,
  ChevronRight,
  ShieldCheck,
  Moon,
  Dumbbell,
  CheckCircle2,
  Droplets,
  Footprints,
  Calendar,
  Award,
} from "lucide-react";
import { toast } from "sonner";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { UserAvatar } from "@/components/lifehub/UserAvatar";
import { useAuth } from "@/hooks/use-auth";
import { calculateAge, toDateInputValue } from "@/lib/utils";
import {
  updateUserProfile,
  deleteUserAccount,
  getAppointments,
  getMedications,
  getBills,
  getDocuments,
  getTodos,
  getActivityLogs,
  getProfileStats,
  ProfileStats,
} from "@/lib/api";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [{ title: "Profile & Settings — Balance" }],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, logout, updateUserField } = useAuth();
  const navigate = useNavigate();

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [timezone, setTimezone] = useState("UTC");

  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Real Database Statistics
  const [realStats, setRealStats] = useState<ProfileStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (user) {
      setFullName(user.full_name || "");
      setDob(user.date_of_birth || "");
      setAvatarPreview(user.avatar_url || "");
      setTimezone(user.timezone || "UTC");

      // Load real statistics computed directly from Firestore
      setStatsLoading(true);
      getProfileStats(user.id)
        .then((data) => {
          setRealStats(data);
        })
        .catch((err) => {
          console.error("Failed to load profile stats:", err);
        })
        .finally(() => {
          setStatsLoading(false);
        });
    }
  }, [user]);

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setAvatarPreview(dataUrl);
      toast.success("Profile photo updated! Click Save to apply.");
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (dob && dob > toDateInputValue()) {
      toast.error("Date of birth can't be in the future.");
      return;
    }

    setSubmitting(true);
    try {
      await updateUserProfile(user.id, {
        full_name: fullName,
        avatar_url: avatarPreview,
        timezone,
        date_of_birth: dob || null,
      });
      updateUserField("date_of_birth", dob || null);
      setEditModalOpen(false);
      toast.success("Profile updated successfully!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleSetting = async (key: "compact_mode" | "animations_enabled") => {
    if (!user) return;
    const newVal = !user[key];
    try {
      await updateUserProfile(user.id, { [key]: newVal });
      updateUserField(key, newVal);
      toast.success("Preference updated");
    } catch {
      toast.error("Could not update preference");
    }
  };

  const handleExportData = async () => {
    if (!user) return;
    setExporting(true);
    try {
      const [apps, meds, bills, docs, todos, logs] = await Promise.all([
        getAppointments(user.id),
        getMedications(user.id),
        getBills(user.id),
        getDocuments(user.id),
        getTodos(user.id),
        getActivityLogs(user.id),
      ]);

      const exportObject = {
        user_profile: user,
        appointments: apps,
        medications: meds,
        bills: bills,
        documents: docs,
        todos: todos,
        activity_logs: logs,
        exported_at: new Date().toISOString(),
        version: "Balance 2.0",
      };

      const dataStr =
        "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObject, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute(
        "download",
        `balance_export_${(user.full_name || "user").replace(/\s+/g, "_")}.json`,
      );
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();

      toast.success("Account data exported!");
    } catch {
      toast.error("Failed to export data.");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
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
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out safely");
    navigate({ to: "/auth" });
  };

  return (
    <Screen>
      <ScreenHeader
        title="Profile"
        showBack
        action={
          <button
            onClick={() => setSettingsModalOpen(true)}
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
            onClick={() => setEditModalOpen(true)}
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

        {/* Real Database Statistics Grid (6 Cards, No Hardcoding, Following Replaced) */}
        <div className="mt-5 grid grid-cols-2 gap-2.5">
          {/* 1. Workouts Completed */}
          <div className="card-soft bg-white p-3.5 border border-black/5 shadow-xs text-left flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-orange-500/10 text-orange-600 shrink-0">
              <Dumbbell className="size-4.5" />
            </div>
            <div>
              <span className="text-base font-black text-[#12131A]">
                {statsLoading ? "..." : realStats ? realStats.totalWorkoutsCompleted : "—"}
              </span>
              <span className="block text-[11px] font-semibold text-[#6B7280]">Workouts</span>
            </div>
          </div>

          {/* 2. Avg Task Completion % */}
          <div className="card-soft bg-white p-3.5 border border-black/5 shadow-xs text-left flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 shrink-0">
              <CheckCircle2 className="size-4.5" />
            </div>
            <div>
              <span className="text-base font-black text-[#12131A]">
                {statsLoading ? "..." : realStats ? `${realStats.avgTaskCompletion}%` : "—"}
              </span>
              <span className="block text-[11px] font-semibold text-[#6B7280]">Avg Task Done</span>
            </div>
          </div>

          {/* 3. Water Goal Streak */}
          <div className="card-soft bg-white p-3.5 border border-black/5 shadow-xs text-left flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600 shrink-0">
              <Droplets className="size-4.5" />
            </div>
            <div>
              <span className="text-base font-black text-[#12131A]">
                {statsLoading ? "..." : realStats ? `${realStats.waterGoalStreak}d` : "—"}
              </span>
              <span className="block text-[11px] font-semibold text-[#6B7280]">Water Streak</span>
            </div>
          </div>

          {/* 4. Total Walking Distance */}
          <div className="card-soft bg-white p-3.5 border border-black/5 shadow-xs text-left flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 shrink-0">
              <Footprints className="size-4.5" />
            </div>
            <div>
              <span className="text-base font-black text-[#12131A]">
                {statsLoading
                  ? "..."
                  : realStats
                    ? `${(realStats.totalWalkingDistanceMeters / 1000).toFixed(2)}km`
                    : "—"}
              </span>
              <span className="block text-[11px] font-semibold text-[#6B7280]">Walk Distance</span>
            </div>
          </div>

          {/* 5. Total Appointments */}
          <div className="card-soft bg-white p-3.5 border border-black/5 shadow-xs text-left flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-600 shrink-0">
              <Calendar className="size-4.5" />
            </div>
            <div>
              <span className="text-base font-black text-[#12131A]">
                {statsLoading ? "..." : realStats ? realStats.totalAppointments : "—"}
              </span>
              <span className="block text-[11px] font-semibold text-[#6B7280]">Appointments</span>
            </div>
          </div>

          {/* 6. Current Achievement Level */}
          <div className="card-soft bg-white p-3.5 border border-black/5 shadow-xs text-left flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 shrink-0">
              <Award className="size-4.5" />
            </div>
            <div>
              <span className="text-sm font-black text-[#12131A] truncate block max-w-[85px]">
                {statsLoading ? "..." : realStats ? realStats.currentAchievementLevel : "—"}
              </span>
              <span className="block text-[11px] font-semibold text-[#6B7280]">Level</span>
            </div>
          </div>
        </div>
      </section>

      {/* Menu Options List matching Screen 12 */}
      <section className="mt-5 space-y-2">
        <button
          onClick={() => setEditModalOpen(true)}
          className="tap card-soft w-full bg-white p-4 flex items-center justify-between border border-black/5 shadow-xs text-[#12131A] hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#F0F0F5] text-[#12131A]">
              <User className="size-4.5" />
            </div>
            <span className="text-sm font-extrabold">Personal Info</span>
          </div>
          <ChevronRight className="size-4 opacity-50" />
        </button>

        <button
          onClick={() => navigate({ to: "/analytics" })}
          className="tap card-soft w-full bg-white p-4 flex items-center justify-between border border-black/5 shadow-xs text-[#12131A] hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#F0F0F5] text-[#12131A]">
              <Target className="size-4.5" />
            </div>
            <span className="text-sm font-extrabold">Goals & Progress</span>
          </div>
          <ChevronRight className="size-4 opacity-50" />
        </button>

        <button
          onClick={() => setSettingsModalOpen(true)}
          className="tap card-soft w-full bg-white p-4 flex items-center justify-between border border-black/5 shadow-xs text-[#12131A] hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#F0F0F5] text-[#12131A]">
              <Bell className="size-4.5" />
            </div>
            <span className="text-sm font-extrabold">Notifications</span>
          </div>
          <ChevronRight className="size-4 opacity-50" />
        </button>

        <button
          onClick={handleExportData}
          disabled={exporting}
          className="tap card-soft w-full bg-white p-4 flex items-center justify-between border border-black/5 shadow-xs text-[#12131A] hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-[#F0F0F5] text-[#12131A]">
              <Download className="size-4.5" />
            </div>
            <span className="text-sm font-extrabold">Help & Support / Export</span>
          </div>
          {exporting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ChevronRight className="size-4 opacity-50" />
          )}
        </button>

        <button
          onClick={handleLogout}
          className="tap card-soft w-full bg-white p-4 flex items-center justify-between border border-rose-100 shadow-xs text-rose-600 hover:bg-rose-50/50 transition-all mt-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-rose-100 text-rose-600">
              <LogOut className="size-4.5" />
            </div>
            <span className="text-sm font-extrabold">Log Out</span>
          </div>
          <ChevronRight className="size-4 opacity-50" />
        </button>
      </section>

      {/* Settings Modal (Matching Screen 13) */}
      {settingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 pb-3">
              <h3 className="text-base font-extrabold text-[#12131A]">Settings</h3>
              <button
                onClick={() => setSettingsModalOpen(false)}
                className="size-7 flex items-center justify-center rounded-full bg-black/5"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4 text-xs">
              <div>
                <h4 className="font-extrabold text-[#6B7280] uppercase tracking-wider mb-2">
                  General
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between rounded-xl bg-[#F9F9FD] p-3">
                    <span className="font-bold text-[#12131A]">Units</span>
                    <span className="font-extrabold text-[#7C5CFC]">Metric (kg, cm) &gt;</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-[#F9F9FD] p-3">
                    <span className="font-bold text-[#12131A]">Reminders</span>
                    <span className="font-extrabold text-emerald-600">On &gt;</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-extrabold text-[#6B7280] uppercase tracking-wider mb-2">
                  About
                </h4>
                <div className="flex items-center justify-between rounded-xl bg-[#F9F9FD] p-3">
                  <span className="font-bold text-[#12131A]">Version</span>
                  <span className="font-semibold text-[#6B7280]">1.0.0</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 pb-3">
              <h3 className="text-base font-extrabold text-[#12131A]">Edit Personal Info</h3>
              <button
                onClick={() => setEditModalOpen(false)}
                className="size-7 flex items-center justify-center rounded-full bg-black/5"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateProfile} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-[#12131A]">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#12131A]">Date of Birth</label>
                <input
                  type="date"
                  required
                  max={toDateInputValue()}
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-black/10 bg-[#F9F9FD] p-2.5 text-xs outline-none focus:border-[#7C5CFC]"
                />
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-[#6B7280]">
                  Age:{" "}
                  <span className="rounded-full bg-[#7C5CFC]/10 px-2 py-0.5 text-[10px] font-extrabold text-[#7C5CFC]">
                    {dob ? `${calculateAge(dob)} years` : "—"}
                  </span>
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-[#12131A]">Profile Photo</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleImageFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-black/20 p-3 text-xs font-bold text-[#12131A]"
                >
                  <Camera className="size-4 text-[#7C5CFC]" /> Upload New Avatar
                </button>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="w-1/2 rounded-xl border border-black/10 py-2.5 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-1/2 flex items-center justify-center gap-1 rounded-xl bg-[#12131A] py-2.5 text-xs font-bold text-white"
                >
                  {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Screen>
  );
}
