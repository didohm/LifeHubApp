/**
 * LifeHub Assistant — the in-app AI companion, orchestration layer.
 *
 * Architecture (NOT a database, NOT a stale-context chatbot):
 *
 *   User prompt
 *      │
 *      ▼
 *   Intent Detection        ← decides WHICH tools to call
 *      │
 *      ▼
 *   Live tool calls         ← queryUserData() / getUserContext()
 *      │                        (fresh Firestore reads at request time)
 *      ▼
 *   Reply generation        ← built-in engine OR external LLM
 *
 * The assistant never works from a snapshot captured at page load. Every
 * personal-data question triggers fresh retrieval, so data added one minute
 * ago is already visible. Only the data the intent actually needs is fetched
 * and (optionally) sent to the model — never the whole account.
 *
 * A configurable external model endpoint can be plugged in via
 * VITE_ASSISTANT_ENDPOINT without changing any UI.
 */

import {
  queryUserData,
  getUserContext,
  formatDataForPrompt,
  formatUserContextForPrompt,
  AI_TOOLS,
  todayKey,
  type DataModule,
  type DataFilters,
  type QueryResult,
  type UserContextSnapshot,
} from "./ai-tools";
import type {
  Todo,
  Appointment,
  Medication,
  Bill,
  DocumentItem,
  Birthday,
  Workout,
  WalkSession,
  WaterLog,
  ActivityLog,
  User,
} from "./types";
import type { ProfileStats } from "./api";

export interface AssistantOptions {
  prompt: string;
  /** The logged-in user — every retrieval is scoped to this account only. */
  userId: string;
  conversationHistory?: { role: "user" | "assistant" | "system"; content: string }[];
  signal?: AbortSignal;
}

export const MEDICAL_DISCLAIMER =
  "This assistant offers general information only — it does not diagnose conditions, prescribe medication, or replace advice from a qualified healthcare professional. For medical concerns, please consult your doctor.";

// ─────────────────────────────────────────────────────────────────────────
//  System prompt — the orchestrator contract
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_INTRO = `You are the official AI Assistant of this application — NOT a generic AI chatbot.

You are an ORCHESTRATOR, not a database. You never hold or remember user data; every answer about the user's personal life is built from data freshly retrieved from the application database via tools, at request time.

## TOOL RULES
- Never answer a personal question without first retrieving the required data.
- If a tool exists for the requested information, always call it.
- Never rely on previously injected context when fresh data can be retrieved.
- Application APIs are the source of truth. The model is responsible only for reasoning and formatting the response; the backend is responsible for storing and retrieving user data.

## AVAILABLE TOOLS
${AI_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join("\n")}

## CRITICAL RULES
- Every user has their own account. Never mix data between users.
- Never invent information. Never generate fake appointments, medications, tasks, goals, habits, expenses, records, or statistics.
- If the data does not exist, say clearly: "I couldn't find any data related to this in your account."
- Never answer using examples as if they were real data.
- Only the data blocks supplied in this conversation may be referenced — nothing from any other user, and nothing assumed.

You give clear, encouraging, well-structured answers, and you keep replies concise and skimmable with short sections and bullet points.`;

// ─────────────────────────────────────────────────────────────────────────
//  Intent detection — the router that decides which tools to call
// ─────────────────────────────────────────────────────────────────────────

type IntentKind =
  | "overview"
  | "tasks"
  | "medications"
  | "appointments"
  | "bills"
  | "documents"
  | "birthdays"
  | "workouts"
  | "walks"
  | "water"
  | "activity"
  | "profile"
  | "help"
  | "general";

interface IntentPlan {
  kind: IntentKind;
  modules: DataModule[];
  filters: DataFilters;
}

