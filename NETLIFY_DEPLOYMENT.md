# Netlify Production Deployment Guide — Sangurur Digital Learner Register (SDLR)

**Institution:** Sangurur Comprehensive School  
**Application:** Sangurur Digital Learner Register (SDLR)  
**Frontend Stack:** React 19 + TypeScript + Vite 8  
**Backend Stack:** Express API hosted via Netlify Functions (`netlify/functions/api.ts`) + Firebase Authentication + Cloud Firestore

---

## 1. Prerequisites

Before connecting SDLR to Netlify, verify you have:

1. A **GitHub account** with push/admin access to your SDLR repository.
2. A **Netlify account** connected to your GitHub account.
3. Access to the **Firebase Console** for the production Firebase project (`ai-studio-applet-webapp-19cab`) and Firestore database (`ai-studio-remixsangururdig-8ba34e88-20b8-4da3-82c1-c3a1c99313d6`).
4. **Node.js 22** (configured automatically on Netlify via `netlify.toml`) if testing builds locally.

---

## 2. GitHub Repository Connection Instructions

1. Commit and push the prepared SDLR source code (including `netlify.toml`, `netlify/functions/api.ts`, `server/apiApp.ts`, and `.env.example` — **never** `.env` or downloaded service account `.json` files) to your GitHub repository.
2. Sign in to the **Netlify Dashboard** (`app.netlify.com`).
3. Click **Add new site** -> **Import an existing project**.
4. Choose **Deploy with GitHub**, authorize Netlify if prompted, and select your existing SDLR GitHub repository.
5. Select your production branch (e.g., `main`).

---

## 3. Netlify Build Settings

`netlify.toml` is already committed at the repository root and automatically configures Netlify with:

- **Base directory:** *(leave empty / repository root)*
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Functions directory:** `netlify/functions`
- **Functions bundler:** `esbuild`
- **Node.js version:** `22`

Netlify redirects configured in `netlify.toml`:
- `/api/*` -> `/.netlify/functions/api/:splat` (`status = 200`, `force = true`) so backend API calls reach the Netlify Function without being intercepted by the SPA fallback.
- `/*` -> `/index.html` (`status = 200`) for React SPA deep linking and browser refresh.

---

## 4. Required Environment Variables

In Netlify Dashboard go to **Site configuration** -> **Environment variables** -> **Add a variable**, and configure the following **before** triggering a fresh production deploy:

### A. Public Client Variables (`VITE_FIREBASE_*`) — Scope: **Frontend (Vite Builds)**
> Used by `src/services/firebase.ts` in the browser. Obtain exact values from **Firebase Console -> Project settings (`ai-studio-applet-webapp-19cab`) -> Your apps** (optional if matching the bundled `firebase-applet-config.json`, recommended to set explicitly in Netlify):

| Variable | Description / Value | Where It Belongs |
|---|---|---|
| `VITE_FIREBASE_API_KEY` | Firebase Web API key | Frontend (Netlify Scope: **Builds**) |
| `VITE_FIREBASE_AUTH_DOMAIN` | `ai-studio-applet-webapp-19cab.firebaseapp.com` | Frontend (Netlify Scope: **Builds**) |
| `VITE_FIREBASE_PROJECT_ID` | `ai-studio-applet-webapp-19cab` | Frontend (Netlify Scope: **Builds**) |
| `VITE_FIREBASE_STORAGE_BUCKET` | `ai-studio-applet-webapp-19cab.firebasestorage.app` | Frontend (Netlify Scope: **Builds**) |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `710469628945` | Frontend (Netlify Scope: **Builds**) |
| `VITE_FIREBASE_APP_ID` | Firebase Web App ID | Frontend (Netlify Scope: **Builds**) |
| `VITE_FIREBASE_DATABASE_ID` | `ai-studio-remixsangururdig-8ba34e88-20b8-4da3-82c1-c3a1c99313d6` | Frontend (Netlify Scope: **Builds**) |

### B. Secret Server-Side Variables — Scope: **Netlify Functions Only (Never Prefix with `VITE_`)**

