import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { NotificationService } from "./notifications";

/**
 * Native runtime permission bridge (implemented in
 * android/app/src/main/java/com/lifehub/app/NativePermissionsPlugin.java).
 * Requests Android OS permissions for location, physical activity, media
 * files and audio — outside the WebView — and returns the real grant state.
 */
interface NativePermissionsPlugin {
  check(alias: PermissionAlias): Promise<{ granted: boolean }>;
  request(alias: PermissionAlias): Promise<{ granted: boolean; permanentlyDenied: boolean }>;
  /** Payload of the OS notification that cold-started the app (if any). */
  getLaunchNotification(): Promise<{ extra: Record<string, any> | null }>;
}

type PermissionAlias = "location" | "activity" | "health" | "media" | "audio";

const NativePermissions = registerPlugin<NativePermissionsPlugin>("NativePermissions");
export { NativePermissions };

export type PermissionName =
  "notification" | "location" | "activity" | "health" | "media" | "audio";
type PermissionState = "granted" | "denied" | "unknown";

/** Fired on `window` whenever a native permission transitions into granted. */
export const PERMISSIONS_CHANGED_EVENT = "lifehub:permissions-changed";

const PERMISSION_STATES_KEY = "lifehub_permission_states";

/**
 * In-flight native request per permission. While an OS permission dialog is
 * open, every other caller awaits the SAME promise instead of racing a second
 * dialog — a concurrent `requestPermissions()` resolves as denied, which made
 * `requestAllPermissions()` permanently cache `denied` and silently disable
 * every reminder type.
 */
const inFlight = new Map<PermissionName, Promise<boolean>>();

function loadStates(): Partial<Record<PermissionName, PermissionState>> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PERMISSION_STATES_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<PermissionName, PermissionState>>) : {};
  } catch {
    return {};
  }
}

function saveState(name: PermissionName, state: PermissionState) {
  if (typeof window === "undefined") return;
  try {
    const states = loadStates();
    states[name] = state;
    localStorage.setItem(PERMISSION_STATES_KEY, JSON.stringify(states));
  } catch {
    /* storage unavailable — ignore */
  }
}

function getState(name: PermissionName): PermissionState {
  return loadStates()[name] || "unknown";
}

function isNative() {
  return Capacitor.isNativePlatform();
}

/**
 * Runtime permission manager for Android.
 *
 * - Stores permission answers locally (`lifehub_permission_states`) so we
 *   never re-ask for the same permission on every launch.
 * - Denied permissions are only asked again when the related feature is
 *   actually used (`ensurePermission`).
 * - No in-app informational banners are shown — permission prompts only
 *   appear as the OS-level dialog when a feature truly needs access.
 */
export class PermissionManager {
  private static startupRequested = false;

  /** Requests all not-yet-answered permissions. Fire-and-forget (non-blocking). */
  static requestAllPermissions(): void {
    if (this.startupRequested) return;
    this.startupRequested = true;
    if (!isNative()) return;

    // Sequential, spaced-out requests so Android permission dialogs never stack.
    void (async () => {
      await this.requestUnknown("notification");
      await sleep(500);
      await this.requestUnknown("location");
      await sleep(500);
      await this.requestUnknown("activity");
      await sleep(500);
      await this.requestUnknown("media");
      await sleep(500);
      await this.requestUnknown("audio");
    })();
  }

  /** Requests a permission only if the user has never answered it before. */
  private static async requestUnknown(name: PermissionName): Promise<boolean> {
    const state = getState(name);
    if (state === "granted") return true;
    // Denied before → ask again only when the feature is used.
    if (state === "denied") return false;
    return this.request(name);
  }

  /** Shows the OS permission prompt directly — no in-app banner. */
  static async request(name: PermissionName): Promise<boolean> {
    if (name === "notification" && !isNative()) {
      return this.requestWebNotification();
    }
    if (!isNative()) return true; // web: no OS-level prompts for these

    const pending = inFlight.get(name);
    if (pending) return pending;

    const task = this.performRequest(name);
    inFlight.set(name, task);
    try {
      return await task;
    } finally {
      inFlight.delete(name);
    }
  }

  private static async performRequest(name: PermissionName): Promise<boolean> {
    try {
      let granted = false;
      if (name === "notification") {
        await NotificationService.initChannels();
        const check = await LocalNotifications.checkPermissions();
        granted = check.display === "granted";
        if (!granted) {
          const status = await LocalNotifications.requestPermissions();
          granted = status.display === "granted";
        }
        if (granted) {
          await NotificationService.ensureExactAlarmPermission();
        }
      } else {
        const result = await NativePermissions.request(name as PermissionAlias);
        granted = result.granted;
      }
      // Only the OS result writes a state, so a "denied" here is a real denial
      // (single-flight removed the race that produced false denials).
      const previous = getState(name);
      saveState(name, granted ? "granted" : "denied");
      // A denied → granted transition means reminders can be armed now — let
      // the data context know so it re-runs the full resync immediately.
      if (granted && previous !== "granted" && name === "notification") {
        this.dispatchPermissionsChanged();
      }
      return granted;
    } catch (err) {
      console.warn(`Failed to request ${name} permission:`, err);
      return false;
    }
  }

  /**
   * Feature-time check: re-asks a previously denied permission (via the OS
   * dialog only) when the user actually opens the related feature.
   */
  static async ensurePermission(name: PermissionName): Promise<boolean> {
    if (await this.check(name)) return true;
    return this.request(name);
  }

  /** Cheap OS-level check without showing any dialog. */
  static async check(name: PermissionName): Promise<boolean> {
    if (!isNative()) return true;
    try {
      if (name === "notification") {
        const status = await LocalNotifications.checkPermissions();
        return status.display === "granted";
      }
      const result = await NativePermissions.check(name as PermissionAlias);
      return result.granted;
    } catch {
      return false;
    }
  }

  /** Local answer cache (what the user last chose in this app). */
  static wasDenied(name: PermissionName): boolean {
    return getState(name) === "denied";
  }

  private static dispatchPermissionsChanged() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(PERMISSIONS_CHANGED_EVENT));
  }

  private static async requestWebNotification(): Promise<boolean> {
    if (!("Notification" in window)) return true;
    try {
      const state = await Notification.requestPermission();
      saveState("notification", state === "granted" ? "granted" : "denied");
      return state === "granted";
    } catch {
      return false;
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