function detectIntent(prompt: string): IntentPlan {
  const q = prompt.toLowerCase().trim();
  const has = (re: RegExp) => re.test(q);

  // Documents / OCR / summarising a specific record
  if (
    has(
      /\b(ocr|scan|scanne[dr]|extract|parse this|read (?:my )?(?:document|prescription|lab|report))\b/,
    ) ||
    (has(/\b(document|prescription|lab report|blood test|results?)\b/) &&
      has(/\b(summar|explain|read|understand|what does|parse)\b/))
  ) {
    return { kind: "documents", modules: ["documents"], filters: { limit: 5 } };
  }

  // Medications (check before overview: "what meds do I have today" → meds)
  if (
    has(
      /\b(med|meds|medication|pill|dose|dosage|vitamin|supplement|prescription|when do i take|interact)\b/,
    )
  ) {
    return { kind: "medications", modules: ["medications"], filters: { limit: 50 } };
  }

  // Appointments / doctor visits
  if (
    has(
      /\b(appointment|doctor|clinic|visit|checkup|consult|prepare for|what to ask (?:my )?doctor|next visit)\b/,
    )
  ) {
    return { kind: "appointments", modules: ["appointments"], filters: { limit: 20 } };
  }

  // Bills / finance
  if (has(/\b(bill|pay|payment|money|budget|due|expense|afford|insurance|premium|owe|spend)\b/)) {
    return { kind: "bills", modules: ["bills"], filters: { limit: 50 } };
  }

  // Tasks / to-dos / goals (goals are tracked as tasks with progress)
  if (has(/\b(task|to-do|todo|goal|prioriti|remind me|list)\b/)) {
    return { kind: "tasks", modules: ["tasks"], filters: { limit: 50 } };
  }

  // Workouts / fitness
  if (has(/\b(workout|gym|exercise|training|session|program|muscle|cardio|calisthenic)\b/)) {
    return { kind: "workouts", modules: ["workouts"], filters: { limit: 20 } };
  }

  // Walking
  if (has(/\b(walk|walking|steps|km (?:walked|today))\b/)) {
    return { kind: "walks", modules: ["walks"], filters: { limit: 10 } };
  }

  // Hydration
  if (has(/\b(water|hydrat|drink|glass|glasses)\b/)) {
    return { kind: "water", modules: ["water"], filters: {} };
  }

  // Birthdays
  if (has(/\b(birthday|anniversary)\b/)) {
    return { kind: "birthdays", modules: ["birthdays"], filters: { upcoming: true, limit: 10 } };
  }

  // Profile / progress stats
  if (
    has(
      /\b(profile|achievement|level|stats?|progress|streak|how (?:am|have) i (?:doing|been)|accomplish)\b/,
    )
  ) {
    return { kind: "profile", modules: ["profile"], filters: {} };
  }

  // Recent activity / history
  if (has(/\b(recent|history|what have i done|activity log|timeline|this week)\b/)) {
    return { kind: "activity", modules: ["activity"], filters: { limit: 15 } };
  }

  // General advice / wellness tips — general knowledge, NO personal data
  if (
    has(
      /\b(tip|advice|recommend|suggest|wellness|healthy (?:habit|lifestyle)|how (?:can|should) i (?:improve|stay|get|eat|sleep))\b/,
    )
  ) {
    return { kind: "general", modules: [], filters: {} };
  }

  // Day / life overview — the getUserContext() power tool
  if (
    has(
      /\b(today|day at a glance|overview|summary of my|summarize my|summarise my|summarize all my|summarise all my|my day|my week|plan my day|what do i have|what should i do|what do i need to do|records|my health)\b/,
    )
  ) {
    return { kind: "overview", modules: ["overview"], filters: {} };
  }

  // Greetings / help
  if (has(/\b(hi|hello|hey|help|what can you do|who are you|what do you)\b/) || q.length < 3) {
    return { kind: "help", modules: [], filters: {} };
  }

  // Everything else — general knowledge, answered WITHOUT personal data
  return { kind: "general", modules: [], filters: {} };
}

// ─────────────────────────────────────────────────────────────────────────
//  Live retrieval — always fresh, always scoped to userId
// ─────────────────────────────────────────────────────────────────────────

