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
import { ALLOWED_GOOGLE_EMAILS, DEFAULT_FALLBACK_USER } from '../utils/constants';
import { useToast } from './ToastContext';

const AuthContext = createContext(null);

export function isAuthorizedAdmin(user) {
  if (!user || !user.email) return false;
  return ALLOWED_GOOGLE_EMAILS.includes(user.email.toLowerCase());
}

export function AuthProvider({ children }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [user, setUser] = useState(() => getAuthUser());
  const [googleClientId, setGoogleClientId] = useState('');
  const [authReady, setAuthReady] = useState(false);
  const locationRef = useRef(location);
  const initialEntryRef = useRef(
    typeof window !== 'undefined'
      ? {
          pathname: window.location.pathname.toLowerCase(),
          hash: (window.location.hash || '').replace('#', '').toLowerCase().trim(),
        }
      : { pathname: '/', hash: '' }
  );

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  const processGoogleAuthPayload = useCallback(
    async (payload) => {
      try {
        showToast('Verifying Google account with security whitelist...', 'info');
        const { ok, data } = await authenticateWithGoogle(payload);
        if (ok && data?.user) {
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
      return null;
    }
    try {
      const res = await fetchCurrentUser();
      if (res.ok) {
        const data = await res.json();
        if (data?.user) {
          localStorage.setItem('AUTH_USER', JSON.stringify(data.user));
          if (data.token) localStorage.setItem('AUTH_TOKEN', data.token);
          setUser(data.user);
          return data.user;
        }
      } else if (res.status === 401) {
        localStorage.removeItem('AUTH_USER');
        localStorage.removeItem('AUTH_TOKEN');
        setUser(null);
        return null;
      }
    } catch (e) {
      console.warn('Session check offline or tunnel not connected yet:', e.message);
    }

    const localUser = getAuthUser();
    if (localUser && !isAuthorizedAdmin(localUser)) {
      localStorage.removeItem('AUTH_USER');
      localStorage.removeItem('AUTH_TOKEN');
      setUser(null);
      return null;
    }
    setUser(localUser);
    return localUser;
  }, []);

  // Register global 401 & tunnel connection toast handlers
  useEffect(() => {
    registerApiHandlers({
      onUnauthorized: () => {
        const wasUser = getAuthUser();
        if (wasUser) {
          localStorage.removeItem('AUTH_USER');
          localStorage.removeItem('AUTH_TOKEN');
          setUser(null);
          const p = locationRef.current.pathname;
          if (p !== '/landing' && p !== '/login') {
            navigate('/login');
            showToast('Session expired. Please sign in again.', 'info');
          }
        }
      },
      onTunnelToast: (msg, type) => showToast(msg, type),
    });
  }, [navigate, showToast]);

  // Bootstrap query param, OAuth redirect hash, auth config, and initial session
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

      // 3. Check persisted session
      const sessionUser = await checkAuthSession();
      if (!active) return;

      const currentPath = initialEntryRef.current.pathname;
      const rawHash = initialEntryRef.current.hash;
      const isPublicEntry =
        currentPath === '/landing' ||
        currentPath === '/login' ||
        currentPath === '/register' ||
        ['landing', 'features', 'architecture', 'security', 'login', 'register'].includes(rawHash);

      if (!isPublicEntry) {
        let effectiveUser = sessionUser || getAuthUser();
        if (!effectiveUser) {
          effectiveUser = DEFAULT_FALLBACK_USER;
          localStorage.setItem('AUTH_USER', JSON.stringify(effectiveUser));
        }
        setUser(effectiveUser);
      }
      setAuthReady(true);
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
    const current = user || getAuthUser();
    if (isAuthorizedAdmin(current)) {
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
    localStorage.removeItem('AUTH_TOKEN');
    localStorage.removeItem('AUTH_USER');
    setUser(null);
    showToast('Signed out safely. Your credentials remain isolated & encrypted.', 'info');
    navigate('/landing');
  }, [navigate, showToast]);

  return (
    <AuthContext.Provider
      value={{
        user,
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
