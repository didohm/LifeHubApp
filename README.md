# LifeHub

A personal life-management app (appointments, medications, bills, tasks, fitness,
health tracking, and an AI assistant) built with TanStack Start + Firebase.

## Development

```sh
npm i
npm run dev
```

Environment configuration lives in `.env` (copy from `.env.example` — never
commit the real file):

| Variable | Where used | Secret? |
|---|---|---|
| `VITE_FIREBASE_*` | Client (Firebase config — public by design) | No |
| `VITE_ASSISTANT_MODEL` | Client (model name for the assistant) | No |
| `ASSISTANT_API_KEY` | **Server only** — OpenRouter key for the assistant proxy | **Yes** |
| `ASSISTANT_ENDPOINT` | **Server only** — default `https://openrouter.ai/api/v1/chat/completions` | No |

### How the assistant stays secure

The AI assistant never calls OpenRouter from the browser. The client sends its
Firebase ID token to the same-origin proxy `POST /api/assistant`
(`src/routes/api/assistant.ts`), which:

1. Verifies the Firebase ID token (Identity Toolkit lookup) — anonymous calls get 401.
2. Forwards the prompt to OpenRouter with the server-only key.
3. Returns the reply; if anything fails, the client gracefully falls back to the
   built-in offline engine, so the assistant always answers.

### Deploying (Cloudflare Workers)

The production build reads the OpenRouter key from **runtime environment
variables**, so set `ASSISTANT_API_KEY` (and optionally `ASSISTANT_ENDPOINT`)
as a **Cloudflare Worker secret/variable** (dashboard → Settings → Variables and
Secrets, or `wrangler secret put ASSISTANT_API_KEY`). Without it the external
model is skipped and the built-in engine is used.

**Security note:** a previous version of this repo contained a live OpenRouter
API key in git history (`.env`). That key must be revoked at
https://openrouter.ai/settings/keys. `.env` is now gitignored and untracked.

## Scripts

```sh
npm run dev       # local development
npm run build     # production build (nitro → Cloudflare worker)
npm run lint      # eslint
npm run format    # prettier
```

## License / Ownership

Built with [Lovable](https://lovable.dev) — this code is yours.