interface FetchedData {
  plan: IntentPlan;
  results: QueryResult[];
  overview: UserContextSnapshot | null;
}

async function retrieveForPlan(userId: string, plan: IntentPlan): Promise<FetchedData> {
  if (plan.modules.length === 0) return { plan, results: [], overview: null };

  const overviewIdx = plan.modules.indexOf("overview");
  if (overviewIdx !== -1) {
    const overview = await getUserContext(userId);
    return { plan, results: [], overview };
  }

  const results = await Promise.all(
    plan.modules.map((module) => queryUserData(userId, module, plan.filters)),
  );
  return { plan, results, overview: null };
}

function serializeFetchedData(data: FetchedData): string {
  if (data.overview) return formatUserContextForPrompt(data.overview);
  return data.results.map((r) => formatDataForPrompt(r)).join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────
//  generateAssistantReply() — detect → retrieve live → generate
//  Always returns a helpful string, never throws.
// ─────────────────────────────────────────────────────────────────────────
export async function generateAssistantReply(options: AssistantOptions): Promise<string> {
  const { prompt, userId, conversationHistory, signal } = options;

  // 1) Orchestrate: decide which tools this question needs
  const plan = detectIntent(prompt);

  // 2) Retrieve FRESH data at request time (never a stale page-load snapshot)
  const data = await retrieveForPlan(userId, plan);

  // 3) Optional external model — gets ONLY the fetched slice, never the whole account
  const endpoint = import.meta.env.VITE_ASSISTANT_ENDPOINT as string | undefined;
  const model = (import.meta.env.VITE_ASSISTANT_MODEL as string | undefined) || "default";

  if (endpoint) {
    try {
      const dataBlock = serializeFetchedData(data);
      const userContent = [
        prompt,
        dataBlock
          ? `\n\nFRESH DATA — retrieved from the user's own account via tools just now. This is the ONLY data you may reference:\n${dataBlock}`
          : plan.kind === "help" || plan.kind === "general"
            ? "\n\nNo account data was retrieved (not needed for this kind of question). Do not invent any user data."
            : "\n\nNo account data could be retrieved for this request. If the question is about the user's personal data, answer exactly: \"I couldn't find any data related to this in your account.\"",
      ].join("");

      const messages = [
        { role: "system", content: `${SYSTEM_INTRO}\n\n${MEDICAL_DISCLAIMER}` },
        ...(conversationHistory || []).map((m) => ({
          role:
            m.role === "system"
              ? ("system" as const)
              : m.role === "assistant"
                ? ("assistant" as const)
                : ("user" as const),
          content: m.content,
        })),
        { role: "user", content: userContent },
      ];

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model, messages, stream: false }),
        signal,
      });

      if (res.ok) {
        const resData = await res.json();
        const reply = resData?.choices?.[0]?.message?.content || resData?.content;
        if (typeof reply === "string" && reply.trim()) return reply.trim();
      }
    } catch (err) {
      // Fall through to the built-in engine.
      console.warn("Assistant external model unavailable, using built-in engine:", err);
    }
  }

  // 4) Built-in engine: answers built ONLY from the freshly retrieved data
  return buildBuiltInReply(prompt, data);
}

// ─────────────────────────────────────────────────────────────────────────
//  Built-in reply engine — typed data in, honest answers out
// ─────────────────────────────────────────────────────────────────────────

const NO_DATA_PHRASE = "I couldn't find any data related to this in your account.";

