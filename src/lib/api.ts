import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  setDoc,
  arrayUnion,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import {
  Appointment,
  Birthday,
  Medication,
  MedicationLog,
  Bill,
  Payment,
  DocumentItem,
  Todo,
  ActivityLog,
  AiConversation,
  AiMessage,
  User,
  GlobalSearchResult,
  WorkoutProgram,
  Workout,
  WalkSession,
  WaterLog,
  DayKey,
} from "./types";

// Helper: convert Firestore doc to typed object with id
function docToObj<T>(docSnap: any): T {
  const data = docSnap.data();
  const result: any = { id: docSnap.id, ...data };
  // Convert Firestore Timestamps to ISO strings for compatibility
  for (const key of Object.keys(result)) {
    if (result[key] instanceof Timestamp) {
      result[key] = result[key].toDate().toISOString();
    }
  }
  return result as T;
}

// Helper: get current ISO timestamp
function now(): string {
  return new Date().toISOString();
}

// Helper: current local date as YYYY-MM-DD (stable across timezones for daily resets)
export function todayLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// APPOINTMENTS API
export async function getAppointments(userId: string): Promise<Appointment[]> {
  const ref = collection(db, "users", userId, "appointments");
  const q = query(ref, orderBy("appointment_date", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<Appointment>(d));
}

export async function createAppointment(
  userId: string,
  data: Partial<Appointment>,
): Promise<Appointment> {
  const ref = collection(db, "users", userId, "appointments");
  const newDoc = {
    user_id: userId,
    title: data.title || "",
    doctor_name: data.doctor_name || "",
    location: data.location || "",
    appointment_date: data.appointment_date || new Date().toISOString().split("T")[0],
    start_time: data.start_time || "",
    end_time: data.end_time || "",
    priority: data.priority || "medium",
    status: data.status || "upcoming",
    reminder: data.reminder !== undefined ? data.reminder : true,
    reminder_offset_minutes:
      data.reminder_offset_minutes !== undefined ? data.reminder_offset_minutes : 30,
    notes: data.notes || "",
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(
    userId,
    "Created Appointment",
    `Added appointment with ${data.doctor_name || "Doctor"}`,
  );
  return { id: docRef.id, ...newDoc } as Appointment;
}

export async function updateAppointment(
  id: string,
  userId: string,
  data: Partial<Appointment>,
): Promise<Appointment> {
  const docRef = doc(db, "users", userId, "appointments", id);
  const updates: any = { updated_at: now() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.doctor_name !== undefined) updates.doctor_name = data.doctor_name;
  if (data.location !== undefined) updates.location = data.location;
  if (data.appointment_date !== undefined) updates.appointment_date = data.appointment_date;
  if (data.start_time !== undefined) updates.start_time = data.start_time;
  if (data.end_time !== undefined) updates.end_time = data.end_time;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.status !== undefined) updates.status = data.status;
  if (data.reminder !== undefined) updates.reminder = data.reminder;
  if (data.reminder_offset_minutes !== undefined) {
    updates.reminder_offset_minutes = data.reminder_offset_minutes;
  }
  if (data.notes !== undefined) updates.notes = data.notes;

  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<Appointment>(updated);
}

export async function deleteAppointment(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "appointments", id);
  await deleteDoc(docRef);
  await addActivityLog(userId, "Deleted Appointment", "Removed appointment from schedule.");
}

// MEDICATIONS API
export async function getMedications(userId: string): Promise<Medication[]> {
  const ref = collection(db, "users", userId, "medications");
  const q = query(ref, orderBy("scheduled_time", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<Medication>(d));
}

export async function createMedication(
  userId: string,
  data: Partial<Medication>,
): Promise<Medication> {
  const ref = collection(db, "users", userId, "medications");
  const newDoc = {
    user_id: userId,
    name: data.name || "",
    dosage: data.dosage || "",
    frequency: data.frequency || "",
    scheduled_time: data.scheduled_time || "",
    priority: data.priority || "medium",
    taken: data.taken || false,
    notes: data.notes || "",
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(userId, "Added Medication", `Started tracking ${data.name}`);
  return { id: docRef.id, ...newDoc } as Medication;
}

export async function updateMedication(
  id: string,
  userId: string,
  data: Partial<Medication>,
): Promise<Medication> {
  const docRef = doc(db, "users", userId, "medications", id);
  const updates: any = { updated_at: now() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.dosage !== undefined) updates.dosage = data.dosage;
  if (data.frequency !== undefined) updates.frequency = data.frequency;
  if (data.scheduled_time !== undefined) updates.scheduled_time = data.scheduled_time;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.taken !== undefined) updates.taken = data.taken;
  if (data.notes !== undefined) updates.notes = data.notes;
  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<Medication>(updated);
}

export async function toggleMedicationTaken(
  id: string,
  userId: string,
  taken: boolean,
): Promise<Medication> {
  const docRef = doc(db, "users", userId, "medications", id);
  await updateDoc(docRef, { taken, updated_at: now() });

  if (taken) {
    const logsRef = collection(db, "users", userId, "medication_logs");
    await addDoc(logsRef, {
      user_id: userId,
      medication_id: id,
      taken_at: now(),
      status: "taken",
      notes: `Marked taken at ${new Date().toLocaleTimeString()}`,
      created_at: now(),
      updated_at: now(),
    });
  }

  const updated = await getDoc(docRef);
  const med = docToObj<Medication>(updated);

  if (taken && med) {
    await addActivityLog(userId, "Medication Taken", `Marked ${med.name} as taken.`);
  }

  return med;
}

export async function deleteMedication(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "medications", id);
  await deleteDoc(docRef);
  await addActivityLog(userId, "Deleted Medication", "Removed medication record.");
}

