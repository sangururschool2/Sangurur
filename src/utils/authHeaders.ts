import { auth } from '../services/firebase';

const LEARNER_SESSION_KEY = 'sdlr_learner_session';
const TEACHER_SESSION_KEY = 'sdlr_teacher_session';

export function getStoredTeacherToken(): string | null {
  try {
    const raw = localStorage.getItem(TEACHER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.token && typeof parsed.token === 'string') {
      return parsed.token;
    }
    return null;
  } catch {
    return null;
  }
}

export function getStoredLearnerToken(): string | null {
  try {
    const raw = localStorage.getItem(LEARNER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.token && typeof parsed.token === 'string') {
      return parsed.token;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getTeacherAuthHeaders(
  teacherToken?: string | null,
  forceRefresh = false
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!forceRefresh) {
    const resolvedToken = getStoredTeacherToken() || teacherToken;
    if (resolvedToken) {
      headers.Authorization = `Bearer ${resolvedToken}`;
      return headers;
    }
  }

  if (auth.currentUser) {
    const idToken = await auth.currentUser.getIdToken(forceRefresh);
    headers.Authorization = `Bearer ${idToken}`;
    return headers;
  }

  const fallbackToken = teacherToken || getStoredTeacherToken();
  if (fallbackToken) {
    headers.Authorization = `Bearer ${fallbackToken}`;
    return headers;
  }

  throw new Error('Staff authentication required. Please sign in again.');
}

export async function teacherFetch(
  input: string,
  teacherToken?: string | null,
  init: RequestInit = {}
): Promise<Response> {
  let token = getStoredTeacherToken() || teacherToken || '';
  if (!token && auth.currentUser) {
    token = await auth.currentUser.getIdToken().catch(() => '');
  }

  const buildHeaders = (bearer: string): Record<string, string> => {
    const base: Record<string, string> = {};
    if (init.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers)) {
      Object.assign(base, init.headers as Record<string, string>);
    }
    if (bearer) {
      base.Authorization = `Bearer ${bearer}`;
    }
    return base;
  };

  let response = await fetch(input, {
    ...init,
    headers: buildHeaders(token),
  });

  if (response.status === 401 && auth.currentUser) {
    try {
      const freshIdToken = await auth.currentUser.getIdToken(true);
      if (freshIdToken && freshIdToken !== token) {
        response = await fetch(input, {
          ...init,
          headers: buildHeaders(freshIdToken),
        });
      }
    } catch {
      // Keep original 401 response if ID token refresh fails
    }
  }

  return response;
}

export async function getLearnerAuthToken(learnerToken?: string | null): Promise<string> {
  const stored = getStoredLearnerToken();
  if (stored) return stored;
  if (learnerToken) return learnerToken;
  if (auth.currentUser) {
    return auth.currentUser.getIdToken();
  }
  throw new Error('Authentication required. Please sign in again.');
}

export async function learnerFetch(
  input: string,
  learnerToken?: string | null,
  init: RequestInit = {}
): Promise<Response> {
  let token = getStoredLearnerToken() || learnerToken || '';
  if (!token && auth.currentUser) {
    token = await auth.currentUser.getIdToken().catch(() => '');
  }

  const buildHeaders = (bearer: string): Record<string, string> => {
    const base: Record<string, string> = {};
    if (init.headers && !(init.headers instanceof Headers) && !Array.isArray(init.headers)) {
      Object.assign(base, init.headers as Record<string, string>);
    }
    if (bearer) {
      base.Authorization = `Bearer ${bearer}`;
    }
    return base;
  };

  let response = await fetch(input, {
    ...init,
    headers: buildHeaders(token),
  });

  if (response.status === 401 && auth.currentUser) {
    try {
      const freshIdToken = await auth.currentUser.getIdToken(true);
      if (freshIdToken && freshIdToken !== token) {
        response = await fetch(input, {
          ...init,
          headers: buildHeaders(freshIdToken),
        });
      }
    } catch {
      // Keep original 401 response if ID token refresh fails
    }
  }

  return response;
}