function buildBuiltInReply(prompt: string, data: FetchedData): string {
  const { kind } = data.plan;
  switch (kind) {
    case "help":
      return replyHelp();
    case "overview":
      return replyOverview(data.overview);
    case "tasks":
      return replyTasks(
        prompt,
        data.results.find((r) => r.module === "tasks")?.items as Todo[] | undefined,
      );
    case "medications":
      return replyMedications(
        data.results.find((r) => r.module === "medications")?.items as Medication[] | undefined,
      );
    case "appointments":
      return replyAppointments(
        data.results.find((r) => r.module === "appointments")?.items as Appointment[] | undefined,
      );
    case "bills":
      return replyBills(
        data.results.find((r) => r.module === "bills")?.items as Bill[] | undefined,
      );
    case "documents":
      return replyDocuments(
        prompt,
        data.results.find((r) => r.module === "documents")?.items as DocumentItem[] | undefined,
      );
    case "birthdays":
      return replyBirthdays(
        data.results.find((r) => r.module === "birthdays")?.items as Birthday[] | undefined,
      );
    case "workouts":
      return replyWorkouts(
        data.results.find((r) => r.module === "workouts")?.items as Workout[] | undefined,
      );
    case "walks":
      return replyWalks(
        data.results.find((r) => r.module === "walks")?.items as WalkSession[] | undefined,
      );
    case "water":
      return replyWater(
        data.results.find((r) => r.module === "water")?.items as WaterLog[] | undefined,
        data.results.find((r) => r.module === "water")?.extra?.today as
          { glasses: number; goal: number; goal_reached: boolean } | undefined,
      );
    case "activity":
      return replyActivity(
        data.results.find((r) => r.module === "activity")?.items as ActivityLog[] | undefined,
      );
    case "profile":
      return replyProfile(
        data.results.find((r) => r.module === "profile")?.items as User[] | undefined,
        data.results.find((r) => r.module === "profile")?.extra?.stats as ProfileStats | undefined,
      );
    default:
      return replyGeneral(prompt);
  }
}

function replyHelp(): string {
  const items = [
    "💊 **Medications** — explain your schedule, dose times, and adherence",
    "🗓️ **Appointments** — review upcoming visits and prepare questions",
    "💳 **Bills** — see what's due and plan payments",
    "✅ **Tasks** — prioritise your day and clear your list",
    "🏋️ **Workouts & Walks** — today's sessions, distance, and steps",
    "💧 **Hydration** — glasses vs your daily goal",
    "📄 **Documents** — summarise a prescription or lab report you uploaded",
    '☀️ **Day overview** — ask "What should I do today?" for a live snapshot',
  ];
  return [
    "Hi! I'm your LifeHub Assistant 👋",
    "",
    "I answer from your real account data — fetched live every time you ask.",
    "",
    "Here's how I can help right now:",
    ...items.map((i) => `- ${i}`),
    "",
    "Ask me anything, or tap one of the quick actions above.",
    "",
    `_${MEDICAL_DISCLAIMER}_`,
  ].join("\n");
}

