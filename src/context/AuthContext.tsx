import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signOut as fbSignOut,
  db,
} from '../services/firebase';
import {
  onAuthStateChanged,
  signInWithCustomToken,
  User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Teacher, Learner, Cohort, UserRole } from '../types';
import { learnerFetch, teacherFetch } from '../utils/authHeaders';

const LOCAL_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const LEARNER_SESSION_KEY = 'sdlr_learner_session';
const TEACHER_SESSION_KEY = 'sdlr_teacher_session';

function safeStorageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota or restricted iframe errors
  }
}

function safeStorageRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage access errors
  }
}

interface StoredLearnerSession {
  token: string;
  expiresAt: number;
  learner: Learner;
}

interface StoredTeacherSession {
  token: string;
  expiresAt: number;
  teacher: Teacher;
}

interface AuthContextType {
  firebaseUser: FirebaseUser | null;
  role: UserRole | null;
  teacherProfile: Teacher | null;
  teacherToken: string | null;
  learnerProfile: Learner | null;
  learnerToken: string | null;
  activeCohort: Cohort | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginAsTeacher: (username: string, password: string) => Promise<void>;
  loginAsLearner: (
    username: string,
    password: string
  ) => Promise<{ success: boolean; isFirstLogin: boolean; learner: Learner }>;
  changeLearnerPassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  setActiveCohort: (cohort: Cohort | null) => void;
  logout: () => Promise<void>;
  refreshLearnerData: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function readApiJson(response: Response): Promise<any> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const isHtml = raw.trim().startsWith('<');
    throw new Error(
      isHtml
        ? `Authentication endpoint returned an unexpected HTML response (HTTP ${response.status}). Ensure Netlify Functions / Express API routes are active.`
        : `Server returned invalid JSON response (HTTP ${response.status}).`
    );
  }
}

function readStoredLearnerSession(): StoredLearnerSession | null {
  try {
    const raw = safeStorageGet(LEARNER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.learner && parsed.expiresAt) {
      if (Date.now() > parsed.expiresAt) {
        safeStorageRemove(LEARNER_SESSION_KEY);
        return null;
      }
      return parsed as StoredLearnerSession;
    }
    safeStorageRemove(LEARNER_SESSION_KEY);
    return null;
  } catch {
    safeStorageRemove(LEARNER_SESSION_KEY);
    return null;
  }
}

