# LifeHub

A personal life-management app built with TanStack Start + Firebase:

- **Schedule & finance** — appointments, medications, bills, tasks, birthdays, documents
- **Fitness** — walking sessions with GPS tracking (offline SQLite), workout programs
- **Wellbeing** — daily azkar (Adhkar) with streak tracking, health reminders
- **AI assistant** — in-app assistant with a server-side OpenRouter proxy
- **Native Android** — packaged with Capacitor, includes background walk tracking and notifications

## Development

```sh
npm i
npm run dev
```

Environment configuration lives in `.env` (copy from `.env.example` — never
commit the real file):

| Variable               | Where used                                                                | Secret? |
| ---------------------- | ------------------------------------------------------------------------- | ------- |
| `VITE_FIREBASE_*`      | Client (Firebase config — public by design)                               | No      |
| `VITE_ASSISTANT_MODEL` | Client (model name for the assistant)                                     | No      |
| `ASSISTANT_API_KEY`    | **Server only** — OpenRouter key for the assistant proxy                  | **Yes** |
| `ASSISTANT_ENDPOINT`   | **Server only** — default `https://openrouter.ai/api/v1/chat/completions` | No      |

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
API key in git history (`.env`). The history has since been scrubbed with
`git filter-repo`, but the key must still be revoked at
https://openrouter.ai/settings/keys and replaced with a new one in `.env`.
`.env` is gitignored and untracked.

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

- **Google sign-in**: browsers use Firebase's redirect flow, which avoids
  popup credential failures in Android browsers. The Capacitor Android/iOS app
  uses the native `@capacitor-firebase/authentication` plugin instead; do not
  switch its WebView to the Firebase JS redirect flow. Register the Android
  app's SHA-1/SHA-256 fingerprints in Firebase and keep
  `google-services.json` current.
- Web content is served from `https://localhost` in the WebView; keep Firebase
  auth domain/reCAPTCHA settings compatible with that origin.
- **Android walk tracking** uses a foreground service (`WalkService`) with a
  local SQLite database; it requires the `POST_NOTIFICATIONS` runtime
  permission on Android 13+.

## Azkar (Adhkar)

Daily zikr is served from `azkar.json` (server- and client-side data) with a
per-day progress/streak tracker and optional local notifications scheduled by
`src/lib/notifications.ts`. Data is persisted per user in Firebase.

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

Built with [TanStack Start](https://tanstack.com/start), Firebase, and Capacitor — this code is yours.