function replyOverview(snapshot: UserContextSnapshot | null): string {
  if (!snapshot) return [NO_DATA_PHRASE, "", `_${MEDICAL_DISCLAIMER}_`].join("\n");

  const t = snapshot.today;
  const hasAnything =
    t.tasks.length ||
    t.appointments.length ||
    t.medications.length ||
    t.workouts.length ||
    t.walks.length ||
    t.water ||
    t.bills.length ||
    snapshot.upcoming.appointments.length ||
    snapshot.upcoming.bills.length ||
    snapshot.upcoming.birthdays.length ||
    snapshot.recentActivity.length;

  const lines: string[] = [`☀️ **Your day at a glance** — ${todayKey()}`, ""];

  if (!hasAnything) {
    lines.push(NO_DATA_PHRASE);
    lines.push("");
    lines.push(
      "Once you add tasks, appointments, medications, or bills, I'll turn them into a live daily plan.",
    );
    lines.push("");
    lines.push(`_${MEDICAL_DISCLAIMER}_`);
    return lines.join("\n");
  }

  if (t.tasks.length) {
    const open = t.tasks.filter((x) => !x.completed);
    lines.push(`**Tasks today** ${open.length ? `(${open.length} open)` : "(all done ✅)"}`);
    for (const x of open.slice(0, 5)) lines.push(`- ${x.title} — ${x.priority} priority`);
  }
  if (t.appointments.length) {
    lines.push("**Appointments today**");
    for (const a of t.appointments)
      lines.push(
        `- ${a.title} with ${a.doctor_name}${a.start_time ? ` at ${a.start_time}` : ""}${a.location ? ` @ ${a.location}` : ""}`,
      );
  }
  const pendingMeds = t.medications.filter((m) => !m.taken);
  if (pendingMeds.length) {
    lines.push(`**Medications still to take (${pendingMeds.length})**`);
    for (const m of pendingMeds) lines.push(`- ${m.name} (${m.dosage}) at ${m.scheduled_time}`);
  }
  if (t.workouts.length) {
    lines.push("**Workouts today**");
    for (const w of t.workouts) lines.push(`- ${w.session_name} — ${w.duration} min (${w.status})`);
  }
  if (t.walks.length) {
    const total = t.walks.reduce((s, w) => s + (w.distance || 0), 0);
    lines.push(
      `- 🚶 Walked **${(total / 1000).toFixed(2)} km** today (${t.walks.length} session${t.walks.length === 1 ? "" : "s"})`,
    );
  }
  if (t.water) {
    lines.push(
      `- 💧 Water: **${t.water.glasses}/${t.water.goal}** glasses${t.water.goal_reached ? " — goal reached ✅" : ""}`,
    );
  }
  if (t.bills.length) {
    lines.push("**Bills due today**");
    for (const b of t.bills) lines.push(`- ${b.title} — $${Number(b.amount).toFixed(2)}`);
  }
  if (snapshot.upcoming.appointments.length) {
    const next = snapshot.upcoming.appointments[0];
    lines.push(
      `- 🗓️ Next visit: **${next.title}** with ${next.doctor_name} on ${next.appointment_date}${next.start_time ? ` at ${next.start_time}` : ""}`,
    );
  }
  if (snapshot.upcoming.bills.length) {
    const total = snapshot.upcoming.bills.reduce((s, b) => s + Number(b.amount), 0);
    lines.push(
      `- 💳 Bills ahead: **${snapshot.upcoming.bills.length}** totalling **$${total.toFixed(2)}** (soonest: ${snapshot.upcoming.bills[0].title}, ${snapshot.upcoming.bills[0].due_date})`,
    );
  }
  if (snapshot.upcoming.birthdays.length) {
    lines.push(
      `- 🎂 Birthdays soon: ${snapshot.upcoming.birthdays.map((b) => b.full_name).join(", ")}`,
    );
  }

  lines.push("");
  const nextTask = snapshot.outstanding.tasks[0];
  const suggestion = pendingMeds.length
    ? `Take **${pendingMeds[0].name}** at ${pendingMeds[0].scheduled_time} to stay on schedule.`
    : nextTask
      ? `Start with **${nextTask.title}** — your highest-priority open task.`
      : t.appointments.length
        ? `Head to **${t.appointments[0].title}** — it's on today's calendar.`
        : "You're all caught up. 🎉";
  lines.push(`**Suggested first step:** ${suggestion}`);
  lines.push("");
  lines.push(`_${MEDICAL_DISCLAIMER}_`);
  return lines.join("\n");
}

function replyTasks(prompt: string, tasks: Todo[] | undefined): string {
  const items = tasks || [];
  const today = /\btoday\b/.test(prompt.toLowerCase());
  if (items.length === 0) {
    return [
      "✅ **Your tasks**",
      "",
      NO_DATA_PHRASE,
      "",
      "Add your tasks on the **Tasks** tab and I'll help you prioritise from your real data.",
    ].join("\n");
  }
  const open = items.filter((t) => !t.completed);
  const lines = [
    "✅ **Your tasks**",
    "",
    ...items.map(
      (t) =>
        `- ${t.completed ? "~~" + t.title + "~~ ✅" : `**${t.title}** — ${t.progress}% (${t.priority})${t.due_date ? `, due ${t.due_date}` : ""}`}`,
    ),
    "",
  ];
  if (open.length) {
    const next = [...open].sort((a, b) => rank(b.priority) - rank(a.priority))[0];
    lines.push(
      `Start with **${next.title}** — it's your highest-priority open item${today ? " today" : ""}.`,
    );
  } else {
    lines.push("Everything's checked off — beautifully done. 🎉");
  }
  return lines.join("\n");
}