function readStoredTeacherSession(): StoredTeacherSession | null {
  try {
    const raw = safeStorageGet(TEACHER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.token && parsed.teacher && parsed.expiresAt) {
      if (Date.now() > parsed.expiresAt) {
        safeStorageRemove(TEACHER_SESSION_KEY);
        return null;
      }
      return parsed as StoredTeacherSession;
    }
    safeStorageRemove(TEACHER_SESSION_KEY);
    return null;
  } catch {
    safeStorageRemove(TEACHER_SESSION_KEY);
    return null;
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [teacherProfile, setTeacherProfile] = useState<Teacher | null>(null);
  const [teacherToken, setTeacherToken] = useState<string | null>(null);
  const [learnerProfile, setLearnerProfile] = useState<Learner | null>(null);
  const [learnerToken, setLearnerToken] = useState<string | null>(null);
  const [activeCohort, setActiveCohort] = useState<Cohort | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const googleSignInInFlightRef = useRef<boolean>(false);
  const sessionVersionRef = useRef<number>(0);

  // Restore and live-validate learner session with server on mount
  useEffect(() => {
    let cancelled = false;

    async function validateSavedLearner() {
      const saved = readStoredLearnerSession();
      if (!saved) return;
      const startGen = sessionVersionRef.current;

      try {
        const res = await learnerFetch('/api/auth/learner-session', saved.token);
        if (cancelled || sessionVersionRef.current !== startGen) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            safeStorageRemove(LEARNER_SESSION_KEY);
            setLearnerProfile(null);
            setLearnerToken(null);
            setRole((prev) => (prev === 'learner' ? null : prev));
          } else {
            setLearnerToken(saved.token);
            setLearnerProfile(saved.learner);
            setRole('learner');
          }
          return;
        }
        const data = await readApiJson(res);
        if (!cancelled && sessionVersionRef.current === startGen && data.learner) {
          const nextToken = data.token || saved.token;
          const nextExpiresAt = data.expiresAt || saved.expiresAt;
          const updatedSession: StoredLearnerSession = {
            token: nextToken,
            expiresAt: nextExpiresAt,
            learner: data.learner,
          };
          safeStorageSet(LEARNER_SESSION_KEY, JSON.stringify(updatedSession));
          setLearnerToken(nextToken);
          setLearnerProfile(data.learner);
          setRole('learner');
        }
      } catch {
        if (!cancelled && sessionVersionRef.current === startGen) {
          setLearnerToken(saved.token);
          setLearnerProfile(saved.learner);
          setRole('learner');
        }
      }
    }

    validateSavedLearner();
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore and live-validate saved teacher credential session with server on mount
  useEffect(() => {
    let cancelled = false;

    async function validateSavedTeacher() {
      const saved = readStoredTeacherSession();
      if (!saved) return;
      const startGen = sessionVersionRef.current;

      try {
        const res = await teacherFetch('/api/auth/teacher-session', saved.token);
        if (cancelled || sessionVersionRef.current !== startGen) return;
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            safeStorageRemove(TEACHER_SESSION_KEY);
            setTeacherToken(null);
            setTeacherProfile(null);
            setRole((prev) => (prev && prev !== 'learner' ? null : prev));
          } else {
            setTeacherToken(saved.token);
            setTeacherProfile(saved.teacher);
            setRole(saved.teacher.role || 'teacher');
          }
          return;
        }
        const data = await readApiJson(res);
        if (!cancelled && sessionVersionRef.current === startGen && data.teacher) {
          if (data.firebaseCustomToken && !auth.currentUser) {
            signInWithCustomToken(auth, data.firebaseCustomToken).catch(() => {});
          }
          const nextToken = data.token || saved.token;
          const nextExpiresAt = data.expiresAt || saved.expiresAt;
          const updatedSession: StoredTeacherSession = {
            token: nextToken,
            expiresAt: nextExpiresAt,
            teacher: data.teacher,
          };
          safeStorageSet(TEACHER_SESSION_KEY, JSON.stringify(updatedSession));
          setTeacherToken(nextToken);
          setTeacherProfile(data.teacher);
          setRole(data.teacher.role || 'teacher');
        }
      } catch {
        if (!cancelled && sessionVersionRef.current === startGen) {
          setTeacherToken(saved.token);
          setTeacherProfile(saved.teacher);
          setRole(saved.teacher.role || 'teacher');
        }
      }
    }

    validateSavedTeacher();
    return () => {
      cancelled = true;
    };
  }, []);

  // Monitor Firebase Auth state for Google Staff Sign-In (preserving custom-token staff/learner sessions)
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const isGoogleProvider = user.providerData?.some((p) => p.providerId === 'google.com');

        // Custom-token sessions are managed explicitly by loginAsTeacher / loginAsLearner
        if (!isGoogleProvider) {
          setFirebaseUser(user);
          setLoading(false);
          return;
        }

        const startGen = sessionVersionRef.current;
        setFirebaseUser(user);
        safeStorageRemove(LEARNER_SESSION_KEY);
        safeStorageRemove(TEACHER_SESSION_KEY);
        setLearnerProfile(null);
        setLearnerToken(null);
        setTeacherToken(null);

        try {
          const teacherDocRef = doc(db, 'teachers', user.uid);
          const snap = await getDoc(teacherDocRef);
          if (sessionVersionRef.current !== startGen) return;

          const isBootstrapAdmin =
            user.email === 'sangururschool10@gmail.com' ||
            user.email === 'sangururschool2@gmail.com';

          if (snap.exists()) {
            const data = snap.data() as Teacher;
            if (isBootstrapAdmin && data.role !== 'admin' && data.role !== 'super_admin') {
              const upgraded: Teacher = {
                ...data,
                role: 'admin',
                updatedAt: new Date().toISOString(),
              };
              await setDoc(teacherDocRef, upgraded);
              if (sessionVersionRef.current !== startGen) return;
              setTeacherProfile(upgraded);
              setRole('admin');
            } else {
              setTeacherProfile(data);
              setRole(data.role || 'teacher');
            }
          } else {
            const newTeacher: Teacher = {
              uid: user.uid,
              email: user.email || 'teacher@sangururschool.edu.ke',
              fullName: user.displayName || (isBootstrapAdmin ? 'School Administrator' : 'Staff Teacher'),
              role: isBootstrapAdmin ? 'admin' : 'teacher',
              active: true,
              createdAt: new Date().toISOString(),
            };
            await setDoc(teacherDocRef, newTeacher);
            if (sessionVersionRef.current !== startGen) return;
            setTeacherProfile(newTeacher);
            setRole(newTeacher.role);
          }
        } catch (err) {
          if (sessionVersionRef.current !== startGen) return;
          console.error('Error fetching teacher profile:', err);
          const isBootstrapAdmin =
            user.email === 'sangururschool10@gmail.com' ||
            user.email === 'sangururschool2@gmail.com';
          setTeacherProfile({
            uid: user.uid,
            email: user.email || 'teacher@sangurur.ac.ke',
            fullName: user.displayName || 'Staff Teacher',
            role: isBootstrapAdmin ? 'admin' : 'teacher',
            active: true,
            createdAt: new Date().toISOString(),
          });
          setRole(isBootstrapAdmin ? 'admin' : 'teacher');
        }
      } else {
        setFirebaseUser(null);
        const savedLearner = readStoredLearnerSession();
        const savedTeacher = readStoredTeacherSession();
        if (!savedLearner && !savedTeacher) {
          setTeacherProfile(null);
          setTeacherToken(null);
          setRole(null);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Teacher Google Auth Login
  const loginWithGoogle = async () => {
    if (googleSignInInFlightRef.current) {
      return;
    }
    googleSignInInFlightRef.current = true;
    sessionVersionRef.current += 1;
    try {
      await signInWithPopup(auth, googleProvider);
      safeStorageRemove(LEARNER_SESSION_KEY);
      safeStorageRemove(TEACHER_SESSION_KEY);
      setLearnerProfile(null);
      setLearnerToken(null);
      setTeacherToken(null);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code || '')
          : '';

      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        throw new Error(
          'Google Sign-In popup was closed before completing sign-in. Click "Sign In with Google Staff Account" again to continue.'
        );
      }
      if (code === 'auth/popup-blocked') {
        throw new Error(
          'Google Sign-In popup was blocked by your browser. Please allow popups for this site and try again.'
        );
      }
      if (code === 'auth/unauthorized-domain') {
        throw new Error(
          'This domain is not authorized for Google Sign-In in Firebase Authentication settings.'
        );
      }
      if (code === 'auth/network-request-failed') {
        throw new Error(
          'Network error while connecting to Google Sign-In. Please check your internet connection and try again.'
        );
      }

      const fallbackMessage =
        err instanceof Error && err.message
          ? err.message
          : 'Google Sign-In could not be completed. Please try again.';
      console.warn('Google Sign-In issue:', code || fallbackMessage);
      throw new Error(fallbackMessage);
    } finally {
      googleSignInInFlightRef.current = false;
    }
  };

  // Teacher Username & Password Login
  const loginAsTeacher = async (username: string, password: string) => {
    const response = await fetch('/api/auth/teacher-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await readApiJson(response);
    if (!response.ok) {
      throw new Error(data.error || `Failed to authenticate teacher account (HTTP ${response.status})`);
    }

    sessionVersionRef.current += 1;
    if (auth.currentUser && auth.currentUser.uid !== data.teacher?.uid) {
      await fbSignOut(auth).catch(() => {});
    }
    if (data.firebaseCustomToken) {
      try {
        await signInWithCustomToken(auth, data.firebaseCustomToken);
      } catch (customErr) {
        console.warn('Firebase custom token sign-in notice:', customErr);
      }
    }

    const sessionObj: StoredTeacherSession = {
      token: data.token,
      expiresAt: data.expiresAt || Date.now() + LOCAL_SESSION_TTL_MS,
      teacher: data.teacher,
    };

    safeStorageRemove(LEARNER_SESSION_KEY);
    setLearnerProfile(null);
    setLearnerToken(null);
    setTeacherProfile(data.teacher);
    setTeacherToken(data.token);
    setRole(data.teacher.role || 'teacher');
    safeStorageSet(TEACHER_SESSION_KEY, JSON.stringify(sessionObj));
  };

  // Learner Login
  const loginAsLearner = async (username: string, password: string) => {
    const response = await fetch('/api/auth/learner-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await readApiJson(response);
    if (!response.ok) {
      throw new Error(data.error || `Failed to authenticate learner account (HTTP ${response.status})`);
    }

    sessionVersionRef.current += 1;
    if (auth.currentUser && auth.currentUser.uid !== data.learner?.id) {
      await fbSignOut(auth).catch(() => {});
    }
    if (data.firebaseCustomToken) {
      try {
        await signInWithCustomToken(auth, data.firebaseCustomToken);
      } catch (customErr) {
        console.warn('Firebase custom token sign-in notice:', customErr);
        if (auth.currentUser && auth.currentUser.uid !== data.learner?.id) {
          await fbSignOut(auth).catch(() => {});
        }
      }
    }

    const sessionObj: StoredLearnerSession = {
      token: data.token,
      expiresAt: data.expiresAt || Date.now() + LOCAL_SESSION_TTL_MS,
      learner: data.learner,
    };

    safeStorageRemove(TEACHER_SESSION_KEY);
    setTeacherProfile(null);
    setTeacherToken(null);
    setLearnerProfile(data.learner);
    setLearnerToken(data.token);
    setRole('learner');
    safeStorageSet(LEARNER_SESSION_KEY, JSON.stringify(sessionObj));

    return {
      success: true,
      isFirstLogin: Boolean(data.learner.mustChangePassword || data.learner.isFirstLogin),
      learner: data.learner,
    };
  };

  // Change Learner Password
  const changeLearnerPassword = async (newPassword: string, currentPassword?: string) => {
    if (!learnerProfile || (!learnerToken && !auth.currentUser)) {
      throw new Error('Active learner session not found. Please sign in again.');
    }

    const res = await learnerFetch('/api/auth/learner-change-password', learnerToken, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        learnerId: learnerProfile.id,
        currentPassword,
        newPassword,
      }),
    });

    const data = await readApiJson(res);
    if (!res.ok) {
      throw new Error(data.error || 'Could not change password');
    }

    sessionVersionRef.current += 1;
    const updated: Learner = {
      ...learnerProfile,
      mustChangePassword: false,
      isFirstLogin: false,
    };
    setLearnerProfile(updated);

    const nextToken = data.token || learnerToken || '';
    const nextExpiresAt = data.expiresAt || Date.now() + LOCAL_SESSION_TTL_MS;
    if (data.token) {
      setLearnerToken(data.token);
    }

    safeStorageSet(
      LEARNER_SESSION_KEY,
      JSON.stringify({ token: nextToken, expiresAt: nextExpiresAt, learner: updated })
    );
  };

  const refreshLearnerData = async () => {
    if (!learnerToken && !auth.currentUser) return;
    try {
      const res = await learnerFetch('/api/auth/learner-session', learnerToken);
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          await logout();
        }
        return;
      }
      const data = await readApiJson(res);
      if (data.learner) {
        setLearnerProfile(data.learner);
        const saved = readStoredLearnerSession();
        const nextToken = data.token || saved?.token || learnerToken || '';
        const nextExpiresAt = data.expiresAt || saved?.expiresAt || Date.now() + LOCAL_SESSION_TTL_MS;
        if (data.token) {
          setLearnerToken(data.token);
        }
        safeStorageSet(
          LEARNER_SESSION_KEY,
          JSON.stringify({ token: nextToken, expiresAt: nextExpiresAt, learner: data.learner })
        );
      }
    } catch (e) {
      console.error('Error refreshing learner data:', e);
    }
  };

  // Logout (invalidates server session token + clears local state + Firebase Auth)
  const logout = async () => {
    sessionVersionRef.current += 1;
    const activeToken = teacherToken || learnerToken;
    safeStorageRemove(LEARNER_SESSION_KEY);
    safeStorageRemove(TEACHER_SESSION_KEY);
    setLearnerProfile(null);
    setLearnerToken(null);
    setTeacherProfile(null);
    setTeacherToken(null);
    setActiveCohort(null);
    setRole(null);
    try {
      if (activeToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${activeToken}` },
        }).catch(() => {});
      }
      if (auth.currentUser) {
        await fbSignOut(auth);
      }
    } catch (e) {
      console.warn('Signout warning:', e);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        role,
        teacherProfile,
        teacherToken,
        learnerProfile,
        learnerToken,
        activeCohort,
        loading,
        loginWithGoogle,
        loginAsTeacher,
        loginAsLearner,
        changeLearnerPassword,
        setActiveCohort,
        logout,
        refreshLearnerData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
