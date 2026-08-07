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

### Deploying (Node.js)

The production build targets a plain Node.js server (nitro `node-server`
preset — no Cloudflare). Build with `npm run build`, then run
`node .output/server/index.mjs` (Node 20+) or wrap it with a process manager /
container of your choice.

The production server reads the OpenRouter key from **runtime environment
variables**, so set `ASSISTANT_API_KEY` (and optionally `ASSISTANT_ENDPOINT`)
in your host's environment. Without it the external model is skipped and the
built-in engine is used.

**Security note:** a previous version of this repo contained a live OpenRouter
API key in git history (`.env`). That key must be revoked at
https://openrouter.ai/settings/keys. `.env` is now gitignored and untracked.

## Mobile (Android APK via Capacitor)

The app can be packaged as a native Android app with Capacitor. The mobile
build is **static and client-rendered** (`vite.config.capacitor.ts`): Nitro is
skipped, TanStack Start's SPA mode prerenders the shell to `index.html`, and
Capacitor serves it from the device's WebView. Output goes to
`dist-capacitor/client` (the `webDir` in `capacitor.config.ts`).

### Prerequisites (one-time)

- **Android Studio** (bundles the JDK 17+ and Android SDK required by the
  `android/` Gradle project). The machine must be able to run Gradle — verify
  with `java -version`.

### Building the APK

```sh
npm run build:capacitor   # static web build → dist-capacitor/client
npm run sync:android      # build + copy assets into android/
npm run apk:android       # build + sync + assembleDebug APK
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.
You can also open the `android/` folder in Android Studio and press Run.

### Assistant endpoint in the APK

The APK has no server, so the same-origin proxy (`/api/assistant`) does not
exist on device. Point the app at a separately deployed backend (e.g. Render)
by setting at build time:

```sh
VITE_ASSISTANT_ENDPOINT=https://your-assistant-host.example/api/assistant npm run build:capacitor
```

The endpoint receives the same `Bearer <Firebase ID token>` header and body,
so the deployed backend can keep the exact verification logic from
`src/routes/api/assistant.ts` (or deploy that file itself via TanStack Start's
node-server preset — the proxy code is portable). The API key never ships in
the APK; without the endpoint the assistant uses the built-in engine.

### Known caveats

- **Google sign-in**: `signInWithPopup` works in browsers but may fail inside
  the Android WebView (`auth/popup-blocked`, since `window.open` is not
  supported there). If on-device testing shows this, switch to the native
  `@capacitor-firebase/authentication` plugin (recommended) or a
  redirect-based flow. Validate on a real device or emulator.
- Web content is served from `https://localhost` in the WebView; keep Firebase
auth domain/reCAPTCHA settings compatible with that origin.

## Scripts

```sh
npm run dev              # local development
npm run build            # production build (nitro → Node.js server)
npm run build:capacitor  # static build for the native app
npm run sync:android     # build + copy assets into android/
npm run apk:android      # assemble the debug APK (needs JDK + Android SDK)
npm run lint             # eslint
npm run format           # prettier
```

## License / Ownership

Built with [Lovable](https://lovable.dev) — this code is yours.
