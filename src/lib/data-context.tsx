import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  ReactNode,
} from "react";
import {
  getMedications,
  createMedication,
  updateMedication,
  deleteMedication,
  toggleMedicationTaken,
  getMedicationLogs,
  getBills,
  createBill,
  updateBill,
  deleteBill,
  payBill as payBillApi,
  getPayments,
  getAppointments,
  createAppointment,
  updateAppointment,
  deleteAppointment,
  getWorkoutPrograms,
  getWorkouts,
  getWalkSessions,
  subscribeMedications,
  subscribeMedicationLogs,
  subscribeBills,
  subscribePayments,
  subscribeAppointments,
  subscribeBirthdays,
  subscribeWorkoutPrograms,
  subscribeWorkouts,
  subscribeWalkSessions,
  subscribeActivityLogs,
  subscribeTodos,
  subscribeWaterLogs,
} from "./api";
import {
  Medication,
  MedicationLog,
  Bill,
  Payment,
  Appointment,
  Birthday,
  WorkoutProgram,
  Workout,
  WalkSession,
  ActivityLog,
  Todo,
  WaterLog,
} from "./types";
import { Notifications } from "./notifications-integration";
import { PERMISSIONS_CHANGED_EVENT } from "./permissions";
import { sounds } from "./sound";
import { useRef } from "react";