| Variable | Description | Where It Belongs | Required? |
|---|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Complete single-line service account JSON from Firebase Console -> Project settings (`ai-studio-applet-webapp-19cab`) -> Service accounts -> Generate new private key | **Netlify Functions** (Secret) | **Yes (Required)** |
| `SESSION_SECRET` | Strong random 32+ character hex secret (`openssl rand -hex 32`) for HMAC-SHA256 teacher/learner session tokens across serverless invocations | **Netlify Functions** (Secret) | **Yes (Required)** |
| `DEFAULT_TEACHER_PASSWORD` | Initial password used when bootstrapping `teacherCredentials/teacher_default_staff` if it does not yet exist | **Netlify Functions** (Secret) | Recommended |
| `FIREBASE_PROJECT_ID` | Optional override for `ai-studio-applet-webapp-19cab` | **Netlify Functions** | Optional |
| `FIREBASE_DATABASE_ID` | Optional override for `ai-studio-remixsangururdig-8ba34e88-20b8-4da3-82c1-c3a1c99313d6` | **Netlify Functions** | Optional |
| `APP_URL` | Full HTTPS URL of your deployed Netlify site | **Netlify Functions** | Optional |

#### Formatting `FIREBASE_SERVICE_ACCOUNT_JSON` for Netlify
1. In **Firebase Console** -> select project **`ai-studio-applet-webapp-19cab`** -> **Project settings** -> **Service accounts** -> **Generate new private key** to download the `.json` file.
   - *Note:* If your project is still on a managed starter tier that restricts service account key creation in IAM, first claim/upgrade ownership of the project in Google Cloud Console (`https://console.cloud.google.com/welcome`) or use a Firebase project you own and update the project ID/config accordingly.
2. Compact the downloaded JSON onto a **single line** (preserve the `\n` escapes inside `"private_key"`, e.g. `jq -c . serviceAccountKey.json`), and paste the raw JSON object `{...}` directly as the value of `FIREBASE_SERVICE_ACCOUNT_JSON` in Netlify (do **not** wrap it in extra quotes).
3. Restrict the variable scope in Netlify to **Functions** (and **Never** prefix it with `VITE_`).

---

## 5. Firebase Authorized-Domain Configuration (CRITICAL)

Firebase Authentication **blocks Google Sign-In (`auth/unauthorized-domain`)** from any domain not explicitly whitelisted.

After Netlify assigns your site domain (and after adding any custom domain):

1. Open **Firebase Console** -> select project **`ai-studio-applet-webapp-19cab`**.
2. Go to **Authentication** -> **Settings** -> **Authorized domains**.
3. Click **Add domain** and add:
   - Your Netlify default subdomain (e.g. `<your-site-name>.netlify.app`)
   - Any Netlify branch/deploy-preview domains you test on, if applicable
   - Any custom school domain once configured

---

## 6. Production Firebase Setup Checklist

1. **Named Firestore Database:** Ensure the app connects to `ai-studio-remixsangururdig-8ba34e88-20b8-4da3-82c1-c3a1c99313d6` (already configured in `firebase-applet-config.json` and `VITE_FIREBASE_DATABASE_ID`).
2. **Firestore Security Rules (`firestore.rules`):** Ensure the latest hardened `firestore.rules` are deployed to Firebase (`firebase deploy --only firestore:rules` or via AI Studio deployment). `teacherCredentials` and `counters` are locked (`allow read, write: if false`) for client SDKs and served exclusively via Firebase Admin SDK.
3. **Firebase Storage (`storage.rules`):** If your deployment uses file/asset uploads in Firebase Storage (`ai-studio-applet-webapp-19cab.firebasestorage.app`), enable Storage in **Firebase Console -> Storage -> Get started** and deploy `storage.rules` (`firebase deploy --only storage`).
4. **Firebase Authentication Providers:** Confirm **Google** sign-in provider is enabled in Firebase Authentication -> Sign-in method.
5. **No Emulators Active:** Confirm no emulator environment variables or `connectFirestoreEmulator` / `connectAuthEmulator` calls exist (verified clean in SDLR source).
6. **Initial Admin Account:** Confirm `sangururschool10@gmail.com` or authorized staff Google accounts can sign in cleanly, and rotate default staff/learner passwords after onboarding.

---

## 7. Domain Configuration Instructions

To attach a custom school domain later in Netlify:

