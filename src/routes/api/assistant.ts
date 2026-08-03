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
      POST: async ({ request }) => {
        // 0) Server must have a key configured.
        const apiKey = serverEnv("ASSISTANT_API_KEY");
        if (!apiKey) {
          return Response.json(
            { error: "Assistant model is not configured on the server." },
            { status: 503 },
          );
        }

        // 1) Authenticate: require a Firebase ID token.
        const authHeader = request.headers.get("authorization") ?? "";
        const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        if (!idToken) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }
        const uid = await verifyIdToken(idToken);
        if (!uid) {
          return Response.json({ error: "Unauthorized." }, { status: 401 });
        }

        // 2) Parse body, then confirm the claimed userId matches the token.
        let body: { userId?: string; model?: string; messages?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }
        if (body.userId && body.userId !== uid) {
          return Response.json({ error: "Forbidden." }, { status: 403 });
        }
        if (!Array.isArray(body.messages)) {
          return Response.json({ error: "Invalid request body." }, { status: 400 });
        }

        // 3) Forward to the external model with the server-only key.
        const endpoint =
          serverEnv("ASSISTANT_ENDPOINT") ?? "https://openrouter.ai/api/v1/chat/completions";
        const model = typeof body.model === "string" && body.model ? body.model : DEFAULT_MODEL;

        const upstream = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, messages: body.messages, stream: false }),
        });
        if (!upstream.ok) {
          const detail = await upstream.text().catch(() => "");
          console.error(`[assistant] upstream error ${upstream.status}: ${detail.slice(0, 500)}`);
          return Response.json({ error: "Assistant model request failed." }, { status: 502 });
        }
        const data = (await upstream.json()) as {
          choices?: { message?: { content?: string } }[];
          content?: string;
        };
        const reply = data.choices?.[0]?.message?.content ?? data.content ?? "";
        if (!reply.trim()) {
          return Response.json({ error: "Assistant returned an empty reply." }, { status: 502 });
        }
        return Response.json({ content: reply });
      },
    },
  },
});
