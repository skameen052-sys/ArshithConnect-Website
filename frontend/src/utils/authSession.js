import axios from 'axios';
import { getCurrentFirebaseUser, getFirebaseIdToken } from '../firebase/auth';

const LOGIN_ROUTES = {
  admin: '/admin/login',
  hr: '/hr/login',
  hr_projects: '/hr-projects/login',
  project_hr: '/hr-projects/login',
  team_leader: '/teamlead/login',
  employee: '/login',
};

let refreshPromise = null;
let redirectingToLogin = false;

export function getApiBaseUrl() {
  if (typeof window !== 'undefined') {
    if (window.location.port === '8000' || !window.location.port) {
      return '';
    }
  }
  return import.meta.env.VITE_API_BASE_URL || '';
}

export function getLoginRouteForRole(role) {
  const normalized = String(role || '').trim().toLowerCase();
  return LOGIN_ROUTES[normalized] || '/login';
}

export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isJwtExpired(token, skewSeconds = 30) {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return true;
  }
  return payload.exp * 1000 <= Date.now() + skewSeconds * 1000;
}

export function hasActiveAuthStorage(allowedRoles, { requireUser = true } = {}) {
  const role = localStorage.getItem('arshith_role');
  const token = localStorage.getItem('arshith_auth_token');
  const user = localStorage.getItem('arshith_user');

  if (!role || !token || token === 'null' || token === 'undefined') {
    return false;
  }
  if (requireUser && (!user || user === 'null' || user === 'undefined')) {
    return false;
  }
  if (Array.isArray(allowedRoles) && !allowedRoles.includes(role)) {
    return false;
  }
  return Boolean(decodeJwtPayload(token));
}

export function clearAuthSession() {
  localStorage.removeItem('arshith_auth_token');
  localStorage.removeItem('arshith_role');
  localStorage.removeItem('arshith_user');
}

export function handleExpiredSession(roleHint = null) {
  const role = roleHint || localStorage.getItem('arshith_role');
  const targetRoute = getLoginRouteForRole(role);
  clearAuthSession();

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('arshith:session-expired'));
    const path = window.location.pathname || '';
    const alreadyOnLogin = Object.values(LOGIN_ROUTES).includes(path);
    if (!alreadyOnLogin && !redirectingToLogin) {
      redirectingToLogin = true;
      window.location.replace(targetRoute);
    }
  }
}

export async function refreshAuthTokenIfPossible() {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const storedRole = localStorage.getItem('arshith_role');
      let storedEmail = '';
      try {
        const parsed = JSON.parse(localStorage.getItem('arshith_user') || 'null');
        storedEmail = String(parsed?.email || '').trim().toLowerCase();
      } catch {
        storedEmail = '';
      }

      const fbUser = await getCurrentFirebaseUser();
      const fbEmail = String(fbUser?.email || '').trim().toLowerCase();
      if (!fbUser || (storedEmail && fbEmail && fbEmail !== storedEmail)) {
        return null;
      }

      const fbToken = await getFirebaseIdToken(true);
      if (!fbToken) {
        return null;
      }

      const res = await axios.post(
        `${getApiBaseUrl()}/api/auth/refresh`,
        {
          firebase_token: fbToken,
          expected_role: storedRole || undefined,
        },
        { timeout: 10000 }
      );

      const { access_token, role, user } = res.data || {};
      if (!access_token) {
        return null;
      }

      localStorage.setItem('arshith_auth_token', access_token);
      if (role) localStorage.setItem('arshith_role', role);
      if (user) localStorage.setItem('arshith_user', JSON.stringify(user));
      redirectingToLogin = false;
      return access_token;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

