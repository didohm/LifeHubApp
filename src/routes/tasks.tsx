import { useState, useEffect, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  Plus,
  ListChecks,
  CheckSquare,
  Square,
  Trash2,
  Edit2,
  X,
  Loader2,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { getTodos, createTodo, updateTodo, deleteTodo } from "@/lib/api";
import { Todo } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";

export const Route = createFileRoute("/tasks")({
  head: () => ({
    meta: [{ title: "To-Do List — LifeHub" }],
  }),
  component: TasksPage,
});

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
  const [progress, setProgress] = useState(0);
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
    setProgress(0);
    setModalOpen(true);
  };

  const openEditModal = (task: Todo) => {
    setEditingTask(task);
    setTitle(task.title);
    setCategory(task.category);
    setPriority(task.priority);
    setDueDate(task.due_date || new Date().toISOString().split("T")[0]);
    setProgress(task.progress || 0);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingTask) {
        // Edit existing task
        const isComp = progress >= 100;
        await updateTodo(editingTask.id, user.id, {
          title,
          category,
          priority,
          due_date: dueDate,
          progress,
          completed: isComp,
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
                  progress,
                  completed: isComp,
                }
              : t,
          ),
        );
        toast.success("Task updated!");
      } else {
        // Create new task
        const task = await createTodo(user.id, {
          title,
          category,
          priority,
          due_date: dueDate,
          completed: progress >= 100,
          progress,
        });
        setTodos((prev) => [task, ...prev]);
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
      toast.success(newStatus ? "Task completed! 🎉" : "Task marked active");
    } catch (err) {
      toast.error("Could not update task status");
    }
  };

  const handleProgressChange = async (id: string, newProgress: number) => {
    if (!user) return;
    const isComp = newProgress >= 100;
    try {
      await updateTodo(id, user.id, { progress: newProgress, completed: isComp });
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? { ...t, progress: newProgress, completed: isComp } : t)),
      );
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await deleteTodo(id, user.id);
      setTodos((prev) => prev.filter((t) => t.id !== id));
      toast.success("Task deleted.");
    } catch (err) {
      toast.error("Failed to delete task.");
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
          filteredTasks.map((t) => (
            <div
              key={t.id}
              className={`card-soft p-4 border transition-all shadow-sm hover:shadow-md ${
                t.completed ? "bg-muted/40 border-border/30 opacity-75" : "bg-card border-border/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => handleToggleComplete(t.id, t.completed)}
                    aria-label={
                      t.completed
                        ? `Mark task ${t.title} as active`
                        : `Mark task ${t.title} as complete`
                    }
                    className="mt-0.5 text-primary hover:scale-110 transition-transform"
                  >
                    {t.completed ? (
                      <CheckSquare className="size-5" />
                    ) : (
                      <Square className="size-5" />
                    )}
                  </button>
                  <div>
                    <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                      {t.category}
                    </span>
                    <h3
                      className={`mt-0.5 text-sm font-extrabold ${
                        t.completed ? "line-through text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {t.title}
                    </h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Due: {t.due_date || "Today"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => openEditModal(t)}
                    aria-label={`Edit task ${t.title}`}
                    title="Edit Task"
                    className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Edit2 className="size-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(t.id)}
                    aria-label={`Delete task ${t.title}`}
                    title="Delete Task"
                    className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              {/* Interactive Progress Bar */}
              <div className="mt-3 flex items-center gap-2 border-t border-border/20 pt-2">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={t.progress}
                  onChange={(e) => handleProgressChange(t.id, Number(e.target.value))}
                  className="h-1.5 flex-1 accent-primary cursor-pointer"
                />
                <span className="text-[10px] font-bold text-muted-foreground">{t.progress}%</span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add / Edit Task Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
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

              <div>
                <label className="text-xs font-bold text-foreground">Progress ({progress}%)</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={progress}
                  onChange={(e) => setProgress(Number(e.target.value))}
                  className="w-full mt-1 accent-primary"
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
          </div>
        </div>
      )}
    </Screen>
  );
}
