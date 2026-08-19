/**
 * Server-side proxy for the LifeHub Assistant's external LLM.
 *
 * Why a proxy? The OpenRouter API key must NEVER reach the browser.
 * The browser can't be trusted with a paid API credential — anyone could
 * extract it from the bundle and use it. So the client calls THIS route
 * (same origin) with its Firebase ID token, and the server:
 *
 *   1. Verifies the Firebase ID token (Identity Toolkit lookup API) →
 *      rejects anonymous callers with 401.
 *   2. Confirms the token's uid matches the claimed userId (403 otherwise).
 *   3. Forwards the prompt to OpenRouter with the server-only API key.
 *
 * If the model is unavailable the client falls back to the built-in engine,
 * so this route failing is never fatal for the user.
 *
 * Server-only env (never bundled to the client):
 *   ASSISTANT_API_KEY   — OpenRouter key (required)
 *   ASSISTANT_ENDPOINT  — defaults to OpenRouter chat completions
 */
import { createFileRoute } from "@tanstack/react-router";

const FIREBASE_API_KEY = import.meta.env.VITE_FIREBASE_API_KEY ?? "";
const FIREBASE_PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "";
const DEFAULT_MODEL = "google/gemma-4-31b-it:free";

// Only models in this allowlist may be requested through the proxy — the
// client must never be able to name an expensive paid model billed to the
// server's OpenRouter key. Override with ASSISTANT_ALLOWED_MODELS
// (comma-separated) in the server environment.
function allowedModels(): Set<string> {
  const raw = serverEnv("ASSISTANT_ALLOWED_MODELS");
  const list = (raw || DEFAULT_MODEL)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return new Set(list.length > 0 ? list : [DEFAULT_MODEL]);
}

// Simple in-memory sliding-window rate limiter keyed by user uid, plus a
// global cap that protects the upstream key even under a distributed burst.
// In-memory is fine for the single-node node-server preset; a multi-instance
// deployment would want a shared store (e.g. Redis) instead.
const PER_USER_LIMIT = { max: 30, windowMs: 60_000 };
const GLOBAL_LIMIT = { max: 240, windowMs: 60_000 };
const buckets = new Map<string, { count: number; resetAt: number }>();

function takeRateLimit(key: string, limit: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > limit.max) {
    // Evict stale buckets so the map can't grow unboundedly.
    if (buckets.size > 10_000) {
      const cutoff = now;
      buckets.forEach((b, k) => {
        if (b.resetAt <= cutoff) buckets.delete(k);
      });
    }
    return false;
  }
  return true;
}

// Max total serialized size of the messages array forwarded upstream —
// a huge prompt/conversation costs real money on the paid key.
const MAX_MESSAGES_SIZE = 64 * 1024; // 64 KB
const MAX_MESSAGE_COUNT = 200;
const MAX_MESSAGE_CONTENT = 32 * 1024; // 32 KB per message
// Upstream log lines must never echo prompt/context content — strip the body
// and keep only the status code.
const UPSTREAM_LOG_PREFIX = "[assistant] upstream error";

// The native (Capacitor) APK is served from a WebView origin (http://localhost
// on Android) and points at this route via VITE_ASSISTANT_ENDPOINT. CORS must
// be open here so the phone can call the deployed backend. The route still
// verifies the Firebase ID token before doing anything, so `*` is safe — no
// cookies or credentials are involved.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

