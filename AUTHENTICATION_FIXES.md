# Authentication Fixes

## Issue 1: Google Sign-In "No credentials available"

### Root Cause
The `android/app/google-services.json` file currently only contains a **Web OAuth client** (`client_type: 3`). For native Android Google Sign-In to work, you need an **Android OAuth client** (`client_type: 1`) registered with the SHA-1/SHA-256 fingerprints of your app's signing key.

### Fix Required (Firebase Console)

#### Step 1: Get Your SHA Fingerprints

**For Debug Key:**
```bash
cd android
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

**For Release Key (if using a custom keystore):**
```bash
keytool -list -v -keystore /path/to/your-release.keystore -alias your-alias
```

#### Step 2: Register Fingerprints in Firebase Console

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **life-hub-79641**
3. Go to **Project Settings** (gear icon)
4. Scroll to **Your apps** section
5. Find the Android app with package name: `com.lifehub.app`
6. Click **Add fingerprint**
7. Add both SHA-1 and SHA-256 fingerprints for:
   - Debug key
   - Release key (if applicable)

#### Step 3: Download Updated google-services.json

1. In the same Project Settings page
2. Click **google-services.json** download button
3. Replace `android/app/google-services.json` with the downloaded file

#### Step 4: Verify Google Sign-In is Enabled

1. Go to **Authentication** > **Sign-in method**
2. Ensure **Google** provider is enabled
3. Verify the **Web client ID** and **Web client secret** are populated

#### Step 5: Rebuild the APK

```bash
npm run apk:android
```

### Expected google-services.json Structure

The file should have two entries in `oauth_client`:

```json
{
  "oauth_client": [
    {
      "client_id": "474626172728-xxxx.apps.googleusercontent.com",
      "client_type": 1,
      "android_info": {
        "package_name": "com.lifehub.app",
        "certificate_hash": "YOUR_SHA1_FINGERPRINT_HERE"
      }
    },
    {
      "client_id": "474626172728-xxxx.apps.googleusercontent.com",
      "client_type": 3
    }
  ]
}
```

---

## Issue 2: Authentication State Initialization / Routing Flash

### Root Cause
The `OnboardingGate` component was returning early while `loading` was `true`, but the child routes (`<Outlet />`) were still being rendered. This caused a flash of protected content before the auth state was determined.

### Fix Applied

Updated `src/routes/__root.tsx` to:
1. Show a splash/loading screen while `authLoading` is `true`
2. Prevent rendering any child components until auth state is resolved
3. Only render protected routes after Firebase auth listener has fired

Updated `src/routes/auth.tsx` to:
1. Show splash while auth is loading
2. Only redirect to home after loading is complete
3. Prevent flash of auth page when user is already logged in

### Code Changes

**src/routes/__root.tsx:**
- Added `AuthLoadingSplash` component
- Modified `OnboardingGate` to return splash instead of `null` when loading
- Added comprehensive console logging for debugging

**src/routes/auth.tsx:**
- Added loading state check before rendering
- Added splash screen during auth initialization
- Updated redirect logic to only trigger after loading completes

**src/hooks/use-auth.tsx:**
- Added detailed console logging for native Google Sign-In
- Added helpful error messages for common failure scenarios

---

## Testing Checklist

- [ ] After rebuild, launch app
- [ ] Verify splash screen shows during auth initialization
- [ ] Verify no flash of Home page for unauthenticated users
- [ ] Verify no flash of Auth page for authenticated users
- [ ] Test Google Sign-In on Android device
- [ ] Check Logcat for any authentication errors
- [ ] Test sign-out and re-sign-in flow
