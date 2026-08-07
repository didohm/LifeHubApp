import { useState, useEffect, useCallback, useRef } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import { differenceInCalendarDays, format } from "date-fns";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { getTodos, createTodo, updateTodo, deleteTodo } from "@/lib/api";
import { Notifications } from "@/lib/notifications-integration";
import { Todo } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [{ title: "To-Do List — LifeHub" }],
  }),
  component: TasksPage,
});

type TaskStatus = "completed" | "in_progress" | "overdue";

/** Parse a YYYY-MM-DD (or ISO) date string as a LOCAL mid-day date — tz-safe. */
function parseLocalDate(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(y || 1970, (m || 0) - 1, d || 1, 12);
}

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
  return format(due, "EEE, MMM d");
}

const STATUS_META: Record<TaskStatus, { label: string; className: string }> = {
  completed: {
    label: "Completed",
    className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  in_progress: {
    label: "In Progress",
    className: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  overdue: {
    label: "Overdue",
    className: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
};

const CATEGORY_META: Record<string, string> = {
  Health: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Finance: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  Personal: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  Work: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
};

function categoryBadgeClass(category: string): string {
  return CATEGORY_META[category] || "bg-muted text-muted-foreground";
}

function TasksPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [todos, setTodos] = useState<Todo[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Todo | null>(null);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Health");
  const [priority, setPriority] = useState<"high" | "medium" | "light">("medium");
  const [dueDate, setDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

  const loadTasks = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const data = await getTodos(user.id);
      setTodos(data);
    } catch (e) {
      console.error(e);
      toast.error("Failed to load tasks.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) loadTasks();
  }, [user, loadTasks]);

  const openAddModal = () => {
    setEditingTask(null);
    setTitle("");
    setCategory("Health");
    setPriority("medium");
    setDueDate(new Date().toISOString().split("T")[0]);
    setModalOpen(true);
  };

  const openEditModal = (task: Todo) => {
    setEditingTask(task);
    setTitle(task.title);
    setCategory(task.category);
    setPriority(task.priority);
    setDueDate(task.due_date || new Date().toISOString().split("T")[0]);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingTask) {
        // Edit existing task — keep its stored progress; completion is only
        // toggled from the card checkbox, not from this form.
        const keptProgress = editingTask.progress || 0;
        await updateTodo(editingTask.id, user.id, {
          title,
          category,
          priority,
          due_date: dueDate,
          progress: keptProgress,
          completed: editingTask.completed,
        });
        setTodos((prev) =>
          prev.map((t) =>
            t.id === editingTask.id
              ? {
                  ...t,
                  title,
                  category,
                  priority,
                  due_date: dueDate,
                  progress: keptProgress,
                  completed: editingTask.completed,
                }
              : t,
          ),
        );
        // Keep the real OS notification in sync with the edited task
        Notifications.cancelTodo(editingTask.id);
        Notifications.scheduleTodo({
          ...editingTask,
          title,
          due_date: dueDate,
          completed: editingTask.completed,
        });
        toast.success("Task updated!");
      } else {
        // Create new task
        const task = await createTodo(user.id, {
          title,
          category,
          priority,
          due_date: dueDate,
          completed: false,
          progress: 0,
        });
        setTodos((prev) => [task, ...prev]);
        Notifications.scheduleTodo(task);
        toast.success("Task created!");
      }
      setModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to save task.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleComplete = async (id: string, currentCompleted: boolean) => {
    if (!user) return;
    const newStatus = !currentCompleted;
    try {
      await updateTodo(id, user.id, { completed: newStatus, progress: newStatus ? 100 : 0 });
      setTodos((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, completed: newStatus, progress: newStatus ? 100 : 0 } : t,
        ),
      );
      // Real OS notification follows the task state
      if (newStatus) Notifications.cancelTodo(id);
      else {
        const todo = todos.find((t) => t.id === id);
        if (todo) Notifications.scheduleTodo({ ...todo, completed: false });
      }
      toast.success(newStatus ? "Task completed! 🎉" : "Task marked active");
    } catch (err) {
      toast.error("Could not update task status");
    }
  };

  // Guards against repeated taps on the same Delete button: repeat taps on
  // an item that is already being deleted are ignored, and the success toast
  // uses a per-item id so only ONE "deleted" notification is ever shown.
  const deletingIds = useRef<Set<string>>(new Set());
  const handleDelete = async (id: string) => {
    if (!user) return;
    if (deletingIds.current.has(id)) return; // already deleting this item
    deletingIds.current.add(id);
    try {
      await deleteTodo(id, user.id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
      Notifications.cancelTodo(id);
      toast.success("Task deleted.", { id: `task-deleted-${id}` });
    } catch (err) {
      toast.error("Failed to delete task.", { id: `task-delete-error-${id}` });
    } finally {
      deletingIds.current.delete(id);
    }
  };

  const filteredTasks = todos.filter((t) => {
    const matchesCat = categoryFilter === "all" ? true : t.category === categoryFilter;
    const matchesSearch = t.title.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <Screen>
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            <ListChecks className="size-6 text-pink-600" /> To-Do List
          </h1>
          <p className="text-xs text-muted-foreground">Manage your daily tasks & goals</p>
        </div>
        <button
          onClick={openAddModal}
          className="tap flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-xs font-bold text-card shadow-md transition-transform active:scale-95 hover:opacity-90"
        >
          <Plus className="size-4" /> Add Task
        </button>
      </header>

      {/* Progress banner */}
      <div className="mt-4 card-soft bg-blush p-4 text-ink flex items-center justify-between shadow-sm">
        <div>
          <span className="text-xs font-bold text-ink/75">Tasks Completed</span>
          <p className="mt-1 text-2xl font-black">
            {completedCount} of {todos.length}
          </p>
        </div>
        <div className="flex size-12 items-center justify-center rounded-full bg-card shadow-sm text-pink-700">
          <ListChecks className="size-6" />
        </div>
      </div>

      {/* Search & Category filter */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card px-3.5 py-2 text-xs shadow-sm">
          <Search className="size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search task title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {["all", "Health", "Finance", "Personal", "Work"].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-full px-3.5 py-1 text-xs font-bold capitalize whitespace-nowrap ${
                categoryFilter === cat
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Tasks List */}
      <div className="mt-4 space-y-3">
        {loading ? (
          <ListSkeleton count={3} />
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-card/40">
            <ListChecks className="mx-auto size-12 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-bold text-foreground">No tasks found</p>
          </div>
        ) : (
          filteredTasks.map((t) => {
            const status = getTaskStatus(t);
            const statusMeta = STATUS_META[status];
            const overdue = status === "overdue";
            return (
              <div
                key={t.id}
                className={`card-soft overflow-hidden border bg-card shadow-sm transition-all hover:shadow-md ${
                  t.completed ? "border-border/40 opacity-75" : "border-border/40"
                }`}
              >
                <div className="flex items-center gap-3 p-4">
                  {/* Completion checkbox — Apple Reminders style */}
                  <button
                    onClick={() => handleToggleComplete(t.id, t.completed)}
                    aria-label={
                      t.completed
                        ? `Mark task ${t.title} as active`
                        : `Mark task ${t.title} as complete`
                    }
                    className={`mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] transition-all active:scale-90 ${
                      t.completed
                        ? "border-emerald-500 bg-emerald-500 text-white shadow-sm shadow-emerald-500/30"
                        : "border-muted-foreground/25 bg-transparent text-transparent hover:border-emerald-500"
                    }`}
                  >
                    <Check className="size-3.5" strokeWidth={3.5} />
                  </button>

                  {/* Title + meta */}
                  <div className="min-w-0 flex-1">
                    <h3
                      className={`truncate text-[15px] font-bold leading-snug tracking-tight ${
                        t.completed
                          ? "text-muted-foreground line-through decoration-muted-foreground/50"
                          : "text-foreground"
                      }`}
                    >
                      {t.title}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* Category badge */}
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${categoryBadgeClass(
                          t.category,
                        )}`}
                      >
                        {t.category}
                      </span>

                      {/* Due date */}
                      {t.due_date && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                            overdue ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"
                          }`}
                        >
                          <CalendarDays className="size-3" />
                          {overdue
                            ? `${formatDueDate(t.due_date)} • Overdue`
                            : formatDueDate(t.due_date)}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Status badge + actions */}
                  <div className="flex shrink-0 flex-col items-end gap-2.5 self-start">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${statusMeta.className}`}
                    >
                      <span className="size-1.5 rounded-full bg-current" />
                      {statusMeta.label}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => openEditModal(t)}
                        aria-label={`Edit task ${t.title}`}
                        title="Edit Task"
                        className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95"
                      >
                        <Edit2 className="size-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        aria-label={`Delete task ${t.title}`}
                        title="Delete Task"
                        className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive active:scale-95"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Add / Edit Task Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} className="bg-card">
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h2 className="text-lg font-extrabold text-foreground">
            {editingTask ? "Edit Task" : "Add New Task"}
          </h2>
          <button
            onClick={() => setModalOpen(false)}
            className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="mt-4 space-y-3">
          <div>
            <label className="text-xs font-bold text-foreground">Task Title</label>
            <input
              type="text"
              required
              placeholder="Refill prescription"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
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
                onChange={(e) => setPriority(e.target.value as any)}
                className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
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
              className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
            />
          </div>

          <div className="flex gap-2 pt-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
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
              {submitting ? "Saving..." : "Save Task"}
            </button>
          </div>
        </form>
      </Modal>
    </Screen>
  );
}