export async function getMedicationLogs(userId: string): Promise<MedicationLog[]> {
  const ref = collection(db, "users", userId, "medication_logs");
  const q = query(ref, orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<MedicationLog>(d));
}

// BILLS & PAYMENTS API
export async function getBills(userId: string): Promise<Bill[]> {
  const ref = collection(db, "users", userId, "bills");
  const q = query(ref, orderBy("due_date", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<Bill>(d));
}

export async function createBill(userId: string, data: Partial<Bill>): Promise<Bill> {
  const ref = collection(db, "users", userId, "bills");
  const newDoc = {
    user_id: userId,
    title: data.title || "",
    amount: data.amount || 0.0,
    category: data.category || "General",
    due_date: data.due_date || new Date().toISOString().split("T")[0],
    status: data.status || "unpaid",
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(userId, "Added Bill", `Created bill: ${data.title} ($${data.amount})`);
  return { id: docRef.id, ...newDoc } as Bill;
}

export async function updateBill(id: string, userId: string, data: Partial<Bill>): Promise<Bill> {
  const docRef = doc(db, "users", userId, "bills", id);
  const updates: any = { updated_at: now() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.amount !== undefined) updates.amount = data.amount;
  if (data.category !== undefined) updates.category = data.category;
  if (data.due_date !== undefined) updates.due_date = data.due_date;
  if (data.status !== undefined) updates.status = data.status;
  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<Bill>(updated);
}

export async function payBill(
  billId: string,
  userId: string,
  paymentMethod: string = "Cash (Espèces)",
): Promise<Bill> {
  const billRef = doc(db, "users", userId, "bills", billId);
  await updateDoc(billRef, { status: "paid", updated_at: now() });

  const billSnap = await getDoc(billRef);
  const bill = docToObj<Bill>(billSnap);

  if (bill) {
    const paymentsRef = collection(db, "users", userId, "payments");
    await addDoc(paymentsRef, {
      user_id: userId,
      bill_id: billId,
      amount: bill.amount,
      payment_date: now(),
      payment_method: paymentMethod,
      reference: "TXN-" + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000),
      created_at: now(),
      updated_at: now(),
    });
    await addActivityLog(userId, "Paid Bill", `Paid $${bill.amount} for ${bill.title}`);
  }

  return bill;
}

export async function deleteBill(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "bills", id);
  await deleteDoc(docRef);
}

export async function getPayments(userId: string): Promise<Payment[]> {
  const ref = collection(db, "users", userId, "payments");
  const q = query(ref, orderBy("payment_date", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<Payment>(d));
}

// DOCUMENTS API
export async function getDocuments(userId: string): Promise<DocumentItem[]> {
  const ref = collection(db, "users", userId, "documents");
  const q = query(ref, orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<DocumentItem>(d));
}

export async function createDocument(
  userId: string,
  data: Partial<DocumentItem>,
): Promise<DocumentItem> {
  const ref = collection(db, "users", userId, "documents");
  const newDoc = {
    user_id: userId,
    name: data.name || "",
    category: data.category || "",
    file_url: data.file_url || "",
    file_size: data.file_size || "",
    file_type: data.file_type || "",
    summary: data.summary || "",
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(userId, "Uploaded Document", `Added document ${data.name}`);
  return { id: docRef.id, ...newDoc } as DocumentItem;
}

export async function updateDocument(
  id: string,
  userId: string,
  data: Partial<DocumentItem>,
): Promise<DocumentItem> {
  const docRef = doc(db, "users", userId, "documents", id);
  const updates: any = { updated_at: now() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.category !== undefined) updates.category = data.category;
  if (data.file_url !== undefined) updates.file_url = data.file_url;
  if (data.file_size !== undefined) updates.file_size = data.file_size;
  if (data.file_type !== undefined) updates.file_type = data.file_type;
  if (data.summary !== undefined) updates.summary = data.summary;

  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<DocumentItem>(updated);
}

export async function deleteDocument(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "documents", id);
  await deleteDoc(docRef);
}

// TODOS API
export async function getTodos(userId: string): Promise<Todo[]> {
  const ref = collection(db, "users", userId, "todos");
  const q = query(ref, orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  // Sort: incomplete first, then by created_at desc
  const todos = snap.docs.map((d) => docToObj<Todo>(d));
  return todos.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export async function createTodo(userId: string, data: Partial<Todo>): Promise<Todo> {
  const ref = collection(db, "users", userId, "todos");
  const newDoc = {
    user_id: userId,
    title: data.title || "",
    category: data.category || "",
    priority: data.priority || "medium",
    due_date: data.due_date || new Date().toISOString().split("T")[0],
    completed: data.completed || false,
    progress: data.progress || 0,
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(userId, "Created Task", `Added task: ${data.title}`);
  return { id: docRef.id, ...newDoc } as Todo;
}

export async function updateTodo(id: string, userId: string, data: Partial<Todo>): Promise<Todo> {
  const docRef = doc(db, "users", userId, "todos", id);
  const updates: any = { updated_at: now() };
  if (data.title !== undefined) updates.title = data.title;
  if (data.category !== undefined) updates.category = data.category;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.due_date !== undefined) updates.due_date = data.due_date;
  if (data.completed !== undefined) updates.completed = data.completed;
  if (data.progress !== undefined) updates.progress = data.progress;

  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<Todo>(updated);
}

export async function deleteTodo(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "todos", id);
  await deleteDoc(docRef);
}

// BIRTHDAYS API
export async function getBirthdays(userId: string): Promise<Birthday[]> {
  const ref = collection(db, "users", userId, "birthdays");
  const q = query(ref, orderBy("birthday_date", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<Birthday>(d));
}

export async function createBirthday(userId: string, data: Partial<Birthday>): Promise<Birthday> {
  const ref = collection(db, "users", userId, "birthdays");
  const newDoc = {
    user_id: userId,
    full_name: data.full_name || "",
    phone_number: data.phone_number || "",
    birthday_date: data.birthday_date || new Date().toISOString().split("T")[0],
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(userId, "Added Birthday", `Saved birthday for ${data.full_name}`);
  return { id: docRef.id, ...newDoc } as Birthday;
}

export async function updateBirthday(
  id: string,
  userId: string,
  data: Partial<Birthday>,
): Promise<Birthday> {
  const docRef = doc(db, "users", userId, "birthdays", id);
  const updates: any = { updated_at: now() };
  if (data.full_name !== undefined) updates.full_name = data.full_name;
  if (data.phone_number !== undefined) updates.phone_number = data.phone_number;
  if (data.birthday_date !== undefined) updates.birthday_date = data.birthday_date;
  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<Birthday>(updated);
}

export async function deleteBirthday(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "birthdays", id);
  await deleteDoc(docRef);
  await addActivityLog(userId, "Deleted Birthday", "Removed birthday record.");
}

// ACTIVITY LOGS & USER PROFILE API
export async function getActivityLogs(userId: string): Promise<ActivityLog[]> {
  // No limit — analytics and exports need the complete history.
  const ref = collection(db, "users", userId, "activity_logs");
  const q = query(ref, orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<ActivityLog>(d));
}

export async function addActivityLog(
  userId: string,
  action: string,
  description?: string,
): Promise<void> {
  const ref = collection(db, "users", userId, "activity_logs");
  await addDoc(ref, {
    user_id: userId,
    action,
    description: description || "",
    created_at: now(),
  });
}

// ════════════════════════════════════════════════════════════
//  REALTIME SUBSCRIPTIONS (Firestore onSnapshot)
//  Every service collection streams live changes so pages (and
//  Analytics) stay in sync with the database without reloads.
// ════════════════════════════════════════════════════════════

type OrderDir = "asc" | "desc";

function subscribeCollection<T>(
  userId: string,
  subcollection: string,
  callback: (items: T[]) => void,
  orderByField?: string,
  orderDir: OrderDir = "asc",
  limitCount?: number,
): Unsubscribe {
  const ref = collection(db, "users", userId, subcollection);
  const q = orderByField
    ? limitCount
      ? query(ref, orderBy(orderByField, orderDir), limit(limitCount))
      : query(ref, orderBy(orderByField, orderDir))
    : ref;
  return onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => docToObj<T>(d))),
    (err) => console.error(`Firestore subscription error (${subcollection}):`, err),
  );
}

