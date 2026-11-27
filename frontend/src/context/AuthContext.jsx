import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  authenticateWithGoogle,
  fetchAuthConfig,
  fetchCurrentUser,
  logoutSession,
} from '../services/alphaSignalApi';
import {
  bootstrapBackendParamFromQuery,
  getAuthToken,
  getAuthUser,
  registerApiHandlers,
} from '../services/apiClient';
import { ALLOWED_GOOGLE_EMAILS } from '../utils/constants';
import { useToast } from './ToastContext';

const AuthContext = createContext(null);

export function isAuthorizedAdmin(user) {
  if (!user || !user.email) return false;
  return ALLOWED_GOOGLE_EMAILS.includes(user.email.toLowerCase().trim());
}

function hasValidNonExpiredJwt(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    const payload = JSON.parse(json);
    if (!payload?.email || !ALLOWED_GOOGLE_EMAILS.includes(String(payload.email).toLowerCase().trim())) {
      return false;
    }
    if (payload.exp && payload.exp * 1000 <= Date.now()) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function clearStoredAuth() {
  localStorage.removeItem('AUTH_TOKEN');
  localStorage.removeItem('AUTH_USER');
}

export function AuthProvider({ children }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(null);
  const [googleClientId, setGoogleClientId] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const locationRef = useRef(location);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const processGoogleAuthPayload = useCallback(
    async (payload) => {
      try {
        showToast('Verifying Google account with security whitelist...', 'info');
        const { ok, data } = await authenticateWithGoogle(payload);
        if (ok && data?.user && isAuthorizedAdmin(data.user)) {
          if (data.token) localStorage.setItem('AUTH_TOKEN', data.token);
          localStorage.setItem('AUTH_USER', JSON.stringify(data.user));
          setUser(data.user);
          showToast(
            `Welcome back, ${data.user.name || data.user.email}! (Admin Verified)`,
            'success'
          );
          navigate('/dashboard', { replace: true });
          return true;
        }
        clearStoredAuth();
        setUser(null);
        showToast(data?.detail || 'Access Denied: Google email not authorized.', 'error');
        return false;
      } catch (e) {
        showToast('Google OAuth error: ' + e.message, 'error');
        return false;
      }
    },
    [navigate, showToast]
  );

  const checkAuthSession = useCallback(async () => {
    const token = getAuthToken();
    const hasCookie = typeof document !== 'undefined' && document.cookie.includes('access_token');
    if (!token && !hasCookie) {
      clearStoredAuth();
      setUser(null);
      return null;
    }
    try {
      const res = await fetchCurrentUser();
      if (res.ok) {
        const data = await res.json();
        if (data?.user && isAuthorizedAdmin(data.user)) {
          localStorage.setItem('AUTH_USER', JSON.stringify(data.user));
          if (data.token) localStorage.setItem('AUTH_TOKEN', data.token);
          setUser(data.user);
          return data.user;
        }
        clearStoredAuth();
        setUser(null);
        return null;
      }
      if (res.status === 401 || res.status === 403) {
        clearStoredAuth();
        setUser(null);
        return null;
      }
    } catch (e) {
      console.warn('Session check offline or tunnel not connected yet:', e.message);
    }

    // Only keep cached user during temporary network outage if backed by a non-expired whitelisted JWT
    const localUser = getAuthUser();
    if (token && hasValidNonExpiredJwt(token) && isAuthorizedAdmin(localUser)) {
      setUser(localUser);
      return localUser;
    }

    clearStoredAuth();
    setUser(null);
    return null;
  }, []);

  // Register global 401 & tunnel connection toast handlers
  useEffect(() => {
    registerApiHandlers({
      onUnauthorized: () => {
        const hadSession = Boolean(getAuthToken() || getAuthUser());
        clearStoredAuth();
        setUser(null);
        const p = locationRef.current.pathname;
        if (hadSession && p !== '/login' && p !== '/register') {
          navigate('/login', { replace: true });
          showToast('Session expired. Please sign in again.', 'info');
        }
      },
      onTunnelToast: (msg, type) => showToast(msg, type),
    });
  }, [navigate, showToast]);

  // Bootstrap query param, OAuth redirect hash, auth config, and strict session verification
  useEffect(() => {
    let active = true;

    async function bootstrap() {
      bootstrapBackendParamFromQuery();

      // 1. Check OAuth redirect hash (#id_token=... or #access_token=...)
      const hash = window.location.hash || '';
      if (hash && (hash.includes('id_token=') || hash.includes('access_token='))) {
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        const idToken = params.get('id_token');
        const accessToken = params.get('access_token');
        try {
          window.history.replaceState({}, document.title, window.location.pathname);
        } catch {
          // Ignore
        }
        if (idToken || accessToken) {
          await processGoogleAuthPayload({ credential: idToken, access_token: accessToken });
          if (active) setAuthReady(true);
          return;
        }
      }

      // 2. Fetch public auth configuration (.env)
      try {
        const cfg = await fetchAuthConfig();
        if (active && cfg?.google_client_id) {
          setGoogleClientId(cfg.google_client_id.trim());
        }
      } catch (e) {
        console.warn('Auth config fetch warning:', e.message);
      }

      // 3. Strictly verify persisted session (no unauthenticated fallback)
      await checkAuthSession();
      if (active) {
        setAuthReady(true);
      }
    }

    bootstrap();
    return () => {
      active = false;
    };
  }, [checkAuthSession, processGoogleAuthPayload]);

  const triggerGoogleOAuthRedirect = useCallback(() => {
    if (!googleClientId) {
      showToast(
        'Google Client ID is not configured in .env. Please add GOOGLE_CLIENT_ID to your local .env file.',
        'warning'
      );
      return;
    }
    const redirectUri = window.location.origin + '/';
    const state = Math.random().toString(36).substring(7);
    const nonce = Math.random().toString(36).substring(7);

    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?' +
      new URLSearchParams({
        client_id: googleClientId,
        redirect_uri: redirectUri,
        response_type: 'token id_token',
        scope: 'openid email profile',
        state,
        nonce,
        prompt: 'select_account',
      }).toString();

    window.location.href = authUrl;
  }, [googleClientId, showToast]);

  const handleDashboardAccess = useCallback(() => {
    if (isAuthorizedAdmin(user)) {
      navigate('/dashboard');
    } else {
      showToast(
        'Authentication required. Please sign in with your authorized Google Account.',
        'warning'
      );
      navigate('/login');
    }
  }, [navigate, showToast, user]);

  const logoutUser = useCallback(async () => {
    try {
      await logoutSession();
    } catch (e) {
      console.warn('Logout request failed:', e);
    }
    clearStoredAuth();
    setUser(null);
    showToast('Signed out safely. Your credentials remain isolated & encrypted.', 'info');
    navigate('/login', { replace: true });
  }, [navigate, showToast]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: isAuthorizedAdmin(user),
        googleClientId,
        authReady,
        processGoogleAuthPayload,
        triggerGoogleOAuthRedirect,
        handleDashboardAccess,
        logoutUser,
        checkAuthSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
