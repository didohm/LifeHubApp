import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Plus,
  Wallet,
  CheckCircle2,
  Trash2,
  History,
  X,
  Loader2,
  Search,
  AlertCircle,
  Edit2,
  Calendar,
  CreditCard,
  Banknote,
  Building2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Screen, ScreenHeader } from "@/components/lifehub/Screen";
import { Modal } from "@/components/lifehub/Modal";
import { useAuth } from "@/hooks/use-auth";
import { useDeleteWithGuard } from "@/hooks/use-delete-with-guard";
import { useData } from "@/lib/data-context";
import { todayLocalDate } from "@/lib/api";
import { Bill } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";
import { sounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/bills")({
  head: () => ({
    meta: [{ title: "Bills & Financial Payments — LifeHub" }],
  }),
  component: BillsPage,
});

const CATEGORIES = ["all", "Health", "Utilities", "Subscription", "Personal", "Housing"] as const;

function BillsPage() {
  const { user } = useAuth();

  const {
    bills = [],
    payments = [],
    billLoading,
    billError,
    addBill,
    editBill,
    removeBill,
    payBill: payBillAction,
    refreshBills,
  } = useData();

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [payModalBill, setPayModalBill] = useState<Bill | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Health");
  const [dueDate, setDueDate] = useState(todayLocalDate());
  const [paymentMethod, setPaymentMethod] = useState("Cash (Espèces)");
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);

  const { deleteWithGuard } = useDeleteWithGuard();

  const openAddModal = () => {
    sounds.playActionClick();
    setEditingBill(null);
    setTitle("");
    setAmount("");
    setCategory("Health");
    setDueDate(todayLocalDate());
    setModalOpen(true);
  };

  const openEditModal = (bill: Bill) => {
    sounds.playActionClick();
    setEditingBill(bill);
    setTitle(bill.title);
    setAmount(String(bill.amount));
    setCategory(bill.category);
    setDueDate(bill.due_date || todayLocalDate());
    setModalOpen(true);
  };

  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingBill) {
        if (editingBill.status === "paid") {
          toast.error("Cannot edit a paid bill. Delete and recreate if needed.");
          setSubmitting(false);
          return;
        }

        const updated = await editBill(editingBill.id, {
          title,
          amount: parseFloat(amount) || 0,
          category,
          due_date: dueDate,
          status: "unpaid",
        });
        if (updated) {
          toast.success("Bill updated!");
        } else {
          toast.error("Failed to update bill.");
        }
      } else {
        const bill = await addBill({
          title,
          amount: parseFloat(amount) || 0,
          category,
          due_date: dueDate,
          status: "unpaid",
        });
        if (bill) {
          toast.success("New bill added!");
        } else {
          toast.error("Failed to add bill.");
        }
      }
      setModalOpen(false);
    } catch {
      toast.error("Failed to save bill.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !payModalBill) return;
    setPaying(true);

    try {
      await payBillAction(payModalBill.id, paymentMethod);
      sounds.playSuccess();
      toast.success(
        `Paid ${Number(payModalBill.amount).toLocaleString()} DZD via ${paymentMethod}! 🎉`,
      );
      setPayModalBill(null);
    } catch {
      toast.error("Payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    await deleteWithGuard(id, async () => {
      await removeBill(id);
      toast.success("Bill deleted.");
    })().catch(() => {
      toast.error("Failed to delete bill.");
    });
  };

  const filteredBills = bills.filter((b) => {
    const matchesCat = categoryFilter === "all" ? true : b.category === categoryFilter;
    const matchesSearch = b.title.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const totalUnpaid = bills
    .filter((b) => b.status === "unpaid")
    .reduce((sum, b) => sum + Number(b.amount || 0), 0);
  const totalPaid = bills
    .filter((b) => b.status === "paid")
    .reduce((sum, b) => sum + Number(b.amount || 0), 0);

  if (billError) {
    return (
      <Screen>
        <ScreenHeader title="Bills & Payments" showBack />
        <div className="mt-6 rounded-3xl border border-dashed border-destructive/50 p-8 text-center bg-destructive/5">
          <AlertCircle className="mx-auto size-12 text-destructive/60" />
          <p className="mt-2 text-sm font-bold text-foreground">Failed to load bills</p>
          <p className="text-xs text-muted-foreground mt-1">{billError}</p>
          <button
            onClick={() => refreshBills()}
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-bold text-white shadow-xs"
          >
            <Loader2 className="size-3.5 animate-spin" /> Retry
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Bills & Payments"
        subtitle="Manage dues, recurring utilities & expenses"
        showBack
        action={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                sounds.playActionClick();
                setHistoryOpen(true);
              }}
              title="Payment Records"
              className="tap flex size-9 items-center justify-center rounded-full bg-white text-[#12131A] shadow-xs border border-black/5 hover:bg-slate-50 transition-colors"
            >
              <History className="size-4" />
            </button>
            <button
              type="button"
              onClick={openAddModal}
              className="tap flex items-center gap-1.5 rounded-full bg-[#12131A] px-4 py-2 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95 whitespace-nowrap"
            >
              <Plus className="size-3.5 stroke-[3]" /> Add Bill
            </button>
          </div>
        }
      />

      {/* ════════════════════════════════════════════════════════════
          FINANCIAL OVERVIEW HERO
          ════════════════════════════════════════════════════════════ */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="card-soft mt-1 bg-gradient-to-br from-[#FFE0C7] via-[#FFF0E2] to-[#FAF8FF] p-5 border border-amber-300/30 shadow-xs"
      >
        <div className="flex items-center justify-between">
          <div>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-0.5 text-[10px] font-black text-amber-950 shadow-2xs">
              <Wallet className="size-3" /> Financial Summary
            </span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-black text-[#12131A] tracking-tight">
                {totalUnpaid.toLocaleString()} DZD
              </span>
              <span className="text-xs font-bold text-amber-900/80">Pending Dues</span>
            </div>
            <p className="mt-0.5 text-xs font-medium text-amber-950/70">
              {totalPaid.toLocaleString()} DZD total settled in LifeHub
            </p>
          </div>

          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#12131A] text-white shadow-md">
            <Wallet className="size-7 text-[#FFC593]" />
          </div>
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
            placeholder="Search bills & expenses..."
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
          BILLS LIST
          ════════════════════════════════════════════════════════════ */}
      <div className="mt-3 space-y-2.5">
        {billLoading ? (
          <ListSkeleton count={3} />
        ) : filteredBills.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border p-8 text-center bg-white shadow-2xs">
            <Wallet className="mx-auto size-10 text-muted-foreground/40" />
            <p className="mt-2 text-sm font-extrabold text-[#12131A]">No bills recorded</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {searchTerm
                ? "No match for your search"
                : "Log your first upcoming bill or recurring utility."}
            </p>
            <button
              type="button"
              onClick={openAddModal}
              className="tap mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#12131A] px-5 py-2.5 text-xs font-black text-white shadow-md hover:bg-slate-800 transition-transform active:scale-95"
            >
              <Plus className="size-3.5 stroke-[3]" /> Add Bill
            </button>
          </div>
        ) : (
          filteredBills.map((b) => {
            const isPaid = b.status === "paid";

            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  "card-soft p-4 border transition-all flex items-center justify-between shadow-2xs group",
                  isPaid
                    ? "bg-emerald-50/40 border-emerald-200/70"
                    : "bg-white border-border/70 hover:shadow-xs",
                )}
              >
                <div className="min-w-0 flex-1 pr-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-slate-100 px-2 py-0.2 text-[9.5px] font-bold text-slate-700">
                      {b.category}
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.2 text-[9.5px] font-black uppercase",
                        isPaid ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800",
                      )}
                    >
                      {isPaid ? "Paid" : "Unpaid"}
                    </span>
                  </div>

                  <h3 className="mt-1.5 text-sm sm:text-base font-extrabold text-foreground truncate">
                    {b.title}
                  </h3>

                  <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                    <span className="text-sm font-black text-[#12131A]">
                      {Number(b.amount).toLocaleString()} DZD
                    </span>
                    {b.due_date && (
                      <span className="flex items-center gap-1 text-[11px]">
                        <Calendar className="size-3" /> Due {b.due_date}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {!isPaid && (
                    <button
                      onClick={() => {
                        sounds.playActionClick();
                        setPayModalBill(b);
                      }}
                      className="tap rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-black text-white shadow-xs hover:bg-emerald-700 transition-transform active:scale-95"
                    >
                      Pay Now
                    </button>
                  )}
                  {!isPaid && (
                    <button
                      onClick={() => openEditModal(b)}
                      className="size-8 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-slate-100"
                      title="Edit"
                    >
                      <Edit2 className="size-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(b.id)}
                    className="size-8 flex items-center justify-center rounded-xl text-rose-500 hover:bg-rose-50"
                    title="Delete"
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
          ADD / EDIT BILL MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h3 className="text-base font-extrabold text-foreground">
            {editingBill ? "Edit Bill" : "Add Bill Due"}
          </h3>
          <button
            onClick={() => setModalOpen(false)}
            className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSaveBill} className="mt-4 space-y-3.5">
          <div>
            <label className="text-xs font-bold text-foreground">Bill Title</label>
            <input
              type="text"
              required
              placeholder="e.g. Electric utility, Health insurance"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-foreground">Amount (DZD)</label>
              <input
                type="number"
                step="1"
                required
                placeholder="2500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none focus:border-[#7C5CFC] focus:bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-bold text-foreground">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none"
              >
                <option value="Health">Health</option>
                <option value="Utilities">Utilities</option>
                <option value="Subscription">Subscription</option>
                <option value="Personal">Personal</option>
                <option value="Housing">Housing</option>
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
              {submitting ? <Loader2 className="size-3.5 animate-spin" /> : null} Save Bill
            </button>
          </div>
        </form>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          PAY BILL CONFIRMATION MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={!!payModalBill}
        onClose={() => setPayModalBill(null)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h3 className="text-base font-extrabold text-foreground flex items-center gap-1.5">
            <CheckCircle2 className="size-4 text-emerald-600" /> Settle Payment
          </h3>
          <button
            onClick={() => setPayModalBill(null)}
            className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        {payModalBill && (
          <form onSubmit={handleConfirmPayment} className="mt-4 space-y-4">
            <div className="rounded-2xl bg-slate-50 p-4 border border-border/60 text-center">
              <span className="text-xs font-bold text-muted-foreground uppercase">
                {payModalBill.title}
              </span>
              <p className="mt-1 text-3xl font-black text-[#12131A]">
                {Number(payModalBill.amount).toLocaleString()} DZD
              </p>
              <p className="mt-0.5 text-xs font-semibold text-muted-foreground">
                Category: {payModalBill.category}
              </p>
            </div>

            <div>
              <label className="text-xs font-bold text-foreground">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border bg-slate-50 p-2.5 text-xs font-semibold text-foreground outline-none"
              >
                <option value="Cash (Espèces)">Cash (Espèces)</option>
                <option value="Edahabia / CIB Card">Edahabia / CIB Card</option>
                <option value="BaridiMob">BaridiMob</option>
                <option value="Bank Transfer">Bank Transfer</option>
                <option value="Credit Card">Credit Card</option>
              </select>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayModalBill(null)}
                className="w-1/2 rounded-xl border border-border py-2.5 text-xs font-bold text-foreground hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={paying}
                className="w-1/2 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
              >
                {paying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}
                Confirm Paid
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* ════════════════════════════════════════════════════════════
          PAYMENT HISTORY MODAL
          ════════════════════════════════════════════════════════════ */}
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        className="p-5 max-w-md bg-white rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-border/40 pb-3">
          <h3 className="text-base font-extrabold text-foreground flex items-center gap-1.5">
            <History className="size-4 text-[#7C5CFC]" /> Payment Records
          </h3>
          <button
            onClick={() => setHistoryOpen(false)}
            className="size-8 flex items-center justify-center rounded-full text-muted-foreground hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 max-h-72 overflow-y-auto space-y-2">
          {payments.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">
              No settled payments yet.
            </p>
          ) : (
            payments.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-xs border border-border/60"
              >
                <div>
                  <span className="font-bold text-foreground block">
                    {bills.find((b) => b.id === p.bill_id)?.title || "Bill Payment"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    Via {p.payment_method || "Payment"}
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-black text-emerald-600 block">
                    {Number(p.amount).toLocaleString()} DZD
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {p.payment_date ? new Date(p.payment_date).toLocaleDateString() : "Settled"}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Modal>
    </Screen>
  );
}