function replyMedications(meds: Medication[] | undefined): string {
  const items = meds || [];
  if (items.length === 0) {
    return [
      "💊 **Your medication schedule**",
      "",
      NO_DATA_PHRASE,
      "",
      "Add your medications on the **Medications** tab and I'll explain your schedule, dose times, and adherence.",
      "",
      `_${MEDICAL_DISCLAIMER}_`,
    ].join("\n");
  }
  const pending = items.filter((m) => !m.taken);
  const lines = [
    "💊 **Your medication schedule**",
    "",
    "Here's what you're currently tracking:",
    ...items.map(
      (m) =>
        `- **${m.name}** — ${m.dosage}, ${m.frequency} at ${m.scheduled_time} (${m.taken ? "✅ taken" : "⏳ pending"})${m.notes ? ` — _${m.notes}_` : ""}`,
    ),
    "",
  ];
  if (pending.length) {
    lines.push(
      `**Still to take today:** ${pending.map((m) => m.name).join(", ")} (${pending.length}).`,
    );
    lines.push("Try to take each one at its scheduled time for the best effect.");
  } else {
    lines.push("Great work — all your doses are logged for today. 🎉");
  }
  lines.push("");
  lines.push(`_${MEDICAL_DISCLAIMER}_`);
  return lines.join("\n");
}

function replyAppointments(apps: Appointment[] | undefined): string {
  const items = apps || [];
  const upcoming = items.find((a) => a.status === "upcoming") || items[0];
  if (!upcoming) {
    return [
      "🗓️ **Appointments**",
      "",
      NO_DATA_PHRASE,
      "",
      "Add your appointments on the **Appointments** tab and I'll help you prepare a list of questions and reminders.",
      "",
      `_${MEDICAL_DISCLAIMER}_`,
    ].join("\n");
  }
  return [
    "🗓️ **Your next appointment**",
    "",
    `**${upcoming.title}** with ${upcoming.doctor_name}${upcoming.location ? ` at ${upcoming.location}` : ""} on ${upcoming.appointment_date}${upcoming.start_time ? ` at ${upcoming.start_time}` : ""}.`,
    "",
    "**Before you go:**",
    "- Write down your top 2-3 symptoms or questions",
    "- Bring a list of your current medications (I've got them above if you ask)",
    "- Pack any relevant documents from your Vault",
    "- Note how long each symptom has lasted",
    "",
    `_${MEDICAL_DISCLAIMER}_`,
  ].join("\n");
}

function replyBills(bills: Bill[] | undefined): string {
  const items = bills || [];
  if (items.length === 0) {
    return [
      "💳 **Bills & payments**",
      "",
      NO_DATA_PHRASE,
      "",
      "Add your bills on the **Bills** tab and I'll help you see what's due and plan payments.",
    ].join("\n");
  }
  const unpaid = items.filter((b) => b.status !== "paid");
  const lines = [
    "💳 **Your bills**",
    "",
    ...items.map(
      (b) =>
        `- **${b.title}** — $${Number(b.amount).toFixed(2)} (${b.status}, due ${b.due_date}, ${b.category})`,
    ),
    "",
  ];
  if (unpaid.length) {
    const total = unpaid.reduce((s, b) => s + Number(b.amount), 0);
    lines.push(
      `You still owe **$${total.toFixed(2)}** across ${unpaid.length} bills. Focus on the earliest due date first to avoid late fees.`,
    );
  } else {
    lines.push("All clear — every bill is paid. Time for a small reward. ☕");
  }
  return lines.join("\n");
}