export function subscribeActivityLogs(
  userId: string,
  cb: (items: ActivityLog[]) => void,
): Unsubscribe {
  return subscribeCollection<ActivityLog>(userId, "activity_logs", cb, "created_at", "desc");
}

export function subscribeMedications(
  userId: string,
  cb: (items: Medication[]) => void,
): Unsubscribe {
  return subscribeCollection<Medication>(userId, "medications", cb, "scheduled_time", "asc");
}

export function subscribeMedicationLogs(
  userId: string,
  cb: (items: MedicationLog[]) => void,
): Unsubscribe {
  return subscribeCollection<MedicationLog>(userId, "medication_logs", cb, "created_at", "desc");
}

export function subscribeBills(userId: string, cb: (items: Bill[]) => void): Unsubscribe {
  return subscribeCollection<Bill>(userId, "bills", cb, "due_date", "asc");
}

export function subscribePayments(userId: string, cb: (items: Payment[]) => void): Unsubscribe {
  return subscribeCollection<Payment>(userId, "payments", cb, "payment_date", "desc");
}

export function subscribeAppointments(
  userId: string,
  cb: (items: Appointment[]) => void,
): Unsubscribe {
  return subscribeCollection<Appointment>(userId, "appointments", cb, "appointment_date", "asc");
}

export function subscribeBirthdays(userId: string, cb: (items: Birthday[]) => void): Unsubscribe {
  return subscribeCollection<Birthday>(userId, "birthdays", cb, "birthday_date", "asc");
}

export function subscribeTodos(userId: string, cb: (items: Todo[]) => void): Unsubscribe {
  return subscribeCollection<Todo>(
    userId,
    "todos",
    (items) => {
      // Same ordering as getTodos: incomplete first, then newest first.
      cb(
        items.sort((a, b) => {
          if (a.completed !== b.completed) return a.completed ? 1 : -1;
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        }),
      );
    },
    "created_at",
    "desc",
  );
}

export function subscribeWorkoutPrograms(
  userId: string,
  cb: (items: WorkoutProgram[]) => void,
): Unsubscribe {
  return subscribeCollection<WorkoutProgram>(userId, "workout_programs", cb, "created_at", "asc");
}

export function subscribeWorkouts(userId: string, cb: (items: Workout[]) => void): Unsubscribe {
  return subscribeCollection<Workout>(userId, "workouts", cb, "scheduled_at", "asc");
}

export function subscribeWalkSessions(
  userId: string,
  cb: (items: WalkSession[]) => void,
): Unsubscribe {
  return subscribeCollection<WalkSession>(userId, "walk_sessions", cb, "created_at", "desc");
}

export function subscribeWaterLogs(userId: string, cb: (items: WaterLog[]) => void): Unsubscribe {
  return subscribeCollection<WaterLog>(userId, "water_logs", cb, "day", "desc");
}

export async function getUserProfile(userId: string): Promise<User | null> {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return null;
    return docToObj<User>(userSnap);
  } catch (err) {
    console.error("Failed to load user profile from Firestore:", err);
    return null;
  }
}

/**
 * Checks whether the user's Firestore profile document exists.
 * Returns `true` (profile exists), `false` (no profile — brand-new user), or
 * `null` when the read itself failed. Callers use this to determine whether
 * the onboarding (Birthday / Date of Birth) screen should be shown: a
 * transient read failure must never be mistaken for a brand-new account.
 */
