import express, { Request, Response, NextFunction, Express } from 'express';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  initializeApp as initializeAdminApp,
  getApps as getAdminApps,
  cert,
  App as AdminApp,
} from 'firebase-admin/app';
import {
  getFirestore as getAdminFirestore,
  Firestore as AdminFirestore,
} from 'firebase-admin/firestore';
import { getAuth as getAdminAuth, Auth as AdminAuth } from 'firebase-admin/auth';

dotenv.config();

interface FirebaseWebConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

function getConfigFileCandidates(): string[] {
  const candidates = [
    path.resolve(process.cwd(), 'firebase-applet-config.json'),
    path.resolve(process.cwd(), '..', 'firebase-applet-config.json'),
  ];
  // In CommonJS builds (e.g. Netlify esbuild), __dirname is defined without needing import.meta.url
  if (typeof __dirname === 'string' && __dirname.length > 0) {
    candidates.push(
      path.resolve(__dirname, 'firebase-applet-config.json'),
      path.resolve(__dirname, '..', 'firebase-applet-config.json'),
      path.resolve(__dirname, '..', '..', 'firebase-applet-config.json')
    );
  }
  return Array.from(new Set(candidates));
}

function loadFirebaseConfig(): FirebaseWebConfig {
  const candidates = getConfigFileCandidates();

  let fileConfig: Partial<FirebaseWebConfig> = {};
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fileConfig = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        break;
      }
    } catch {
      // Try next path candidate
    }
  }

  return {
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      fileConfig.projectId ||
      '',
    appId:
      process.env.FIREBASE_APP_ID ||
      process.env.VITE_FIREBASE_APP_ID ||
      fileConfig.appId ||
      '',
    apiKey:
      process.env.FIREBASE_API_KEY ||
      process.env.VITE_FIREBASE_API_KEY ||
      fileConfig.apiKey ||
      '',
    authDomain:
      process.env.FIREBASE_AUTH_DOMAIN ||
      process.env.VITE_FIREBASE_AUTH_DOMAIN ||
      fileConfig.authDomain ||
      '',
    firestoreDatabaseId:
      process.env.FIREBASE_DATABASE_ID ||
      process.env.VITE_FIREBASE_DATABASE_ID ||
      fileConfig.firestoreDatabaseId ||
      '(default)',
    storageBucket:
      process.env.FIREBASE_STORAGE_BUCKET ||
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      fileConfig.storageBucket ||
      '',
    messagingSenderId:
      process.env.FIREBASE_MESSAGING_SENDER_ID ||
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
      fileConfig.messagingSenderId ||
      '',
  };
}

const firebaseConfig = loadFirebaseConfig();

// Session token signing secret (HMAC-SHA256)
// In Netlify production, set SESSION_SECRET (32+ chars) in Site Configuration -> Environment variables.
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.NETLIFY === 'true';
const ENV_SESSION_SECRET = process.env.SESSION_SECRET?.trim() || '';
const SESSION_SECRET_CONFIGURED = ENV_SESSION_SECRET.length >= 16;

const EPHEMERAL_FALLBACK_SECRET = (() => {
  if (IS_PRODUCTION) {
    console.warn(
      'SDLR Security Alert: SESSION_SECRET env var is missing or under 16 characters in production. Using Firestore-persisted fallback secret when available; configure SESSION_SECRET in Netlify Environment variables.'
    );
    return crypto.randomBytes(32).toString('hex');
  }
  const devSecretFile = path.join(os.tmpdir(), '.sdlr_dev_session_secret');
  try {
    if (fs.existsSync(devSecretFile)) {
      const existing = fs.readFileSync(devSecretFile, 'utf-8').trim();
      if (existing.length >= 32) return existing;
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(devSecretFile, generated, { mode: 0o600 });
    return generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
})();

let cachedFirestoreSessionSecret: string | null = null;
let sessionSecretInitPromise: Promise<string> | null = null;

async function getSessionSecret(db: ServerDbAdapter | null): Promise<string> {
  if (SESSION_SECRET_CONFIGURED) {
    return ENV_SESSION_SECRET;
  }
  if (cachedFirestoreSessionSecret) {
    return cachedFirestoreSessionSecret;
  }
  if (!db || db.mode !== 'admin') {
    return EPHEMERAL_FALLBACK_SECRET;
  }
  if (sessionSecretInitPromise) {
    return sessionSecretInitPromise;
  }

  sessionSecretInitPromise = (async () => {
    try {
      // Fast read-first path avoids Firestore transaction write contention under concurrent classroom logins
      const existingSnap = await db.getDoc('counters', '_sdlr_session_secret');
      const preExisting = String(existingSnap.data()?.secret || '').trim();
      if (existingSnap.exists && preExisting.length >= 32) {
        cachedFirestoreSessionSecret = preExisting;
        return preExisting;
      }

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const secret = await db.runTransaction(async (tx) => {
            const snap = await tx.get('counters', '_sdlr_session_secret');
            const existing = String(snap.data()?.secret || '').trim();
            if (snap.exists && existing.length >= 32) {
              return existing;
            }
            const generated = crypto.randomBytes(32).toString('hex');
            tx.set('counters', '_sdlr_session_secret', {
              secret: generated,
              updatedAt: new Date().toISOString(),
            });
            return generated;
          });
          cachedFirestoreSessionSecret = secret;
          return secret;
        } catch (txErr) {
          if (attempt === 2) throw txErr;
          await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
        }
      }
      return EPHEMERAL_FALLBACK_SECRET;
    } catch (err) {
      console.warn('Could not load/persist shared session secret in Firestore:', err);
      return EPHEMERAL_FALLBACK_SECRET;
    } finally {
      sessionSecretInitPromise = null;
    }
  })();

  return sessionSecretInitPromise;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const BOOTSTRAP_ADMIN_EMAILS = new Set([
  'sangururschool10@gmail.com',
  'sangururschool2@gmail.com',
]);
const DEFAULT_INITIAL_PASSWORD = '123456789';
const DEFAULT_TEACHER_UID = 'teacher_default_staff';
const DEFAULT_TEACHER_USERNAME = 'Teacher';

interface SessionPayload {
  sub: string;
  role: 'learner';
  digitalId: string;
  jti?: string;
  iat: number;
  exp: number;
}

interface TeacherSessionPayload {
  sub: string;
  role: 'teacher' | 'admin' | 'super_admin';
  username: string;
  jti?: string;
  iat: number;
  exp: number;
}

interface AuthenticatedLearnerRequest extends Request {
  authLearner?: any;
  reissuedLearnerSession?: { token: string; expiresAt: number };
}

interface AuthenticatedTeacherRequest extends Request {
  authTeacher?: {
    uid: string;
    fullName: string;
    role: 'teacher' | 'admin' | 'super_admin';
    email?: string;
  };
}

// Unified Admin / Client Firestore Adapter
interface DocSnapshotLike {
  exists: boolean;
  id: string;
  data: () => Record<string, any> | undefined;
}

interface ServerDbAdapter {
  mode: 'admin';
  getDoc: (colName: string, docId: string) => Promise<DocSnapshotLike>;
  setDoc: (colName: string, docId: string, data: Record<string, any>) => Promise<void>;
  updateDoc: (colName: string, docId: string, data: Record<string, any>) => Promise<void>;
  deleteDoc: (colName: string, docId: string) => Promise<void>;
  getCollectionDocs: (colName: string) => Promise<Array<{ id: string; data: () => Record<string, any> }>>;
  queryWhere: (
    colName: string,
    filters: Array<[string, '==' | 'array-contains', any]>
  ) => Promise<Array<{ id: string; data: () => Record<string, any> }>>;
  runTransaction: <T>(
    fn: (tx: {
      get: (colName: string, docId: string) => Promise<DocSnapshotLike>;
      set: (colName: string, docId: string, data: Record<string, any>) => void;
    }) => Promise<T>
  ) => Promise<T>;
}

type AdminInitErrorCode =
  | 'NONE'
  | 'MISSING_SERVICE_ACCOUNT_JSON'
  | 'INVALID_SERVICE_ACCOUNT_JSON'
  | 'INVALID_SERVICE_ACCOUNT_CREDENTIALS'
  | 'FIREBASE_ADMIN_INIT_FAILED';

interface AdminInitState {
  ok: boolean;
  errorCode: AdminInitErrorCode;
  errorMessage: string | null;
}

let cachedAdminApp: AdminApp | null = null;
let cachedAdminDb: AdminFirestore | null = null;
let cachedAdminAuth: AdminAuth | null = null;
let lastAdminInitState: AdminInitState = {
  ok: false,
  errorCode: 'MISSING_SERVICE_ACCOUNT_JSON',
  errorMessage: 'Firebase Admin SDK has not been initialized yet.',
};

function parseServiceAccountJson(rawEnv: string): {
  parsed?: Record<string, unknown>;
  errorCode?: AdminInitErrorCode;
  errorMessage?: string;
} {
  let candidate = rawEnv.trim();

  // Strip accidental single wrapping quotes pasted into hosting UI
  if (
    (candidate.startsWith("'") && candidate.endsWith("'")) ||
    (candidate.startsWith('"') && candidate.endsWith('"') && !candidate.startsWith('"{'))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(candidate);
    // Support double-encoded JSON strings (e.g. "\"{...}\"")
    if (typeof parsedUnknown === 'string') {
      parsedUnknown = JSON.parse(parsedUnknown);
    }
  } catch {
    return {
      errorCode: 'INVALID_SERVICE_ACCOUNT_JSON',
      errorMessage:
        'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the complete raw Firebase service account JSON without extra outer quotes or truncation.',
    };
  }

  if (!parsedUnknown || typeof parsedUnknown !== 'object' || Array.isArray(parsedUnknown)) {
    return {
      errorCode: 'INVALID_SERVICE_ACCOUNT_CREDENTIALS',
      errorMessage:
        'FIREBASE_SERVICE_ACCOUNT_JSON must be a JSON object downloaded from Firebase Console -> Project settings -> Service accounts.',
    };
  }

  return { parsed: parsedUnknown as Record<string, unknown> };
}

function initAdminServices(): {
  adminDb: AdminFirestore | null;
  adminAuth: AdminAuth | null;
  initState: AdminInitState;
} {
  if (cachedAdminDb && cachedAdminAuth) {
    return {
      adminDb: cachedAdminDb,
      adminAuth: cachedAdminAuth,
      initState: { ok: true, errorCode: 'NONE', errorMessage: null },
    };
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!rawJson) {
    lastAdminInitState = {
      ok: false,
      errorCode: 'MISSING_SERVICE_ACCOUNT_JSON',
      errorMessage:
        'Server-side Firebase Admin SDK is not configured: FIREBASE_SERVICE_ACCOUNT_JSON is missing from Netlify environment variables.',
    };
    return { adminDb: null, adminAuth: null, initState: lastAdminInitState };
  }

  const parseResult = parseServiceAccountJson(rawJson);
  if (!parseResult.parsed) {
    lastAdminInitState = {
      ok: false,
      errorCode: parseResult.errorCode || 'INVALID_SERVICE_ACCOUNT_JSON',
      errorMessage:
        parseResult.errorMessage || 'FIREBASE_SERVICE_ACCOUNT_JSON could not be parsed.',
    };
    console.error(`[SDLR Admin SDK] ${lastAdminInitState.errorCode}: ${lastAdminInitState.errorMessage}`);
    return { adminDb: null, adminAuth: null, initState: lastAdminInitState };
  }

  const parsed = parseResult.parsed;
  if (parsed.type && parsed.type !== 'service_account') {
    lastAdminInitState = {
      ok: false,
      errorCode: 'INVALID_SERVICE_ACCOUNT_CREDENTIALS',
      errorMessage:
        'FIREBASE_SERVICE_ACCOUNT_JSON has an invalid credential type. Expected "service_account" JSON.',
    };
    console.error(`[SDLR Admin SDK] ${lastAdminInitState.errorCode}: ${lastAdminInitState.errorMessage}`);
    return { adminDb: null, adminAuth: null, initState: lastAdminInitState };
  }

  const serviceProjectId = String(parsed.project_id || parsed.projectId || '').trim();
  const clientEmail = String(parsed.client_email || parsed.clientEmail || '').trim();
  const rawPrivateKey = String(parsed.private_key || parsed.privateKey || '');
  const privateKey = rawPrivateKey.replace(/\\n/g, '\n').trim();

  if (!serviceProjectId || !clientEmail || !privateKey) {
    lastAdminInitState = {
      ok: false,
      errorCode: 'INVALID_SERVICE_ACCOUNT_CREDENTIALS',
      errorMessage:
        'FIREBASE_SERVICE_ACCOUNT_JSON is missing required fields (project_id, client_email, or private_key).',
    };
    console.error(`[SDLR Admin SDK] ${lastAdminInitState.errorCode}: ${lastAdminInitState.errorMessage}`);
    return { adminDb: null, adminAuth: null, initState: lastAdminInitState };
  }

  if (!clientEmail.includes('@') || !privateKey.includes('-----BEGIN') || !privateKey.includes('PRIVATE KEY-----')) {
    lastAdminInitState = {
      ok: false,
      errorCode: 'INVALID_SERVICE_ACCOUNT_CREDENTIALS',
      errorMessage:
        'FIREBASE_SERVICE_ACCOUNT_JSON contains a malformed client_email or private_key PEM block.',
    };
    console.error(`[SDLR Admin SDK] ${lastAdminInitState.errorCode}: ${lastAdminInitState.errorMessage}`);
    return { adminDb: null, adminAuth: null, initState: lastAdminInitState };
  }

  const targetProjectId = firebaseConfig.projectId || serviceProjectId;
  if (firebaseConfig.projectId && serviceProjectId !== firebaseConfig.projectId) {
    lastAdminInitState = {
      ok: false,
      errorCode: 'INVALID_SERVICE_ACCOUNT_CREDENTIALS',
      errorMessage: `Service account project_id ("${serviceProjectId}") does not match configured Firebase project ("${firebaseConfig.projectId}"). Generate a service account key for "${firebaseConfig.projectId}".`,
    };
    console.error(`[SDLR Admin SDK] ${lastAdminInitState.errorCode}: ${lastAdminInitState.errorMessage}`);
    return { adminDb: null, adminAuth: null, initState: lastAdminInitState };
  }

  try {
    const existing = getAdminApps().find((a) => a.name === 'SDLR_ADMIN_APP');
    cachedAdminApp =
      existing ||
      initializeAdminApp(
        {
          credential: cert({
            projectId: serviceProjectId,
            clientEmail,
            privateKey,
          }),
          projectId: targetProjectId,
          ...(firebaseConfig.storageBucket ? { storageBucket: firebaseConfig.storageBucket } : {}),
        },
        'SDLR_ADMIN_APP'
      );

    const dbId = firebaseConfig.firestoreDatabaseId?.trim();
    cachedAdminDb =
      dbId && dbId !== '(default)'
        ? getAdminFirestore(cachedAdminApp, dbId)
        : getAdminFirestore(cachedAdminApp);
    cachedAdminAuth = getAdminAuth(cachedAdminApp);

    lastAdminInitState = {
      ok: true,
      errorCode: 'NONE',
      errorMessage: null,
    };
    return {
      adminDb: cachedAdminDb,
      adminAuth: cachedAdminAuth,
      initState: lastAdminInitState,
    };
  } catch (err: any) {
    cachedAdminApp = null;
    cachedAdminDb = null;
    cachedAdminAuth = null;
    const reason = err instanceof Error ? err.message : 'Unknown initialization error';
    console.error(`[SDLR Admin SDK] FIREBASE_ADMIN_INIT_FAILED: ${reason}`);
    lastAdminInitState = {
      ok: false,
      errorCode: 'FIREBASE_ADMIN_INIT_FAILED',
      errorMessage:
        'Firebase Admin SDK failed to initialize with the provided FIREBASE_SERVICE_ACCOUNT_JSON credentials. Verify the service account key is valid and not revoked.',
    };
    return { adminDb: null, adminAuth: null, initState: lastAdminInitState };
  }
}

function stripUndefinedDeep<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date || Buffer.isBuffer(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    return value;
  }
  const cleaned: Record<string, any> = {};
  for (const [k, v] of Object.entries(value as Record<string, any>)) {
    if (v !== undefined) {
      cleaned[k] = stripUndefinedDeep(v);
    }
  }
  return cleaned as T;
}

