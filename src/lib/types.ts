export interface BaseEntity {
  id: string;
  created_at: string;
  updated_at?: string;
}

export interface User extends BaseEntity {
  email: string;
  full_name: string;
  avatar_url?: string | null;
  /** Date of birth as YYYY-MM-DD — required during onboarding, age is always derived */
  date_of_birth?: string | null;
  theme: "light" | "dark" | "system";
  language: string;
  timezone: string;
  email_verified: boolean;
  accent_color: string;
  compact_mode: boolean;
  animations_enabled: boolean;
  accessibility_mode: boolean;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  user_agent?: string | null;
  ip_address?: string | null;
  remember_me: boolean;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface Appointment {
  id: string;
  user_id: string;
  title: string;
  doctor_name: string;
  location?: string | null;
  appointment_date: string;
  start_time?: string | null;
  end_time?: string | null;
  priority: "high" | "medium" | "light";
  status: "upcoming" | "completed" | "cancelled";
  reminder: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Medication {
  id: string;
  user_id: string;
  name: string;
  dosage: string;
  frequency: string;
  scheduled_time: string;
  scheduled_date?: string | null;
  priority: "high" | "medium" | "light";
  taken: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface MedicationLog {
  id: string;
  user_id: string;
  medication_id: string;
  taken_at: string;
  status: "taken" | "skipped" | "late";
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Bill {
  id: string;
  user_id: string;
  title: string;
  amount: number;
  category: string;
  due_date: string;
  status: "unpaid" | "paid" | "overdue" | "pending";
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  bill_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  reference?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentItem {
  id: string;
  user_id: string;
  name: string;
  category: string;
  file_url: string;
  file_size?: string | null;
  file_type?: string | null;
  preview_url?: string | null;
  summary?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Todo {
  id: string;
  user_id: string;
  title: string;
  category: string;
  priority: "high" | "medium" | "light";
  due_date?: string | null;
  completed: boolean;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  action: string;
  description?: string | null;
  created_at: string;
}

export interface AiConversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface AiMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface GlobalSearchResult {
  id: string;
  type:
    "appointment" | "bill" | "medication" | "document" | "todo" | "ai_conversation" | "birthday";
  title: string;
  subtitle: string;
  url: string;
  date?: string;
}

export interface Birthday {
  id: string;
  user_id: string;
  full_name: string;
  phone_number?: string | null;
  birthday_date: string;
  created_at: string;
  updated_at: string;
}

// ─── Fitness: Workout Programs ───
export type WorkoutType = "Gym" | "Calisthenics" | "Cardio";

export type Difficulty = "Easy" | "Medium" | "Hard";

// Days stored as short lowercase keys for stable ordering (0 = Sunday ... 6 = Saturday)
export type DayKey = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";

export interface ProgramDayPlan {
  day: DayKey;
  /** Free-form label for the session this day, e.g. "Push", "Pull", "Rest" */
  focus: string;
}

export interface WorkoutProgram {
  id: string;
  user_id: string;
  name: string;
  /** Default workout type associated with the program */
  workout_type: WorkoutType | "";
  /** Optional list of weekday day -> focus mapping (the weekly plan) */
  weekly_plan?: ProgramDayPlan[];
  /** Structured cardio schedule: day keys checked as cardio training days */
  training_days?: DayKey[];
  /** Whether this program is the user's active program (drives the Workouts page) */
  is_active?: boolean;
  color?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workout {
  id: string;
  user_id: string;
  /** Required reference to a WorkoutProgram */
  program_id: string;
  program_name?: string | null;
  workout_type: WorkoutType | "";
  session_name: string;
  /** Duration in minutes */
  duration: number;
  /** ISO date-time string for when the session is scheduled */
  scheduled_at: string;
  /** Optional date-only string for fast filtering */
  scheduled_date: string;
  difficulty: Difficulty | "";
  notes?: string | null;
  status: "scheduled" | "completed" | "skipped";
  created_at: string;
  updated_at: string;
}

// ─── Walking Service ───
export type WalkStatus = "active" | "paused" | "finished" | "cancelled";

export interface WalkSession {
  id: string;
  user_id: string;
  status: WalkStatus;
  /** total elapsed active time in seconds (excluding pauses) */
  duration: number;
  /** distance in meters */
  distance: number;
  /** estimated calories burned */
  calories: number;
  /** number of steps (device-derived when available) */
  steps: number;
  /** date this walk belongs to (YYYY-MM-DD, local) */
  day: string;
  started_at: string;
  finished_at?: string | null;
  /** array of {lat,lng,ts} points captured via GPS */
  path?: { lat: number; lng: number; ts: number }[] | null;
  created_at: string;
  updated_at: string;
}

// ─── Hydration (daily water intake) ───
export interface WaterLog {
  id: string;
  user_id: string;
  /** local date YYYY-MM-DD */
  day: string;
  /** number of glasses consumed today (1 glass = 250ml) */
  glasses: number;
  /** daily goal in glasses */
  goal: number;
  /** whether the goal was reached this day (for streak math) */
  goal_reached: boolean;
  created_at: string;
  updated_at: string;
}