function replyDocuments(prompt: string, docs: DocumentItem[] | undefined): string {
  const items = docs || [];
  if (items.length === 0) {
    return [
      "📄 **Document summary**",
      "",
      NO_DATA_PHRASE,
      "",
      "Upload a document in the **Document Vault** first, then ask me about it and I'll use its real contents.",
      "",
      `_${MEDICAL_DISCLAIMER}_`,
    ].join("\n");
  }

  // Match the document the user is asking about (by name in their prompt), else the newest.
  const q = prompt.toLowerCase();
  const target =
    items.find((d) => q.includes(d.name.toLowerCase())) || items.find((d) => d.summary) || items[0];

  if (!target.summary) {
    return [
      "📄 **Document summary**",
      "",
      `I found **${target.name}** (${target.category}) in your Document Vault, but it has no readable content or summary stored, so I can't summarise it without inventing details.`,
      "",
      "Add a summary to the document (or re-upload it) in the **Document Vault** and I'll work from its real contents.",
      "",
      `_${MEDICAL_DISCLAIMER}_`,
    ].join("\n");
  }

  return [
    "📄 **Document summary**",
    "",
    `**${target.name}** (${target.category})`,
    "",
    `**What it says:** ${target.summary}`,
    "",
    "> Tip: keep the original in your Vault and ask me follow-up questions about it anytime.",
    "",
    `_${MEDICAL_DISCLAIMER}_`,
  ].join("\n");
}

function replyBirthdays(birthdays: Birthday[] | undefined): string {
  const items = birthdays || [];
  if (items.length === 0) {
    return [
      "🎂 **Birthdays**",
      "",
      NO_DATA_PHRASE,
      "",
      "Save birthdays on the **Birthdays** tab and I'll remind you who's coming up.",
    ].join("\n");
  }
  return [
    "🎂 **Upcoming birthdays**",
    "",
    ...items.map(
      (b) =>
        `- **${b.full_name}** — ${b.birthday_date}${b.phone_number ? ` (${b.phone_number})` : ""}`,
    ),
    "",
    "Want a reminder when one is near? Just ask.",
  ].join("\n");
}

function replyWorkouts(workouts: Workout[] | undefined): string {
  const items = workouts || [];
  if (items.length === 0) {
    return [
      "🏋️ **Workouts**",
      "",
      NO_DATA_PHRASE,
      "",
      "Schedule a workout on the **Workouts** tab and I'll help you plan around it.",
    ].join("\n");
  }
  const lines = [
    "🏋️ **Your workouts**",
    "",
    ...items.map(
      (w) =>
        `- **${w.session_name}** (${w.workout_type || "Workout"}, ${w.duration} min) — ${w.status} on ${w.scheduled_date}${w.program_name ? ` · ${w.program_name}` : ""}`,
    ),
  ];
  const scheduled = items.filter((w) => w.status === "scheduled");
  if (scheduled.length) {
    lines.push("");
    lines.push(`Next up: **${scheduled[0].session_name}** on ${scheduled[0].scheduled_date}.`);
  }
  return lines.join("\n");
}

function replyWalks(walks: WalkSession[] | undefined): string {
  const items = walks || [];
  if (items.length === 0) {
    return [
      "🚶 **Walking**",
      "",
      NO_DATA_PHRASE,
      "",
      "Finish a walk from the **Walk** tab and I'll report your real distance, steps, and calories.",
    ].join("\n");
  }
  const totalDistance = items.reduce((s, w) => s + (w.distance || 0), 0);
  const totalSteps = items.reduce((s, w) => s + (w.steps || 0), 0);
  const totalCal = items.reduce((s, w) => s + (w.calories || 0), 0);
  return [
    "🚶 **Your walks**",
    "",
    ...items.map(
      (w) =>
        `- ${new Date(w.created_at).toLocaleDateString()} — **${(w.distance / 1000).toFixed(2)} km**, ${w.steps} steps, ${w.calories} kcal`,
    ),
    "",
    `**Totals (shown):** ${(totalDistance / 1000).toFixed(2)} km · ${totalSteps} steps · ${totalCal} kcal`,
  ].join("\n");
}