function getServerDbAdapter(): {
  db: ServerDbAdapter | null;
  adminAuth: AdminAuth | null;
  initState: AdminInitState;
} {
  const { adminDb, adminAuth, initState } = initAdminServices();
  if (!adminDb || !adminAuth) {
    return { db: null, adminAuth: null, initState };
  }

  const adapter: ServerDbAdapter = {
    mode: 'admin',
    async getDoc(colName, docId) {
      const snap = await adminDb.collection(colName).doc(docId).get();
      return {
        exists: snap.exists,
        id: snap.id,
        data: () => snap.data(),
      };
    },
    async setDoc(colName, docId, data) {
      await adminDb.collection(colName).doc(docId).set(stripUndefinedDeep(data));
    },
    async updateDoc(colName, docId, data) {
      await adminDb.collection(colName).doc(docId).update(stripUndefinedDeep(data));
    },
    async deleteDoc(colName, docId) {
      await adminDb.collection(colName).doc(docId).delete();
    },
    async getCollectionDocs(colName) {
      const snap = await adminDb.collection(colName).get();
      return snap.docs.map((d) => ({ id: d.id, data: () => d.data() }));
    },
    async queryWhere(colName, filters) {
      let q: FirebaseFirestore.Query = adminDb.collection(colName);
      for (const [field, op, val] of filters) {
        q = q.where(field, op, val);
      }
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, data: () => d.data() }));
    },
    async runTransaction(fn) {
      return adminDb.runTransaction(async (tx) => {
        const wrappedTx = {
          async get(colName: string, docId: string): Promise<DocSnapshotLike> {
            const snap = await tx.get(adminDb.collection(colName).doc(docId));
            return { exists: snap.exists, id: snap.id, data: () => snap.data() };
          },
          set(colName: string, docId: string, data: Record<string, any>) {
            tx.set(adminDb.collection(colName).doc(docId), stripUndefinedDeep(data));
          },
        };
        return fn(wrappedTx);
      });
    },
  };
  return { db: adapter, adminAuth, initState };
}

function formatServerFirestoreError(
  err: any,
  db: ServerDbAdapter | null,
  fallbackMsg: string
): { status: number; message: string; code?: string } {
  const msg = String(err?.message || err || '');
  const code = String(err?.code || '');

  if (
    msg.includes('UNAUTHENTICATED') ||
    msg.includes('invalid_grant') ||
    msg.includes('DECODER routines') ||
    msg.includes('Invalid JWT Signature')
  ) {
    return {
      status: 503,
      code: 'FIREBASE_ADMIN_AUTH_FAILED',
      message:
        'Firebase Admin SDK credentials were rejected by Google Auth. Ensure FIREBASE_SERVICE_ACCOUNT_JSON contains an active, unrevoked key for project ai-studio-applet-webapp-19cab.',
    };
  }

  if (code === '5' || code === 'not-found' || msg.includes('NOT_FOUND')) {
    return {
      status: 503,
      code: 'FIRESTORE_DATABASE_NOT_FOUND',
      message:
        'Configured Firestore database was not found. Verify FIREBASE_DATABASE_ID matches your Firebase project database ID.',
    };
  }

  if (
    code === '7' ||
    code === 'permission-denied' ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('Missing or insufficient permissions')
  ) {
    if (db?.mode !== 'admin') {
      return {
        status: 503,
        code: 'MISSING_ADMIN_SDK',
        message:
          'Server-side Firebase Admin SDK is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON in Netlify Environment Variables (or sign in with Google Staff Account).',
      };
    }
    return {
      status: 403,
      code: 'FIRESTORE_PERMISSION_DENIED',
      message:
        'Firebase Admin service account lacks Firestore IAM permissions. Grant Cloud Datastore User or Firebase Admin role in Google Cloud IAM.',
    };
  }

  return {
    status: 500,
    message: msg || fallbackMsg,
  };
}

