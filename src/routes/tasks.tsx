import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  ListChecks,
  Check,
  Trash2,
  Edit2,
  X,
  Loader2,
  Search,
  CalendarDays,
  CheckCircle2,
} from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { createTodo, updateTodo, deleteTodo, todayLocalDate } from "@/lib/api";
import { Notifications } from "@/lib/notifications-integration";
import { Todo } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { parseLocalDate } from "@/lib/date-utils";
import { useData } from "@/lib/data-context";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [{ title: "To-Do Routine & Tasks — LifeHub" }],
  }),
  component: TasksPage,
});

type TaskStatus = "completed" | "in_progress" | "overdue";

function getTaskStatus(t: Todo): TaskStatus {
  if (t.completed) return "completed";
  if (t.due_date && differenceInCalendarDays(parseLocalDate(t.due_date), new Date()) < 0) {
    return "overdue";
  }
  return "in_progress";
}

function formatDueDate(value: string): string {
  const due = parseLocalDate(value);
  const diff = differenceInCalendarDays(due, new Date());
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < -1) return `${Math.abs(diff)}d overdue`;
  return format(due, "EEE, MMM d");
}

const CATEGORIES = ["all", "Health", "Finance", "Personal", "Work"] as const;

function TasksPage() {
  const { user } = useAuth();

  const { todos = [], todosLoading: loading } = useData();
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Todo | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Health");
  const [priority, setPriority] = useState<"high" | "medium" | "light">("medium");
  const [dueDate, setDueDate] = useState(todayLocalDate());
  const [submitting, setSubmitting] = useState(false);

  const { deleteWithGuard } = useDeleteWithGuard();

  const openAddModal = () => {
    sounds.playActionClick();
    setEditingTask(null);
    setTitle("");
    setCategory("Health");
    setPriority("medium");
    setDueDate(todayLocalDate());
    setModalOpen(true);
  };

  const openEditModal = (task: Todo) => {
    sounds.playActionClick();
    setEditingTask(task);
    setTitle(task.title);
    setCategory(task.category);
    setPriority(task.priority);
    setDueDate(task.due_date || todayLocalDate());
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingTask) {
        const keptProgress = editingTask.progress || 0;
        await updateTodo(editingTask.id, user.id, {
          title,
          category,
          priority,
          due_date: dueDate,
          progress: keptProgress,
          completed: editingTask.completed,
        });
        Notifications.cancelTodo(editingTask.id);
        Notifications.scheduleTodo({
          ...editingTask,
          title,
          due_date: dueDate,
          completed: editingTask.completed,
        });
        toast.success("Task updated!");
      } else {
        const task = await createTodo(user.id, {
          title,
          category,
          priority,
          due_date: dueDate,
          completed: false,
          progress: 0,
        });
        Notifications.scheduleTodo(task);
        toast.success("Task created!");
      }
      setModalOpen(false);
    } catch {
      toast.error("Failed to save task.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleComplete = async (id: string, currentCompleted: boolean) => {
    if (!user) return;
    const newStatus = !currentCompleted;
    try {
      if (newStatus) {
        sounds.playSuccess();
      } else {
        sounds.playClick();
      }
      await updateTodo(id, user.id, { completed: newStatus, progress: newStatus ? 100 : 0 });
      if (newStatus) Notifications.cancelTodo(id);
      else {
        const todo = todos.find((t) => t.id === id);
        if (todo) Notifications.scheduleTodo({ ...todo, completed: false });
      }
      toast.success(newStatus ? "Task completed! 🎉" : "Task marked active");
    } catch {
      toast.error("Could not update task status");
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await deleteTodo(id, user.id);
      Notifications.cancelTodo(id);
      toast.success("Task deleted.");
    })().catch(() => {
      toast.error("Failed to delete task.");
    });
  };

  const filteredTasks = todos.filter((t) => {
    const matchesCat = categoryFilter === "all" ? true : t.category === categoryFilter;
    const matchesSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const completedCount = todos.filter((t) => t.completed).length;
  const completionPct = todos.length > 0 ? Math.round((completedCount / todos.length) * 100) : 0;

  return (
    <Screen>
      <ScreenHeader
        title="To-Do Routine"
        subtitle="Daily task checklist & priority tracker"
        showBack
        action={
          <button
            onClick={openAddModal}
            className="tap flex items-center gap-1 rounded-full bg-[#12131A] px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-[#12131A]/90 transition-transform active:scale-95"
          >
            <Plus className="size-3.5" /> Add Task
          </button>
        }
      />

      {/* ════════════════════════════════════════════════════════════
          TASK PROGRESS HERO CARD
          ════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-soft mt-1 bg-gradient-to-br from-[#FFE6F2] via-[#FFF0F7] to-[#FAF8FF] p-4 sm:p-5 border border-pink-200/60 shadow-xs"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-black text-pink-700 shadow-2xs">
              <CheckCircle2 className="size-3" /> Routine Progress
            </span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black text-[#12131A]">
                {completedCount}{" "}
                <span className="text-sm font-bold text-muted-foreground">
                  / {todos.length} Done
                </span>
              </span>
              <span className="text-xs font-bold text-emerald-600">{completionPct}% Complete</span>
            </div>
            <p className="mt-0.5 text-xs font-medium text-muted-foreground">
              {todos.length - completedCount} active tasks remaining today
            </p>
          </div>

          <div className="flex size-12 items-center justify-center rounded-2xl bg-white shadow-2xs text-pink-600">
            <ListChecks className="size-6" />
          </div>
        </div>

        <div className="mt-3.5 h-1.5 w-full rounded-full bg-white/80 overflow-hidden">
          <div
            className="h-full bg-pink-500 rounded-full transition-all duration-500"
            style={{ width: `${completionPct}%` }}
          />
        </div>
      </motion.div>

      {/* ════════════════════════════════════════════════════════════
          SEARCH & CATEGORY FILTERS
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-4 space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search task title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-border/70 bg-white py-2 pl-10 pr-4 text-xs font-semibold text-foreground outline-none shadow-2xs focus:border-[#7C5CFC]"
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-5 px-5">
          {CATEGORIES.map((cat) => {
            const active = categoryFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => {
                  sounds.playNavClick();
                  setCategoryFilter(cat);
                }}
                className={cn(
                  "tap shrink-0 rounded-full px-3.5 py-1 text-xs font-bold capitalize transition-all",
                  active
                    ? "bg-[#12131A] text-white shadow-xs"
                    : "bg-white text-muted-foreground border border-border/60 hover:bg-slate-50",
                )}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════
          TASK LIST
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-3 space-y-2.5">
        {loading ? (
          <ListSkeleton count={3} />
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border p-8 text-center bg-white shadow-2xs">
            <ListChecks className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-extrabold text-[#12131A]">No tasks found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {searchTerm
                ? "Try searching another term"
                : "Tap Add Task to create your first to-do."}
            </p>
          </div>
        ) : (
          filteredTasks.map((t) => {
            const status = getTaskStatus(t);
            const overdue = status === "overdue";

            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "card-soft p-3.5 border transition-all flex items-center justify-between shadow-2xs group",
                  t.completed
                    ? "bg-slate-50 border-border/40 opacity-70"
                    : "bg-white border-border/70 hover:shadow-xs",
                )}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                  <button
                    onClick={() => handleToggleComplete(t.id, t.completed)}
                    className={cn(
                      "tap flex size-7 shrink-0 items-center justify-center rounded-xl border transition-all active:scale-90",
                      t.completed
                        ? "border-emerald-500 bg-emerald-500 text-white shadow-xs"
                        : "border-slate-300 bg-white hover:border-emerald-500",
                    )}
                    title={t.completed ? "Mark active" : "Mark completed"}
                  >
                    {t.completed && <Check className="size-4 stroke-[3]" />}
                  </button>

                  <div className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block text-xs sm:text-sm font-bold text-foreground truncate",
                        t.completed && "line-through text-muted-foreground",
                      )}
                    >
                      {t.title}
                    </span>

                    <div className="mt-1 flex items-center gap-2 flex-wrap">
                      <span className="rounded-md bg-slate-100 px-2 py-0.2 text-[9.5px] font-bold text-slate-700">
                        {t.category}
                      </span>
                      {t.due_date && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-semibold",
                            overdue ? "text-rose-600 font-bold" : "text-muted-foreground",
                          )}
                        >
                          <CalendarDays className="size-3" /> {formatDueDate(t.due_date)}
                        </span>
                      )}
                      {t.priority === "high" && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.2 text-[9px] font-black text-rose-600">
                          High
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEditModal(t)}
                    className="size-7 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-slate-100"
                    title="Edit task"
                  >
                    <Edit2 className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="size-7 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50"
                    title="Delete task"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════
          ADD / EDIT TASK MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h3 className="text-base font-extrabold text-foreground">
            {editingTask ? "Edit Task" : "Create New Task"}
          </h3>
          <button
            onClick={() => setModalOpen(false)}
            className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-3.5">
          <div>
            <label className="text-xs font-bold text-foreground">Task Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Schedule eye checkup, Refill vitamins"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none"
              >
                <option value="Health">Health</option>
                <option value="Finance">Finance</option>
                <option value="Personal">Personal</option>
                <option value="Work">Work</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-foreground">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as "high" | "medium" | "light")}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="light">Light</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-foreground">Due Date</label>
            <input
              type="date"
              required
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white"
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="w-1/2 rounded-xl border border-border py-2.5 text-xs font-bold text-foreground hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-[#12131A] py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#12131A]/90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save Task
            </button>
          </div>
        </form>
      </Modal>
    </Screen>
  );
}