function replyWater(
  logs: WaterLog[] | undefined,
  today: { glasses: number; goal: number; goal_reached: boolean } | undefined,
): string {
  const items = logs || [];
  const todayInfo = today || items.find((l) => l.day === todayKey());
  if (!todayInfo) {
    return [
      "💧 **Hydration**",
      "",
      NO_DATA_PHRASE,
      "",
      "Log a glass of water on the home screen and I'll track your progress against your goal.",
    ].join("\n");
  }
  const lines = [
    "💧 **Hydration**",
    "",
    `Today: **${todayInfo.glasses}/${todayInfo.goal}** glasses${todayInfo.goal_reached ? " — goal reached ✅" : ""}`,
    "",
  ];
  const recent = items.filter((l) => l.day !== todayKey()).slice(0, 5);
  if (recent.length) {
    lines.push("Recent days:");
    for (const l of recent)
      lines.push(`- ${l.day}: ${l.glasses}/${l.goal}${l.goal_reached ? " ✅" : ""}`);
  }
  return lines.join("\n");
}

function replyActivity(logs: ActivityLog[] | undefined): string {
  const items = logs || [];
  if (items.length === 0) {
    return [
      "🕓 **Recent activity**",
      "",
      NO_DATA_PHRASE,
      "",
      "Your activity timeline will appear here as you use the app.",
    ].join("\n");
  }
  return [
    "🕓 **Your recent activity**",
    "",
    ...items.map(
      (a) =>
        `- **${a.action}** — ${a.description || ""} (${new Date(a.created_at).toLocaleString()})`,
    ),
  ].join("\n");
}

function replyProfile(profiles: User[] | undefined, stats: ProfileStats | undefined): string {
  const profile = profiles?.[0];
  if (!profile && !stats) {
    return ["👤 **Profile & progress**", "", NO_DATA_PHRASE].join("\n");
  }
  const lines: string[] = [];
  if (profile) {
    lines.push(
      `👤 **${profile.full_name}**${profile.date_of_birth ? ` — born ${profile.date_of_birth}` : ""}`,
    );
    lines.push("");
  }
  if (stats) {
    lines.push("**Your real statistics:**");
    lines.push(
      `- ✅ Tasks: **${stats.tasksCompleted}/${stats.tasksTotal}** completed (${stats.avgTaskCompletion}%)`,
    );
    lines.push(`- 🏋️ Workouts completed: **${stats.totalWorkoutsCompleted}**`);
    lines.push(
      `- 💧 Water streak: **${stats.waterGoalStreak} day${stats.waterGoalStreak === 1 ? "" : "s"}**`,
    );
    lines.push(
      `- 🚶 Distance walked: **${(stats.totalWalkingDistanceMeters / 1000).toFixed(1)} km**`,
    );
    lines.push(`- 🗓️ Appointments tracked: **${stats.totalAppointments}**`);
    lines.push(`- 🏆 Achievement level: **${stats.currentAchievementLevel}**`);
  }
  return lines.join("\n");
}

function replyGeneral(prompt: string): string {
  return [
    `Here's some general guidance on _"${prompt.trim()}"_:`,
    "",
    "This is general information only — it is **not** from your account data, and I won't pretend otherwise.",
    "",
    "If you'd like answers based on your own real data, ask me about your medications, appointments, bills, tasks, workouts, water, or documents — I'll fetch them live.",
    "",
    `_${MEDICAL_DISCLAIMER}_`,
  ].join("\n");
}

function rank(p: string) {
  return p === "high" ? 3 : p === "medium" ? 2 : 1;
}