export async function userProfileExists(userId: string): Promise<boolean | null> {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    return userSnap.exists();
  } catch (err) {
    console.error("Failed to check user profile existence:", err);
    return null;
  }
}

export async function updateUserProfile(userId: string, data: Partial<User>): Promise<User | null> {
  try {
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      // Update existing user
      const updates: any = { updated_at: now() };
      if (data.full_name !== undefined) updates.full_name = data.full_name;
      if (data.avatar_url !== undefined) updates.avatar_url = data.avatar_url;
      if (data.date_of_birth !== undefined) updates.date_of_birth = data.date_of_birth;
      if (data.theme !== undefined) updates.theme = data.theme;
      if (data.language !== undefined) updates.language = data.language;
      if (data.timezone !== undefined) updates.timezone = data.timezone;
      if (data.accent_color !== undefined) updates.accent_color = data.accent_color;
      if (data.compact_mode !== undefined) updates.compact_mode = data.compact_mode;
      if (data.animations_enabled !== undefined)
        updates.animations_enabled = data.animations_enabled;
      if (data.accessibility_mode !== undefined)
        updates.accessibility_mode = data.accessibility_mode;
      await updateDoc(userRef, updates);
    } else {
      // Create new user document
      await setDoc(userRef, {
        id: userId,
        email: data.email || "",
        full_name: data.full_name || "User",
        avatar_url: data.avatar_url || null,
        date_of_birth: data.date_of_birth || null,
        theme: data.theme || "light",
        language: data.language || "en",
        timezone: data.timezone || "UTC",
        email_verified: data.email_verified ?? false,
        accent_color: data.accent_color || "primary",
        compact_mode: data.compact_mode ?? false,
        animations_enabled: data.animations_enabled ?? true,
        accessibility_mode: data.accessibility_mode ?? false,
        created_at: now(),
        updated_at: now(),
      });
    }

    const updated = await getDoc(userRef);
    return docToObj<User>(updated);
  } catch (err) {
    console.error("Failed to update user profile in Firestore:", err);
    return null;
  }
}

export async function deleteUserAccount(userId: string): Promise<void> {
  try {
    const subcollections = [
      "appointments",
      "medications",
      "medication_logs",
      "bills",
      "payments",
      "documents",
      "todos",
      "activity_logs",
      "ai_conversations",
    ];

    for (const sub of subcollections) {
      const colRef = collection(db, "users", userId, sub);
      const snap = await getDocs(colRef);
      const deletes = snap.docs.map((d) => deleteDoc(d.ref));
      await Promise.all(deletes);
    }

    const userRef = doc(db, "users", userId);
    await deleteDoc(userRef);
  } catch (err) {
    console.error("Failed to delete user record in Firestore:", err);
  }
}