/** Reads a server-only env var: runtime binding first, build-time define second. */
function serverEnv(name: string): string | undefined {
  const runtime = (process.env ?? {}) as Record<string, string | undefined>;
  const buildTime = import.meta.env as Record<string, unknown>;
  const value = runtime[name] ?? buildTime[name];
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Verifies a Firebase ID token using the Identity Toolkit lookup endpoint.
 * Returns the token's uid, or null if invalid/expired/foreign-project.
 */
async function verifyIdToken(idToken: string): Promise<string | null> {
  if (!FIREBASE_API_KEY) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: { localId?: string; projectId?: string }[];
    };
    const user = data.users?.[0];
    if (!user?.localId) return null;
    // A token minted for another Firebase project is rejected outright.
    if (user.projectId && FIREBASE_PROJECT_ID && user.projectId !== FIREBASE_PROJECT_ID) {
      return null;
    }
    return user.localId;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/assistant")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        // 0) Server must have a key configured.
        const apiKey = serverEnv("ASSISTANT_API_KEY");
        if (!apiKey) {
          return json(
            { error: "Assistant model is not configured on the server." },
            { status: 503 },
          );
        }

        // 1) Authenticate: require a Firebase ID token.
        const authHeader = request.headers.get("authorization") ?? "";
        const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!idToken) {
          return json({ error: "Unauthorized." }, { status: 401 });
        }
        const uid = await verifyIdToken(idToken);
        if (!uid) {
          return json({ error: "Unauthorized." }, { status: 401 });
        }

        // 2) Parse body, then confirm the claimed userId matches the token.
        let body: { userId?: string; model?: string; messages?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "Invalid request body." }, { status: 400 });
        }
        if (body.userId && body.userId !== uid) {
          return json({ error: "Forbidden." }, { status: 403 });
        }
        if (!Array.isArray(body.messages)) {
          return json({ error: "Invalid request body." }, { status: 400 });
        }

        // 2b) Rate limiting: per-user and global windows. Done after auth so
        // anonymous attackers can't exhaust the bucket space.
        if (!takeRateLimit(uid, PER_USER_LIMIT)) {
          return json({ error: "Too many requests. Try again shortly." }, { status: 429 });
        }
        if (!takeRateLimit("__global__", GLOBAL_LIMIT)) {
          return json({ error: "Service is busy. Try again shortly." }, { status: 429 });
        }

        // 2c) Sanitize the conversation before it leaves the server:
        // only allowlist roles, cap per-message size and total payload size so
        // nobody can run up the bill with a megabyte of prompt, and never
        // forward injected fields (temperature, tools, ...) from the client.
        if (body.messages.length > MAX_MESSAGE_COUNT) {
          return json({ error: "Conversation too long." }, { status: 400 });
        }
        const messages: { role: "user" | "assistant" | "system"; content: string }[] = [];
        for (const raw of body.messages) {
          if (typeof raw !== "object" || raw === null) continue;
          const role = (raw as { role?: unknown }).role;
          if (role !== "user" && role !== "assistant" && role !== "system") continue;
          const rawContent = (raw as { content?: unknown }).content;
          if (typeof rawContent !== "string") continue;
          const content = rawContent.slice(0, MAX_MESSAGE_CONTENT);
          messages.push({ role: role as "user" | "assistant" | "system", content });
        }
        if (messages.length === 0) {
          return json({ error: "Invalid request body." }, { status: 400 });
        }
        if (JSON.stringify(messages).length > MAX_MESSAGES_SIZE) {
          return json({ error: "Conversation too long." }, { status: 400 });
        }

        // 3) Forward to the external model with the server-only key.
        const endpoint =
          serverEnv("ASSISTANT_ENDPOINT") ?? "https://openrouter.ai/api/v1/chat/completions";
        const requested = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;
        // Client can only pick a model from the allowlist; anything else falls
        // back to the default free model.
        const model = allowedModels().has(requested) ? requested : DEFAULT_MODEL;

        const upstream = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          // Propagate the client's abort signal so stopping generation also
          // cancels the upstream model request instead of paying for tokens
          // the user will never see.
          signal: request.signal,
          body: JSON.stringify({ model, messages, stream: true }),
        });
        if (!upstream.ok) {
          // Log the status code only — the upstream error body can contain
          // echoed prompt content, which must never reach the logs.
          console.error(`${UPSTREAM_LOG_PREFIX} ${upstream.status}`);
          return json({ error: "Assistant model request failed." }, { status: 502 });
        }

        // Pipe the upstream SSE stream straight through to the client. The
        // model's tokens are relayed as they are produced, so the chat UI can
        // render the reply incrementally instead of waiting for the full
        // completion. No buffering, no parsing here — the client decodes the
        // `data:` frames.
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