// Utility: deduplicate an array of objects with `id` field
function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export interface DataContextValue {
  // Medications
  medications: Medication[];
  medicationLogs: MedicationLog[];
  medLoading: boolean;
  medError: string | null;
  addMedication: (data: Partial<Medication>) => Promise<Medication | null>;
  editMedication: (id: string, data: Partial<Medication>) => Promise<Medication | null>;
  removeMedication: (id: string) => Promise<void>;
  toggleMedication: (id: string, currentTaken: boolean) => Promise<void>;
  refreshMedications: () => Promise<void>;

  // Bills
  bills: Bill[];
  payments: Payment[];
  billLoading: boolean;
  billError: string | null;
  addBill: (data: Partial<Bill>) => Promise<Bill | null>;
  editBill: (id: string, data: Partial<Bill>) => Promise<Bill | null>;
  removeBill: (id: string) => Promise<void>;
  payBill: (id: string, paymentMethod: string) => Promise<void>;
  refreshBills: () => Promise<void>;

  // Appointments
  appointments: Appointment[];
  appLoading: boolean;
  appError: string | null;
  refreshAppointments: () => Promise<void>;

  // Fitness & Workouts
  workoutPrograms: WorkoutProgram[];
  workouts: Workout[];
  walkSessions: WalkSession[];
  fitnessLoading: boolean;
  refreshFitness: () => Promise<void>;

  // Activity logs (every service writes one per user action)
  activityLogs: ActivityLog[];
  activityLoading: boolean;

  // Tasks
  todos: Todo[];
  todosLoading: boolean;

  // Hydration (daily water intake history)
  waterLogs: WaterLog[];
  waterLoading: boolean;

  // Global refresh
  refreshAll: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | undefined>(undefined);

export function DataProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  // Medications State
  const [medications, setMedications] = useState<Medication[]>([]);
  const [medicationLogs, setMedicationLogs] = useState<MedicationLog[]>([]);
  // Start as false — Firestore local persistence means data arrives quickly.
  // Skeletons only show briefly if truly empty (new user).
  const [medLoading, setMedLoading] = useState(false);
  const [medError, setMedError] = useState<string | null>(null);

  // Bills State
  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [billLoading, setBillLoading] = useState(false);
  const [billError, setBillError] = useState<string | null>(null);

  // Appointments & Birthdays State
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [birthdays, setBirthdays] = useState<Birthday[]>([]);
  // Start as false — same reasoning as medications
  const [appLoading, setAppLoading] = useState(false);
  const [appError, setAppError] = useState<string | null>(null);

  // Fitness State
  const [workoutPrograms, setWorkoutPrograms] = useState<WorkoutProgram[]>([]);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [walkSessions, setWalkSessions] = useState<WalkSession[]>([]);
  const [fitnessLoading, setFitnessLoading] = useState(false);

  // Activity Logs State
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  // Tasks State
  const [todos, setTodos] = useState<Todo[]>([]);
  const [todosLoading, setTodosLoading] = useState(false);

  // Hydration State
  const [waterLogs, setWaterLogs] = useState<WaterLog[]>([]);
  const [waterLoading, setWaterLoading] = useState(false);

  // ---------- Medications ----------
  const refreshMedications = useCallback(async () => {
    if (!userId) return;
    setMedLoading(true);
    setMedError(null);
    try {
      const [medsData, logsData] = await Promise.all([
        getMedications(userId),
        getMedicationLogs(userId),
      ]);
      setMedications(dedupeById(medsData));
      setMedicationLogs(dedupeById(logsData));
    } catch (e: any) {
      console.error("Failed to load medications:", e);
      setMedError(e.message || "Failed to load medications");
    } finally {
      setMedLoading(false);
    }
  }, [userId]);

  const addMedication = useCallback(
    async (data: Partial<Medication>): Promise<Medication | null> => {
      if (!userId) return null;
      try {
        const med = await createMedication(userId, data);
        setMedications((prev) => dedupeById([...prev, med]));
        sounds.playSuccess();
        Notifications.scheduleMedication(med);
        return med;
      } catch (e: any) {
        console.error("Failed to add medication:", e);
        return null;
      }
    },
    [userId],
  );

  const editMedication = useCallback(
    async (id: string, data: Partial<Medication>): Promise<Medication | null> => {
      if (!userId) return null;
      try {
        const updated = await updateMedication(id, userId, data);
        setMedications((prev) => dedupeById(prev.map((m) => (m.id === id ? updated : m))));
        sounds.playClick();
        Notifications.cancelMedication(id);
        Notifications.scheduleMedication(updated);
        return updated;
      } catch (e: any) {
        console.error("Failed to update medication:", e);
        return null;
      }
    },
    [userId],
  );

  const removeMedication = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        await deleteMedication(id, userId);
        setMedications((prev) => prev.filter((m) => m.id !== id));
        sounds.playClick();
        Notifications.cancelMedication(id);
      } catch (e: any) {
        console.error("Failed to delete medication:", e);
      }
    },
    [userId],
  );

  const toggleMedication = useCallback(
    async (id: string, currentTaken: boolean) => {
      if (!userId) return;
      try {
        const updated = await toggleMedicationTaken(id, userId, !currentTaken);
        setMedications((prev) => dedupeById(prev.map((m) => (m.id === id ? updated : m))));
        if (!currentTaken) sounds.playSuccess();
        else sounds.playClick();
        // Refresh logs
        const logsData = await getMedicationLogs(userId);
        setMedicationLogs(dedupeById(logsData));
      } catch (e: any) {
        console.error("Failed to toggle medication:", e);
      }
    },
    [userId],
  );

  // ---------- Bills ----------
  const refreshBills = useCallback(async () => {
    if (!userId) return;
    setBillLoading(true);
    setBillError(null);
    try {
      const [billsData, payData] = await Promise.all([getBills(userId), getPayments(userId)]);
      setBills(dedupeById(billsData));
      setPayments(dedupeById(payData));
    } catch (e: any) {
      console.error("Failed to load bills:", e);
      setBillError(e.message || "Failed to load bills");
    } finally {
      setBillLoading(false);
    }
  }, [userId]);

  const addBill = useCallback(
    async (data: Partial<Bill>): Promise<Bill | null> => {
      if (!userId) return null;
      try {
        const bill = await createBill(userId, data);
        setBills((prev) => dedupeById([...prev, bill]));
        sounds.playSuccess();
        Notifications.scheduleBill(bill);
        return bill;
      } catch (e: any) {
        console.error("Failed to add bill:", e);
        return null;
      }
    },
    [userId],
  );

  const editBill = useCallback(
    async (id: string, data: Partial<Bill>): Promise<Bill | null> => {
      if (!userId) return null;
      try {
        const updated = await updateBill(id, userId, data);
        setBills((prev) => dedupeById(prev.map((b) => (b.id === id ? updated : b))));
        sounds.playClick();
        Notifications.cancelBill(id);
        Notifications.scheduleBill(updated);
        return updated;
      } catch (e: any) {
        console.error("Failed to update bill:", e);
        return null;
      }
    },
    [userId],
  );

  const removeBill = useCallback(
    async (id: string) => {
      if (!userId) return;
      try {
        await deleteBill(id, userId);
        setBills((prev) => prev.filter((b) => b.id !== id));
        sounds.playClick();
        Notifications.cancelBill(id);
      } catch (e: any) {
        console.error("Failed to delete bill:", e);
      }
    },
    [userId],
  );

  const payBillAction = useCallback(
    async (id: string, paymentMethod: string) => {
      if (!userId) return;
      try {
        const updated = await payBillApi(id, userId, paymentMethod);
        setBills((prev) => dedupeById(prev.map((b) => (b.id === id ? updated : b))));
        sounds.playSuccess();
        Notifications.cancelBill(id);
        // Refresh payments
        const payData = await getPayments(userId);
        setPayments(dedupeById(payData));
      } catch (e: any) {
        console.error("Failed to pay bill:", e);
      }
    },
    [userId],
  );

  // ---------- Appointments ----------
  const refreshAppointments = useCallback(async () => {
    if (!userId) return;
    setAppLoading(true);
    setAppError(null);
    try {
      const data = await getAppointments(userId);
      setAppointments(dedupeById(data));
    } catch (e: any) {
      console.error("Failed to load appointments:", e);
      setAppError(e.message || "Failed to load appointments");
    } finally {
      setAppLoading(false);
    }
  }, [userId]);

  // ---------- Fitness ----------
  const refreshFitness = useCallback(async () => {
    if (!userId) return;
    setFitnessLoading(true);
    try {
      const [programs, workoutList, walks] = await Promise.all([
        getWorkoutPrograms(userId),
        getWorkouts(userId),
        getWalkSessions(userId),
      ]);
      setWorkoutPrograms(dedupeById(programs));
      setWorkouts(dedupeById(workoutList));
      setWalkSessions(dedupeById(walks));
    } catch (e: any) {
      console.error("Failed to load fitness data:", e);
    } finally {
      setFitnessLoading(false);
    }
  }, [userId]);

  // ---------- Global refresh ----------
  const refreshAll = useCallback(async () => {
    await Promise.all([
      refreshMedications(),
      refreshBills(),
      refreshAppointments(),
      refreshFitness(),
    ]);
  }, [refreshMedications, refreshBills, refreshAppointments, refreshFitness]);

  // Reset when userId changes (login/logout)
  useEffect(() => {
    // Clear stale data
    setMedications([]);
    setMedicationLogs([]);
    setBills([]);
    setPayments([]);
    setAppointments([]);
    setWorkoutPrograms([]);
    setWorkouts([]);
    setWalkSessions([]);
    setActivityLogs([]);
    setTodos([]);
    setWaterLogs([]);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    const unsubscribes: (() => void)[] = [];

    // Don't reset loading states to true here — they start as their initial values.
    // Firestore's local persistence means listeners fire quickly with cached data,
    // so we avoid the skeleton flash on app restart.

    unsubscribes.push(
      subscribeMedications(userId, (items) => {
        if (!active) return;
        setMedications(dedupeById(items));
        setMedLoading(false);
      }),
      subscribeMedicationLogs(userId, (items) => {
        if (!active) return;
        setMedicationLogs(dedupeById(items));
      }),
      subscribeBills(userId, (items) => {
        if (!active) return;
        setBills(dedupeById(items));
        setBillLoading(false);
      }),
      subscribePayments(userId, (items) => {
        if (!active) return;
        setPayments(dedupeById(items));
      }),
      subscribeAppointments(userId, (items) => {
        if (!active) return;
        setAppointments(dedupeById(items));
        setAppLoading(false);
      }),
      subscribeBirthdays(userId, (items) => {
        if (!active) return;
        setBirthdays(dedupeById(items));
      }),
      subscribeWorkoutPrograms(userId, (items) => {
        if (!active) return;
        setWorkoutPrograms(dedupeById(items));
      }),
      subscribeWorkouts(userId, (items) => {
        if (!active) return;
        setWorkouts(dedupeById(items));
      }),
      subscribeWalkSessions(userId, (items) => {
        if (!active) return;
        setWalkSessions(dedupeById(items));
        setFitnessLoading(false);
      }),
      subscribeActivityLogs(userId, (items) => {
        if (!active) return;
        setActivityLogs(dedupeById(items));
        setActivityLoading(false);
      }),
      subscribeTodos(userId, (items) => {
        if (!active) return;
        setTodos(dedupeById(items));
        setTodosLoading(false);
      }),
      subscribeWaterLogs(userId, (items) => {
        if (!active) return;
        setWaterLogs(dedupeById(items));
        setWaterLoading(false);
      }),
    );

    return () => {
      active = false;
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [userId]);

  // Keep the OS notification schedule in sync with the data. reconcile() is
  // idempotent (cancel + re-schedule per prefix), so it is safe to run on
  // every relevant data change, on app resume, and when notification
  // permission is granted — catching reminders the OS dropped while we were
  // away and dropping reminders for deleted/completed records.
  const resyncNotifications = useCallback(() => {
    if (!userId) return;
    const hasData =
      medications.length > 0 ||
      appointments.length > 0 ||
      bills.length > 0 ||
      birthdays.length > 0 ||
      workouts.length > 0 ||
      todos.length > 0;
    if (hasData) {
      void Notifications.resyncAll({
        medications,
        appointments,
        bills,
        birthdays,
        workouts,
        todos,
      });
    } else {
      // A zero-data account still needs its daily check-in reminder armed.
      void Notifications.resyncRecurringReminders().catch(() => {});
    }
  }, [
    userId,
    medications,
    appointments,
    bills,
    birthdays,
    workouts,
    todos,
  ]);

  useEffect(() => {
    if (!userId) return;

    resyncNotifications();

    // Re-sync on foregrounding and on permission grant. `resyncAll` is
    // idempotent, so frequent triggers are safe — but `visibilitychange`
    // can fire in rapid succession on app switches, so debounce it.
    let debounceTimer: number | null = null;
    const scheduleResync = () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        resyncNotifications();
      }, 1500);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") scheduleResync();
    };
    const onPermissionsChanged = () => scheduleResync();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener(
      PERMISSIONS_CHANGED_EVENT as keyof WindowEventMap,
      onPermissionsChanged as EventListener,
    );

    return () => {
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener(
        PERMISSIONS_CHANGED_EVENT as keyof WindowEventMap,
        onPermissionsChanged as EventListener,
      );
    };
  }, [userId, resyncNotifications]);

  const value = useMemo<DataContextValue>(
    () => ({
      medications,
      medicationLogs,
      medLoading,
      medError,
      addMedication,
      editMedication,
      removeMedication,
      toggleMedication,
      refreshMedications,
      bills,
      payments,
      billLoading,
      billError,
      addBill,
      editBill,
      removeBill,
      payBill: payBillAction,
      refreshBills,
      appointments,
      appLoading,
      appError,
      refreshAppointments,
      workoutPrograms,
      workouts,
      walkSessions,
      fitnessLoading,
      refreshFitness,
      activityLogs,
      activityLoading,
      todos,
      todosLoading,
      waterLogs,
      waterLoading,
      refreshAll,
    }),
    [
      medications,
      medicationLogs,
      medLoading,
      medError,
      addMedication,
      editMedication,
      removeMedication,
      toggleMedication,
      refreshMedications,
      bills,
      payments,
      billLoading,
      billError,
      addBill,
      editBill,
      removeBill,
      payBillAction,
      refreshBills,
      appointments,
      appLoading,
      appError,
      refreshAppointments,
      workoutPrograms,
      workouts,
      walkSessions,
      fitnessLoading,
      refreshFitness,
      activityLogs,
      activityLoading,
      todos,
      todosLoading,
      waterLogs,
      waterLoading,
      refreshAll,
    ],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useData must be used within a DataProvider");
  }
  return ctx;
}
