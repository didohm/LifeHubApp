import { useState, useMemo } from "react";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import {
  Plus,
  Cake,
  Trash2,
  Edit2,
  X,
  Loader2,
  Gift,
  Phone,
  CalendarDays,
  PartyPopper,
  ChevronRight,
  AlertCircle,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { useData } from "@/lib/data-context";
import { createBirthday, updateBirthday, deleteBirthday } from "@/lib/api";
import { Notifications } from "@/lib/notifications-integration";
import { Birthday } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { parseLocalDate } from "@/lib/date-utils";

export const Route = createFileRoute("/birthdays")({
  head: () => ({
    meta: [{ title: "Birthdays — LifeHub" }],
  }),
  component: BirthdaysPage,
});

// ─── Helpers ──────────────────────────────────────────────────────

/** Calculate the next birthday date (this year or next year) given a birthday date string. */
function getNextBirthday(birthdayDate: string): Date {
  const today = new Date();
  const bd = parseLocalDate(birthdayDate);
  const next = new Date(today.getFullYear(), bd.getMonth(), bd.getDate());
  // If already passed this year, set to next year
  if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    next.setFullYear(next.getFullYear() + 1);
  }
  return next;
}

/** Format how many days until the next birthday. */
function daysUntil(birthdayDate: string): number {
  const today = new Date();
  const next = getNextBirthday(birthdayDate);
  const diff =
    next.getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/** Check if birthday is today. */
function isToday(birthdayDate: string): boolean {
  const today = new Date();
  const bd = parseLocalDate(birthdayDate);
  return today.getMonth() === bd.getMonth() && today.getDate() === bd.getDate();
}

/** Format a birthday date for display (e.g. "March 15"). */
function formatBirthdayDisplay(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

/** Sort birthdays by next upcoming occurrence. */
function sortByUpcoming(birthdays: Birthday[]): Birthday[] {
  return [...birthdays].sort((a, b) => {
    const nextA = getNextBirthday(a.birthday_date).getTime();
    const nextB = getNextBirthday(b.birthday_date).getTime();
    return nextA - nextB;
  });
}

/** Get the age a person will turn on their next birthday (null if birth year is current or future). */
function getNextAge(birthdayDate: string): number | null {
  const bd = parseLocalDate(birthdayDate);
  const next = getNextBirthday(birthdayDate);
  const age = next.getFullYear() - bd.getFullYear();
  return age > 0 ? age : null;
}

// ─── Page Component ───────────────────────────────────────────────

function BirthdaysPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const handleBack = () => {
    if (router.history.canGoBack()) router.history.back();
    else navigate({ to: "/services" });
  };

  const { birthdays, refreshAll } = useData();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBirthday, setEditingBirthday] = useState<Birthday | null>(null);

  // Form State
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [birthdayDate, setBirthdayDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { deleteWithGuard } = useDeleteWithGuard();

  // Sorted birthdays by upcoming
  const sortedBirthdays = useMemo(() => sortByUpcoming(birthdays), [birthdays]);

  // Upcoming count (within next 30 days)
  const upcomingCount = useMemo(() => {
    return birthdays.filter((b) => {
      const days = daysUntil(b.birthday_date);
      return days >= 0 && days <= 30;
    }).length;
  }, [birthdays]);

  // ─── Modal helpers ─────────────────────────────────────────────

  const openAddModal = () => {
    setEditingBirthday(null);
    setFullName("");
    setPhoneNumber("");
    setBirthdayDate("");
    setModalOpen(true);
  };

  const openEditModal = (birthday: Birthday) => {
    setEditingBirthday(birthday);
    setFullName(birthday.full_name);
    setPhoneNumber(birthday.phone_number || "");
    setBirthdayDate(birthday.birthday_date);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingBirthday(null);
  };

  // ─── CRUD operations ───────────────────────────────────────────

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!fullName.trim()) {
      toast.error("Please enter a name");
      return;
    }
    if (!birthdayDate) {
      toast.error("Please select a birthday date");
      return;
    }
    setSubmitting(true);

    try {
      if (editingBirthday) {
        const updated = await updateBirthday(editingBirthday.id, user.id, {
          full_name: fullName.trim(),
          phone_number: phoneNumber.trim() || "",
          birthday_date: birthdayDate,
        });
        Notifications.cancelBirthday(editingBirthday.id);
        Notifications.scheduleBirthday(updated);
        toast.success("Birthday updated! 🎂");
      } else {
        const created = await createBirthday(user.id, {
          full_name: fullName.trim(),
          phone_number: phoneNumber.trim() || "",
          birthday_date: birthdayDate,
        });
        Notifications.scheduleBirthday(created);
        toast.success("Birthday saved! 🎉");
      }
      closeModal();
    } catch (err: any) {
      toast.error("Failed to save birthday");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await deleteBirthday(id, user.id);
      Notifications.cancelBirthday(id);
      toast.success("Birthday deleted.", { id: `bday-deleted-${id}` });
    })().catch(() => {
      toast.error("Failed to delete birthday.", { id: `bday-delete-error-${id}` });
    });
  };

  // ─── Render ────────────────────────────────────────────────────

  const focusRing =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  // Error state
  if (error) {
    return (
      <Screen>
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={handleBack}
              aria-label="Go back to Services"
              title="Back to Services"
              className="tap flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5 hover:bg-black/5"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div>
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground flex items-center gap-2">
                <Cake className="size-5 sm:size-6 text-pink-500" /> Birthdays
              </h1>
              <p className="text-xs text-muted-foreground font-medium">Never miss a special date</p>
            </div>
          </div>
        </header>
        <div className="mt-6 rounded-3xl border border-dashed border-destructive/50 p-8 text-center bg-destructive/5">
          <AlertCircle className="mx-auto size-12 text-destructive/60" />
          <p className="mt-2 text-sm font-bold text-foreground">Failed to load birthdays</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <button
            onClick={() => refreshAll()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-xs font-bold text-card"
          >
            <Loader2 className="size-3.5 animate-spin" /> Retry
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      {/* ── Header with return/back button (consistent with other services, ux:back-behavior) ── */}
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={handleBack}
            aria-label="Go back to Services"
            title="Back to Services"
            className="tap flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-extrabold text-foreground flex items-center gap-2 truncate">
              <Cake className="size-5 sm:size-6 text-pink-500 shrink-0" /> Birthdays
            </h1>
            <p className="text-xs text-muted-foreground font-medium truncate">
              Never miss a special date
            </p>
          </div>
        </div>
        <button
          onClick={openAddModal}
          className="tap flex shrink-0 items-center gap-1 rounded-full bg-ink px-4 py-2 text-xs font-bold text-card shadow-md transition-transform active:scale-95 hover:opacity-90"
        >
          <Plus className="size-4" />{" "}
          <span className="hidden xs:inline sm:inline">Add Birthday</span>
          <span className="xs:hidden sm:hidden">Add</span>
        </button>
      </header>

      {/* ── Upcoming Banner ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="card-soft relative mt-4 overflow-hidden bg-blush p-5 shadow-sm"
      >
        <div className="max-w-[70%]">
          <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-extrabold text-ink">
            <PartyPopper className="size-3" />{" "}
            {upcomingCount > 0 ? `${upcomingCount} upcoming` : "All set"}
          </span>
          <h1 className="mt-2 text-[26px] leading-7 font-extrabold text-ink">
            {sortedBirthdays.length > 0 ? (
              <>
                {isToday(sortedBirthdays[0].birthday_date) ? (
                  <>Today is Special 🎂</>
                ) : (
                  <>
                    Next <span className="text-ink">Birthday</span>
                  </>
                )}
              </>
            ) : (
              <>Save a Birthday</>
            )}
          </h1>
          {sortedBirthdays.length > 0 && (
            <p className="mt-1 text-[13px] text-ink/80">
              {isToday(sortedBirthdays[0].birthday_date) ? (
                <span className="font-bold">{sortedBirthdays[0].full_name}</span>
              ) : (
                <>
                  <span className="font-bold">{sortedBirthdays[0].full_name}</span> &middot;{" "}
                  {formatBirthdayDisplay(sortedBirthdays[0].birthday_date)} &middot;{" "}
                  <span className="font-semibold">
                    {daysUntil(sortedBirthdays[0].birthday_date)} days away
                  </span>
                </>
              )}
            </p>
          )}
          {sortedBirthdays.length === 0 && (
            <p className="mt-1 text-[13px] text-ink/80">
              Add your friends&apos; birthdays so you never miss one.
            </p>
          )}
        </div>
        <div className="pointer-events-none absolute -right-3 top-1/2 w-36 -translate-y-1/2 opacity-15">
          <Gift className="size-36 text-ink" strokeWidth={1} />
        </div>
      </motion.div>

      {/* ── Stats Row ── */}
      {birthdays.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="mt-4 grid grid-cols-2 gap-3"
        >
          <div className="card-soft bg-card p-3.5 border border-border/40">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground">Total Saved</span>
              <Cake className="size-4 text-pink-500" />
            </div>
            <p className="mt-2 text-2xl font-black text-foreground">{birthdays.length}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground font-semibold">
              {upcomingCount > 0 ? `${upcomingCount} within 30 days` : "No upcoming soon"}
            </p>
          </div>

          <div className="card-soft bg-card p-3.5 border border-border/40">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-muted-foreground">Next Up</span>
              <CalendarDays className="size-4 text-tangerine" />
            </div>
            {sortedBirthdays.length > 0 ? (
              <>
                <p className="mt-2 text-base font-black text-foreground truncate">
                  {sortedBirthdays[0].full_name}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground font-semibold">
                  {daysUntil(sortedBirthdays[0].birthday_date) === 0
                    ? "Today! 🎉"
                    : `${daysUntil(sortedBirthdays[0].birthday_date)} days away`}
                </p>
              </>
            ) : (
              <>
                <p className="mt-2 text-lg font-black text-foreground">—</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground font-semibold">
                  No birthdays yet
                </p>
              </>
            )}
          </div>
        </motion.section>
      )}

      {/* ── Birthdays List ── */}
      <div className="mt-5 space-y-3">
        {loading ? (
          <ListSkeleton count={3} />
        ) : birthdays.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-card/40">
            <Cake className="mx-auto size-12 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-bold text-foreground">No birthdays saved yet</p>
            <p className="text-xs text-muted-foreground">
              Tap &quot;Add Birthday&quot; to save your first one.
            </p>
          </div>
        ) : (
          <AnimatePresence>
            {sortedBirthdays.map((birthday, idx) => {
              const days = daysUntil(birthday.birthday_date);
              const today = isToday(birthday.birthday_date);
              const upcomingSoon = days >= 0 && days <= 30 && !today;

              return (
                <motion.div
                  key={birthday.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -50 }}
                  transition={{ duration: 0.25, delay: idx * 0.04 }}
                  className={`card-soft p-4 border transition-all flex items-center justify-between shadow-sm hover:shadow-md ${
                    today
                      ? "bg-blush border-blush/40 text-ink"
                      : upcomingSoon
                        ? "bg-mint/30 border-mint/30 text-foreground"
                        : "bg-card border-border/40 text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Avatar circle with initials */}
                    <div
                      className={`flex size-11 shrink-0 items-center justify-center rounded-full text-xs font-extrabold shadow-sm ${
                        today
                          ? "bg-card text-ink"
                          : upcomingSoon
                            ? "bg-mint text-ink"
                            : "bg-lavender-soft text-ink"
                      }`}
                    >
                      {birthday.full_name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .toUpperCase()
                        .slice(0, 2)}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-extrabold truncate">{birthday.full_name}</h3>
                        {today && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-card px-2 py-0.5 text-[10px] font-bold text-ink">
                            <Gift className="size-2.5" /> Today!
                          </span>
                        )}
                        {upcomingSoon && days <= 7 && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-card/70 px-2 py-0.5 text-[10px] font-bold text-ink">
                            <PartyPopper className="size-2.5" />{" "}
                            {days === 0 ? "Today!" : `${days}d`}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {formatBirthdayDisplay(birthday.birthday_date)}
                        </span>
                        {getNextAge(birthday.birthday_date) !== null && (
                          <span className="text-[11px] text-muted-foreground/70">
                            Turns {getNextAge(birthday.birthday_date)}
                          </span>
                        )}
                      </div>
                      {birthday.phone_number && (
                        <div className="flex items-center gap-1 mt-0.5">
                          <Phone className="size-3 text-muted-foreground/60" />
                          <span className="text-[11px] text-muted-foreground/70">
                            {birthday.phone_number}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    {!today && (
                      <span className="hidden sm:inline text-[11px] font-bold text-muted-foreground mr-1">
                        {days === 0 ? "Today!" : days === 1 ? "Tomorrow" : `${days}d`}
                      </span>
                    )}
                    <button
                      onClick={() => openEditModal(birthday)}
                      title="Edit"
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                    >
                      <Edit2 className="size-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(birthday.id)}
                      title="Delete"
                      className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      {/* ── Add / Edit Birthday Modal ── */}
      <Modal open={modalOpen} onClose={closeModal} className="bg-card">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h2 className="text-lg font-extrabold text-foreground">
            {editingBirthday ? "Edit Birthday" : "Add New Birthday"}
          </h2>
          <button
            onClick={closeModal}
            className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-bold text-foreground">
              Full Name <span className="text-destructive">*</span>
            </label>
            <div className="relative mt-1">
              <Cake className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                required
                placeholder="e.g. Jane Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-xl border border-input bg-muted/30 p-2.5 pl-10 text-sm outline-none focus:border-ring transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-foreground">Phone Number</label>
            <span className="ml-1 text-[10px] text-muted-foreground">(optional)</span>
            <div className="relative mt-1">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="tel"
                placeholder="e.g. +1 555-0123"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="w-full rounded-xl border border-input bg-muted/30 p-2.5 pl-10 text-sm outline-none focus:border-ring transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-foreground">
              Birthday Date <span className="text-destructive">*</span>
            </label>
            <div className="relative mt-1">
              <CalendarDays className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="date"
                required
                value={birthdayDate}
                onChange={(e) => setBirthdayDate(e.target.value)}
                className="w-full rounded-xl border border-input bg-muted/30 p-2.5 pl-10 text-sm outline-none focus:border-ring transition-colors"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-3">
            <button
              type="button"
              onClick={closeModal}
              className="w-1/2 rounded-xl border border-border py-2.5 text-xs font-bold text-foreground hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-ink py-2.5 text-xs font-bold text-card shadow-md disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Gift className="size-4" />
              )}
              {submitting ? "Saving..." : editingBirthday ? "Update Birthday" : "Save Birthday"}
            </button>
          </div>
        </form>
      </Modal>
    </Screen>
  );
}
