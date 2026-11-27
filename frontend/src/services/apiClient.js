import { CURRENT_ACTIVE_TUNNEL, STALE_TUNNELS } from '../utils/constants';

let unauthorizedHandler = null;
let tunnelToastTimer = null;
let tunnelToastBlocked = false;
let tunnelToastHandler = null;

export function registerApiHandlers({ onUnauthorized, onTunnelToast }) {
  unauthorizedHandler = onUnauthorized || null;
  tunnelToastHandler = onTunnelToast || null;
}

export function bootstrapBackendParamFromQuery() {
  if (typeof window === 'undefined') return;
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('backend')) {
    const backendParam = (urlParams.get('backend') || '').trim().replace(/\/$/, '');
    if (backendParam) {
      localStorage.setItem('API_BACKEND_URL', backendParam);
      try {
        window.history.replaceState(
          {},
          document.title,
          window.location.pathname + window.location.hash
        );
      } catch {
        // Ignore history restrictions
      }
    }
  }
}

export function getApiBase() {
  if (typeof window === 'undefined') return '';
  let stored = localStorage.getItem('API_BACKEND_URL') || '';
  if (stored && STALE_TUNNELS.some((stale) => stored.includes(stale))) {
    stored = CURRENT_ACTIVE_TUNNEL;
    localStorage.setItem('API_BACKEND_URL', CURRENT_ACTIVE_TUNNEL);
  }
  const hostname = window.location.hostname || '';
  const isRemoteHost =
    hostname.includes('vercel.app') ||
    (!hostname.includes('localhost') && !hostname.includes('127.0.0.1'));

  if (!stored && isRemoteHost) {
    stored = CURRENT_ACTIVE_TUNNEL;
    localStorage.setItem('API_BACKEND_URL', CURRENT_ACTIVE_TUNNEL);
  }
  return stored;
}

export function setApiBase(url) {
  const clean = (url || '').trim().replace(/\/$/, '');
  if (clean) {
    localStorage.setItem('API_BACKEND_URL', clean);
  } else {
    localStorage.removeItem('API_BACKEND_URL');
  }
  return clean;
}

export function getApiUrl(endpoint) {
  const base = getApiBase();
  if (!base || endpoint.startsWith('http')) return endpoint;
  const cleanBase = base.replace(/\/$/, '');
  return endpoint.startsWith('/') ? `${cleanBase}${endpoint}` : `${cleanBase}/${endpoint}`;
}

export function getWebSocketUrl() {
  const base = getApiBase();
  if (base) {
    const wsProto = base.startsWith('https') ? 'wss:' : 'ws:';
    const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return `${wsProto}//${host}/ws`;
  }
  if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
    return null;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function resolveMediaUrl(mediaPath) {
  if (!mediaPath) return '';
  let p = String(mediaPath).replace(/\\/g, '/');
  if (p.includes('uploads/')) {
    p = p.substring(p.indexOf('uploads/'));
  } else if (p.includes('sample_signals/')) {
    p = p.substring(p.indexOf('sample_signals/'));
  }
  if (!p.startsWith('/') && !p.startsWith('http')) {
    p = '/' + p;
  }
  if (p.startsWith('/uploads') || p.startsWith('/sample_signals')) {
    return getApiUrl(p);
  }
  return p;
}

export function getAuthToken() {
  return localStorage.getItem('AUTH_TOKEN') || '';
}

export function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem('AUTH_USER') || 'null');
  } catch {
    return null;
  }
}

export async function apiFetch(endpoint, options = {}) {
  const targetUrl =
    typeof endpoint === 'string' &&
    (endpoint.startsWith('/api') ||
      endpoint.startsWith('/uploads') ||
      endpoint.startsWith('/sample_signals'))
      ? getApiUrl(endpoint)
      : endpoint;

  const opts = { ...options, credentials: 'include' };
  const headers = new Headers(options.headers || {});
  if (!headers.has('ngrok-skip-browser-warning')) {
    headers.set('ngrok-skip-browser-warning', 'true');
  }
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  opts.headers = headers;

  try {
    const res = await fetch(targetUrl, opts);
    if (
      res.status === 401 &&
      typeof endpoint === 'string' &&
      !endpoint.includes('/api/auth/login') &&
      !endpoint.includes('/api/auth/register') &&
      !endpoint.includes('/api/auth/google')
    ) {
      unauthorizedHandler?.();
    }
    return res;
  } catch (err) {
    if (err?.message?.includes('Failed to fetch')) {
      const currentBase = getApiBase();
      console.error('Backend fetch failed for endpoint:', endpoint, 'Target base:', currentBase);
      if (
        typeof window !== 'undefined' &&
        window.location.hostname.includes('vercel.app') &&
        !tunnelToastBlocked
      ) {
        tunnelToastBlocked = true;
        clearTimeout(tunnelToastTimer);
        tunnelToastTimer = setTimeout(() => {
          tunnelToastBlocked = false;
        }, 10000);
        tunnelToastHandler?.(`Connecting to backend (${currentBase})...`, 'info');
      }
    }
    throw err;
  }
}