// AI CONVERSATIONS & MESSAGES API
export async function getAiConversations(userId: string): Promise<AiConversation[]> {
  const ref = collection(db, "users", userId, "ai_conversations");
  const q = query(ref, orderBy("updated_at", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<AiConversation>(d));
}

export async function createAiConversation(
  userId: string,
  title: string = "New Conversation",
): Promise<AiConversation> {
  const ref = collection(db, "users", userId, "ai_conversations");
  const newDoc = {
    user_id: userId,
    title,
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  return { id: docRef.id, ...newDoc } as AiConversation;
}

export async function deleteAiConversation(id: string, userId: string): Promise<void> {
  const convRef = doc(db, "users", userId, "ai_conversations", id);
  // Delete all messages in the conversation first
  const msgsRef = collection(db, "users", userId, "ai_conversations", id, "messages");
  const msgsSnap = await getDocs(msgsRef);
  const deletes = msgsSnap.docs.map((d) => deleteDoc(d.ref));
  await Promise.all(deletes);
  await deleteDoc(convRef);
}

export async function getAiMessages(conversationId: string, userId: string): Promise<AiMessage[]> {
  const ref = collection(db, "users", userId, "ai_conversations", conversationId, "messages");
  const q = query(ref, orderBy("created_at", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<AiMessage>(d));
}

export async function addAiMessage(
  conversationId: string,
  role: string,
  content: string,
  userId: string,
): Promise<AiMessage> {
  const ref = collection(db, "users", userId, "ai_conversations", conversationId, "messages");
  const newDoc = {
    conversation_id: conversationId,
    role,
    content,
    created_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  // Update conversation's updated_at
  const convRef = doc(db, "users", userId, "ai_conversations", conversationId);
  await updateDoc(convRef, { updated_at: now() });
  return { id: docRef.id, ...newDoc } as AiMessage;
}

// GLOBAL SEARCH API
export async function performGlobalSearch(
  userId: string,
  term: string,
): Promise<GlobalSearchResult[]> {
  if (!term || term.trim().length === 0) return [];
  const lowerTerm = term.trim().toLowerCase();
  const results: GlobalSearchResult[] = [];

  // Search appointments
  const appsRef = collection(db, "users", userId, "appointments");
  const appsSnap = await getDocs(query(appsRef, limit(50))); // Added limit
  appsSnap.docs.forEach((d) => {
    const a = docToObj<Appointment>(d);
    if (
      a.title.toLowerCase().includes(lowerTerm) ||
      a.doctor_name.toLowerCase().includes(lowerTerm) ||
      (a.location && a.location.toLowerCase().includes(lowerTerm))
    ) {
      results.push({
        id: a.id,
        type: "appointment",
        title: a.title,
        subtitle: `${a.doctor_name} · ${a.appointment_date}`,
        url: "/appointments",
      });
    }
  });

  // Search bills
  const billsRef = collection(db, "users", userId, "bills");
  const billsSnap = await getDocs(query(billsRef, limit(50))); // Added limit
  billsSnap.docs.forEach((d) => {
    const b = docToObj<Bill>(d);
    if (b.title.toLowerCase().includes(lowerTerm) || b.category.toLowerCase().includes(lowerTerm)) {
      results.push({
        id: b.id,
        type: "bill",
        title: b.title,
        subtitle: `$${b.amount} · Due ${b.due_date}`,
        url: "/bills",
      });
    }
  });

  // Search medications
  const medsRef = collection(db, "users", userId, "medications");
  const medsSnap = await getDocs(query(medsRef, limit(50))); // Added limit
  medsSnap.docs.forEach((d) => {
    const m = docToObj<Medication>(d);
    if (m.name.toLowerCase().includes(lowerTerm) || m.dosage.toLowerCase().includes(lowerTerm)) {
      results.push({
        id: m.id,
        type: "medication",
        title: m.name,
        subtitle: `${m.dosage} · ${m.frequency}`,
        url: "/medications",
      });
    }
  });

  // Search documents
  const docsRef = collection(db, "users", userId, "documents");
  const docsSnap = await getDocs(query(docsRef, limit(50))); // Added limit
  docsSnap.docs.forEach((d) => {
    const doc = docToObj<DocumentItem>(d);
    if (
      doc.name.toLowerCase().includes(lowerTerm) ||
      doc.category.toLowerCase().includes(lowerTerm)
    ) {
      results.push({
        id: doc.id,
        type: "document",
        title: doc.name,
        subtitle: `${doc.category} · ${doc.file_size}`,
        url: "/documents",
      });
    }
  });

  // Search todos
  const todosRef = collection(db, "users", userId, "todos");
  const todosSnap = await getDocs(query(todosRef, limit(50))); // Added limit
  todosSnap.docs.forEach((d) => {
    const t = docToObj<Todo>(d);
    if (t.title.toLowerCase().includes(lowerTerm) || t.category.toLowerCase().includes(lowerTerm)) {
      results.push({
        id: t.id,
        type: "todo",
        title: t.title,
        subtitle: `${t.category} · ${t.priority} Priority`,
        url: "/tasks",
      });
    }
  });

  // Search birthdays
  const birthdaysRef = collection(db, "users", userId, "birthdays");
  const birthdaysSnap = await getDocs(query(birthdaysRef, limit(50))); // Added limit
  birthdaysSnap.docs.forEach((d) => {
    const b = docToObj<Birthday>(d);
    if (
      b.full_name.toLowerCase().includes(lowerTerm) ||
      (b.phone_number && b.phone_number.includes(lowerTerm))
    ) {
      results.push({
        id: b.id,
        type: "birthday",
        title: b.full_name,
        subtitle: `Birthday: ${b.birthday_date}`,
        url: "/birthdays",
      });
    }
  });

  // Search workout programs
  const programsRef = collection(db, "users", userId, "workout_programs");
  const programsSnap = await getDocs(query(programsRef, limit(50))); // Added limit
  programsSnap.docs.forEach((d) => {
    const p = docToObj<WorkoutProgram>(d);
    if (p.name.toLowerCase().includes(lowerTerm)) {
      results.push({
        id: p.id,
        type: "document",
        title: p.name,
        subtitle: `Program · ${p.workout_type || "Custom"}`,
        url: "/workouts",
      });
    }
  });

  // Search workouts
  const workoutsRef = collection(db, "users", userId, "workouts");
  const workoutsSnap = await getDocs(query(workoutsRef, limit(50))); // Added limit
  workoutsSnap.docs.forEach((d) => {
    const w = docToObj<Workout>(d);
    if (
      w.session_name.toLowerCase().includes(lowerTerm) ||
      (w.workout_type && w.workout_type.toLowerCase().includes(lowerTerm))
    ) {
      results.push({
        id: w.id,
        type: "todo",
        title: w.session_name,
        subtitle: `${w.workout_type || "Workout"} · ${w.scheduled_date}`,
        url: "/workouts",
      });
    }
  });

  return results;
}

// ════════════════════════════════════════════════════════════
//  HYDRATION (Daily Water Tracker) — Firestore-backed
//  One document per local day, automatically keyed by date.
//  Reading "today's log" naturally resets at the start of a new
//  local day because no document exists yet → glasses default to 0.
//  Past days remain in the database for future analytics.
// ════════════════════════════════════════════════════════════

export const DEFAULT_WATER_GOAL = 8;

export async function getTodayWaterLog(userId: string): Promise<WaterLog | null> {
  const ref = collection(db, "users", userId, "water_logs");
  const day = todayLocalDate();
  const q = query(ref, where("day", "==", day), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  return docToObj<WaterLog>(snap.docs[0]);
}

export async function addWaterGlass(userId: string, amount = 1): Promise<WaterLog> {
  const ref = collection(db, "users", userId, "water_logs");
  const day = todayLocalDate();
  const goal = DEFAULT_WATER_GOAL;
  const existing = await getTodayWaterLog(userId);
  let result: WaterLog;
  let loggedGlasses = 0;

  if (existing) {
    const glasses = Math.max(0, Math.min(999, existing.glasses + amount));
    loggedGlasses = glasses;
    const docRef = doc(db, "users", userId, "water_logs", existing.id);
    const updates: any = { glasses, goal_reached: glasses >= goal, updated_at: now() };
    await updateDoc(docRef, updates);
    result = { ...existing, ...updates } as WaterLog;
  } else {
    const glasses = Math.max(0, amount);
    loggedGlasses = glasses;
    const newDoc = {
      user_id: userId,
      day,
      glasses,
      goal,
      goal_reached: glasses >= goal,
      created_at: now(),
      updated_at: now(),
    };
    const docRef = await addDoc(ref, newDoc);
    result = { id: docRef.id, ...newDoc } as WaterLog;
  }

  if (amount > 0) {
    await addActivityLog(
      userId,
      "Drank Water",
      `Logged ${loggedGlasses} glass${loggedGlasses === 1 ? "" : "es"} of water`,
    );
  }
  return result;
}

export async function removeWaterGlass(userId: string, amount = 1): Promise<WaterLog | null> {
  return addWaterGlass(userId, -amount);
}

export async function setWaterGoal(userId: string, goal: number): Promise<void> {
  const day = todayLocalDate();
  const safeGoal = Math.max(1, Math.round(goal));
  const existing = await getTodayWaterLog(userId);
  if (existing) {
    const docRef = doc(db, "users", userId, "water_logs", existing.id);
    await updateDoc(docRef, {
      goal: safeGoal,
      goal_reached: existing.glasses >= safeGoal,
      updated_at: now(),
    });
  } else {
    const ref = collection(db, "users", userId, "water_logs");
    await addDoc(ref, {
      user_id: userId,
      day,
      glasses: 0,
      goal: safeGoal,
      goal_reached: false,
      created_at: now(),
      updated_at: now(),
    });
  }
}

export async function getWaterLogs(userId: string, limitCount = 90): Promise<WaterLog[]> {
  const ref = collection(db, "users", userId, "water_logs");
  const q = query(ref, orderBy("day", "desc"), limit(limitCount));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<WaterLog>(d));
}

/**
 * Number of consecutive days (ending today or yesterday) where the
 * daily water goal was reached. A not-yet-reached "today" does not break
 * a streak built up to yesterday.
 */
export async function getWaterGoalStreak(userId: string): Promise<number> {
  const logs = await getWaterLogs(userId, 400);
  const byDay = new Map<string, WaterLog>();
  logs.forEach((l) => byDay.set(l.day, l));
  let streak = 0;
  const cursor = new Date();
  const todayLog = byDay.get(todayLocalDate(cursor));
  if (!todayLog || !todayLog.goal_reached) {
    cursor.setDate(cursor.getDate() - 1);
  }

  while (true) {
    const day = todayLocalDate(cursor);
    const log = byDay.get(day);
    if (log && log.goal_reached) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ════════════════════════════════════════════════════════════
//  WORKOUT PROGRAMS
// ════════════════════════════════════════════════════════════

export const DAY_KEY_ORDER: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const DAY_LABELS: Record<DayKey, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
export const DAY_SHORT: Record<DayKey, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

export async function getWorkoutPrograms(userId: string): Promise<WorkoutProgram[]> {
  const ref = collection(db, "users", userId, "workout_programs");
  const q = query(ref, orderBy("created_at", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<WorkoutProgram>(d));
}

export async function createWorkoutProgram(
  userId: string,
  data: Partial<WorkoutProgram>,
): Promise<WorkoutProgram> {
  const ref = collection(db, "users", userId, "workout_programs");

  // The newly created program becomes the active program — deactivate any other
  // programs so there is always exactly one active program.
  const existing = await getDocs(ref);
  const deactivates = existing.docs
    .filter((d) => d.data().is_active === true)
    .map((d) => updateDoc(d.ref, { is_active: false, updated_at: now() }));
  await Promise.all(deactivates);

  const newDoc = {
    user_id: userId,
    name: data.name || "Untitled Program",
    workout_type: data.workout_type || "",
    weekly_plan: data.weekly_plan || [],
    training_days: data.training_days || [],
    color: data.color || null,
    notes: data.notes || "",
    is_active: true,
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(
    userId,
    "Created Program",
    `New workout program: ${data.name || "Untitled"}`,
  );
  return { id: docRef.id, ...newDoc } as WorkoutProgram;
}

export async function updateWorkoutProgram(
  id: string,
  userId: string,
  data: Partial<WorkoutProgram>,
): Promise<WorkoutProgram> {
  const docRef = doc(db, "users", userId, "workout_programs", id);
  const updates: any = { updated_at: now() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.workout_type !== undefined) updates.workout_type = data.workout_type;
  if (data.weekly_plan !== undefined) updates.weekly_plan = data.weekly_plan;
  if (data.training_days !== undefined) updates.training_days = data.training_days;
  if (data.is_active !== undefined) updates.is_active = data.is_active;
  if (data.color !== undefined) updates.color = data.color;
  if (data.notes !== undefined) updates.notes = data.notes;
  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<WorkoutProgram>(updated);
}

export async function deleteWorkoutProgram(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "workout_programs", id);
  await deleteDoc(docRef);
  await addActivityLog(userId, "Deleted Program", "Removed a workout program");
}

/**
 * Sets the given program as the active one. All other programs are deactivated
 * so the Workouts page always resolves a single active program.
 */
export async function activateWorkoutProgram(id: string, userId: string): Promise<void> {
  const ref = collection(db, "users", userId, "workout_programs");
  const snap = await getDocs(ref);
  const updates = snap.docs.map((d) =>
    updateDoc(d.ref, { is_active: d.id === id, updated_at: now() }),
  );
  await Promise.all(updates);
  await addActivityLog(userId, "Active Program", "Changed the active workout program");
}

// ════════════════════════════════════════════════════════════
//  WORKOUT SESSIONS
// ════════════════════════════════════════════════════════════

export async function getWorkouts(userId: string): Promise<Workout[]> {
  const ref = collection(db, "users", userId, "workouts");
  const q = query(ref, orderBy("scheduled_at", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<Workout>(d));
}

export async function createWorkout(userId: string, data: Partial<Workout>): Promise<Workout> {
  const ref = collection(db, "users", userId, "workouts");
  const scheduledAt = data.scheduled_at || new Date().toISOString();
  const scheduledDate = data.scheduled_date || scheduledAt.slice(0, 10);
  const newDoc = {
    user_id: userId,
    program_id: data.program_id || "",
    program_name: data.program_name || "",
    workout_type: data.workout_type || "",
    session_name: data.session_name || "",
    duration: data.duration || 0,
    scheduled_at: scheduledAt,
    scheduled_date: scheduledDate,
    difficulty: data.difficulty || "",
    notes: data.notes || "",
    status: data.status || "scheduled",
    created_at: now(),
    updated_at: now(),
  };
  const docRef = await addDoc(ref, newDoc);
  await addActivityLog(
    userId,
    "Scheduled Workout",
    `${data.session_name || data.workout_type || "Workout"} · ${newDoc.duration || ""} min`,
  );
  return { id: docRef.id, ...newDoc } as Workout;
}

export async function updateWorkout(
  id: string,
  userId: string,
  data: Partial<Workout>,
): Promise<Workout> {
  const docRef = doc(db, "users", userId, "workouts", id);
  const updates: any = { updated_at: now() };
  if (data.program_id !== undefined) updates.program_id = data.program_id;
  if (data.program_name !== undefined) updates.program_name = data.program_name;
  if (data.workout_type !== undefined) updates.workout_type = data.workout_type;
  if (data.session_name !== undefined) updates.session_name = data.session_name;
  if (data.duration !== undefined) updates.duration = data.duration;
  if (data.scheduled_at !== undefined) {
    updates.scheduled_at = data.scheduled_at;
    if (!data.scheduled_date) updates.scheduled_date = data.scheduled_at.slice(0, 10);
  }
  if (data.scheduled_date !== undefined) updates.scheduled_date = data.scheduled_date;
  if (data.difficulty !== undefined) updates.difficulty = data.difficulty;
  if (data.notes !== undefined) updates.notes = data.notes;
  if (data.status !== undefined) updates.status = data.status;
  await updateDoc(docRef, updates);
  const updated = await getDoc(docRef);
  return docToObj<Workout>(updated);
}

export async function completeWorkout(id: string, userId: string): Promise<Workout> {
  const updated = await updateWorkout(id, userId, { status: "completed" });
  await addActivityLog(
    userId,
    "Completed Workout",
    `${updated.session_name || updated.workout_type || "Workout"} · ${updated.duration || ""} min`,
  );
  return updated;
}

/**
 * Records a completion for a specific program + day using a deterministic
 * document id (`{programId}_{date}`). This guarantees exactly one completion
 * per program per day and prevents completions from leaking across programs.
 */
export async function completeDayWorkout(
  userId: string,
  program: WorkoutProgram,
  date: string,
  sessionName: string,
): Promise<void> {
  const docId = `${program.id}_${date}`;
  const docRef = doc(db, "users", userId, "workouts", docId);
  await setDoc(docRef, {
    user_id: userId,
    program_id: program.id,
    program_name: program.name || "",
    workout_type: program.workout_type || "",
    session_name: sessionName || "Workout",
    duration: 45,
    scheduled_at: now(),
    scheduled_date: date,
    difficulty: "Medium",
    notes: "",
    status: "completed",
    created_at: now(),
    updated_at: now(),
  });
  await addActivityLog(userId, "Completed Workout", `${sessionName || "Workout"} · ${date}`);
}

export async function deleteWorkout(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "workouts", id);
  await deleteDoc(docRef);
}

// ════════════════════════════════════════════════════════════
//  WALK SERVICE
// ════════════════════════════════════════════════════════════

/** Simple MET-based calorie estimate for walking. */
export function estimateWalkCalories(distanceMeters: number, durationSeconds: number): number {
  const hours = Math.max(0, durationSeconds) / 3600;
  const baseMet = 3.5;
  const weightKg = 70;
  const distanceKm = Math.max(0, distanceMeters) / 1000;
  const byDuration = baseMet * weightKg * hours;
  const byDistance = distanceKm * 55; // ~55 kcal per km walked for 70kg
  if (durationSeconds <= 0 && distanceKm > 0) return Math.round(byDistance);
  if (distanceKm <= 0 && durationSeconds > 0) return Math.round(byDuration);
  if (distanceKm <= 0 && durationSeconds <= 0) return 0;
  return Math.round((byDuration + byDistance) / 2);
}

export async function getWalkSessions(userId: string): Promise<WalkSession[]> {
  // No limit — lifetime stats (profile) and history must match the realtime
  // subscription used by the Walk service, which streams all sessions.
  const ref = collection(db, "users", userId, "walk_sessions");
  const q = query(ref, orderBy("created_at", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => docToObj<WalkSession>(d));
}

/**
 * Fetch every non-finished walk session (active/paused). These are sessions
 * that were started but never completed — e.g. the app was closed or the user
 * navigated away mid-walk. Used to restore the latest in-progress walk after
 * a reload and to clean up abandoned ones so they never block new walks.
 */
export async function getAbandonedWalkSessions(userId: string): Promise<WalkSession[]> {
  const ref = collection(db, "users", userId, "walk_sessions");
  // No orderBy here on purpose: `in` + orderBy on another field would require
  // a composite index. The result set is small — sort client-side instead.
  const q = query(ref, where("status", "in", ["active", "paused"]));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => docToObj<WalkSession>(d))
    .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
}

/**
 * Mark a walk session as cancelled. Used for abandoned walks — they are kept
 * for audit/history but never counted in statistics (stats only aggregate
 * sessions with status "finished").
 */
export async function cancelWalkSession(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "walk_sessions", id);
  await updateDoc(docRef, { status: "cancelled", updated_at: now() });
}

export async function createWalkSession(userId: string): Promise<WalkSession> {
  const ref = collection(db, "users", userId, "walk_sessions");
  const startedAt = now();
  const newDoc = {
    user_id: userId,
    status: "active" as const,
    duration: 0,
    distance: 0,
    calories: 0,
    steps: 0,
    day: todayLocalDate(),
    started_at: startedAt,
    finished_at: null,
    path: [],
    created_at: startedAt,
    updated_at: startedAt,
  };
  const docRef = await addDoc(ref, newDoc);
  return { id: docRef.id, ...newDoc } as WalkSession;
}

export async function updateWalkSession(
  id: string,
  userId: string,
  data: Partial<WalkSession>,
): Promise<void> {
  const docRef = doc(db, "users", userId, "walk_sessions", id);
  const updates: any = { updated_at: now() };
  for (const key of [
    "status",
    "duration",
    "distance",
    "calories",
    "steps",
    "finished_at",
    "path",
  ] as const) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  await updateDoc(docRef, updates);
}

export async function appendWalkPoint(
  id: string,
  userId: string,
  point: { lat: number; lng: number; ts: number },
): Promise<void> {
  const docRef = doc(db, "users", userId, "walk_sessions", id);
  await updateDoc(docRef, { path: arrayUnion(point), updated_at: now() });
}

export async function deleteWalkSession(id: string, userId: string): Promise<void> {
  const docRef = doc(db, "users", userId, "walk_sessions", id);
  await deleteDoc(docRef);
}

export async function finishWalkSession(id: string, userId: string): Promise<WalkSession | null> {
  const docRef = doc(db, "users", userId, "walk_sessions", id);
  await updateDoc(docRef, { status: "finished", finished_at: now(), updated_at: now() });
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  const session = docToObj<WalkSession>(snap);
  if (session.distance > 0) {
    await addActivityLog(
      userId,
      "Finished Walk",
      `${(session.distance / 1000).toFixed(2)} km · ${session.duration || 0}s`,
    );
  }
  return session;
}

// ════════════════════════════════════════════════════════════
//  UNIFIED ACTIVITY TIMELINE (from real DB events)
// ════════════════════════════════════════════════════════════

export interface ActivityEntry {
  id: string;
  action: string;
  description: string;
  /** semantic type for icon/color selection */
  kind:
    | "workout"
    | "water"
    | "task"
    | "appointment"
    | "medication"
    | "walk"
    | "document"
    | "bill"
    | "other";
  created_at: string;
}

export function classifyAction(action: string): ActivityEntry["kind"] {
  const a = (action || "").toLowerCase();
  if (a.includes("workout") || a.includes("program")) return "workout";
  if (a.includes("water") || a.includes("hydrat") || a.includes("drank")) return "water";
  if (a.includes("task")) return "task";
  if (a.includes("appointment")) return "appointment";
  if (a.includes("medication") || a.includes("dose")) return "medication";
  if (a.includes("walk")) return "walk";
  if (a.includes("document")) return "document";
  if (a.includes("bill") || a.includes("paid")) return "bill";
  return "other";
}

export async function getActivityTimeline(userId: string, max = 30): Promise<ActivityEntry[]> {
  const ref = collection(db, "users", userId, "activity_logs");
  const q = query(ref, orderBy("created_at", "desc"), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data: any = d.data();
    let created_at = data.created_at;
    if (created_at instanceof Timestamp) created_at = created_at.toDate().toISOString();
    return {
      id: d.id,
      action: data.action || "Activity",
      description: data.description || "",
      kind: classifyAction(data.action || ""),
      created_at,
    } as ActivityEntry;
  });
}

// ════════════════════════════════════════════════════════════
//  PROFILE STATISTICS (computed from real data — no hardcoding)
// ════════════════════════════════════════════════════════════

export interface ProfileStats {
  totalWorkoutsCompleted: number;
  avgTaskCompletion: number; // percentage 0..100
  waterGoalStreak: number; // consecutive days
  totalWalkingDistanceMeters: number;
  totalAppointments: number;
  currentAchievementLevel: string;
  /** raw numbers for richer UI if needed */
  tasksCompleted: number;
  tasksTotal: number;
  walks: number;
}

const ACHIEVEMENT_LEVELS: { min: number; label: string }[] = [
  { min: 0, label: "Beginner" },
  { min: 10, label: "Rookie" },
  { min: 25, label: "Active" },
  { min: 50, label: "Pro" },
  { min: 100, label: "Elite" },
  { min: 200, label: "Legend" },
];

export function achievementLevel(score: number): string {
  let label = ACHIEVEMENT_LEVELS[0].label;
  for (const lvl of ACHIEVEMENT_LEVELS) {
    if (score >= lvl.min) label = lvl.label;
  }
  return label;
}

export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const [workouts, walks, todos, appointments, waterStreak] = await Promise.all([
    getWorkouts(userId),
    getWalkSessions(userId),
    getTodos(userId),
    getAppointments(userId),
    getWaterGoalStreak(userId),
  ]);

  const workoutsCompleted = workouts.filter((w) => w.status === "completed").length;
  const tasksCompleted = todos.filter((t) => t.completed).length;
  const tasksTotal = todos.length;
  const avgTaskCompletion = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;
  // Only count finished walks — matches the Walk service statistics
  const walksFinished = walks.filter((w) => w.status === "finished");
  const totalWalkingDistanceMeters = walksFinished.reduce(
    (sum, w) => sum + (typeof w.distance === "number" ? w.distance : 0),
    0,
  );
  const totalAppointments = appointments.length;

  // Composite score drives the achievement level
  const score =
    workoutsCompleted * 3 +
    walksFinished.length * 2 +
    waterStreak * 5 +
    Math.min(50, tasksCompleted);

  return {
    totalWorkoutsCompleted: workoutsCompleted,
    avgTaskCompletion,
    waterGoalStreak: waterStreak,
    totalWalkingDistanceMeters,
    totalAppointments,
    currentAchievementLevel: achievementLevel(score),
    tasksCompleted,
    tasksTotal,
    walks: walksFinished.length,
  };
}
