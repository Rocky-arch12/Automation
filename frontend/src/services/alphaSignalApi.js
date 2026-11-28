import { apiFetch } from './apiClient';

export async function fetchSystemStatus() {
  const res = await apiFetch('/api/status');
  return res.json();
}

export async function fetchXmStatus() {
  const res = await apiFetch('/api/xm/status');
  return res.json();
}

export async function fetchDashboardStats() {
  const res = await apiFetch('/api/stats');
  return res.json();
}

export async function fetchMessages({ limit = 60, intentFilter = 'ALL', search = '' } = {}) {
  let url = `/api/messages?limit=${limit}&intent_filter=${encodeURIComponent(intentFilter)}`;
  if (search) {
    url += `&search=${encodeURIComponent(search)}`;
  }
  const res = await apiFetch(url);
  return res.json();
}

export async function simulateIncomingSignal({ text, sender, channelTitle, image }) {
  const formData = new FormData();
  formData.append('text', text);
  formData.append('sender', sender || 'Channel Owner');
  formData.append('channel_title', channelTitle || 'VIP Signals');
  if (image) {
    formData.append('image', image);
  }
  const res = await apiFetch('/api/simulate', {
    method: 'POST',
    body: formData,
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function fetchTrades({ limit = 60, statusFilter = 'ALL' } = {}) {
  let url = `/api/trades?limit=${limit}`;
  if (statusFilter && statusFilter !== 'ALL') {
    url += `&status_filter=${encodeURIComponent(statusFilter)}`;
  }
  const res = await apiFetch(url);
  return res.json();
}

export async function fetchTradeTimeline(tradeId) {
  const res = await apiFetch(`/api/trades/${encodeURIComponent(tradeId)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function updateTradeStatusManual(tradeId, { status, notes }) {
  const res = await apiFetch(`/api/trades/${encodeURIComponent(tradeId)}/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status,
      notes: notes || `Manual operator outcome update to ${status}`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function fetchXmPositions() {
  const res = await apiFetch('/api/xm/positions');
  return res.json();
}

export async function fetchXmAnalytics({ days = 30, tzOffsetMinutes } = {}) {
  const tz =
    typeof tzOffsetMinutes === 'number'
      ? tzOffsetMinutes
      : -new Date().getTimezoneOffset();
  const res = await apiFetch(
    `/api/xm/analytics?days=${encodeURIComponent(days)}&tz_offset_minutes=${encodeURIComponent(tz)}`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function closeXmPosition({ ticket, lots }) {
  const res = await apiFetch('/api/xm/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ticket: parseInt(ticket, 10), lots }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function fetchLogs(limit = 40) {
  const res = await apiFetch(`/api/logs?limit=${limit}`);
  return res.json();
}

export async function resetAllData() {
  const res = await apiFetch('/api/reset-data', { method: 'POST' });
  return res.json();
}

export async function fetchAuthConfig() {
  const res = await apiFetch('/api/auth/config');
  if (!res.ok) return {};
  return res.json();
}

export async function fetchCurrentUser() {
  return apiFetch('/api/auth/me', { method: 'GET' });
}

export async function authenticateWithGoogle(payload) {
  const res = await apiFetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function logoutSession() {
  return apiFetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchSettings() {
  const res = await apiFetch('/api/settings');
  return { ok: res.ok, status: res.status, data: res.ok ? await res.json() : null };
}

export async function saveSettingsPayload(payload) {
  const res = await apiFetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

export async function fetchTelegramDialogs() {
  const res = await apiFetch('/api/telegram/dialogs');
  return res.json();
}

export async function startTelegramClient(channelIds) {
  const res = await apiFetch('/api/telegram/start_client', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_ids: channelIds }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function startTelegramBot() {
  const res = await apiFetch('/api/telegram/start', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function stopTelegramListener() {
  const res = await apiFetch('/api/telegram/stop', { method: 'POST' });
  return res.ok;
}