1. In Netlify Dashboard -> **Domain management** -> **Add a domain**.
2. Follow Netlify's DNS instructions (Netlify DNS nameservers or `CNAME`/`ALIAS` records at your domain registrar).
3. Wait for DNS propagation and let Netlify provision the free **Let's Encrypt HTTPS certificate** automatically.
4. Immediately add the custom domain to **Firebase Console -> Authentication -> Settings -> Authorized domains** (see Section 5).
5. Update `APP_URL` in Netlify Environment Variables to `https://<your-custom-domain>`.

---

## 8. Deployment Instructions

> **Important:** A **fresh deployment is required** after changing code or adding/updating Netlify environment variables (`FIREBASE_SERVICE_ACCOUNT_JSON`, `SESSION_SECRET`, `VITE_*`), because Netlify injects `VITE_*` variables at build time and snapshots function configuration per deploy.

1. Confirm all Environment Variables (Section 4) are saved in Netlify.
2. Push your updated code and trigger a fresh deploy in Netlify Dashboard -> **Deploys** -> **Trigger deploy** -> **Clear cache and deploy site**.
3. Monitor the build log until `vite build` outputs `dist/` and Netlify Functions bundles `netlify/functions/api.ts`.
4. Verify the live site immediately after deploy:
   - Visit `https://<your-site>/api/health` -> verify JSON returns `"status": "ok"`, `"adminSdkActive": true`, `"firestoreConfigured": true`, `"sessionSecretConfigured": true`, and `"projectId": "ai-studio-applet-webapp-19cab"`.
   - Test direct SPA reload on a sub-path (should return `200 OK`, not `404`).
   - Verify Sangurur Comprehensive School logo, Motto (`Think, Code, Change the World`), and classroom backgrounds load cleanly.
   - Test Staff Teacher login (Username/Password + Google Staff Sign-In after adding Authorized Domain).
   - Test Learner Digital ID login, mandatory password change flow, daily register submission, and PDF/XLSX export.

---

## 9. Troubleshooting Steps

- **`HTTP 503` on `/api/auth/teacher-login` with `MISSING_SERVICE_ACCOUNT_JSON` or `INVALID_SERVICE_ACCOUNT_JSON`:**
  - Check `/api/health` -> inspect `adminInitErrorCode` and `adminInitErrorMessage`.
  - Confirm `FIREBASE_SERVICE_ACCOUNT_JSON` is set in Netlify **Environment variables** with **Functions** scope, formatted as a valid single-line JSON object without extra outer quotes, and that you triggered a **fresh deploy** afterwards.
- **`auth/unauthorized-domain` during Google Sign-In:**
  - Add your exact `.netlify.app` or custom domain to Firebase Authentication -> Settings -> Authorized domains (Section 5).
- **API calls return HTML (`index.html`) or 404:**
  - Confirm `netlify.toml` has `/api/* -> /.netlify/functions/api/:splat` with `force = true` **above** the `/* -> /index.html` SPA rule, and check Netlify -> **Functions** logs for `api`.
- **Teacher/Learner sessions unexpectedly log out across requests:**
  - Ensure `SESSION_SECRET` is set to a fixed 32+ character secret in Netlify Environment Variables (do not leave blank).
- **Protected staff actions return `401 Staff authentication required`:**
  - Ensure the staff user refreshes their session / signs in again so `Authorization: Bearer <token>` is sent, and confirm `VITE_FIREBASE_API_KEY` matches project `ai-studio-applet-webapp-19cab`.
- **Missing database records or permission denied:**
  - Verify `VITE_FIREBASE_DATABASE_ID` matches `ai-studio-remixsangururdig-8ba34e88-20b8-4da3-82c1-c3a1c99313d6` and `firestore.rules` are deployed to Firebase.

---

## 10. Rollback Instructions

Netlify maintains atomic immutable snapshots of every previous deploy (both `dist/` static assets and `netlify/functions` bundles):

1. Open Netlify Dashboard -> your SDLR site -> **Deploys**.
2. Locate the last known healthy deploy in the deploy history list.
3. Click the deploy entry and select **Publish deploy**.
4. Netlify switches traffic back to that build and its matching Netlify Function snapshot instantaneously (typically under 10 seconds), without modifying Firestore database records.
