import { useState, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
} from "lucide-react";
import { toast } from "sonner";
import { Screen } from "@/components/lifehub/Screen";
import { useAuth } from "@/hooks/use-auth";
import { useData } from "@/lib/data-context";
import { Bill } from "@/lib/types";
import { ListSkeleton } from "@/components/lifehub/SkeletonLoader";

export const Route = createFileRoute("/bills")({
  head: () => ({
    meta: [{ title: "Bills & Payments — LifeHub" }],
  }),
  component: BillsPage,
});

function BillsPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const {
    bills,
    payments,
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

  // Modal States
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | null>(null);
  const [payModalBill, setPayModalBill] = useState<Bill | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Health");
  const [dueDate, setDueDate] = useState(new Date().toISOString().split("T")[0]);
  const [paymentMethod, setPaymentMethod] = useState("Cash (Espèces)");
  const [submitting, setSubmitting] = useState(false);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate({ to: "/auth" });
    }
  }, [user, authLoading, navigate]);

  const openAddModal = () => {
    setEditingBill(null);
    setTitle("");
    setAmount("");
    setCategory("Health");
    setDueDate(new Date().toISOString().split("T")[0]);
    setModalOpen(true);
  };

  const handleSaveBill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);

    try {
      if (editingBill) {
        const updated = await editBill(editingBill.id, {
          title,
          amount: parseFloat(amount) || 0,
          category,
          due_date: dueDate,
          status: editingBill.status,
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
    } catch (err: any) {
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
      toast.success(`Paid $${Number(payModalBill.amount).toFixed(2)} via ${paymentMethod}! 🎉`);
      setPayModalBill(null);
    } catch (err) {
      toast.error("Payment failed. Please try again.");
    } finally {
      setPaying(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!user) return;
    try {
      await removeBill(id);
      toast.success("Bill removed.");
    } catch (err) {
      toast.error("Failed to delete bill.");
    }
  };

  const filteredBills = bills.filter((b) => {
    const matchesCat = categoryFilter === "all" ? true : b.category === categoryFilter;
    const matchesSearch = b.title.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const totalUnpaid = bills.filter((b) => b.status === "unpaid").reduce((sum, b) => sum + Number(b.amount), 0);
  const totalPaid = bills.filter((b) => b.status === "paid").reduce((sum, b) => sum + Number(b.amount), 0);

  // Error state
  if (billError) {
    return (
      <Screen>
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
              <Wallet className="size-6 text-emerald-600" /> Bills & Payments
            </h1>
            <p className="text-xs text-muted-foreground">Track dues, subscriptions & financial records</p>
          </div>
        </header>
        <div className="mt-6 rounded-3xl border border-dashed border-destructive/50 p-8 text-center bg-destructive/5">
          <AlertCircle className="mx-auto size-12 text-destructive/60" />
          <p className="mt-2 text-sm font-bold text-foreground">Failed to load bills</p>
          <p className="text-xs text-muted-foreground mt-1">{billError}</p>
          <button
            onClick={() => refreshBills()}
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
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            <Wallet className="size-6 text-emerald-600" /> Bills & Payments
          </h1>
          <p className="text-xs text-muted-foreground">Track dues, subscriptions & financial records</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setHistoryOpen(true)}
            title="Payment History"
            className="tap flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent active:scale-95"
          >
            <History className="size-4.5" />
          </button>
          <button
            onClick={openAddModal}
            className="tap flex items-center gap-1 rounded-full bg-ink px-4 py-2 text-xs font-bold text-card shadow-md transition-transform active:scale-95 hover:opacity-90"
          >
            <Plus className="size-4" /> Add Bill
          </button>
        </div>
      </header>

      {/* Summary Statistics */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="card-soft bg-rose-500/10 p-4 border border-rose-500/20 text-rose-900">
          <span className="text-xs font-bold">Unpaid Dues</span>
          <p className="mt-1 text-2xl font-black">${totalUnpaid.toFixed(2)}</p>
        </div>
        <div className="card-soft bg-emerald-500/10 p-4 border border-emerald-500/20 text-emerald-900">
          <span className="text-xs font-bold">Paid Total</span>
          <p className="mt-1 text-2xl font-black">${totalPaid.toFixed(2)}</p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="mt-4 space-y-3">
        <div className="flex items-center gap-2 rounded-2xl border border-border/50 bg-card px-3.5 py-2 text-xs shadow-sm">
          <Search className="size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search bill name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {["all", "Health", "Utilities", "Insurance", "Medical", "Subscriptions"].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-full px-3.5 py-1 text-xs font-bold capitalize whitespace-nowrap ${
                categoryFilter === cat ? "bg-slate-900 text-white shadow-sm" : "bg-muted text-muted-foreground"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Bills List */}
      <div className="mt-4 space-y-3">
        {billLoading ? (
          <ListSkeleton count={3} />
        ) : filteredBills.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200/60 p-6 text-center bg-card/40">
            <Wallet className="mx-auto size-10 text-muted-foreground/50" />
            <p className="mt-2 text-sm font-bold text-foreground">No bills found</p>
          </div>
        ) : (
          filteredBills.map((bill) => (
            <div
              key={bill.id}
              className="card-soft bg-card p-4 border border-border/40 shadow-sm flex items-center justify-between transition-all hover:shadow-md"
            >
              <div>
                <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
                  {bill.category}
                </span>
                <h3 className="mt-1 text-base font-extrabold text-foreground">{bill.title}</h3>
                <p className="text-xs text-muted-foreground">Due: {bill.due_date}</p>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <p className="text-base font-black text-foreground">${Number(bill.amount).toFixed(2)}</p>
                  <span
                    className={`text-[10px] font-bold uppercase ${
                      bill.status === "paid" ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {bill.status}
                  </span>
                </div>

                {bill.status !== "paid" ? (
                  <button
                    onClick={() => setPayModalBill(bill)}
                    className="tap rounded-xl bg-ink px-3.5 py-1.5 text-xs font-bold text-card shadow-sm hover:opacity-90 active:scale-95"
                  >
                    Pay
                  </button>
                ) : (
                  <button
                    onClick={() => handleDelete(bill.id)}
                    className="size-8 flex items-center justify-center text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add Bill Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="text-lg font-extrabold text-foreground">
                {editingBill ? "Edit Bill" : "Add New Bill"}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <form onSubmit={handleSaveBill} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-foreground">Bill Title</label>
                <input
                  type="text"
                  required
                  placeholder="Electricity / Clinic Bill"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-foreground">Amount ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    placeholder="85.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-foreground">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-sm outline-none"
                  >
                    <option value="Health">Health</option>
                    <option value="Utilities">Utilities</option>
                    <option value="Insurance">Insurance</option>
                    <option value="Medical">Medical</option>
                    <option value="Subscriptions">Subscriptions</option>
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
                  {submitting ? "Saving..." : editingBill ? "Update Bill" : "Save Bill"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pay Bill Modal */}
      {payModalBill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="text-lg font-extrabold text-foreground">Pay Bill Dues</h2>
              <button
                onClick={() => setPayModalBill(null)}
                className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-4 rounded-2xl bg-muted/30 p-4 text-center">
              <p className="text-xs text-muted-foreground">Amount Due for {payModalBill.title}</p>
              <p className="text-3xl font-black text-foreground mt-1">${Number(payModalBill.amount).toFixed(2)}</p>
            </div>

            <form onSubmit={handleConfirmPayment} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-foreground">Payment Method</label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-input bg-muted/30 p-2.5 text-xs outline-none"
                >
                  <option value="Carte Edahabia">Carte Edahabia</option>
                  <option value="Cash (Espèces)">Cash (Espèces)</option>
                </select>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setPayModalBill(null)}
                  className="w-1/3 rounded-xl border border-border py-2.5 text-xs font-bold text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={paying}
                  className="w-2/3 flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 py-2.5 text-xs font-bold text-white shadow-md hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                >
                  {paying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  {paying ? "Processing..." : `Confirm Pay $${Number(payModalBill.amount).toFixed(2)}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Payment History Modal */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-border/40 pb-3">
              <h2 className="text-lg font-extrabold text-foreground">Payment History Log</h2>
              <button
                onClick={() => setHistoryOpen(false)}
                className="size-8 flex items-center justify-center rounded-full bg-muted text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-3 max-h-80 overflow-y-auto space-y-2">
              {payments.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
                    <div>
                      <p className="text-xs font-bold text-foreground">{p.payment_method}</p>
                      <p className="text-[10px] text-muted-foreground">Ref: {p.reference || "PAY-" + p.id.slice(0, 6)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-emerald-600">+${Number(p.amount).toFixed(2)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(p.payment_date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}