function createSessionToken(
  learnerDocId: string,
  digitalId: string,
  secret: string,
  issuedAtMs?: number
): { token: string; expiresAt: number } {
  const now = issuedAtMs ?? Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const payload: SessionPayload = {
    sub: learnerDocId,
    role: 'learner',
    digitalId,
    jti: crypto.randomBytes(12).toString('hex'),
    iat: now,
    exp: expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return { token: `${encoded}.${sig}`, expiresAt };
}

function verifySessionToken(token: string, secret: string): SessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as SessionPayload;
    if (!payload.sub || payload.role !== 'learner' || !payload.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function createTeacherSessionToken(
  teacherUid: string,
  username: string,
  role: 'teacher' | 'admin' | 'super_admin',
  secret: string
): { token: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const payload: TeacherSessionPayload = {
    sub: teacherUid,
    role,
    username,
    jti: crypto.randomBytes(12).toString('hex'),
    iat: now,
    exp: expiresAt,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return { token: `${encoded}.${sig}`, expiresAt };
}

function verifyTeacherSessionToken(token: string, secret: string): TeacherSessionPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [encoded, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as TeacherSessionPayload;
    if (
      !payload.sub ||
      !['teacher', 'admin', 'super_admin'].includes(payload.role) ||
      !payload.exp ||
      Date.now() > payload.exp
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function isSessionTokenRevoked(db: ServerDbAdapter, jti?: string): Promise<boolean> {
  if (!jti) return false;
  try {
    const snap = await db.getDoc('revokedSessions', jti);
    return snap.exists;
  } catch {
    return false;
  }
}

function normalizeDigitalIdKey(raw: string): string {
  const unified = String(raw || '')
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, '')
    .toUpperCase();
  const sglrnMatch = unified.match(/^SG-?LRN-?(\d{4})-?0*(\d+)$/);
  if (sglrnMatch) {
    return `SG-LRN-${sglrnMatch[1]}-${sglrnMatch[2].padStart(3, '0')}`;
  }
  return unified;
}

// Verify Firebase Auth ID tokens server-side (via Admin SDK if available, else Identity Toolkit)
async function verifyFirebaseIdToken(
  idToken: string,
  adminAuth: AdminAuth | null
): Promise<{ uid: string; email: string; emailVerified: boolean; displayName?: string; authTime?: number } | null> {
  if (!idToken) return null;
  if (adminAuth) {
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      return {
        uid: decoded.uid,
        email: decoded.email || '',
        emailVerified: Boolean(decoded.email_verified || decoded.firebase?.sign_in_provider === 'custom'),
        displayName: decoded.name,
        authTime: typeof decoded.auth_time === 'number' ? decoded.auth_time * 1000 : undefined,
      };
    } catch (err: any) {
      console.warn('[SDLR Auth] verifyIdToken failed:', err?.code || err?.message || 'unknown');
      return null;
    }
  }

  if (!firebaseConfig.apiKey) return null;
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as {
      users?: Array<{
        localId?: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
        disabled?: boolean;
      }>;
    };
    const user = data.users?.[0];
    if (!user || !user.localId || user.disabled) return null;
    return {
      uid: user.localId,
      email: user.email || '',
      emailVerified: Boolean(user.emailVerified),
      displayName: user.displayName,
    };
  } catch {
    return null;
  }
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
}

function verifyLearnerPassword(rawPassword: string, learnerData: Record<string, any>): boolean {
  const candidates: string[] = [rawPassword];
  const trimmed = rawPassword.trim();
  if (trimmed && trimmed !== rawPassword) {
    candidates.push(trimmed);
  }

  const storedHash = String(learnerData.passwordHash || '').trim().toLowerCase();
  const storedSalt = String(learnerData.salt || '').trim();

  if (storedHash && storedSalt) {
    const storedBuf = Buffer.from(storedHash, 'utf8');
    for (const candidate of candidates) {
      const computedHash = hashPassword(candidate, storedSalt).toLowerCase();
      const computedBuf = Buffer.from(computedHash, 'utf8');
      if (
        computedBuf.length > 0 &&
        computedBuf.length === storedBuf.length &&
        crypto.timingSafeEqual(computedBuf, storedBuf)
      ) {
        return true;
      }
    }
    return false;
  }

  return candidates.some((candidate) => candidate === DEFAULT_INITIAL_PASSWORD);
}

function getNairobiDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

let defaultTeacherEnsured = false;
let defaultTeacherBootstrapPromise: Promise<void> | null = null;

async function ensureDefaultTeacherAccount(db: ServerDbAdapter | null): Promise<void> {
  if (!db || db.mode !== 'admin' || defaultTeacherEnsured) return;
  if (defaultTeacherBootstrapPromise) return defaultTeacherBootstrapPromise;

  const initialTeacherPassword = process.env.DEFAULT_TEACHER_PASSWORD || 'Sangurur@2026';

  defaultTeacherBootstrapPromise = (async () => {
    try {
      const now = new Date().toISOString();
      const teacherSnap = await db.getDoc('teachers', DEFAULT_TEACHER_UID);
      if (!teacherSnap.exists) {
        await db.setDoc('teachers', DEFAULT_TEACHER_UID, {
          uid: DEFAULT_TEACHER_UID,
          username: DEFAULT_TEACHER_USERNAME,
          email: 'teacher@sangururschool.edu.ke',
          fullName: 'Sangurur Staff Teacher',
          role: 'teacher',
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }

      const credSnap = await db.getDoc('teacherCredentials', DEFAULT_TEACHER_UID);
      if (!credSnap.exists) {
        const salt = generateSalt();
        const passwordHash = hashPassword(initialTeacherPassword, salt);
        await db.setDoc('teacherCredentials', DEFAULT_TEACHER_UID, {
          id: DEFAULT_TEACHER_UID,
          username: DEFAULT_TEACHER_USERNAME,
          teacherUid: DEFAULT_TEACHER_UID,
          passwordHash,
          salt,
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      defaultTeacherEnsured = true;
    } catch (err) {
      console.error('Default teacher bootstrap error:', err);
      throw err;
    } finally {
      defaultTeacherBootstrapPromise = null;
    }
  })();

  return defaultTeacherBootstrapPromise;
}

async function allocateDigitalIds(db: ServerDbAdapter | null, count: number): Promise<string[]> {
  if (!db) {
    return Array.from({ length: count }, (_, idx) => `SG-LRN-2026-${String(idx + 1).padStart(3, '0')}`);
  }

  let bootstrapMax = 0;
  const learnersDocs = await db.getCollectionDocs('learners');
  learnersDocs.forEach((d) => {
    const data = d.data();
    const idStr = String(data.digitalId || data.learnerId || data.username || '');
    const match = idStr.match(/^SG-LRN-2026-(\d+)$/i) || idStr.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > bootstrapMax) {
        bootstrapMax = num;
      }
    }
  });

  const startSeq = await db.runTransaction(async (tx) => {
    const counterDoc = await tx.get('counters', 'learner_digital_id_2026');
    const existingData = counterDoc.data();
    const currentSeq = counterDoc.exists
      ? Math.max(Number(existingData?.lastSeq) || 0, bootstrapMax)
      : bootstrapMax;
    const nextLast = currentSeq + count;
    tx.set('counters', 'learner_digital_id_2026', {
      lastSeq: nextLast,
      updatedAt: new Date().toISOString(),
    });
    return currentSeq + 1;
  });

  return Array.from({ length: count }, (_, i) => `SG-LRN-2026-${String(startSeq + i).padStart(3, '0')}`);
}

async function writeAuditLog(
  db: ServerDbAdapter | null,
  entry: {
    actorId: string;
    actorName: string;
    actorRole: string;
    action: string;
    targetEntity: string;
    targetId: string;
    details: string;
  }
) {
  if (!db) return;
  try {
    const logId = `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    await db.setDoc('auditLogs', logId, {
      id: logId,
      ...entry,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Audit log write notice:', err);
  }
}

export function createApiApp(options?: { isServerless?: boolean }): Express {
  const app = express();
  const isServerless = Boolean(options?.isServerless);

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '4mb' }));

  // Normalize incoming Netlify Functions path (/.netlify/functions/api/...) -> /api/...
  // and guarantee req.body is safely parsed even under raw serverless-http payloads
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (req.url.startsWith('/.netlify/functions/api')) {
      const suffix = req.url.slice('/.netlify/functions/api'.length);
      req.url = suffix ? `/api${suffix.startsWith('/') ? suffix : `/${suffix}`}` : '/api';
    } else if (isServerless && !req.url.startsWith('/api')) {
      req.url = `/api${req.url.startsWith('/') ? req.url : `/${req.url}`}`;
    }

    if (Buffer.isBuffer(req.body)) {
      try {
        const text = req.body.toString('utf-8').trim();
        req.body = text ? JSON.parse(text) : {};
      } catch {
        req.body = {};
      }
    } else if (typeof req.body === 'string') {
      try {
        const text = req.body.trim();
        req.body = text ? JSON.parse(text) : {};
      } catch {
        req.body = {};
      }
    } else if (!req.body || typeof req.body !== 'object') {
      req.body = {};
    }

    next();
  });

  async function isLearnerCohortMember(
    db: ServerDbAdapter,
    authLearner: any,
    cohortId: string,
    cohortData?: Record<string, any> | null
  ): Promise<boolean> {
    const cleanCohortId = String(cohortId || '').trim();
    if (!cleanCohortId) return false;
    const assignedIds: string[] = Array.isArray(authLearner?.assignedCohortIds)
      ? authLearner.assignedCohortIds.map((v: any) => String(v || '').trim()).filter(Boolean)
      : [];

    const normalizedAssigned = new Set(assignedIds.map((v) => v.toLowerCase()));
    if (normalizedAssigned.has(cleanCohortId.toLowerCase())) {
      return true;
    }
    const cohortCode = String(cohortData?.code || '').trim();
    if (cohortCode && normalizedAssigned.has(cohortCode.toLowerCase())) {
      return true;
    }

    try {
      const memSnap = await db.getDoc('cohortMembers', `mem_${cleanCohortId}_${authLearner.id}`);
      if (memSnap.exists && memSnap.data()?.status !== 'removed') {
        return true;
      }
    } catch {
      // ignore and try class check
    }

    const candidateClassIds = Array.from(
      new Set([
        ...(Array.isArray(authLearner?.assignedClassIds) ? authLearner.assignedClassIds : []),
        ...(authLearner?.classId ? [authLearner.classId] : []),
      ].filter(Boolean))
    );
    for (const cid of candidateClassIds) {
      try {
        const clsSnap = await db.getDoc('cohortClasses', String(cid));
        if (clsSnap.exists && clsSnap.data()?.cohortId === cleanCohortId) {
          return true;
        }
      } catch {
        // continue checking other classes
      }
    }
    return false;
  }

  async function requireLearnerAuth(req: AuthenticatedLearnerRequest, res: Response, next: NextFunction) {
    const { db, adminAuth, initState } = getServerDbAdapter();
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        return res.status(401).json({ error: 'Authentication required. Please sign in again.' });
      }
      if (!db || db.mode !== 'admin') {
        return res.status(503).json({
          error: initState.errorMessage || 'Server-side Firebase Admin SDK is not configured in this environment.',
          code: initState.errorCode,
        });
      }

      const sessionSecret = await getSessionSecret(db);
      const payload = verifySessionToken(token, sessionSecret);
      let learnerDocId = payload?.sub || '';
      let isFirebaseToken = false;
      let fbAuthTime: number | undefined;

      if (!payload) {
        const fbUser = await verifyFirebaseIdToken(token, adminAuth);
        if (!fbUser || !fbUser.uid) {
          return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
        }
        learnerDocId = fbUser.uid;
        isFirebaseToken = true;
        fbAuthTime = fbUser.authTime;
      } else if (await isSessionTokenRevoked(db, payload.jti)) {
        return res.status(401).json({ error: 'Session has been logged out. Please sign in again.' });
      }

      const snap = await db.getDoc('learners', learnerDocId);
      if (!snap.exists) {
        return res.status(401).json({ error: 'Learner account no longer exists.' });
      }
      const data = snap.data() || {};
      if (data.status === 'INACTIVE' || data.active === false) {
        return res.status(403).json({ error: 'Learner account is inactive. Please contact your school administrator.' });
      }
      const nowMs = Date.now();
      const revokedTs = Number(data.sessionRevokedAt);
      if (
        !isFirebaseToken &&
        payload &&
        Number.isFinite(revokedTs) &&
        revokedTs > 0 &&
        revokedTs <= nowMs + 60_000 &&
        payload.iat < revokedTs
      ) {
        return res.status(401).json({ error: 'Session has been logged out or reset. Please sign in again.' });
      }
      // Firebase auth_time is truncated to whole seconds; allow tokens minted in the same second as passwordResetAt
      const resetTs = Number(data.passwordResetAt);
      if (
        isFirebaseToken &&
        Number.isFinite(resetTs) &&
        resetTs > 0 &&
        resetTs <= nowMs + 60_000 &&
        fbAuthTime &&
        fbAuthTime + 1000 < resetTs
      ) {
        return res.status(401).json({ error: 'Your password was recently reset. Please sign in again.' });
      }

      const digitalId = data.digitalId || data.learnerId || data.username || snap.id;
      if (isFirebaseToken) {
        req.reissuedLearnerSession = createSessionToken(snap.id, digitalId, sessionSecret);
      }

      req.authLearner = {
        id: snap.id,
        digitalId,
        learnerId: digitalId,
        fullName: data.fullName || 'Learner',
        username: data.username || digitalId,
        assignedCohortIds: Array.isArray(data.assignedCohortIds) ? data.assignedCohortIds : [],
        assignedClassIds: Array.isArray(data.assignedClassIds) ? data.assignedClassIds : [],
        levelId: data.levelId || null,
        levelName: data.levelName || null,
        classId: data.classId || null,
        className: data.className || null,
        mustChangePassword: data.mustChangePassword ?? data.isFirstLogin ?? true,
        isFirstLogin: data.mustChangePassword ?? data.isFirstLogin ?? true,
        status: data.status || 'ACTIVE',
        gender: data.gender ?? null,
        age: data.age ?? null,
        passwordHash: data.passwordHash,
        salt: data.salt,
      };
      next();
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Session validation error');
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  }

  async function requireTeacherAuth(req: AuthenticatedTeacherRequest, res: Response, next: NextFunction) {
    const { db, adminAuth, initState } = getServerDbAdapter();
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        return res.status(401).json({ error: 'Staff authentication required. Please sign in again.' });
      }
      if (!db || db.mode !== 'admin') {
        return res.status(503).json({
          error: initState.errorMessage || 'Server-side Firebase Admin SDK is not configured in this environment.',
          code: initState.errorCode,
        });
      }

      const sessionSecret = await getSessionSecret(db);
      const staffPayload = verifyTeacherSessionToken(token, sessionSecret);
      if (staffPayload) {
        if (await isSessionTokenRevoked(db, staffPayload.jti)) {
          return res.status(401).json({ error: 'Teacher session has been signed out. Please sign in again.' });
        }
        const teacherSnap = await db.getDoc('teachers', staffPayload.sub);
        if (!teacherSnap.exists) {
          return res.status(401).json({ error: 'Teacher account no longer exists.' });
        }
        const teacherData = teacherSnap.data() || {};
        if (teacherData.active === false) {
          return res.status(403).json({ error: 'Teacher account is inactive.' });
        }
        const revokedTs = Number(teacherData.sessionRevokedAt);
        if (
          staffPayload.sub !== DEFAULT_TEACHER_UID &&
          Number.isFinite(revokedTs) &&
          revokedTs > 0 &&
          revokedTs <= Date.now() + 60_000 &&
          staffPayload.iat < revokedTs
        ) {
          return res.status(401).json({ error: 'Teacher session has been signed out. Please sign in again.' });
        }
        req.authTeacher = {
          uid: teacherSnap.id,
          fullName: teacherData.fullName || 'Sangurur Staff Teacher',
          role: teacherData.role || 'teacher',
          email: teacherData.email,
        };
        return next();
      }

      const fbUser = await verifyFirebaseIdToken(token, adminAuth);
      if (!fbUser || !fbUser.emailVerified) {
        return res.status(401).json({ error: 'Staff session expired or invalid. Please sign in again.' });
      }

      const teacherSnap = await db.getDoc('teachers', fbUser.uid);
      const isBootstrapAdmin = BOOTSTRAP_ADMIN_EMAILS.has(fbUser.email.toLowerCase());

      if (!teacherSnap.exists && !isBootstrapAdmin) {
        return res.status(403).json({ error: 'Access denied: staff teacher profile not authorized.' });
      }

      const teacherData = teacherSnap.exists ? teacherSnap.data() || null : null;
      if (teacherData && teacherData.active === false) {
        return res.status(403).json({ error: 'Teacher account is inactive. Please contact your school administrator.' });
      }

      req.authTeacher = {
        uid: fbUser.uid,
        fullName: teacherData?.fullName || fbUser.displayName || 'Staff Teacher',
        role: teacherData?.role || (isBootstrapAdmin ? 'admin' : 'teacher'),
        email: fbUser.email,
      };
      return next();
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Staff authorization error');
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  }

  // Health Check
  app.get('/api/health', (_req: Request, res: Response) => {
    const { db, adminAuth, initState } = getServerDbAdapter();
    res.json({
      status: 'ok',
      app: 'Sangurur Digital Learner Register (SDLR)',
      school: 'Sangurur Comprehensive School',
      motto: 'THINK, CODE, CHANGE THE WORLD',
      timezone: 'Africa/Nairobi',
      serverTimeEAT: new Date().toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' }),
      projectId: firebaseConfig.projectId || null,
      firestoreDatabaseId: firebaseConfig.firestoreDatabaseId || null,
      storageBucket: firebaseConfig.storageBucket || null,
      firestoreConfigured: Boolean(db),
      adminSdkActive: Boolean(db && adminAuth),
      adminInitErrorCode: initState.ok ? null : initState.errorCode,
      adminInitErrorMessage: initState.ok ? null : initState.errorMessage,
      sessionSecretConfigured: SESSION_SECRET_CONFIGURED,
      isNetlify: process.env.NETLIFY === 'true',
    });
  });

  // Explicit Stateless Session Revocation on Logout
  app.post('/api/auth/logout', async (req: Request, res: Response) => {
    try {
      const { db } = getServerDbAdapter();
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token || !db) {
        return res.json({ success: true });
      }
      const sessionSecret = await getSessionSecret(db);
      const revokedAt = Date.now();
      const teacherPayload = verifyTeacherSessionToken(token, sessionSecret);
      if (teacherPayload) {
        if (teacherPayload.jti) {
          await db
            .setDoc('revokedSessions', teacherPayload.jti, {
              jti: teacherPayload.jti,
              role: 'teacher',
              sub: teacherPayload.sub,
              revokedAt,
              expiresAt: teacherPayload.exp,
            })
            .catch(() => {});
        } else if (teacherPayload.sub !== DEFAULT_TEACHER_UID) {
          await db.updateDoc('teachers', teacherPayload.sub, { sessionRevokedAt: revokedAt }).catch(() => {});
        }
        return res.json({ success: true });
      }
      const learnerPayload = verifySessionToken(token, sessionSecret);
      if (learnerPayload) {
        if (learnerPayload.jti) {
          await db
            .setDoc('revokedSessions', learnerPayload.jti, {
              jti: learnerPayload.jti,
              role: 'learner',
              sub: learnerPayload.sub,
              revokedAt,
              expiresAt: learnerPayload.exp,
            })
            .catch(() => {});
        } else {
          await db.updateDoc('learners', learnerPayload.sub, { sessionRevokedAt: revokedAt }).catch(() => {});
        }
        return res.json({ success: true });
      }
      return res.json({ success: true });
    } catch {
      return res.json({ success: true });
    }
  });

  // Teacher Authentication: Username + Password Login
  app.post('/api/auth/teacher-login', async (req: Request, res: Response) => {
    const { db, adminAuth, initState } = getServerDbAdapter();
    try {
      const { username, password } = req.body || {};
      if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
      }

      if (!db || db.mode !== 'admin') {
        return res.status(503).json({
          error:
            initState.errorMessage ||
            'Username/password staff login requires server-side Firebase Admin SDK access. Configure FIREBASE_SERVICE_ACCOUNT_JSON in Netlify or use "Sign In with Google Staff Account".',
          code: initState.errorCode,
        });
      }

      await ensureDefaultTeacherAccount(db);

      const cleanUsername = String(username).trim();
      const credDocId =
        cleanUsername.toLowerCase() === DEFAULT_TEACHER_USERNAME.toLowerCase()
          ? DEFAULT_TEACHER_UID
          : `teacher_${cleanUsername.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;

      const credSnap = await db.getDoc('teacherCredentials', credDocId);
      if (!credSnap.exists) {
        return res.status(401).json({ error: 'Invalid teacher username or password.' });
      }

      const credData = credSnap.data() || {};
      if (credData.active === false) {
        return res.status(403).json({ error: 'Teacher account is inactive. Please contact the school administrator.' });
      }

      const expectedUsername = String(credData.username || DEFAULT_TEACHER_USERNAME);
      if (cleanUsername.toLowerCase() !== expectedUsername.toLowerCase()) {
        return res.status(401).json({ error: 'Invalid teacher username or password.' });
      }

      const computedHash = hashPassword(String(password), String(credData.salt || ''));
      const computedBuf = Buffer.from(computedHash, 'utf8');
      const storedBuf = Buffer.from(String(credData.passwordHash || ''), 'utf8');
      const isPasswordValid =
        computedBuf.length > 0 &&
        computedBuf.length === storedBuf.length &&
        crypto.timingSafeEqual(computedBuf, storedBuf);

      if (!isPasswordValid) {
        return res.status(401).json({ error: 'Invalid teacher username or password.' });
      }

      const teacherUid = String(credData.teacherUid || DEFAULT_TEACHER_UID);
      const teacherSnap = await db.getDoc('teachers', teacherUid);
      const teacherData = teacherSnap.exists ? teacherSnap.data() || null : null;

      if (teacherData && teacherData.active === false) {
        return res.status(403).json({ error: 'Teacher profile is inactive. Please contact the school administrator.' });
      }

      const teacherRole: 'teacher' | 'admin' | 'super_admin' =
        teacherData?.role === 'admin' || teacherData?.role === 'super_admin'
          ? teacherData.role
          : 'teacher';

      const teacherProfile = {
        uid: teacherUid,
        username: expectedUsername,
        email: teacherData?.email || 'teacher@sangururschool.edu.ke',
        fullName: teacherData?.fullName || 'Sangurur Staff Teacher',
        role: teacherRole,
        phone: teacherData?.phone,
        active: teacherData?.active ?? true,
        createdAt: teacherData?.createdAt || new Date().toISOString(),
        updatedAt: teacherData?.updatedAt,
      };

      if (teacherData?.sessionRevokedAt && Number(teacherData.sessionRevokedAt) > Date.now() && teacherUid !== DEFAULT_TEACHER_UID) {
        await db.updateDoc('teachers', teacherUid, { sessionRevokedAt: Date.now() - 1 }).catch(() => {});
      }

      const sessionSecret = await getSessionSecret(db);
      const { token, expiresAt } = createTeacherSessionToken(
        teacherUid,
        expectedUsername,
        teacherRole,
        sessionSecret
      );

      let firebaseCustomToken: string | undefined;
      if (adminAuth) {
        try {
          firebaseCustomToken = await adminAuth.createCustomToken(teacherUid, {
            role: teacherRole,
            username: expectedUsername,
            email_verified: true,
          });
        } catch (tokenErr) {
          console.warn('Could not mint Firebase custom token for staff teacher:', tokenErr);
        }
      }

      await writeAuditLog(db, {
        actorId: teacherProfile.uid,
        actorName: teacherProfile.fullName,
        actorRole: teacherRole,
        action: 'TEACHER_LOGIN',
        targetEntity: 'teacher',
        targetId: teacherProfile.uid,
        details: `Staff teacher authenticated with username '${expectedUsername}'.`,
      });

      return res.json({
        success: true,
        teacher: teacherProfile,
        token,
        firebaseCustomToken,
        expiresAt,
      });
    } catch (err: any) {
      console.error('Teacher login error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Internal teacher login error');
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  // Validate and refresh active teacher credential session against Firestore
  app.get('/api/auth/teacher-session', async (req: Request, res: Response) => {
    const { db, adminAuth, initState } = getServerDbAdapter();
    try {
      const authHeader = req.headers.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
      if (!token) {
        return res.status(401).json({ error: 'Teacher authentication required.' });
      }

      if (!db || db.mode !== 'admin') {
        return res.status(503).json({
          error: initState.errorMessage || 'Server-side Firebase Admin SDK is not configured in this environment.',
          code: initState.errorCode,
        });
      }

      const sessionSecret = await getSessionSecret(db);
      const payload = verifyTeacherSessionToken(token, sessionSecret);
      let teacherUid = payload?.sub || '';
      let authenticatedViaFirebase = false;
      let fbEmail = '';
      let fbDisplayName = '';

      if (payload) {
        if (await isSessionTokenRevoked(db, payload.jti)) {
          return res.status(401).json({ error: 'Teacher session has been signed out. Please sign in again.' });
        }
      } else {
        const fbUser = await verifyFirebaseIdToken(token, adminAuth);
        if (!fbUser || !fbUser.emailVerified) {
          return res.status(401).json({ error: 'Teacher session expired or invalid. Please sign in again.' });
        }
        teacherUid = fbUser.uid;
        authenticatedViaFirebase = true;
        fbEmail = fbUser.email;
        fbDisplayName = fbUser.displayName || '';
      }

      const teacherSnap = await db.getDoc('teachers', teacherUid);
      const isBootstrapAdmin = BOOTSTRAP_ADMIN_EMAILS.has(fbEmail.toLowerCase());
      if (!teacherSnap.exists && !(authenticatedViaFirebase && isBootstrapAdmin)) {
        return res.status(401).json({ error: 'Teacher account no longer exists.' });
      }

      const teacherData = teacherSnap.exists ? teacherSnap.data() || {} : {};
      if (teacherData.active === false) {
        return res.status(403).json({ error: 'Teacher account is inactive.' });
      }

      const revokedTs = Number(teacherData.sessionRevokedAt);
      if (
        !authenticatedViaFirebase &&
        payload &&
        payload.sub !== DEFAULT_TEACHER_UID &&
        Number.isFinite(revokedTs) &&
        revokedTs > 0 &&
        revokedTs <= Date.now() + 60_000 &&
        payload.iat < revokedTs
      ) {
        return res.status(401).json({ error: 'Teacher session has been signed out. Please sign in again.' });
      }

      const resolvedRole: 'teacher' | 'admin' | 'super_admin' =
        teacherData.role === 'admin' || teacherData.role === 'super_admin'
          ? teacherData.role
          : isBootstrapAdmin
          ? 'admin'
          : 'teacher';
      const resolvedUsername = teacherData.username || payload?.username || DEFAULT_TEACHER_USERNAME;

      let firebaseCustomToken: string | undefined;
      if (adminAuth && !authenticatedViaFirebase) {
        try {
          firebaseCustomToken = await adminAuth.createCustomToken(teacherUid, {
            role: resolvedRole,
            username: resolvedUsername,
            email_verified: true,
          });
        } catch {
          // ignore
        }
      }

      const reissuedSession = authenticatedViaFirebase
        ? createTeacherSessionToken(teacherUid, resolvedUsername, resolvedRole, sessionSecret)
        : null;

      return res.json({
        success: true,
        ...(reissuedSession ? { token: reissuedSession.token, expiresAt: reissuedSession.expiresAt } : {}),
        firebaseCustomToken,
        teacher: {
          uid: teacherUid,
          username: resolvedUsername,
          email: teacherData.email || fbEmail || 'teacher@sangururschool.edu.ke',
          fullName: teacherData.fullName || fbDisplayName || 'Sangurur Staff Teacher',
          role: resolvedRole,
          phone: teacherData.phone,
          active: teacherData.active ?? true,
          createdAt: teacherData.createdAt || new Date().toISOString(),
          updatedAt: teacherData.updatedAt,
        },
      });
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Teacher session validation error');
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  // Learner Authentication: Digital ID (Username) + Password Login
  app.post('/api/auth/learner-login', async (req: Request, res: Response) => {
    const { db, adminAuth, initState } = getServerDbAdapter();
    try {
      const { username: bodyUsername, digitalId: bodyDigitalId, password } = req.body || {};
      const username = bodyUsername || bodyDigitalId;
      if (!username || password === undefined || password === null || !String(password).trim()) {
        return res.status(400).json({ error: 'Digital ID / Username and password are required' });
      }

      if (!db || db.mode !== 'admin') {
        return res.status(503).json({
          error:
            initState.errorMessage ||
            'Learner Digital ID login requires server-side Firebase Admin SDK access. Configure FIREBASE_SERVICE_ACCOUNT_JSON in Netlify or sign in using "Sign In with Google Staff Account".',
          code: initState.errorCode,
        });
      }

      const cleanUsername = String(username).trim();
      const dashUnified = cleanUsername.replace(/[\u2010-\u2015\u2212]/g, '-');
      const cleanUpper = dashUnified.toUpperCase();
      const cleanLower = dashUnified.toLowerCase();
      const canonicalNormalized = normalizeDigitalIdKey(cleanUsername);

      const candidateVariants = Array.from(
        new Set([cleanUsername, dashUnified, cleanUpper, cleanLower, canonicalNormalized].filter(Boolean))
      );
      const queryPromises: Promise<Array<{ id: string; data: () => Record<string, any> }>>[] = [];
      for (const variant of candidateVariants) {
        queryPromises.push(db.queryWhere('learners', [['username', '==', variant]]));
        queryPromises.push(db.queryWhere('learners', [['digitalId', '==', variant]]));
        queryPromises.push(db.queryWhere('learners', [['learnerId', '==', variant]]));
      }

      const queryResults = await Promise.all(queryPromises);
      const candidateMap = new Map<string, { id: string; data: () => Record<string, any> }>();
      queryResults.forEach((list) => {
        list.forEach((docItem) => {
          if (!candidateMap.has(docItem.id)) {
            candidateMap.set(docItem.id, docItem);
          }
        });
      });

      const rawPassword = String(password);
      const findMatchingActive = (docsList: Array<{ id: string; data: () => Record<string, any> }>) => {
        const active = docsList.filter((c) => {
          const d = c.data() || {};
          return d.status !== 'INACTIVE' && d.active !== false;
        });
        const matched = active.find((c) => verifyLearnerPassword(rawPassword, c.data() || {}));
        return { active, matched };
      };

      let { active: activeCandidates, matched: learnerDoc } = findMatchingActive(
        Array.from(candidateMap.values())
      );

      // Always run normalized collection scan if exact/variant query had no match or no password-verified active match
      if (!learnerDoc && canonicalNormalized) {
        const allLearnerDocs = await db.getCollectionDocs('learners');
        allLearnerDocs.forEach((docItem) => {
          const d = docItem.data() || {};
          const keys = [d.digitalId, d.learnerId, d.username]
            .filter(Boolean)
            .map((v) => normalizeDigitalIdKey(String(v)));
          if (keys.includes(canonicalNormalized)) {
            candidateMap.set(docItem.id, docItem);
          }
        });
        const rescan = findMatchingActive(Array.from(candidateMap.values()));
        activeCandidates = rescan.active;
        learnerDoc = rescan.matched;
      }

      if (candidateMap.size === 0) {
        return res.status(401).json({ error: 'Invalid Digital ID or password. Please verify with your teacher.' });
      }

      if (activeCandidates.length === 0) {
        return res.status(403).json({ error: 'Learner account is inactive. Please contact your school administrator.' });
      }

      if (!learnerDoc) {
        return res.status(401).json({ error: 'Invalid Digital ID or password. Please check your access slip.' });
      }

      const learnerData = learnerDoc.data() || {};
      const nowMs = Date.now();
      // Heal skewed future revocation/reset timestamps (e.g., written by a teacher PC with an ahead clock)
      const skewedUpdates: Record<string, any> = {};
      if (learnerData.sessionRevokedAt && Number(learnerData.sessionRevokedAt) > nowMs) {
        skewedUpdates.sessionRevokedAt = nowMs - 1;
      }
      if (learnerData.passwordResetAt && Number(learnerData.passwordResetAt) > nowMs) {
        skewedUpdates.passwordResetAt = nowMs - 1;
      }
      if (Object.keys(skewedUpdates).length > 0) {
        await db.updateDoc('learners', learnerDoc.id, skewedUpdates).catch(() => {});
      }

      const mustChangePassword = learnerData.mustChangePassword ?? learnerData.isFirstLogin ?? true;
      const digitalId = learnerData.digitalId || learnerData.learnerId || learnerData.username || learnerDoc.id;

      const learnerProfile = {
        id: learnerDoc.id,
        digitalId,
        learnerId: digitalId,
        fullName: learnerData.fullName,
        username: learnerData.username || digitalId,
        assignedCohortIds: learnerData.assignedCohortIds || [],
        assignedClassIds: learnerData.assignedClassIds || [],
        levelId: learnerData.levelId || null,
        levelName: learnerData.levelName || null,
        classId: learnerData.classId || null,
        className: learnerData.className || null,
        mustChangePassword,
        isFirstLogin: mustChangePassword,
        status: learnerData.status || 'ACTIVE',
        gender: learnerData.gender,
        age: learnerData.age,
        schoolName: learnerData.schoolName || 'Sangurur Comprehensive School',
        grade: learnerData.grade || null,
      };

      const sessionSecret = await getSessionSecret(db);
      const { token, expiresAt } = createSessionToken(learnerDoc.id, digitalId, sessionSecret, nowMs);

      let firebaseCustomToken: string | undefined;
      if (adminAuth) {
        try {
          firebaseCustomToken = await adminAuth.createCustomToken(learnerDoc.id, {
            role: 'learner',
            digitalId,
            email_verified: true,
          });
        } catch (tokenErr) {
          console.warn('Could not mint Firebase custom token for learner:', tokenErr);
        }
      }

      return res.json({
        success: true,
        learner: learnerProfile,
        mustChangePassword,
        token,
        firebaseCustomToken,
        expiresAt,
      });
    } catch (err: any) {
      console.error('Login error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Internal login error');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Validate and refresh active learner session against Firestore
  app.get('/api/auth/learner-session', requireLearnerAuth, (req: AuthenticatedLearnerRequest, res: Response) => {
    const { passwordHash, salt, ...safeProfile } = req.authLearner;
    return res.json({
      success: true,
      ...(req.reissuedLearnerSession
        ? {
            token: req.reissuedLearnerSession.token,
            expiresAt: req.reissuedLearnerSession.expiresAt,
          }
        : {}),
      learner: safeProfile,
    });
  });

  // Learner Password Change (Mandatory on first login, or voluntary with currentPassword)
  app.post('/api/auth/learner-change-password', requireLearnerAuth, async (req: AuthenticatedLearnerRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authLearner = req.authLearner;
      const { learnerId, currentPassword, newPassword } = req.body;

      if (learnerId && learnerId !== authLearner.id) {
        return res.status(403).json({ error: 'Cannot change password for another learner account.' });
      }

      if (!newPassword || typeof newPassword !== 'string') {
        return res.status(400).json({ error: 'New password is required' });
      }

      const cleanNewPassword = newPassword.trim();
      if (cleanNewPassword === DEFAULT_INITIAL_PASSWORD) {
        return res.status(400).json({
          error: 'Your new password cannot be the default password (123456789). Please choose a private secure password.',
        });
      }

      if (cleanNewPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters long' });
      }

      if (!authLearner.mustChangePassword) {
        if (!currentPassword) {
          return res.status(400).json({ error: 'Current password is required to update your password.' });
        }
        if (!verifyLearnerPassword(String(currentPassword), authLearner)) {
          return res.status(401).json({ error: 'Current password is incorrect.' });
        }
      }

      const newSalt = generateSalt();
      const newHash = hashPassword(cleanNewPassword, newSalt);
      const nowMs = Date.now();
      const revokedBeforeNew = nowMs - 1;

      await db.updateDoc('learners', authLearner.id, {
        passwordHash: newHash,
        salt: newSalt,
        mustChangePassword: false,
        isFirstLogin: false,
        status: 'ACTIVE',
        sessionRevokedAt: revokedBeforeNew,
        updatedAt: new Date().toISOString(),
      });

      const sessionSecret = await getSessionSecret(db);
      const refreshedSession = createSessionToken(
        authLearner.id,
        authLearner.digitalId || authLearner.learnerId,
        sessionSecret,
        nowMs
      );

      await writeAuditLog(db, {
        actorId: authLearner.id,
        actorName: authLearner.fullName,
        actorRole: 'learner',
        action: 'LEARNER_PASSWORD_CHANGED',
        targetEntity: 'learner',
        targetId: authLearner.id,
        details: `Learner ${authLearner.fullName} (${authLearner.digitalId}) updated their password; default credentials invalidated.`,
      });

      return res.json({
        success: true,
        token: refreshedSession.token,
        expiresAt: refreshedSession.expiresAt,
        message: 'Password changed successfully. Default password is now invalidated.',
      });
    } catch (err: any) {
      console.error('Password change error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Error updating password');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Scoped Learner Endpoints (Strictly enforces assigned cohorts & classes)
  app.get('/api/learner/cohorts', requireLearnerAuth, async (req: AuthenticatedLearnerRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const assignedIds: string[] = Array.isArray(req.authLearner.assignedCohortIds)
        ? req.authLearner.assignedCohortIds
        : [];
      const normalizedAssigned = new Set(
        assignedIds.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
      );

      const [docs, levelDocs, classDocs, memberDocs] = await Promise.all([
        db.getCollectionDocs('cohorts'),
        db.getCollectionDocs('cohortLevels'),
        db.getCollectionDocs('cohortClasses'),
        db.queryWhere('cohortMembers', [['learnerId', '==', req.authLearner.id]]),
      ]);

      memberDocs.forEach((m) => {
        const mData = m.data();
        if (mData?.cohortId && mData?.status !== 'removed') {
          normalizedAssigned.add(String(mData.cohortId).trim().toLowerCase());
        }
      });

      const classCohortMap = new Map<string, string>();
      classDocs.forEach((d) => {
        const cls = d.data();
        if (cls?.cohortId) classCohortMap.set(d.id, String(cls.cohortId));
      });
      const assignedClassList = Array.from(
        new Set([
          ...(Array.isArray(req.authLearner.assignedClassIds) ? req.authLearner.assignedClassIds : []),
          ...(req.authLearner.classId ? [req.authLearner.classId] : []),
        ].filter(Boolean))
      );
      assignedClassList.forEach((cid) => {
        const cId = classCohortMap.get(String(cid));
        if (cId) normalizedAssigned.add(cId.trim().toLowerCase());
      });

      if (normalizedAssigned.size === 0) {
        return res.json({ success: true, cohorts: [], levels: [], classes: [] });
      }

      const cohorts = docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .filter((c: any) => {
          const idMatch = normalizedAssigned.has(String(c.id || '').trim().toLowerCase());
          const codeMatch = c.code && normalizedAssigned.has(String(c.code).trim().toLowerCase());
          return idMatch || codeMatch;
        });
      const cohortIdSet = new Set(cohorts.map((c: any) => c.id));
      const levels = levelDocs
        .map((d) => ({ ...d.data(), id: d.id }))
        .filter((lvl: any) => cohortIdSet.has(lvl.cohortId));
      const classes = classDocs
        .map((d) => ({ ...d.data(), id: d.id }))
        .filter((cls: any) => cohortIdSet.has(cls.cohortId));

      return res.json({ success: true, cohorts, levels, classes });
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Failed to load assigned cohorts');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.get('/api/learner/registers', requireLearnerAuth, async (req: AuthenticatedLearnerRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const cohortId = req.query.cohortId ? String(req.query.cohortId) : undefined;

      if (cohortId) {
        const cohortSnap = await db.getDoc('cohorts', cohortId);
        const cohortData = cohortSnap.exists ? cohortSnap.data() || null : null;
        const isMember = await isLearnerCohortMember(db, req.authLearner, cohortId, cohortData);
        if (!isMember) {
          return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
        }
      }

      const filters: Array<[string, '==' | 'array-contains', any]> = [
        ['learnerDocId', '==', req.authLearner.id],
      ];
      if (cohortId) {
        filters.push(['cohortId', '==', cohortId]);
      }

      const docs = await db.queryWhere('dailyRegisters', filters);
      const registers = docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a: any, b: any) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      return res.json({ success: true, registers });
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Failed to load learner registers');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.get('/api/learner/feedback', requireLearnerAuth, async (req: AuthenticatedLearnerRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const docs = await db.queryWhere('teacherFeedback', [['learnerDocId', '==', req.authLearner.id]]);
      const feedback = docs
        .map((d) => ({ ...d.data(), id: d.id }))
        .sort((a: any, b: any) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
      return res.json({ success: true, feedback });
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Failed to load teacher feedback');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.get('/api/learner/timetable', requireLearnerAuth, async (req: AuthenticatedLearnerRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const cohortId = req.query.cohortId ? String(req.query.cohortId).trim() : '';
      if (!cohortId) {
        return res.status(400).json({ error: 'Cohort ID is required.' });
      }

      const cohortSnap = await db.getDoc('cohorts', cohortId);
      const cohortData = cohortSnap.exists ? cohortSnap.data() || null : null;
      const isMember = await isLearnerCohortMember(db, req.authLearner, cohortId, cohortData);
      if (!isMember) {
        return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
      }

      const classId = req.query.classId
        ? String(req.query.classId).trim()
        : req.authLearner.classId
        ? String(req.authLearner.classId).trim()
        : '';

      const docs = await db.queryWhere('weeklyTimetables', [['cohortId', '==', cohortId]]);
      const allEntries = docs.map((d) => ({ ...d.data(), id: d.id })) as any[];
      const classSpecific = classId ? allEntries.filter((e) => e.classId === classId) : [];
      const fallbackCohortWide = allEntries.filter((e) => !e.classId);
      const selectedEntries = classId
        ? classSpecific.length > 0
          ? classSpecific
          : fallbackCohortWide
        : allEntries;

      const entries = selectedEntries.sort((a: any, b: any) => {
        if (a.startDate !== b.startDate) return String(a.startDate || '').localeCompare(String(b.startDate || ''));
        return (Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0);
      });
      return res.json({ success: true, entries });
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Failed to load weekly timetable');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  app.get('/api/learner/settings', requireLearnerAuth, async (_req: AuthenticatedLearnerRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    const defaultSettings = {
      id: 'school_config',
      schoolName: 'Sangurur Comprehensive School',
      schoolMotto: 'THINK, CODE, CHANGE THE WORLD',
      timezone: 'Africa/Nairobi',
      allowLearnerReflections: true,
      lateCutoffTime: '08:30',
      attendanceCutoffTime: '16:30',
      contactEmail: 'sangururschool10@gmail.com',
    };
    try {
      if (!db) return res.json({ success: true, settings: defaultSettings });
      const snap = await db.getDoc('schoolSettings', 'school_config');
      return res.json({
        success: true,
        settings: snap.exists ? { ...defaultSettings, ...snap.data() } : defaultSettings,
      });
    } catch {
      return res.json({ success: true, settings: defaultSettings });
    }
  });

  // Create Single Learner (Authenticated Teacher Only)
  app.post('/api/learners/create', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      const authTeacher = req.authTeacher!;
      const {
        fullName,
        cohortId,
        levelId,
        levelName,
        classId,
        className,
        gender,
        age,
        schoolName,
        grade,
        guardianContact,
        customDigitalId,
      } = req.body;

      if (!fullName || !String(fullName).trim() || !cohortId) {
        return res.status(400).json({ error: 'Full name and cohort assignment are required' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }

      const cohortSnap = await db.getDoc('cohorts', String(cohortId));
      if (!cohortSnap.exists) {
        return res.status(404).json({ error: 'Selected cohort was not found.' });
      }
      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;
      if (!hasSchoolWideAccess && cohortSnap.data()?.teacherId !== authTeacher.uid) {
        return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
      }

      let resolvedLevelId = levelId ? String(levelId).trim() : null;
      let resolvedLevelName = levelName ? String(levelName).trim() : null;
      let resolvedClassId = classId ? String(classId).trim() : null;
      let resolvedClassName = className ? String(className).trim() : null;

      if (resolvedClassId) {
        const classSnap = await db.getDoc('cohortClasses', resolvedClassId);
        if (classSnap.exists) {
          const cls = classSnap.data() || {};
          resolvedClassId = classSnap.id;
          resolvedClassName = cls.name || resolvedClassName;
          resolvedLevelId = cls.levelId || resolvedLevelId;
          resolvedLevelName = cls.levelName || resolvedLevelName;
        }
      }

      let digitalId = '';
      if (customDigitalId && String(customDigitalId).trim()) {
        digitalId = String(customDigitalId).trim().toUpperCase();
        const [dupByDigital, dupByUsername, dupByLearnerId] = await Promise.all([
          db.queryWhere('learners', [['digitalId', '==', digitalId]]),
          db.queryWhere('learners', [['username', '==', digitalId]]),
          db.queryWhere('learners', [['learnerId', '==', digitalId]]),
        ]);
        if (dupByDigital.length > 0 || dupByUsername.length > 0 || dupByLearnerId.length > 0) {
          return res.status(409).json({ error: `Digital ID ${digitalId} is already assigned to another learner.` });
        }
      } else {
        [digitalId] = await allocateDigitalIds(db, 1);
      }

      const username = digitalId;
      const learnerId = digitalId;

      const initialPassword = DEFAULT_INITIAL_PASSWORD;
      const salt = generateSalt();
      const passwordHash = hashPassword(initialPassword, salt);

      const normalizedSchool =
        schoolName && String(schoolName).trim()
          ? String(schoolName).trim().slice(0, 128)
          : 'Sangurur Comprehensive School';
      const normalizedGrade =
        grade && String(grade).trim() ? String(grade).trim().slice(0, 64) : null;

      const docId = `learner_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
      const newLearner = {
        id: docId,
        fullName: String(fullName).trim(),
        digitalId,
        learnerId,
        username,
        gender: gender || null,
        age: age ? Number(age) : null,
        schoolName: normalizedSchool,
        grade: normalizedGrade,
        guardianContact: guardianContact || null,
        assignedCohortIds: [cohortId],
        assignedClassIds: resolvedClassId ? [resolvedClassId] : [],
        levelId: resolvedLevelId,
        levelName: resolvedLevelName,
        classId: resolvedClassId,
        className: resolvedClassName,
        mustChangePassword: true,
        isFirstLogin: true,
        status: 'ACTIVE',
        active: true,
        passwordHash,
        salt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await db.setDoc('learners', docId, newLearner);

      const memberId = `mem_${cohortId}_${docId}`;
      await db.setDoc('cohortMembers', memberId, {
        id: memberId,
        cohortId,
        learnerId: docId,
        learnerName: newLearner.fullName,
        learnerCode: digitalId,
        ...(resolvedLevelId ? { levelId: resolvedLevelId, levelName: resolvedLevelName } : {}),
        ...(resolvedClassId ? { classId: resolvedClassId, className: resolvedClassName } : {}),
        joinedAt: new Date().toISOString(),
        status: 'active',
      });

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'CREATE_LEARNER',
        targetEntity: 'learner',
        targetId: docId,
        details: `Registered learner ${newLearner.fullName} with Digital ID ${digitalId} in cohort ${cohortId}${resolvedClassName ? ` (${resolvedLevelName || ''} / ${resolvedClassName})` : ''}.`,
      });

      return res.json({
        success: true,
        learner: {
          ...newLearner,
          passwordHash: undefined,
          salt: undefined,
          initialPassword: DEFAULT_INITIAL_PASSWORD,
        },
      });
    } catch (err: any) {
      console.error('Create learner error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Error creating learner');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Bulk Import Learners (Authenticated Teacher Only)
  app.post('/api/learners/bulk-import', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      const authTeacher = req.authTeacher!;
      const { cohortId, levelId, levelName, classId, className, learners } = req.body;
      if (!cohortId || !Array.isArray(learners) || learners.length === 0) {
        return res.status(400).json({ error: 'Cohort ID and a list of learners are required' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }

      const cohortSnap = await db.getDoc('cohorts', String(cohortId));
      if (!cohortSnap.exists) {
        return res.status(404).json({ error: 'Selected cohort was not found.' });
      }
      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;
      if (!hasSchoolWideAccess && cohortSnap.data()?.teacherId !== authTeacher.uid) {
        return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
      }

      let resolvedLevelId = levelId ? String(levelId).trim() : null;
      let resolvedLevelName = levelName ? String(levelName).trim() : null;
      let resolvedClassId = classId ? String(classId).trim() : null;
      let resolvedClassName = className ? String(className).trim() : null;

      if (resolvedClassId) {
        const classSnap = await db.getDoc('cohortClasses', resolvedClassId);
        if (classSnap.exists) {
          const cls = classSnap.data() || {};
          resolvedClassId = classSnap.id;
          resolvedClassName = cls.name || resolvedClassName;
          resolvedLevelId = cls.levelId || resolvedLevelId;
          resolvedLevelName = cls.levelName || resolvedLevelName;
        }
      }

      const validItems = learners.filter((item: any) => String(item?.fullName || '').trim().length > 0);
      if (validItems.length === 0) {
        return res.status(400).json({ error: 'No valid learner rows found in upload.' });
      }

      const allocatedIds = await allocateDigitalIds(db, validItems.length);

      const createdList: any[] = [];
      const errors: string[] = [];

      for (let i = 0; i < validItems.length; i++) {
        const item = validItems[i];
        try {
          const fullName = String(item.fullName).trim();
          const digitalId = allocatedIds[i];
          const username = digitalId;
          const learnerId = digitalId;

          const salt = generateSalt();
          const passwordHash = hashPassword(DEFAULT_INITIAL_PASSWORD, salt);

          const docId = `learner_${Date.now()}_${i}_${crypto.randomBytes(3).toString('hex')}`;
          const normalizedSchool =
            item.schoolName && String(item.schoolName).trim()
              ? String(item.schoolName).trim().slice(0, 128)
              : 'Sangurur Comprehensive School';
          const normalizedGrade =
            item.grade && String(item.grade).trim()
              ? String(item.grade).trim().slice(0, 64)
              : null;

          const newLearner = {
            id: docId,
            fullName,
            digitalId,
            learnerId,
            username,
            gender: item.gender || null,
            age: item.age ? Number(item.age) : null,
            schoolName: normalizedSchool,
            grade: normalizedGrade,
            guardianContact: item.guardianContact || null,
            assignedCohortIds: [cohortId],
            assignedClassIds: resolvedClassId ? [resolvedClassId] : [],
            levelId: resolvedLevelId,
            levelName: resolvedLevelName,
            classId: resolvedClassId,
            className: resolvedClassName,
            mustChangePassword: true,
            isFirstLogin: true,
            status: 'ACTIVE',
            active: true,
            passwordHash,
            salt,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await db.setDoc('learners', docId, newLearner);

          const memberId = `mem_${cohortId}_${docId}`;
          await db.setDoc('cohortMembers', memberId, {
            id: memberId,
            cohortId,
            learnerId: docId,
            learnerName: fullName,
            learnerCode: digitalId,
            ...(resolvedLevelId ? { levelId: resolvedLevelId, levelName: resolvedLevelName } : {}),
            ...(resolvedClassId ? { classId: resolvedClassId, className: resolvedClassName } : {}),
            joinedAt: new Date().toISOString(),
            status: 'active',
          });

          createdList.push({
            ...newLearner,
            passwordHash: undefined,
            salt: undefined,
            initialPassword: DEFAULT_INITIAL_PASSWORD,
          });
        } catch (err: any) {
          errors.push(`Error registering ${item.fullName}: ${err.message}`);
        }
      }

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'BULK_IMPORT_LEARNERS',
        targetEntity: 'cohort',
        targetId: cohortId,
        details: `Bulk imported ${createdList.length} learners into cohort ${cohortId} (${allocatedIds[0]} to ${allocatedIds[allocatedIds.length - 1]}).`,
      });

      return res.json({
        success: true,
        createdCount: createdList.length,
        learners: createdList,
        errors,
      });
    } catch (err: any) {
      console.error('Bulk import error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Error processing bulk import');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Teacher Resets Learner Password to Default Password (Authenticated Teacher Only)
  app.post('/api/learners/reset-password', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authTeacher = req.authTeacher!;
      const { learnerId } = req.body;
      if (!learnerId) return res.status(400).json({ error: 'Learner ID is required' });

      const snap = await db.getDoc('learners', learnerId);

      if (!snap.exists) {
        return res.status(404).json({ error: 'Learner account not found' });
      }

      const learnerData = snap.data() || {};
      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;

      if (!hasSchoolWideAccess) {
        const assignedCohortIds: string[] = Array.isArray(learnerData.assignedCohortIds)
          ? learnerData.assignedCohortIds
          : [];
        const teacherCohorts = await db.queryWhere('cohorts', [['teacherId', '==', authTeacher.uid]]);
        const allowedKeys = new Set<string>();
        teacherCohorts.forEach((c) => {
          allowedKeys.add(c.id);
          if (c.data()?.code) allowedKeys.add(c.data()?.code);
        });
        const ownsAnyLearnerCohort = assignedCohortIds.some((cid) => allowedKeys.has(cid));
        if (!ownsAnyLearnerCohort) {
          return res.status(403).json({ error: 'Access denied: learner is not enrolled in any of your cohorts.' });
        }
      }

      const salt = generateSalt();
      const passwordHash = hashPassword(DEFAULT_INITIAL_PASSWORD, salt);

      const resetTimestamp = Date.now();
      await db.updateDoc('learners', learnerId, {
        passwordHash,
        salt,
        mustChangePassword: true,
        isFirstLogin: true,
        status: 'ACTIVE',
        active: true,
        sessionRevokedAt: resetTimestamp,
        passwordResetAt: resetTimestamp,
        updatedAt: new Date().toISOString(),
      });

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'RESET_LEARNER_PASSWORD',
        targetEntity: 'learner',
        targetId: learnerId,
        details: `Authorised password reset to default '123456789' with mustChangePassword=true for ${learnerData.fullName} (Digital ID: ${learnerData.digitalId || learnerData.learnerId})`,
      });

      return res.json({
        success: true,
        digitalId: learnerData.digitalId || learnerData.learnerId,
        learnerName: learnerData.fullName,
        initialPassword: DEFAULT_INITIAL_PASSWORD,
        message: 'Password reset to default 123456789. Audit log entry recorded.',
      });
    } catch (err: any) {
      const formatted = formatServerFirestoreError(err, db, 'Error resetting password');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Update Student Details (Authenticated Teacher Only)
  app.post('/api/learners/update', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authTeacher = req.authTeacher!;
      const {
        learnerId,
        fullName,
        schoolName,
        grade,
        cohortId,
        levelId,
        levelName,
        classId,
        className,
        gender,
        age,
        guardianContact,
        status,
      } = req.body || {};

      const cleanDocId = String(learnerId || '').trim();
      if (!cleanDocId || cleanDocId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(cleanDocId)) {
        return res.status(400).json({ error: 'Valid learner document ID is required.' });
      }

      const cleanName = String(fullName || '').trim();
      if (!cleanName || cleanName.length > 128) {
        return res.status(400).json({ error: 'Full name is required and must be under 128 characters.' });
      }

      const snap = await db.getDoc('learners', cleanDocId);
      if (!snap.exists) {
        return res.status(404).json({ error: 'Learner account not found.' });
      }
      const existingLearner = snap.data() || {};

      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;

      const existingCohorts: string[] = Array.isArray(existingLearner.assignedCohortIds)
        ? existingLearner.assignedCohortIds.filter(Boolean).map((c: any) => String(c))
        : [];

      let allowedKeys = new Set<string>();
      if (!hasSchoolWideAccess) {
        const teacherCohorts = await db.queryWhere('cohorts', [['teacherId', '==', authTeacher.uid]]);
        teacherCohorts.forEach((c) => {
          allowedKeys.add(c.id);
          if (c.data()?.code) allowedKeys.add(String(c.data()?.code));
        });
        const ownsExisting = existingCohorts.some((cid) => allowedKeys.has(cid));
        if (!ownsExisting) {
          return res.status(403).json({ error: 'Access denied: learner is not enrolled in any of your cohorts.' });
        }
      }

      let targetCohortId = cohortId ? String(cohortId).trim() : existingCohorts[0] || '';
      if (targetCohortId) {
        const targetCohortSnap = await db.getDoc('cohorts', targetCohortId);
        if (!targetCohortSnap.exists) {
          return res.status(404).json({ error: 'Selected cohort was not found.' });
        }
        if (!hasSchoolWideAccess && targetCohortSnap.data()?.teacherId !== authTeacher.uid) {
          return res.status(403).json({ error: 'Access denied: you are not assigned to the selected cohort.' });
        }
      }

      let resolvedLevelId: string | null = levelId ? String(levelId).trim().slice(0, 128) : null;
      let resolvedLevelName: string | null = levelName ? String(levelName).trim().slice(0, 128) : null;
      let resolvedClassId: string | null = classId ? String(classId).trim().slice(0, 128) : null;
      let resolvedClassName: string | null = className ? String(className).trim().slice(0, 128) : null;

      if (resolvedClassId) {
        const classSnap = await db.getDoc('cohortClasses', resolvedClassId);
        if (classSnap.exists) {
          const cls = classSnap.data() || {};
          if (!targetCohortId || cls.cohortId === targetCohortId) {
            resolvedClassId = classSnap.id;
            resolvedClassName = cls.name ? String(cls.name).slice(0, 128) : resolvedClassName;
            resolvedLevelId = cls.levelId ? String(cls.levelId).slice(0, 128) : resolvedLevelId;
            resolvedLevelName = cls.levelName ? String(cls.levelName).slice(0, 128) : resolvedLevelName;
          } else {
            resolvedClassId = null;
            resolvedClassName = null;
            resolvedLevelId = null;
            resolvedLevelName = null;
          }
        }
      }

      const validGenders = new Set(['male', 'female', 'other', 'prefer_not_to_say']);
      const normalizedGender =
        gender && validGenders.has(String(gender).trim()) ? String(gender).trim() : null;

      let normalizedAge: number | null = null;
      if (age !== undefined && age !== null && String(age).trim() !== '') {
        const parsedAge = Number(age);
        if (!Number.isFinite(parsedAge) || parsedAge < 3 || parsedAge > 25) {
          return res.status(400).json({ error: 'Age must be a valid number between 3 and 25.' });
        }
        normalizedAge = Math.round(parsedAge);
      }

      const normalizedSchool =
        schoolName && String(schoolName).trim()
          ? String(schoolName).trim().slice(0, 128)
          : 'Sangurur Comprehensive School';
      const normalizedGrade =
        grade && String(grade).trim() ? String(grade).trim().slice(0, 64) : null;
      const normalizedGuardian =
        guardianContact && String(guardianContact).trim()
          ? String(guardianContact).trim().slice(0, 64)
          : null;

      const validStatuses = new Set(['ACTIVE', 'INACTIVE', 'ARCHIVED']);
      const normalizedStatus =
        status && validStatuses.has(String(status).trim().toUpperCase())
          ? (String(status).trim().toUpperCase() as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED')
          : ((existingLearner.status as 'ACTIVE' | 'INACTIVE' | 'ARCHIVED') || 'ACTIVE');

      const oldPrimaryCohortId = existingCohorts[0] || '';
      const updatedAssignedCohortIds = targetCohortId
        ? Array.from(
            new Set([
              targetCohortId,
              ...existingCohorts.filter((c) => c !== oldPrimaryCohortId && c !== targetCohortId),
            ])
          ).slice(0, 20)
        : existingCohorts;

      const updatedAssignedClassIds = resolvedClassId ? [resolvedClassId] : [];
      const nowIso = new Date().toISOString();

      const updateFields: Record<string, any> = {
        fullName: cleanName,
        schoolName: normalizedSchool,
        grade: normalizedGrade,
        gender: normalizedGender,
        age: normalizedAge,
        guardianContact: normalizedGuardian,
        assignedCohortIds: updatedAssignedCohortIds,
        assignedClassIds: updatedAssignedClassIds,
        levelId: resolvedLevelId,
        levelName: resolvedLevelName,
        classId: resolvedClassId,
        className: resolvedClassName,
        status: normalizedStatus,
        active: normalizedStatus === 'ACTIVE',
        updatedAt: nowIso,
      };

      await db.updateDoc('learners', cleanDocId, updateFields);

      // Keep cohortMembers synchronized with primary cohort & class changes
      if (oldPrimaryCohortId && targetCohortId && oldPrimaryCohortId !== targetCohortId) {
        await db.deleteDoc('cohortMembers', `mem_${oldPrimaryCohortId}_${cleanDocId}`).catch(() => {});
      }
      if (targetCohortId) {
        const memberId = `mem_${targetCohortId}_${cleanDocId}`;
        const existingMem = await db.getDoc('cohortMembers', memberId);
        const digitalId = String(existingLearner.digitalId || existingLearner.learnerId || existingLearner.username || '');
        await db.setDoc('cohortMembers', memberId, {
          id: memberId,
          cohortId: targetCohortId,
          learnerId: cleanDocId,
          learnerName: cleanName,
          learnerCode: digitalId,
          ...(resolvedLevelId ? { levelId: resolvedLevelId, levelName: resolvedLevelName } : {}),
          ...(resolvedClassId ? { classId: resolvedClassId, className: resolvedClassName } : {}),
          joinedAt: existingMem.exists ? existingMem.data()?.joinedAt || nowIso : nowIso,
          status: 'active',
        });
      }

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'UPDATE_LEARNER',
        targetEntity: 'learner',
        targetId: cleanDocId,
        details: `Updated details for ${cleanName} (${existingLearner.digitalId || existingLearner.learnerId || cleanDocId}) — School: ${normalizedSchool}${normalizedGrade ? `, Grade: ${normalizedGrade}` : ''}, Status: ${normalizedStatus}.`,
      });

      const merged: Record<string, any> = {
        ...existingLearner,
        ...updateFields,
        id: cleanDocId,
      };
      delete merged.passwordHash;
      delete merged.salt;

      return res.json({
        success: true,
        learner: merged,
      });
    } catch (err: any) {
      console.error('Update learner error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Error updating student details');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Delete Student Record & Associated Enrollment/Register Data (Authenticated Teacher Only)
  app.post('/api/learners/delete', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authTeacher = req.authTeacher!;
      const cleanDocId = String(req.body?.learnerId || '').trim();
      if (!cleanDocId || cleanDocId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(cleanDocId)) {
        return res.status(400).json({ error: 'Valid learner document ID is required.' });
      }

      const snap = await db.getDoc('learners', cleanDocId);
      if (!snap.exists) {
        return res.status(404).json({ error: 'Learner account not found.' });
      }
      const existingLearner = snap.data() || {};

      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;

      if (!hasSchoolWideAccess) {
        const assignedCohortIds: string[] = Array.isArray(existingLearner.assignedCohortIds)
          ? existingLearner.assignedCohortIds.filter(Boolean).map((c: any) => String(c))
          : [];
        const teacherCohorts = await db.queryWhere('cohorts', [['teacherId', '==', authTeacher.uid]]);
        const allowedKeys = new Set<string>();
        teacherCohorts.forEach((c) => {
          allowedKeys.add(c.id);
          if (c.data()?.code) allowedKeys.add(String(c.data()?.code));
        });
        const ownsAnyLearnerCohort = assignedCohortIds.some((cid) => allowedKeys.has(cid));
        if (!ownsAnyLearnerCohort) {
          return res.status(403).json({ error: 'Access denied: learner is not enrolled in any of your cohorts.' });
        }
      }

      // Clean up related records first, then remove the learner document
      const [memberDocs, registerDocs, feedbackDocs, certDocs] = await Promise.all([
        db.queryWhere('cohortMembers', [['learnerId', '==', cleanDocId]]).catch(() => []),
        db.queryWhere('dailyRegisters', [['learnerDocId', '==', cleanDocId]]).catch(() => []),
        db.queryWhere('teacherFeedback', [['learnerDocId', '==', cleanDocId]]).catch(() => []),
        db.queryWhere('masteryCertifications', [['learnerId', '==', cleanDocId]]).catch(() => []),
      ]);

      await Promise.all([
        ...memberDocs.map((d) => db.deleteDoc('cohortMembers', d.id).catch(() => {})),
        ...registerDocs.map((d) => db.deleteDoc('dailyRegisters', d.id).catch(() => {})),
        ...feedbackDocs.map((d) => db.deleteDoc('teacherFeedback', d.id).catch(() => {})),
        ...certDocs.map((d) => db.deleteDoc('masteryCertifications', d.id).catch(() => {})),
      ]);

      await db.deleteDoc('learners', cleanDocId);

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'DELETE_LEARNER',
        targetEntity: 'learner',
        targetId: cleanDocId,
        details: `Deleted learner ${existingLearner.fullName || cleanDocId} (${existingLearner.digitalId || existingLearner.learnerId || 'No ID'}, School: ${existingLearner.schoolName || 'Sangurur Comprehensive School'}).`,
      });

      return res.json({
        success: true,
        deletedLearnerId: cleanDocId,
      });
    } catch (err: any) {
      console.error('Delete learner error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Error deleting student record');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Daily Register Submission (Strictly authenticated learner)
  app.post('/api/attendance/submit', requireLearnerAuth, async (req: AuthenticatedLearnerRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authLearner = req.authLearner;
      if (authLearner.mustChangePassword) {
        return res.status(403).json({ error: 'You must complete your mandatory password change before submitting a register.' });
      }

      const {
        cohortId,
        cohortCode,
        levelId,
        levelName,
        classId,
        className,
        learnerDocId,
        date: requestedDate,
        status,
        didStudy = true,
        nonStudyReason,
        topicId,
        topicTitle,
        topicDescription,
        learningAreaId,
        learningAreaTitle,
        moduleId,
        moduleTitle,
        understandingLevel,
        reflectionLearned,
        reflectionActivity,
        reflectionDifficult,
        reflectionTeacherExplain,
      } = req.body;

      if (!cohortId || !status) {
        return res.status(400).json({ error: 'Cohort and attendance status are required' });
      }

      if (learnerDocId && learnerDocId !== authLearner.id) {
        return res.status(403).json({ error: 'Cannot submit attendance for another learner.' });
      }

      const nairobiToday = getNairobiDateString();
      const targetDate = requestedDate ? String(requestedDate).trim() : nairobiToday;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
        return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
      }
      const [yy, mm, dd] = targetDate.split('-').map(Number);
      const calCheck = new Date(Date.UTC(yy, mm - 1, dd));
      if (
        calCheck.getUTCFullYear() !== yy ||
        calCheck.getUTCMonth() !== mm - 1 ||
        calCheck.getUTCDate() !== dd
      ) {
        return res.status(400).json({ error: `Invalid calendar date: ${targetDate}` });
      }
      if (targetDate > nairobiToday) {
        return res.status(400).json({ error: `Cannot submit register for a future date (${targetDate}).` });
      }
      if (targetDate < '2020-01-01') {
        return res.status(400).json({ error: 'Selected date is out of valid range.' });
      }

      const isPreviousDay = targetDate < nairobiToday;

      const cleanCohortId = String(cohortId).trim();
      const cohortSnap = await db.getDoc('cohorts', cleanCohortId);
      if (!cohortSnap.exists) {
        return res.status(404).json({ error: 'Cohort not found.' });
      }
      const cohortData = cohortSnap.data() || {};
      if (cohortData.status !== 'active') {
        return res.status(403).json({ error: 'Attendance cannot be submitted to an archived or inactive cohort.' });
      }

      const isMember = await isLearnerCohortMember(db, authLearner, cleanCohortId, cohortData);
      if (!isMember) {
        return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
      }

      const normalizedStatus = String(status).trim().toLowerCase();
      if (!['present', 'late'].includes(normalizedStatus)) {
        return res.status(400).json({ error: 'Learners can only submit Present or Late attendance' });
      }

      const studied = didStudy !== false && didStudy !== 'false';
      const cleanNonStudyReason = !studied
        ? String(nonStudyReason || '').trim().slice(0, 256)
        : null;

      if (!studied && !cleanNonStudyReason) {
        return res.status(400).json({
          error: 'Please select or enter a reason explaining why you did not study (e.g., Power blackout).',
        });
      }

      const validUnderstanding = studied
        ? ['excellent', 'good', 'fair', 'needs_support'].includes(String(understandingLevel || ''))
          ? String(understandingLevel)
          : 'good'
        : null;

      let allowReflections = true;
      try {
        const settSnap = await db.getDoc('schoolSettings', 'school_config');
        if (settSnap.exists && settSnap.data()?.allowLearnerReflections === false) {
          allowReflections = false;
        }
      } catch {
        // default true
      }

      const docId = `reg_${cleanCohortId}_${authLearner.id}_${targetDate}`;
      const resolvedLevelId = levelId ? String(levelId).slice(0, 128) : authLearner.levelId || null;
      const resolvedLevelName = levelName ? String(levelName).slice(0, 128) : authLearner.levelName || null;
      const resolvedClassId = classId ? String(classId).slice(0, 128) : authLearner.classId || null;
      const resolvedClassName = className ? String(className).slice(0, 128) : authLearner.className || null;
      const resolvedLearnerCode =
        authLearner.digitalId || authLearner.learnerId || authLearner.username || authLearner.id;
      const resolvedLearnerName = authLearner.fullName || 'Learner';

      const payload: any = {
        id: docId,
        cohortId: cleanCohortId,
        cohortCode: String(cohortCode || cohortData.code || 'COHORT').slice(0, 64),
        levelId: resolvedLevelId,
        levelName: resolvedLevelName,
        classId: resolvedClassId,
        className: resolvedClassName,
        learnerDocId: authLearner.id,
        learnerId: resolvedLearnerCode,
        learnerName: resolvedLearnerName,
        date: targetDate,
        timestamp: new Date().toISOString(),
        status: normalizedStatus,
        didStudy: studied,
        nonStudyReason: cleanNonStudyReason,
        verificationStatus: 'pending_verification',
        learningAreaId: studied && learningAreaId ? String(learningAreaId).slice(0, 128) : null,
        learningAreaTitle: studied && learningAreaTitle ? String(learningAreaTitle).slice(0, 128) : null,
        moduleId: studied && moduleId ? String(moduleId).slice(0, 128) : null,
        moduleTitle: studied && moduleTitle ? String(moduleTitle).slice(0, 128) : null,
        topicId: studied && topicId ? String(topicId).slice(0, 128) : null,
        topicTitle: studied && topicTitle ? String(topicTitle).trim().slice(0, 128) || null : null,
        topicDescription: studied && topicDescription ? String(topicDescription).slice(0, 512) : null,
        understandingLevel: validUnderstanding,
        reflectionLearned: allowReflections && reflectionLearned ? String(reflectionLearned).slice(0, 1024) : null,
        reflectionActivity: allowReflections && reflectionActivity ? String(reflectionActivity).slice(0, 1024) : null,
        reflectionDifficult: allowReflections && reflectionDifficult ? String(reflectionDifficult).slice(0, 1024) : null,
        reflectionTeacherExplain:
          allowReflections && reflectionTeacherExplain ? String(reflectionTeacherExplain).slice(0, 1024) : null,
        correctionHistory: [],
      };

      const txResult = await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get('dailyRegisters', docId);
        if (existingSnap.exists) {
          const existingData = existingSnap.data() || {};
          if (!isPreviousDay) {
            return { conflict: existingData, blocked: false, updated: false, saved: null };
          }
          if (['absent', 'excused'].includes(existingData.status)) {
            return { conflict: existingData, blocked: true, updated: false, saved: null };
          }
          const mergedPrevious = stripUndefinedDeep({
            ...existingData,
            id: docId,
            cohortId: cleanCohortId,
            cohortCode: existingData.cohortCode || payload.cohortCode,
            levelId: existingData.levelId ?? payload.levelId,
            levelName: existingData.levelName ?? payload.levelName,
            classId: existingData.classId ?? payload.classId,
            className: existingData.className ?? payload.className,
            learnerDocId: authLearner.id,
            learnerId: existingData.learnerId || payload.learnerId,
            learnerName: existingData.learnerName || payload.learnerName,
            date: targetDate,
            status: existingData.verificationStatus === 'corrected' ? existingData.status : normalizedStatus,
            didStudy: studied,
            nonStudyReason: cleanNonStudyReason,
            learningAreaId: payload.learningAreaId,
            learningAreaTitle: payload.learningAreaTitle,
            moduleId: payload.moduleId,
            moduleTitle: payload.moduleTitle,
            topicId: payload.topicId,
            topicTitle: payload.topicTitle,
            topicDescription: payload.topicDescription,
            understandingLevel: validUnderstanding,
            reflectionLearned: payload.reflectionLearned ?? existingData.reflectionLearned ?? null,
            reflectionActivity: payload.reflectionActivity ?? existingData.reflectionActivity ?? null,
            reflectionDifficult: payload.reflectionDifficult ?? existingData.reflectionDifficult ?? null,
            reflectionTeacherExplain:
              payload.reflectionTeacherExplain ?? existingData.reflectionTeacherExplain ?? null,
            timestamp: existingData.timestamp || new Date().toISOString(),
          });
          tx.set('dailyRegisters', docId, mergedPrevious);
          return { conflict: null, blocked: false, updated: true, saved: mergedPrevious };
        }

        tx.set('dailyRegisters', docId, payload);
        return { conflict: null, blocked: false, updated: false, saved: payload };
      });

      if (txResult.blocked) {
        return res.status(403).json({
          error: `A teacher marked you ${String(txResult.conflict?.status || '').toUpperCase()} on ${targetDate}. Please contact your teacher to correct attendance.`,
        });
      }

      if (txResult.conflict) {
        return res.status(409).json({
          error: 'Your register for today has already been submitted.',
          alreadySubmitted: true,
          submission: txResult.conflict,
        });
      }

      if (isPreviousDay) {
        await writeAuditLog(db, {
          actorId: authLearner.id,
          actorName: resolvedLearnerName,
          actorRole: 'learner',
          action: txResult.updated ? 'LEARNER_UPDATE_PREVIOUS_DAY_REGISTER' : 'LEARNER_SUBMIT_PREVIOUS_DAY_REGISTER',
          targetEntity: 'dailyRegister',
          targetId: docId,
          details: `${txResult.updated ? 'Updated' : 'Submitted'} register for ${targetDate}: status=${txResult.saved.status}, didStudy=${studied}${
            cleanNonStudyReason
              ? `, reason=${cleanNonStudyReason}`
              : `, area=${payload.learningAreaTitle || 'General'}, topic=${payload.topicTitle || 'N/A'}, understanding=${validUnderstanding}`
          }.`,
        });
      }

      return res.json({
        success: true,
        updated: txResult.updated,
        message: isPreviousDay
          ? txResult.updated
            ? `Previous day (${targetDate}) learning record updated successfully!`
            : `Previous day (${targetDate}) register submitted successfully!`
          : 'Daily register submitted successfully!',
        register: txResult.saved,
      });
    } catch (err: any) {
      console.error('Attendance submit error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Failed to submit daily register');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Bulk Upload Historical / Previous Dates Attendance Register (Authenticated Teacher Only)
  app.post('/api/attendance/bulk-upload', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      const authTeacher = req.authTeacher!;
      const {
        cohortId,
        entries,
        conflictMode = 'skip',
        sessionLabel,
      } = req.body;

      if (!Array.isArray(entries) || entries.length === 0) {
        return res.status(400).json({ error: 'At least one attendance entry is required for upload.' });
      }

      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }

      const [cohortsDocs, learnersDocs] = await Promise.all([
        db.getCollectionDocs('cohorts'),
        db.getCollectionDocs('learners'),
      ]);

      const cohortsById = new Map<string, any>();
      const cohortsByCode = new Map<string, any>();
      cohortsDocs.forEach((d) => {
        const c: Record<string, any> = { ...d.data(), id: d.id };
        cohortsById.set(d.id, c);
        if (c.code) cohortsByCode.set(String(c.code).trim().toUpperCase(), c);
      });

      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;

      const defaultCohort = cohortId ? cohortsById.get(String(cohortId)) : null;
      if (cohortId && !defaultCohort) {
        return res.status(404).json({ error: 'Selected target cohort was not found.' });
      }
      if (defaultCohort && !hasSchoolWideAccess && defaultCohort.teacherId !== authTeacher.uid) {
        return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
      }

      const learnersList = learnersDocs.map((d) => ({ ...d.data(), id: d.id }));
      const learnersByDigitalId = new Map<string, any>();
      learnersList.forEach((l: any) => {
        const keys = [l.digitalId, l.learnerId, l.username, l.id].filter(Boolean);
        keys.forEach((k) => learnersByDigitalId.set(String(k).trim().toUpperCase(), l));
      });

      const nairobiToday = getNairobiDateString();
      const cleanSessionLabel = sessionLabel ? String(sessionLabel).trim().slice(0, 120) : '';
      const mode: 'skip' | 'overwrite' = conflictMode === 'overwrite' ? 'overwrite' : 'skip';

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      const errors: string[] = [];
      const skipped: string[] = [];
      const uploadedDates = new Set<string>();

      for (let i = 0; i < entries.length; i++) {
        const item = entries[i];
        const rowNum = item?.rowNumber || i + 1;

        const dateStr = String(item?.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          errors.push(`Row ${rowNum}: Invalid date "${dateStr}". Expected YYYY-MM-DD.`);
          continue;
        }

        const [yy, mm, dd] = dateStr.split('-').map(Number);
        const checkDate = new Date(Date.UTC(yy, mm - 1, dd));
        if (
          checkDate.getUTCFullYear() !== yy ||
          checkDate.getUTCMonth() !== mm - 1 ||
          checkDate.getUTCDate() !== dd
        ) {
          errors.push(`Row ${rowNum}: Non-existent calendar date "${dateStr}".`);
          continue;
        }

        if (dateStr > nairobiToday) {
          errors.push(`Row ${rowNum}: Date ${dateStr} is in the future (today is ${nairobiToday}).`);
          continue;
        }

        const status = String(item?.status || '').trim().toLowerCase();
        if (!['present', 'late', 'absent', 'excused'].includes(status)) {
          errors.push(`Row ${rowNum}: Invalid status "${item?.status}".`);
          continue;
        }

        let targetCohort = defaultCohort;
        if (item?.cohortCode) {
          const byCode = cohortsByCode.get(String(item.cohortCode).trim().toUpperCase());
          if (byCode) {
            targetCohort = byCode;
          } else if (!targetCohort) {
            errors.push(`Row ${rowNum}: Cohort code "${item.cohortCode}" was not found.`);
            continue;
          }
        }
        if (!targetCohort) {
          errors.push(`Row ${rowNum}: No target cohort specified.`);
          continue;
        }
        if (!hasSchoolWideAccess && targetCohort.teacherId !== authTeacher.uid) {
          errors.push(`Row ${rowNum}: Access denied for cohort "${targetCohort.code}".`);
          continue;
        }

        const rawId = item?.learnerId ? String(item.learnerId).trim().toUpperCase() : '';
        const rawName = item?.learnerName ? String(item.learnerName).trim().toLowerCase() : '';

        let matchedLearner = rawId ? learnersByDigitalId.get(rawId) : undefined;
        if (!matchedLearner && rawName) {
          matchedLearner =
            learnersList.find(
              (l: any) =>
                String(l.fullName || '').trim().toLowerCase() === rawName &&
                Array.isArray(l.assignedCohortIds) &&
                (l.assignedCohortIds.includes(targetCohort.id) || l.assignedCohortIds.includes(targetCohort.code))
            ) ||
            learnersList.find((l: any) => String(l.fullName || '').trim().toLowerCase() === rawName);
        }

        if (!matchedLearner) {
          errors.push(
            `Row ${rowNum}: Learner "${item?.learnerId || item?.learnerName || 'Unknown'}" was not found in registered learners.`
          );
          continue;
        }

        const docId = `reg_${targetCohort.id}_${matchedLearner.id}_${dateStr}`;
        const existingSnap = await db.getDoc('dailyRegisters', docId);

        const learnerDigitalId = matchedLearner.digitalId || matchedLearner.learnerId;
        const validUnderstanding = ['excellent', 'good', 'fair', 'needs_support'].includes(
          String(item?.understandingLevel || '').trim()
        )
          ? String(item.understandingLevel).trim()
          : null;
        const noteText = item?.teacherNote
          ? String(item.teacherNote).trim().slice(0, 1024)
          : cleanSessionLabel
          ? `Historical Excel Upload (${cleanSessionLabel})`
          : 'Historical Excel Register Upload';
        const topicText = item?.topicTitle
          ? String(item.topicTitle).trim().slice(0, 128)
          : cleanSessionLabel || null;

        if (existingSnap.exists) {
          if (mode === 'skip') {
            skippedCount++;
            skipped.push(`Row ${rowNum}: ${matchedLearner.fullName} (${dateStr}) already exists`);
            continue;
          }

          const existingData = existingSnap.data() || {};
          const prevHistory = Array.isArray(existingData.correctionHistory) ? existingData.correctionHistory : [];
          const correctionEntry = {
            correctedBy: authTeacher.uid,
            correctedByName: authTeacher.fullName,
            timestamp: new Date().toISOString(),
            previousStatus: existingData.status,
            newStatus: status,
            reason: noteText,
          };

          await db.updateDoc('dailyRegisters', docId, {
            cohortId: targetCohort.id,
            cohortCode: targetCohort.code || 'COHORT',
            learnerDocId: matchedLearner.id,
            learnerId: learnerDigitalId,
            learnerName: matchedLearner.fullName,
            date: dateStr,
            status,
            verificationStatus: 'corrected',
            topicTitle: topicText ?? existingData.topicTitle ?? null,
            understandingLevel: validUnderstanding ?? existingData.understandingLevel ?? null,
            teacherNote: noteText,
            reviewedBy: authTeacher.uid,
            reviewedAt: new Date().toISOString(),
            correctionHistory: [...prevHistory, correctionEntry],
          });

          updatedCount++;
          uploadedDates.add(dateStr);
        } else {
          await db.setDoc('dailyRegisters', docId, {
            id: docId,
            cohortId: targetCohort.id,
            cohortCode: targetCohort.code || 'COHORT',
            learnerDocId: matchedLearner.id,
            learnerId: learnerDigitalId,
            learnerName: matchedLearner.fullName,
            date: dateStr,
            timestamp: `${dateStr}T08:00:00+03:00`,
            status,
            verificationStatus: 'verified',
            topicTitle: topicText,
            understandingLevel: validUnderstanding,
            teacherNote: noteText,
            reviewedBy: authTeacher.uid,
            reviewedAt: new Date().toISOString(),
            correctionHistory: [],
          });

          createdCount++;
          uploadedDates.add(dateStr);
        }
      }

      const sortedDates = Array.from(uploadedDates).sort();
      const dateSpan =
        sortedDates.length > 0
          ? sortedDates.length === 1
            ? sortedDates[0]
            : `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`
          : 'none';

      if (createdCount > 0 || updatedCount > 0) {
        await writeAuditLog(db, {
          actorId: authTeacher.uid,
          actorName: authTeacher.fullName,
          actorRole: authTeacher.role,
          action: 'BULK_UPLOAD_HISTORICAL_REGISTER',
          targetEntity: 'dailyRegister',
          targetId: defaultCohort?.id || 'multi_cohort',
          details: `Uploaded previous dates Excel register${cleanSessionLabel ? ` (${cleanSessionLabel})` : ''}: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped. Dates: ${dateSpan}.`,
        });
      }

      return res.json({
        success: true,
        createdCount,
        updatedCount,
        skippedCount,
        failedCount: errors.length,
        errors,
        skipped,
        uploadedDates: sortedDates,
      });
    } catch (err: any) {
      console.error('Historical attendance upload error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Failed to upload historical attendance register');
      return res.status(formatted.status).json({ error: formatted.message });
    }
  });

  // Verify Student Daily Register (Authenticated Teacher / Admin Only)
  app.post('/api/attendance/verify', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authTeacher = req.authTeacher!;
      const registerId = String(req.body?.registerId || '').trim();
      if (!registerId) {
        return res.status(400).json({ error: 'Register ID is required.' });
      }

      const regSnap = await db.getDoc('dailyRegisters', registerId);
      if (!regSnap.exists) {
        return res.status(404).json({ error: 'Daily register entry was not found.' });
      }

      const existingData = regSnap.data() || {};
      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;

      if (!hasSchoolWideAccess && existingData.cohortId) {
        const cohortSnap = await db.getDoc('cohorts', String(existingData.cohortId));
        if (!cohortSnap.exists || cohortSnap.data()?.teacherId !== authTeacher.uid) {
          return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
        }
      }

      const reviewedAt = new Date().toISOString();
      await db.updateDoc('dailyRegisters', registerId, {
        verificationStatus: 'verified',
        reviewedBy: authTeacher.uid,
        reviewedAt,
      });

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'VERIFY_ATTENDANCE',
        targetEntity: 'dailyRegister',
        targetId: registerId,
        details: `Verified daily register for ${existingData.learnerName || existingData.learnerId || registerId} (${existingData.date || ''}).`,
      });

      return res.json({
        success: true,
        register: {
          ...existingData,
          id: registerId,
          verificationStatus: 'verified',
          reviewedBy: authTeacher.uid,
          reviewedAt,
        },
      });
    } catch (err: any) {
      console.error('Verify register error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Failed to verify student register');
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  // Correct Student Daily Register with Audit Trail (Authenticated Teacher / Admin Only)
  app.post('/api/attendance/correct', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authTeacher = req.authTeacher!;
      const registerId = String(req.body?.registerId || '').trim();
      const newStatus = String(req.body?.newStatus || '').trim().toLowerCase();
      const reason = String(req.body?.reason || '').trim().slice(0, 1024);

      if (!registerId || !reason) {
        return res.status(400).json({ error: 'Register ID and correction reason are required.' });
      }
      if (!['present', 'late', 'absent', 'excused'].includes(newStatus)) {
        return res.status(400).json({ error: 'Invalid attendance status.' });
      }

      const regSnap = await db.getDoc('dailyRegisters', registerId);
      if (!regSnap.exists) {
        return res.status(404).json({ error: 'Daily register entry was not found.' });
      }

      const existingData = regSnap.data() || {};
      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;

      if (!hasSchoolWideAccess && existingData.cohortId) {
        const cohortSnap = await db.getDoc('cohorts', String(existingData.cohortId));
        if (!cohortSnap.exists || cohortSnap.data()?.teacherId !== authTeacher.uid) {
          return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
        }
      }

      const reviewedAt = new Date().toISOString();
      const prevHistory = Array.isArray(existingData.correctionHistory) ? existingData.correctionHistory : [];
      const correctionEntry = {
        correctedBy: authTeacher.uid,
        correctedByName: authTeacher.fullName,
        timestamp: reviewedAt,
        previousStatus: existingData.status || 'present',
        newStatus,
        reason,
      };
      const nextHistory = [...prevHistory, correctionEntry];

      await db.updateDoc('dailyRegisters', registerId, {
        status: newStatus,
        verificationStatus: 'corrected',
        teacherNote: reason,
        reviewedBy: authTeacher.uid,
        reviewedAt,
        correctionHistory: nextHistory,
      });

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'CORRECT_ATTENDANCE',
        targetEntity: 'dailyRegister',
        targetId: registerId,
        details: `Corrected status for ${existingData.learnerName || registerId} on ${existingData.date || ''} from ${existingData.status} to ${newStatus}. Reason: ${reason}`,
      });

      return res.json({
        success: true,
        register: {
          ...existingData,
          id: registerId,
          status: newStatus,
          verificationStatus: 'corrected',
          teacherNote: reason,
          reviewedBy: authTeacher.uid,
          reviewedAt,
          correctionHistory: nextHistory,
        },
      });
    } catch (err: any) {
      console.error('Correct attendance error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Failed to correct student register');
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  // Mark Learner Absent or Excused (Authenticated Teacher / Admin Only)
  app.post('/api/attendance/mark', requireTeacherAuth, async (req: AuthenticatedTeacherRequest, res: Response) => {
    const { db } = getServerDbAdapter();
    try {
      if (!db) {
        return res.status(503).json({ error: 'Database service unavailable' });
      }
      const authTeacher = req.authTeacher!;
      const {
        cohortId,
        cohortCode,
        learnerDocId,
        learnerId,
        learnerName,
        date,
        status,
        reason,
      } = req.body || {};

      const cleanCohortId = String(cohortId || '').trim();
      const cleanLearnerDocId = String(learnerDocId || '').trim();
      const cleanDate = String(date || '').trim();
      const cleanStatus = String(status || '').trim().toLowerCase();

      if (!cleanCohortId || !cleanLearnerDocId || !cleanDate || !['absent', 'excused'].includes(cleanStatus)) {
        return res.status(400).json({ error: 'Cohort, learner, date, and valid status (absent/excused) are required.' });
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
        return res.status(400).json({ error: 'Invalid date format. Expected YYYY-MM-DD.' });
      }

      const cohortSnap = await db.getDoc('cohorts', cleanCohortId);
      if (!cohortSnap.exists) {
        return res.status(404).json({ error: 'Selected cohort was not found.' });
      }
      const hasSchoolWideAccess =
        authTeacher.role === 'admin' ||
        authTeacher.role === 'super_admin' ||
        authTeacher.uid === DEFAULT_TEACHER_UID;
      if (!hasSchoolWideAccess && cohortSnap.data()?.teacherId !== authTeacher.uid) {
        return res.status(403).json({ error: 'Access denied: you are not assigned to this cohort.' });
      }

      const docId = `reg_${cleanCohortId}_${cleanLearnerDocId}_${cleanDate}`;
      const existingSnap = await db.getDoc('dailyRegisters', docId);
      if (existingSnap.exists) {
        return res.status(409).json({
          error: `An attendance entry for ${learnerName || cleanLearnerDocId} on ${cleanDate} already exists (${existingSnap.data()?.status}). Use "Correct" to modify it with an audit trail.`,
        });
      }

      const reviewedAt = new Date().toISOString();
      const noteText = reason ? String(reason).trim().slice(0, 1024) : `Marked ${cleanStatus} by teacher`;
      const record = {
        id: docId,
        cohortId: cleanCohortId,
        cohortCode: String(cohortCode || cohortSnap.data()?.code || 'COHORT').slice(0, 64),
        learnerDocId: cleanLearnerDocId,
        learnerId: String(learnerId || cleanLearnerDocId).slice(0, 64),
        learnerName: String(learnerName || 'Learner').slice(0, 128),
        date: cleanDate,
        timestamp: reviewedAt,
        status: cleanStatus,
        verificationStatus: 'verified',
        teacherNote: noteText,
        reviewedBy: authTeacher.uid,
        reviewedAt,
        correctionHistory: [],
      };

      await db.setDoc('dailyRegisters', docId, record);

      await writeAuditLog(db, {
        actorId: authTeacher.uid,
        actorName: authTeacher.fullName,
        actorRole: authTeacher.role,
        action: 'TEACHER_MARK_ATTENDANCE',
        targetEntity: 'dailyRegister',
        targetId: docId,
        details: `Teacher marked ${record.learnerName} (${record.learnerId}) as ${cleanStatus} for ${cleanDate}. Note: ${noteText}`,
      });

      return res.json({ success: true, register: record });
    } catch (err: any) {
      console.error('Mark attendance error:', err);
      const formatted = formatServerFirestoreError(err, db, 'Failed to record teacher attendance entry');
      return res.status(formatted.status).json({ error: formatted.message, code: formatted.code });
    }
  });

  return app;
}
