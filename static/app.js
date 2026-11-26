// AlphaSignal AI Frontend Application

// Permanent Tunnel Endpoint (Ngrok Static Free Domain)
const CURRENT_ACTIVE_TUNNEL = "https://plod-exonerate-october.ngrok-free.dev";

// Check query param for backend URL convenience: ?backend=https://...
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has("backend")) {
  const backendParam = urlParams.get("backend").trim().replace(/\/$/, "");
  if (backendParam) {
    localStorage.setItem("API_BACKEND_URL", backendParam);
    try {
      window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    } catch (e) { }
  }
}

function getApiBase() {
  let stored = localStorage.getItem("API_BACKEND_URL") || "";
  // Auto-heal: If stored points to any stale/expired quick tunnel, migrate to permanent static tunnel
  const staleTunnels = [
    "trycloudflare.com",
    "recorders-retirement-prostores-touch.trycloudflare.com",
    "effectiveness-welfare-multimedia-storage.trycloudflare.com",
    "warm-table-appropriate-dept.trycloudflare.com",
    "thoroughly-imagination-pam-shake.trycloudflare.com",
    "cpu-baseline-injection-patrol.trycloudflare.com",
    "demanding-reports-street-plugins.trycloudflare.com",
    "composition-logos-settle-manually.trycloudflare.com"
  ];
  if (stored && staleTunnels.some(stale => stored.includes(stale))) {
    stored = CURRENT_ACTIVE_TUNNEL;
    localStorage.setItem("API_BACKEND_URL", CURRENT_ACTIVE_TUNNEL);
  }
  // If running on Vercel or remote host and no custom backend set, default to active tunnel
  if (!stored && (window.location.hostname.includes("vercel.app") || (!window.location.hostname.includes("localhost") && !window.location.hostname.includes("127.0.0.1")))) {
    stored = CURRENT_ACTIVE_TUNNEL;
    localStorage.setItem("API_BACKEND_URL", CURRENT_ACTIVE_TUNNEL);
  }
  return stored;
}

function getApiUrl(endpoint) {
  const base = getApiBase();
  if (!base || endpoint.startsWith("http")) return endpoint;
  const cleanBase = base.replace(/\/$/, "");
  return endpoint.startsWith("/") ? `${cleanBase}${endpoint}` : `${cleanBase}/${endpoint}`;
}

function getAuthToken() {
  return localStorage.getItem("AUTH_TOKEN") || "";
}

function getAuthUser() {
  try {
    return JSON.parse(localStorage.getItem("AUTH_USER") || "null");
  } catch (e) {
    return null;
  }
}

// Auto-route all /api and /uploads calls to remote backend if API_BASE is configured (e.g. on Vercel)
// Injects Authorization header and 'ngrok-skip-browser-warning': 'true'
const _nativeFetch = window.fetch;
window.fetch = function (url, options = {}) {
  let targetUrl = url;
  if (typeof url === "string" && (url.startsWith("/api") || url.startsWith("/uploads"))) {
    targetUrl = getApiUrl(url);
    options = options || {};
    options.credentials = "include";

    // Normalize headers
    let headers = options.headers;
    if (!headers) {
      headers = {};
    }

    if (headers instanceof Headers) {
      if (!headers.has("ngrok-skip-browser-warning")) {
        headers.set("ngrok-skip-browser-warning", "true");
      }
      const token = getAuthToken();
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    } else {
      headers["ngrok-skip-browser-warning"] = "true";
      const token = getAuthToken();
      if (token && !headers["Authorization"]) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }
    options.headers = headers;

    return _nativeFetch.call(this, targetUrl, options).then(res => {
      if (res.status === 401 && !url.includes("/api/auth/login") && !url.includes("/api/auth/register") && !url.includes("/api/auth/google")) {
        const wasUser = getAuthUser();
        if (wasUser) {
          localStorage.removeItem("AUTH_USER");
          localStorage.removeItem("AUTH_TOKEN");
          updateUserUI(null);
          if (window.location.hash.includes("dashboard")) {
            navigateTo("login");
            showToast("Session expired. Please sign in again.", "info");
          }
        }
      }
      return res;
    }).catch(err => {
      if (err.message && err.message.includes("Failed to fetch")) {
        const currentBase = getApiBase();
        console.error("Backend fetch failed for endpoint:", url, "Target base:", currentBase);
        if (window.location.hostname.includes("vercel.app") && !window._tunnelToastShown) {
          window._tunnelToastShown = true;
          setTimeout(() => { window._tunnelToastShown = false; }, 10000);
          showToast(`Connecting to backend (${currentBase})...`, "info");
        }
      }
      throw err;
    });
  }
  return _nativeFetch.call(this, targetUrl, options);
};

let currentFilter = "ALL";
let currentSearch = "";
let searchTimeout = null;
let selectedFile = null;
let messagesCache = [];
let ws = null;

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", async () => {
  initIcons();
  initParticles();
  initSpotlight();
  setupDragAndDrop();

  // 1. Check if returning from official Google OAuth redirect
  if (checkOAuthRedirectHash()) {
    return;
  }

  // 2. Fetch server environment auth configuration (.env)
  await loadAuthConfig();

  // Check persisted session via HttpOnly cookie & token
  const user = await checkAuthSession();

  // Determine initial view based on hash and auth state
  const hash = (window.location.hash || "").replace("#", "").toLowerCase().trim();
  if (hash === "landing" || hash === "features" || hash === "architecture" || hash === "security") {
    navigateTo("landing", hash === "landing" ? null : hash);
  } else if (hash === "login" || hash === "register") {
    navigateTo("login");
  } else {
    // Default view: Dashboard is the default landing page
    let effectiveUser = user || getAuthUser();
    if (!effectiveUser) {
      effectiveUser = { email: "riddhesh.firake@gmail.com", name: "Riddhesh Firake (Admin)", provider: "google" };
      localStorage.setItem("AUTH_USER", JSON.stringify(effectiveUser));
      updateUserUI(effectiveUser);
    }
    navigateTo("dashboard");
    if (hash.startsWith("dashboard/")) {
      const page = hash.split("/")[1];
      if (page) switchDashboardPage(page);
    } else if (["chats", "signals", "positions", "watchlist", "simulator", "terminal", "settings"].includes(hash)) {
      switchDashboardPage(hash);
    }
  }

  // Refresh stats & open XM MT5 positions periodically when dashboard is active
  setInterval(() => {
    const dash = document.getElementById("view-dashboard");
    if (dash && dash.style.display !== "none") {
      loadStats();
      loadXMPositions();
    }
  }, 5000);
});

// [ReactBits: Particles / Sparkles Canvas Background]
function initParticles() {
  const canvas = document.getElementById("sparkle-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let width, height;
  let particles = [];

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  const colors = ["rgba(59, 130, 246, ", "rgba(139, 92, 246, ", "rgba(16, 185, 129, ", "rgba(56, 189, 248, "];

  for (let i = 0; i < 35; i++) {
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.8 + 0.6,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: Math.random() * 0.5 + 0.2,
      pulseSpeed: Math.random() * 0.02 + 0.005,
    });
  }

  function loop() {
    ctx.clearRect(0, 0, width, height);
    for (let p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.alpha += Math.sin(Date.now() * p.pulseSpeed) * 0.005;
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.max(0.1, Math.min(0.65, p.alpha)) + ")";
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.color + "0.6)";
      ctx.fill();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// [ReactBits: Spotlight Card] Mouse tracking
function initSpotlight() {
  document.addEventListener("mousemove", (e) => {
    const cards = document.querySelectorAll(".stat-card, .signal-card, .trade-tracker-card, .panel-container");
    const cx = e.clientX;
    const cy = e.clientY;
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const rect = card.getBoundingClientRect();
      const x = cx - rect.left;
      const y = cy - rect.top;
      if (x >= -40 && x <= rect.width + 40 && y >= -40 && y <= rect.height + 40) {
        card.style.setProperty("--mouse-x", `${x}px`);
        card.style.setProperty("--mouse-y", `${y}px`);
      }
    }
  });
}

// [ReactBits: Custom Toast Notification]
function showToast(message, type = "info") {
  const existing = document.querySelectorAll(".toast-notification");
  existing.forEach(t => t.remove());

  const toast = document.createElement("div");
  toast.className = `toast-notification toast-${type}`;
  const icon = type === "success" ? "check-circle" : type === "error" ? "alert-triangle" : "info";
  const iconColor = type === "success" ? "#34d399" : type === "error" ? "#f87171" : "#60a5fa";

  toast.innerHTML = `
    <i data-lucide="${icon}" style="width: 16px; height: 16px; flex-shrink: 0; color: ${iconColor};"></i>
    <span>${escapeHtml(message)}</span>
  `;
  document.body.appendChild(toast);
  initIcons();

  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 4200);
}

// [ReactBits: Counter / CountUp with spring bounce & pop]
const prevCounters = {};
function animateCount(elementId, targetValue, duration = 800, prefix = "", suffix = "") {
  const el = document.getElementById(elementId);
  if (!el) return;

  const currentVal = prevCounters[elementId] || 0;
  targetValue = Number(targetValue) || 0;

  if (currentVal === targetValue && el.innerText !== "") {
    el.innerText = `${prefix}${targetValue.toLocaleString()}${suffix}`;
    return;
  }

  prevCounters[elementId] = targetValue;
  el.classList.remove("counter-pop");
  void el.offsetWidth; // Trigger reflow
  el.classList.add("counter-pop");

  const startTime = performance.now();
  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
    const value = Math.round(currentVal + (targetValue - currentVal) * ease);
    el.innerText = `${prefix}${value.toLocaleString()}${suffix}`;
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      el.innerText = `${prefix}${targetValue.toLocaleString()}${suffix}`;
    }
  }
  requestAnimationFrame(update);
}

function renderFeedSkeleton() {
  const container = document.getElementById("message-feed");
  if (!container || (container.children.length > 0 && !container.querySelector(".skeleton"))) return;
  container.innerHTML = `
    <div class="signal-card skeleton-card skeleton" style="opacity: 0.5;"></div>
    <div class="signal-card skeleton-card skeleton" style="opacity: 0.4;"></div>
    <div class="signal-card skeleton-card skeleton" style="opacity: 0.3;"></div>
  `;
}

function renderTradesSkeleton() {
  const container = document.getElementById("watchlist-container");
  if (!container || (container.children.length > 0 && !container.querySelector(".skeleton"))) return;
  container.innerHTML = `
    <div class="trade-tracker-card skeleton-card skeleton" style="opacity: 0.5;"></div>
    <div class="trade-tracker-card skeleton-card skeleton" style="opacity: 0.35;"></div>
  `;
}

function initIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

// WebSocket Connection
function connectWebSocket() {
  const base = getApiBase();
  let wsUrl;
  if (base) {
    const wsProto = base.startsWith("https") ? "wss:" : "ws:";
    const host = base.replace(/^https?:\/\//, "").replace(/\/$/, "");
    wsUrl = `${wsProto}//${host}/ws`;
  } else {
    if (window.location.hostname.includes("vercel.app")) {
      updateWsStatus(false, "Live: Connect Tunnel in Settings");
      return;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    wsUrl = `${protocol}//${window.location.host}/ws`;
  }

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    updateWsStatus(false, "Live: Disconnected");
    return;
  }

  ws.onopen = () => {
    updateWsStatus(true, "Live: Connected");
    appendLog("INFO", "SYSTEM", "Real-time WebSocket stream connected.");

    // Periodic Heartbeat to prevent ngrok / cloudflare / reverse proxy idle socket timeout
    if (window._wsHeartbeat) clearInterval(window._wsHeartbeat);
    window._wsHeartbeat = setInterval(() => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      } catch (e) {}
    }, 25000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "NEW_SIGNAL" || msg.type === "NEW_MESSAGE") {
        handleIncomingMessage(msg.data);
        loadTrades();
        loadXMPositions();
      } else if (msg.type === "TRADE_UPDATED" || msg.type === "TRADES_EXPIRED" || msg.type === "DATA_RESET" || msg.type === "POSITION_CLOSED" || msg.type === "XM_POSITIONS_UPDATE") {
        loadTrades();
        loadXMPositions();
        loadMessages();
        loadStats();
      } else if (msg.type === "SYSTEM_STATUS") {
        updateListenerStatus(msg.data.listener_running, msg.data.listener_mode);
      }
    } catch (e) {
      console.error("WS Parse error", e);
    }
  };

  ws.onclose = () => {
    if (window._wsHeartbeat) clearInterval(window._wsHeartbeat);
    updateWsStatus(false, "Live: Reconnecting...");
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
    if (window._wsHeartbeat) clearInterval(window._wsHeartbeat);
    console.warn("WS error:", err);
    updateWsStatus(false, "Live: Offline");
  };
}

function updateWsStatus(connected, text) {
  const el = document.getElementById("ws-status-text");
  const badge = document.getElementById("ws-status-badge");
  if (el) el.innerText = text;
  if (badge) {
    badge.style.borderColor = connected ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)";
  }
}

function updateListenerStatus(running, mode) {
  const pulse = document.getElementById("tg-pulse");
  const text = document.getElementById("tg-status-text");
  if (!pulse || !text) return;

  if (running) {
    pulse.className = "pulse-dot";
    text.innerText = `Telegram: Listening (${mode})`;
  } else {
    pulse.className = "pulse-dot idle";
    text.innerText = "Telegram: Standby";
  }
}

// Load System Status
async function loadSystemStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();

    updateListenerStatus(data.listener.running, data.listener.mode);

    const aiEl = document.getElementById("ai-status-text");
    if (aiEl) {
      aiEl.innerText = `AI: ${data.ai.mode}`;
    }
    const chartAiBadge = document.getElementById("chart-ai-badge");
    if (chartAiBadge && data.ai) {
      chartAiBadge.innerText = data.ai.provider === "gemini" ? (data.ai.gemini_model || "Gemini") : (data.ai.text_model || data.ai.mode);
    }
    const infraAiEl = document.getElementById("infra-ai-val");
    if (infraAiEl && data.ai) {
      infraAiEl.innerHTML = `<i data-lucide="cpu" style="width:12px;height:12px;"></i> ${escapeHtml(data.ai.text_model || data.ai.mode)}`;
    }

    // Load XM MT5 status
    try {
      const xmRes = await fetch("/api/xm/status");
      const xm = await xmRes.json();
      const xmEl = document.getElementById("xm-status-text");
      const xmBadge = document.getElementById("xm-status-badge");
      if (xmEl && xm) {
        const bal = xm.account ? `$${xm.account.balance.toLocaleString()}` : "";
        if (!xm.auto_execution) {
          xmEl.innerText = `XM MT5: Execution Off`;
          if (xmBadge) xmBadge.style.borderColor = "rgba(100, 116, 139, 0.4)";
        } else if (xm.mode === "XM_DEMO_SANDBOX") {
          xmEl.innerText = `XM MT5: Sandbox (${bal})`;
          if (xmBadge) xmBadge.style.borderColor = "rgba(245, 158, 11, 0.4)";
        } else {
          xmEl.innerText = `XM MT5: Demo Active (${bal})`;
          if (xmBadge) xmBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";
        }
      }
    } catch (xe) {
      console.warn("XM status check", xe);
    }
  } catch (e) {
    console.error("Failed to load status", e);
  }
}

// Load KPI Stats with ReactBits CountUp animation
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const stats = await res.json();

    animateCount("kpi-total", stats.total_messages || 0);
    animateCount("kpi-trades", stats.total_trades || 0);
    animateCount("kpi-chatter", stats.total_chatter || 0);
    animateCount("kpi-latency", stats.avg_latency_ms || 0, 800, "", " ms");

    const noiseEl = document.getElementById("kpi-noise-rate");
    if (noiseEl) noiseEl.innerText = `${stats.noise_filter_ratio || 0}% noise rejected`;

    const confEl = document.getElementById("kpi-confidence");
    if (confEl) confEl.innerText = `${stats.avg_confidence || 0}% avg confidence`;

    updateWatchlist(messagesCache);
    if (typeof updateDashboardCharts === "function") {
      updateDashboardCharts(stats, messagesCache);
    }
  } catch (e) {
    console.error("Failed to load stats", e);
  }
}

// Load Messages Feed
async function loadMessages() {
  try {
    let url = `/api/messages?limit=60&intent_filter=${encodeURIComponent(currentFilter)}`;
    if (currentSearch) {
      url += `&search=${encodeURIComponent(currentSearch)}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    messagesCache = data.messages || [];
    renderFeed(messagesCache);
    updateWatchlist(messagesCache);
    if (typeof renderTradeSignals === "function") {
      renderTradeSignals(messagesCache);
    }
    if (typeof populateChannelFilter === "function") {
      populateChannelFilter(messagesCache);
    }
    if (typeof updateDashboardNavBadges === "function") {
      updateDashboardNavBadges(messagesCache);
    }
    if (typeof updateRecentDashboardWidgets === "function") {
      updateRecentDashboardWidgets(messagesCache);
    }
    if (typeof updateDashboardCharts === "function") {
      updateDashboardCharts(null, messagesCache);
    }
  } catch (e) {
    console.error("Failed to load messages", e);
  }
}

// Render Message Feed Cards
function renderFeed(messages) {
  const container = document.getElementById("message-feed");
  if (!container) return;

  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="inbox" style="width: 36px; height: 36px; opacity: 0.5;"></i>
        <p>No messages match current filter (${currentFilter}).</p>
      </div>
    `;
    initIcons();
    return;
  }

  container.innerHTML = messages.map(msg => createSignalCardHtml(msg)).join("");
  initIcons();
}

function getOutcomeBadgeClass(status) {
  const map = {
    'PENDING': 'badge-pending',
    'PENDING_AWAITING_PARAMS': 'badge-pending',
    'EXECUTED': 'badge-executed',
    'FAILED_EXECUTION': 'badge-sl-hit',
    'CANCELLED': 'badge-cancelled',
    'SL_HIT': 'badge-sl-hit',
    'TP_HIT': 'badge-tp-hit',
    'ACTIVE': 'badge-active'
  };
  return map[status] || 'badge-pending';
}

function parseUtcDate(ts) {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  let s = String(ts).trim();
  // Normalize SQLite "YYYY-MM-DD HH:MM:SS" or ISO strings lacking timezone offset as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    s = s.replace(" ", "T") + "Z";
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) {
    s = s + "Z";
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function formatLocalTime(ts, withSeconds = true) {
  const d = parseUtcDate(ts);
  if (!d) return "";
  const opts = withSeconds
    ? { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' };
  return d.toLocaleTimeString([], opts);
}

function createSignalCardHtml(msg) {
  const intent = msg.intent || "CHATTER";
  const action = msg.action || "NONE";
  const isChatter = intent === "CHATTER" || intent === "OTHERS";
  const isBuy = !isChatter && (action.includes("BUY") || action === "LONG");
  const isSell = !isChatter && (action.includes("SELL") || action === "SHORT");
  const isUpdate = !isChatter && (intent === "TRADE_UPDATE" || intent === "CLOSE_TRADE" || action.includes("MODIFY") || action.includes("PARTIAL"));

  let cardClass = "signal-card";
  let badgeClass = "intent-badge chatter";
  let badgeIcon = "message-circle";

  if (isBuy) {
    cardClass += " trade-card";
    badgeClass = "intent-badge buy";
    badgeIcon = "arrow-up-right";
  } else if (isSell) {
    cardClass += " sell-card";
    badgeClass = "intent-badge sell";
    badgeIcon = "arrow-down-right";
  } else if (isUpdate) {
    cardClass += " update-card";
    badgeClass = "intent-badge update";
    badgeIcon = "refresh-cw";
  }

  const timeFormatted = msg.created_at ? (formatLocalTime(msg.created_at, true) || 'Just now') : 'Just now';
  const confidence = msg.confidence || 0;

  // Format TP levels
  let tpDisplay = "N/A";
  if (Array.isArray(msg.tp_levels) && msg.tp_levels.length > 0) {
    tpDisplay = msg.tp_levels.map((t, idx) => `TP${idx + 1}: ${t}`).join(" | ");
  }

  const safeJsonData = encodeURIComponent(JSON.stringify(msg));

  return `
    <div class="${cardClass}" id="msg-card-${msg.message_id}">
      <div class="signal-card-header">
        <div class="signal-card-meta">
          <span class="sender-tag">${escapeHtml(msg.sender || "Channel Owner")}</span>
          <span class="signal-card-meta-sub">in ${escapeHtml(msg.channel_title || "Channel")}</span>
        </div>
        <div class="signal-card-meta-right">
          <span class="source-pill">${msg.source || "telegram"}</span>
          <span>${timeFormatted}</span>
        </div>
      </div>

      <!-- Raw Telegram Message -->
      <div class="raw-message-box">
        ${escapeHtml(msg.text || "[Image Broadcast]")}
        ${(() => {
      if (!msg.media_path) return "";
      let p = msg.media_path.replace(/\\/g, '/');
      if (p.includes('uploads/')) p = p.substring(p.indexOf('uploads/'));
      else if (p.includes('sample_signals/')) p = p.substring(p.indexOf('sample_signals/'));
      if (!p.startsWith('/')) p = '/' + p;
      return `<div class="img-wrap"><img src="${p}" class="raw-image-thumb" onclick="window.open(this.src)" title="Click to view full image" onerror="this.parentElement.style.display='none'"></div>`;
    })()}
      </div>

      <!-- AI Interpretation Box -->
      <div class="ai-box">
        ${msg.trade_id ? `
          <div class="trade-link-row">
            <span class="trade-id-pill" onclick="switchRightTab('watchlist'); filterToTrade('${msg.trade_id}')" title="Click to view full lifecycle in Trade Watchlist">
              <i data-lucide="tag" style="width: 11px; height: 11px;"></i> #${msg.trade_id}
            </span>
            ${msg.trade_status ? `
              <span class="outcome-badge ${getOutcomeBadgeClass(msg.trade_status)}">
                ${escapeHtml(msg.trade_outcome || msg.trade_status)}
              </span>
            ` : ''}
          </div>
        ` : ''}

        <div class="ai-box-header">
          <div class="ai-box-head-row">
            <span class="${badgeClass}">
              <i data-lucide="${badgeIcon}" style="width: 13px; height: 13px;"></i>
              ${isChatter ? "CHATTER / FILTERED" : `${action} ${msg.symbol || ''}`}
            </span>
            ${msg.symbol && !isChatter ? `<span class="symbol-badge">${msg.symbol}</span>` : ''}
          </div>
          <div class="confidence-label" style="color: ${confidence > 80 ? 'var(--success-text)' : 'var(--warning-text)'};">
            ${confidence}% Confidence
          </div>
        </div>

        ${!isChatter ? `
          <div class="params-grid">
            <div class="param-item">
              <div class="param-title">Order Type</div>
              <div class="param-value">${msg.order_type || 'MARKET'}</div>
            </div>
            <div class="param-item">
              <div class="param-title">Entry Price</div>
              <div class="param-value ${isBuy ? 'green' : 'red'}">${msg.entry_price || 'CMP'}</div>
            </div>
            <div class="param-item">
              <div class="param-title">Stop Loss (SL)</div>
              <div class="param-value red">${msg.sl || 'Open / BE'}</div>
            </div>
            <div class="param-item">
              <div class="param-title">Take Profit (TP)</div>
              <div class="param-value green" title="${escapeHtml(tpDisplay)}">${tpDisplay}</div>
            </div>
          </div>
        ` : ''}

        <div class="reasoning-text">
          <span class="ai-intent-label">AI Intent:</span> ${escapeHtml(msg.reasoning || "Analyzed intent.")}
        </div>

        <div class="meta-footer">
          <div>
            <i data-lucide="cpu" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
            ${escapeHtml(msg.model_used || "Smart Engine")} &bull; ${msg.processing_time_ms || 12}ms
          </div>
          <button class="btn btn-secondary btn-xs" onclick="inspectJson('${safeJsonData}')">
            <i data-lucide="code" style="width: 12px; height: 12px;"></i> Inspect Raw JSON
          </button>
        </div>
      </div>
    </div>
  `;
}

// Handle Incoming Live Message via WebSocket
function handleIncomingMessage(data) {
  messagesCache.unshift(data);
  const isChat = data.intent === "CHATTER" || data.intent === "OTHERS";
  appendLog(
    isChat ? "INFO" : "SIGNAL",
    "STREAM",
    `[${data.intent}] ${data.action || ''} ${data.symbol || ''} - "${(data.text || '').substring(0, 45)}..."`
  );

  // Re-render feed if matches current filter
  if (currentFilter === "ALL" ||
    (currentFilter === "TRADES" && data.is_trade === 1) ||
    (currentFilter === "CHATTER" && isChat) ||
    (currentFilter === "UPDATES" && (data.intent === "TRADE_UPDATE" || data.intent === "CLOSE_TRADE")) ||
    (currentFilter === data.intent)) {
    renderFeed(messagesCache);
  }

  loadStats();
  loadTrades();
}

// Filters & Search
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll(".filter-tab, .filter-btn").forEach(t => {
    if ((t.dataset && t.dataset.filter === filter) || t.innerText.trim().toUpperCase() === filter.toUpperCase()) {
      t.classList.add("active");
    } else {
      t.classList.remove("active");
    }
  });
  if (btn) btn.classList.add("active");
  loadMessages();
}

function handleSearch(val) {
  currentSearch = (val || "").trim();
  debounceSearch();
}

function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    const searchInput = document.getElementById("signal-search") || document.getElementById("feed-search");
    if (searchInput) currentSearch = searchInput.value.trim();
    loadMessages();
  }, 300);
}

// Tab Switching
function switchTab(tabId, btn) {
  switchRightTab(tabId, btn);
}

function switchRightTab(tabId, btn) {
  if (typeof switchDashboardPage === "function") {
    switchDashboardPage(tabId);
  }
  document.querySelectorAll(".tab-nav-btn, .tab-btn").forEach(b => b.classList.remove("active"));
  if (btn) {
    btn.classList.add("active");
  } else {
    const targetBtn = document.getElementById(`tab-btn-${tabId}`);
    if (targetBtn) {
      targetBtn.classList.add("active");
    } else {
      const allBtns = document.querySelectorAll(".tab-nav-btn, .tab-btn");
      if (tabId === "simulator" && allBtns[0]) allBtns[0].classList.add("active");
      if (tabId === "watchlist" && allBtns[1]) allBtns[1].classList.add("active");
      if (tabId === "positions" && allBtns[2]) allBtns[2].classList.add("active");
      if (tabId === "terminal" && allBtns[3]) allBtns[3].classList.add("active");
    }
  }

  const simEl = document.getElementById("tab-simulator");
  const watchEl = document.getElementById("tab-watchlist");
  const posEl = document.getElementById("tab-positions");
  const termEl = document.getElementById("tab-terminal");

  if (simEl) simEl.style.display = tabId === "simulator" ? "block" : "none";
  if (watchEl) watchEl.style.display = tabId === "watchlist" ? "block" : "none";
  if (posEl) posEl.style.display = tabId === "positions" ? "block" : "none";
  if (termEl) termEl.style.display = tabId === "terminal" ? "block" : "none";

  if (tabId === "watchlist") {
    loadTrades();
  } else if (tabId === "positions") {
    loadXMPositions();
  } else if (tabId === "terminal") {
    loadLogs();
  }
  initIcons();
}

// Preset Prompts for instant testing of all signal intents & outcomes
function injectPreset(type) {
  const presetMap = {
    "PENDING": "BE READY ON THIS LEVEL 2640-2642 XAUUSD BUY WAIT FOR 1 MIN ENGULFING OR EVENING STAR CONFIRMATION SL 2634 TP 2655",
    "ACTIVE_MARKET": "BUY BTCUSDT CMP 68100 SL 67800 TP 68900 ACTIVE NOW",
    "ACTIVATE_CONFIRM": "ACTIVE NOW, ENTER FAST! 1m confirmation candle closed.",
    "ACTIVATE": "ACTIVE NOW, ENTER FAST! 1m confirmation candle closed.",
    "CANCEL": "Setup cancelled guys, level not tapped do not enter.",
    "CHATTER": "Good morning traders! Hope everyone had a great weekend 🚀",
    "gold_buy": "BUY GOLD NOW 2642.50 SL 2636.00 TP1 2648.00 TP2 2656.00",
    "btc_short": "BTC SHORT NOW 91250 SL 91900 TP1 90400 TP2 89500"
  };

  const keyUpper = String(type || "").toUpperCase().trim();
  const text = presetMap[keyUpper] || presetMap[type] || type;

  const simTextEl = document.getElementById("sim-text");
  if (simTextEl && text) {
    simTextEl.value = text;
    simTextEl.focus();
    simTextEl.style.borderColor = "#38bdf8";
    setTimeout(() => { simTextEl.style.borderColor = ""; }, 500);
  }
}

function applyPreset(key) {
  injectPreset(key);
}

// Drag and Drop & File Selection
function setupDragAndDrop() {
  const dropzone = document.getElementById("drop-zone") || document.getElementById("dropzone");
  if (!dropzone) return;

  ["dragenter", "dragover"].forEach(event => {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach(event => {
    dropzone.addEventListener(event, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });
}

function handleFileSelect(e) {
  const files = e && e.target ? e.target.files : (e && e.files ? e.files : []);
  if (files && files.length > 0) {
    handleFile(files[0]);
  }
}

function handleFileSelected(input) {
  if (input && input.files && input.files.length > 0) {
    handleFile(input.files[0]);
  }
}

function handleFile(file) {
  selectedFile = file;

  const nameEl = document.getElementById("preview-filename") || document.getElementById("file-name-text");
  if (nameEl) nameEl.innerText = file.name;

  const thumbEl = document.getElementById("preview-thumbnail");
  if (thumbEl) {
    const reader = new FileReader();
    reader.onload = (e) => { thumbEl.src = e.target.result; };
    reader.readAsDataURL(file);
  }

  const previewArea = document.getElementById("file-preview-area") || document.getElementById("file-preview-badge");
  if (previewArea) previewArea.style.display = "flex";
}

function clearSelectedFile(e) {
  if (e && e.stopPropagation) e.stopPropagation();
  selectedFile = null;
  const fileInput = document.getElementById("sim-file");
  if (fileInput) fileInput.value = "";

  const previewArea = document.getElementById("file-preview-area") || document.getElementById("file-preview-badge");
  if (previewArea) previewArea.style.display = "none";
}

function clearFileSelected(e) {
  clearSelectedFile(e);
}

// Submit Simulation
async function submitSimulation(e) {
  e.preventDefault();
  const text = document.getElementById("sim-text").value.trim();
  const sender = document.getElementById("sim-sender").value.trim() || "Channel Owner";
  const channel = document.getElementById("sim-channel").value.trim() || "VIP Signals";
  const submitBtn = document.getElementById("btn-sim-submit") || document.getElementById("sim-submit-btn");

  if (!text && !selectedFile) {
    showToast("Please enter message text or attach a chart screenshot.", "error");
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i data-lucide="loader-2" class="spin" style="width: 16px; height: 16px;"></i> Analyzing Intent with AI...`;
    initIcons();
  }

  const formData = new FormData();
  formData.append("text", text);
  formData.append("sender", sender);
  formData.append("channel_title", channel);
  if (selectedFile) {
    formData.append("image", selectedFile);
  }

  try {
    const res = await fetch("/api/simulate", {
      method: "POST",
      body: formData
    });
    const result = await res.json();
    if (!res.ok) {
      const msg = result.detail || `HTTP ${res.status}`;
      showToast(res.status === 401 ? "Sign in via Google OAuth to run simulations." : `Simulation failed: ${msg}`, "error");
      const fb = document.getElementById("sim-feedback-container");
      if (fb) {
        fb.innerHTML = `<div class="empty-state"><div class="empty-state-title" style="color: var(--danger-text);">Simulation Rejected (${res.status})</div><div class="empty-state-sub">${escapeHtml(msg)}</div></div>`;
      }
      return;
    }

    // Clear inputs
    document.getElementById("sim-text").value = "";
    clearSelectedFile();
    showToast("Signal simulated & parsed successfully!", "success");

    const fb = document.getElementById("sim-feedback-container");
    if (fb && result.result) {
      fb.innerHTML = createSignalCardHtml(result.result);
    }

    // Refresh feed and stats
    loadMessages();
    loadStats();
    loadTrades();
    loadXMPositions();

    // Scroll to new card if present
    setTimeout(() => {
      const cardEl = document.getElementById(`msg-card-${result.result ? result.result.message_id : ''}`);
      if (cardEl) {
        cardEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 400);
  } catch (err) {
    showToast(`Simulation failed: ${err.message}`, "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="send" style="width: 16px; height: 16px;"></i> Process &amp; Filter with AI`;
      initIcons();
    }
  }
}

// --- Trade Lifecycle & Outcomes Watchlist Manager ---
let currentTradeFilter = "ALL";
let tradesCache = [];

async function loadTrades() {
  const container = document.getElementById("watchlist-container");
  if (!container) return;

  try {
    let url = "/api/trades?limit=60";
    if (currentTradeFilter && currentTradeFilter !== "ALL") {
      url += `&status_filter=${encodeURIComponent(currentTradeFilter)}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    tradesCache = data.trades || [];
    renderTrades(tradesCache);
  } catch (err) {
    console.error("Failed to load trades:", err);
  }
}

function setTradeFilter(filter, btn) {
  currentTradeFilter = filter;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll(".filter-btn, .chip-btn").forEach(el => el.classList.remove("active"));
    btn.classList.add("active");
  }
  loadTrades();
}

function filterToTrade(tradeId) {
  setTimeout(() => {
    const card = document.getElementById(`trade-card-${tradeId}`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.style.borderColor = "#3b82f6";
      card.style.boxShadow = "0 0 15px rgba(59, 130, 246, 0.5)";
      setTimeout(() => {
        card.style.borderColor = "";
        card.style.boxShadow = "";
      }, 2500);
    }
  }, 300);
}

function updateWatchlist(messages) {
  loadTrades();
}

function renderTrades(trades) {
  const container = document.getElementById("watchlist-container");
  if (!container) return;

  if (!trades || trades.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i data-lucide="shield-check" style="width: 36px; height: 36px; opacity: 0.5;"></i>
        <p>No trades matching filter (${currentTradeFilter}).</p>
        <p class="empty-state-sub">Simulate a trade setup or receive a Telegram broadcast to track lifecycle states.</p>
      </div>
    `;
    initIcons();
    return;
  }

  container.innerHTML = trades.map(t => {
    const isBuy = (t.action || "").includes("BUY") || (t.action || "") === "LONG";
    const status = t.status || "ACTIVE";
    const badgeCls = getOutcomeBadgeClass(status);
    let tpDisplay = "N/A";
    if (Array.isArray(t.tp_levels) && t.tp_levels.length > 0) {
      tpDisplay = t.tp_levels.join(" | ");
    }

    return `
      <div class="trade-tracker-card" id="trade-card-${t.trade_id}">
        <div class="trade-card-top">
          <div>
            <div class="trade-head-row">
              <span class="trade-id-pill" title="Unique Trade Identifier">
                <i data-lucide="tag" style="width: 11px; height: 11px;"></i> #${t.trade_id}
              </span>
              <span class="trade-card-symbol">
                <span style="color: ${isBuy ? 'var(--success-text)' : 'var(--danger-text)'};">${t.action || 'BUY'}</span>
                <span>${t.symbol || 'XAUUSD'}</span>
              </span>
              <span class="source-pill">${t.order_type || 'MARKET'}</span>
            </div>
            <div class="trade-start-meta">
              Started: ${t.created_at ? (formatLocalTime(t.created_at, false) || 'Today') : 'Today'}
              ${t.updated_at && t.updated_at !== t.created_at ? `&bull; Updated: ${formatLocalTime(t.updated_at, false)}` : ''}
            </div>
          </div>
          <div class="trade-outcome-wrap">
            <span class="outcome-badge ${badgeCls}">
              ${escapeHtml(t.outcome || t.status)}
            </span>
          </div>
        </div>

        <!-- Prices Row -->
        <div class="params-grid params-grid-tight">
          <div class="param-item">
            <div class="param-title">Entry</div>
            <div class="param-value ${isBuy ? 'green' : 'red'}">${t.entry_price || 'CMP'}</div>
          </div>
          <div class="param-item">
            <div class="param-title">Stop Loss (SL)</div>
            <div class="param-value red">${t.sl || 'Open / BE'}</div>
          </div>
          <div class="param-item">
            <div class="param-title">Take Profit (TP)</div>
            <div class="param-value green" title="${escapeHtml(tpDisplay)}">${tpDisplay}</div>
          </div>
          <div class="param-item">
            <div class="param-title">Risk:Reward</div>
            <div class="param-value blue">${t.risk_reward || '1:2+'}</div>
          </div>
        </div>

        ${t.xm_ticket ? `
          <div class="xm-execution-receipt">
            <div class="xm-receipt-top">
              <span class="xm-receipt-title">
                <i data-lucide="check-circle-2" style="width: 14px; height: 14px;"></i>
                XM MT5 Order Executed
              </span>
              <span class="xm-receipt-ticket">
                Ticket #${t.xm_ticket}
              </span>
            </div>
            <div class="xm-receipt-stats">
              <div>Lots: <strong class="xm-stat-strong">${t.xm_lots || (t.symbol && t.symbol.includes('BTC') ? '0.04' : (t.symbol && (t.symbol.includes('XAU') || t.symbol.includes('GOLD')) ? '0.02' : '0.01'))}</strong></div>
              <div>Fill Price: <strong class="xm-stat-strong">${t.xm_execution_price || t.entry_price || 'CMP'}</strong></div>
              <div>SL: <strong style="color:var(--danger-text);">${t.sl || 'Open'}</strong></div>
              <div>TP: <strong style="color:var(--success-text);">${tpDisplay}</strong></div>
            </div>
            <div class="xm-receipt-policy">
              🛡️ XM Policy: Running Hands-Off until TP or SL is reached.
            </div>
          </div>
        ` : (t.pnl_notes ? `
          <div class="pnl-note ${t.pnl_notes.includes('SAFETY SHIELD') || t.pnl_notes.includes('REJECTED') ? 'pnl-note-shield' : 'pnl-note-info'}">
            <i data-lucide="${t.pnl_notes.includes('SAFETY SHIELD') || t.pnl_notes.includes('REJECTED') ? 'shield-alert' : 'info'}" style="width: 13px; height: 13px; flex-shrink: 0;"></i>
            <span>${escapeHtml(t.pnl_notes)}</span>
          </div>
        ` : '')}

        <!-- Actions & Timeline Row -->
        <div class="trade-card-actions">
          <button class="btn btn-secondary btn-xs" onclick="toggleTimeline('${t.trade_id}')">
            <i data-lucide="history" style="width: 12px; height: 12px;"></i>
            Timeline (${t.event_count || 1})
          </button>

          <div class="trade-action-spacer">
            ${t.status === 'PENDING' ? `
              <button class="btn btn-danger btn-xs" onclick="updateTradeStatusManual('${t.trade_id}', 'CANCELLED')">
                <i data-lucide="x" style="width: 11px; height: 11px;"></i> Cancel Setup
              </button>
            ` : t.status === 'EXECUTED' ? `
              <span class="trade-action-state">
                <i data-lucide="lock" style="width: 11px; height: 11px;"></i> XM Hands-Off
              </span>
            ` : `
              <span class="trade-action-dim">
                ${escapeHtml(t.outcome || t.status)}
              </span>
            `}
          </div>
        </div>

        <!-- Hidden Timeline Container -->
        <div id="timeline-${t.trade_id}" class="trade-timeline-container" style="display: none;">
          <div class="timeline-loading">Loading trade lifecycle audit...</div>
        </div>
      </div>
    `;
  }).join("");

  initIcons();
}

async function toggleTimeline(tradeId) {
  const container = document.getElementById(`timeline-${tradeId}`);
  if (!container) return;

  if (container.style.display === "block") {
    container.style.display = "none";
    return;
  }

  container.style.display = "block";
  try {
    const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}`);
    const data = await res.json();
    const events = data.events || [];

    if (events.length === 0) {
      container.innerHTML = `<div class="timeline-no-events">No logged events yet.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="timeline-audit-title">
        Lifecycle Audit Trail (${events.length} events)
      </div>
      ${events.map(ev => `
        <div class="trade-timeline-step">
          <div class="timeline-dot"></div>
          <div>
            <div class="timeline-step-meta">
              <span class="outcome-badge outcome-badge-sm ${getOutcomeBadgeClass(ev.new_status)}">
                ${escapeHtml(ev.new_status)}
              </span>
              <span class="timeline-step-time">
                ${ev.created_at ? formatLocalTime(ev.created_at, true) : ''}
              </span>
            </div>
            <div class="timeline-step-note">
              ${escapeHtml(ev.notes || '')}
            </div>
            ${ev.text ? `
              <div class="timeline-step-quote">
                Telegram: "${escapeHtml(ev.text)}"
              </div>
            ` : ''}
          </div>
        </div>
      `).join("")}
    `;
  } catch (err) {
    container.innerHTML = `<div class="timeline-error">Failed to load events: ${escapeHtml(err.message)}</div>`;
  }
}

async function updateTradeStatusManual(tradeId, newStatus) {
  if (!newStatus) return;
  try {
    const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        notes: `Manual operator outcome update to ${newStatus}`
      })
    });
    if (res.ok) {
      showToast(`Outcome updated to ${newStatus}`, "success");
      loadTrades();
      loadMessages();
      loadStats();
    } else {
      const err = await res.json();
      showToast("Error: " + (err.detail || "Failed to update outcome"), "error");
    }
  } catch (e) {
    showToast("Request failed: " + e.message, "error");
  }
}

// Active XM MT5 Positions Loader
async function loadXMPositions() {
  const container = document.getElementById("positions-container");
  if (!container) return;

  try {
    const res = await fetch("/api/xm/positions");
    const data = await res.json();
    const positions = data.positions || [];
    const count = data.count || 0;

    // Update badge in tab header
    const badge = document.getElementById("open-positions-badge");
    if (badge) {
      badge.innerText = count;
      badge.style.display = count > 0 ? "inline-block" : "none";
    }

    // Update meta bar
    const metaCount = document.getElementById("xm-meta-count");
    if (metaCount) metaCount.innerText = count;

    if (data.account) {
      const srvEl = document.getElementById("xm-meta-server");
      if (srvEl) srvEl.innerText = data.account.server || "XMGlobal-MT5";
      const accEl = document.getElementById("xm-meta-account");
      if (accEl) accEl.innerText = "#" + (data.account.login || "Demo");
    }

    let totalProfit = 0;
    positions.forEach(p => { totalProfit += (p.profit || 0); });
    const pnlEl = document.getElementById("xm-meta-pnl");
    if (pnlEl) {
      pnlEl.innerText = (totalProfit >= 0 ? "+$" : "-$") + Math.abs(totalProfit).toFixed(2);
      pnlEl.style.color = totalProfit >= 0 ? "#10b981" : "#ef4444";
    }

    if (positions.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <i data-lucide="shield-check" style="width: 32px; height: 32px; color: var(--success-text);"></i>
          <div class="empty-state-title">No Active Running Trades in XM MT5</div>
          <div class="empty-state-sub">When a pending setup activates or a direct market order arrives, it executes automatically on XM MT5 with strict SL, TP, and lot size.</div>
        </div>
      `;
      initIcons();
      return;
    }

    container.innerHTML = `
      <div class="pos-list">
        ${positions.map(p => {
      const isBuy = (p.type || "BUY") === "BUY";
      const profitColor = (p.profit || 0) >= 0 ? "var(--success-text)" : "var(--danger-text)";
      const profitSign = (p.profit || 0) >= 0 ? "+" : "";

      return `
            <div class="pos-card">
              <div class="pos-card-top">
                <div class="trade-head-row">
                  <span class="pos-id">#${p.ticket}</span>
                  <span class="pos-symbol" style="color: ${isBuy ? 'var(--success-text)' : 'var(--danger-text)'};">
                    ${p.type} ${p.symbol}
                  </span>
                  <span class="pos-lots">${p.volume} Lots</span>
                </div>
                <div class="pos-pnl" style="color: ${profitColor};">
                  ${profitSign}$${Number(p.profit || 0).toFixed(2)}
                </div>
              </div>

              <!-- Price levels -->
              <div class="pos-grid">
                <div>
                  <div class="pos-grid-label">Open Price</div>
                  <div class="pos-grid-value">${p.price_open}</div>
                </div>
                <div>
                  <div class="pos-grid-label">Market Price</div>
                  <div class="pos-grid-value">${p.price_current}</div>
                </div>
                <div>
                  <div class="pos-grid-label">Stop Loss (SL)</div>
                  <div class="pos-grid-value" style="color: var(--danger-text);">${p.sl || 'Open'}</div>
                </div>
                <div>
                  <div class="pos-grid-label">Take Profit (TP)</div>
                  <div class="pos-grid-value" style="color: var(--success-text);">${p.tp || 'Open'}</div>
                </div>
              </div>

              <!-- Interactive Close & Lots Controls -->
              <div class="pos-actions" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span style="font-size: 11px; color: var(--text-muted); font-weight: 500;">Lots:</span>
                  <input type="number" id="close-lots-${p.ticket}" step="0.01" min="0.01" max="${p.volume}" value="${p.volume}" style="width: 64px; padding: 4px 6px; font-size: 12px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); border-radius: 4px; color: #fff; text-align: center;" />
                  <button type="button" class="btn btn-secondary btn-xs" style="font-size: 10px; padding: 3px 6px;" onclick="setCloseLotsPreset(${p.ticket}, ${(p.volume / 2.0).toFixed(2)})">50%</button>
                  <button type="button" class="btn btn-secondary btn-xs" style="font-size: 10px; padding: 3px 6px;" onclick="setCloseLotsPreset(${p.ticket}, ${p.volume})">100%</button>
                </div>
                <button type="button" class="btn btn-danger btn-sm" id="btn-close-${p.ticket}" style="font-size: 11px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 4px;" onclick="closeXMPosition(${p.ticket})">
                  <i data-lucide="x-circle" style="width: 12px; height: 12px;"></i>
                  Close Trade
                </button>
              </div>

              <div class="pos-footer" style="margin-top: 8px;">
                <span>Opened: ${p.time || 'Recently'}</span>
                <span class="pos-handsoff">
                  <i data-lucide="activity" style="width: 10px; height: 10px;"></i>
                  Auto 1:1 Monitored
                </span>
              </div>
            </div>
          `;
    }).join("")}
      </div>
    `;
    if (typeof updateDashboardPositionsGlance === "function") {
      updateDashboardPositionsGlance(positions);
    }
    initIcons();
  } catch (e) {
    console.error("Failed to load XM positions:", e);
  }
}

function setCloseLotsPreset(ticket, lots) {
  const input = document.getElementById(`close-lots-${ticket}`);
  if (input) {
    input.value = lots;
  }
}

async function closeXMPosition(ticket) {
  const input = document.getElementById(`close-lots-${ticket}`);
  const lots = input ? parseFloat(input.value) : null;
  const btn = document.getElementById(`btn-close-${ticket}`);

  const volText = lots ? `${lots} lots` : "this position";
  if (!confirm(`Are you sure you want to close ${volText} on MT5 Ticket #${ticket}?`)) {
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span style="display:inline-block; animation: spin 1s linear infinite;">⏳</span> Closing...`;
  }

  try {
    const res = await fetch("/api/xm/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: parseInt(ticket), lots: lots })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      alert("Failed to close position: " + (data.detail || data.error || "Unknown error"));
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="x-circle" style="width: 12px; height: 12px;"></i> Close Trade`;
        initIcons();
      }
      return;
    }

    appendLog("SIGNAL", "XM_EXECUTION", `SUCCESS: Closed ${data.closed_lots} lots on #${ticket} (${data.status}).`);
    await loadXMPositions();
  } catch (err) {
    console.error("Error closing position:", err);
    alert("Network or server error while closing position: " + err.message);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="x-circle" style="width: 12px; height: 12px;"></i> Close Trade`;
      initIcons();
    }
  }
}

// Terminal logs
async function loadLogs() {
  try {
    const res = await fetch("/api/logs?limit=40");
    const data = await res.json();
    const terminal = document.getElementById("terminal-logs");
    if (!terminal) return;

    terminal.innerHTML = (data.logs || []).reverse().map(l => `
      <div class="log-entry">
        <span class="log-time">[${formatLocalTime(l.created_at, true)}]</span>
        <span class="log-level-${l.level}">[${l.level}]</span>
        <span class="log-msg">${escapeHtml(l.message)}</span>
      </div>
    `).join("");
    terminal.scrollTop = terminal.scrollHeight;
  } catch (e) {
    console.error("Failed to load logs", e);
  }
}

function appendLog(level, category, message) {
  const terminal = document.getElementById("terminal-logs");
  if (!terminal) return;

  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `
    <span class="log-time">[${new Date().toLocaleTimeString()}]</span>
    <span class="log-level-${level}">[${level}]</span>
    <span class="log-msg">${escapeHtml(message)}</span>
  `;
  terminal.appendChild(entry);
  if (isTerminalAutoScroll) {
    terminal.scrollTop = terminal.scrollHeight;
  }
}

// ============================================================
// SPA Router & Navigation System
// ============================================================

function navigateTo(viewName, targetAnchor) {
  const landingView = document.getElementById("view-landing");
  const loginView = document.getElementById("view-login");
  const dashboardView = document.getElementById("view-dashboard");

  if (!landingView || !loginView || !dashboardView) return;

  // Handle register alias (permanently disabled, routes directly to login)
  if (viewName === "register") {
    viewName = "login";
  }

  // Protected Route Guard for Dashboard
  if (viewName === "dashboard") {
    const user = getAuthUser();
    const allowed = ["riddhesh.firake@gmail.com", "acc94926@gmail.com"];
    if (!user || !user.email || !allowed.includes(user.email.toLowerCase())) {
      showToast("Access Restricted: Please select your authorized administrator account to enter.", "warning");
      navigateTo("login");
      return;
    }
  }

  // Toggle SPA Views
  landingView.style.display = (viewName === "landing") ? "block" : "none";
  loginView.style.display = (viewName === "login") ? "block" : "none";
  dashboardView.style.display = (viewName === "dashboard") ? "block" : "none";

  // Update URL Hash without triggering hard reload
  if (viewName === "landing" && targetAnchor) {
    history.pushState(null, "", `#${targetAnchor}`);
    const anchorEl = document.getElementById(targetAnchor);
    if (anchorEl) {
      anchorEl.scrollIntoView({ behavior: "smooth" });
    }
  } else {
    history.pushState(null, "", `#${viewName}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (viewName === "login") {
    setTimeout(initGoogleIdentityServices, 150);
  }

  // If entering dashboard, initialize & refresh data streams
  if (viewName === "dashboard") {
    loadSystemStatus();
    loadStats();
    loadMessages();
    loadTrades();
    loadLogs();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectWebSocket();
    }
  }

  // Refresh Lucide icon renderings
  initIcons();
}

function handleDashboardAccess() {
  const user = getAuthUser();
  const allowed = ["riddhesh.firake@gmail.com", "acc94926@gmail.com"];
  if (user && user.email && allowed.includes(user.email.toLowerCase())) {
    navigateTo("dashboard");
  } else {
    showToast("Authentication required. Please sign in with your authorized Google Account.", "warning");
    navigateTo("login");
  }
}

function handleHashRouting() {
  const hash = (window.location.hash || "").replace("#", "").toLowerCase().trim();
  const dashPages = ["chats", "signals", "positions", "watchlist", "simulator", "terminal", "settings"];
  if (hash === "dashboard" || hash === "home") {
    handleDashboardAccess();
  } else if (dashPages.includes(hash)) {
    const user = getAuthUser();
    const allowed = ["riddhesh.firake@gmail.com", "acc94926@gmail.com"];
    if (user && user.email && allowed.includes(user.email.toLowerCase())) {
      navigateTo("dashboard");
      switchDashboardPage(hash);
    } else {
      handleDashboardAccess();
    }
  } else if (hash === "login") {
    navigateTo("login");
  } else if (hash === "register") {
    navigateTo("register");
  } else if (["features", "architecture", "security"].includes(hash)) {
    navigateTo("landing", hash);
  } else {
    // Default route: Landing page
    navigateTo("landing");
  }
}

window.addEventListener("hashchange", handleHashRouting);

// Mobile hamburger menu toggle for the landing navigation
function toggleMobileMenu() {
  const nav = document.getElementById("landing-nav");
  if (nav) nav.classList.toggle("open");
}

// Auto-close the mobile menu after a link/button is tapped
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".landing-nav-links a, .landing-nav-links button").forEach((el) => {
    el.addEventListener("click", () => {
      const nav = document.getElementById("landing-nav");
      if (nav) nav.classList.remove("open");
    });
  });
});

// ============================================================
// Multi-Tenant Authentication & Session Recovery
// ============================================================

let currentAuthTab = "login";

async function checkAuthSession() {
  const token = getAuthToken();
  if (!token && !document.cookie.includes("access_token")) {
    updateUserUI(null);
    return null;
  }
  try {
    const res = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "include"
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.user) {
        localStorage.setItem("AUTH_USER", JSON.stringify(data.user));
        if (data.token) localStorage.setItem("AUTH_TOKEN", data.token);
        updateUserUI(data.user);
        return data.user;
      }
    } else if (res.status === 401) {
      localStorage.removeItem("AUTH_USER");
      localStorage.removeItem("AUTH_TOKEN");
      updateUserUI(null);
      return null;
    }
  } catch (e) {
    console.warn("Session check offline or tunnel not connected yet:", e.message);
  }
  const localUser = getAuthUser();
  const allowed = ["riddhesh.firake@gmail.com", "acc94926@gmail.com"];
  if (localUser && localUser.email && !allowed.includes(localUser.email.toLowerCase())) {
    localStorage.removeItem("AUTH_USER");
    localStorage.removeItem("AUTH_TOKEN");
    updateUserUI(null);
    return null;
  }
  updateUserUI(localUser);
  return localUser;
}

function updateUserUI(user) {
  const userBadge = document.getElementById("user-profile-badge");
  const nameEl = document.getElementById("user-display-name");
  if (user) {
    if (userBadge) userBadge.style.display = "flex";
    if (nameEl) nameEl.innerText = user.name || user.email.split("@")[0];
  } else {
    if (userBadge) userBadge.style.display = "none";
  }
}

function initAuthUI() {
  const user = getAuthUser();
  updateUserUI(user);
}

function switchAuthTab(tab) {
  // Manual registration removed. Route directly to login.
  navigateTo("login");
}

async function submitAuthForm() {
  showToast("Manual email/password login is permanently disabled. Please click your authorized administrator account to enter.", "warning");
}

// ============================================================
// Official Google Identity Services & OAuth 2.0 Flow (.env Driven)
// ============================================================
let backendGoogleClientId = "";
let gisInitialized = false;

async function loadAuthConfig() {
  try {
    const res = await fetch("/api/auth/config");
    if (res.ok) {
      const data = await res.json();
      if (data && data.google_client_id) {
        backendGoogleClientId = data.google_client_id.trim();
        initGoogleIdentityServices();
      }
    }
  } catch (e) {
    console.warn("Auth config fetch warning:", e.message);
  }
}

function initGoogleIdentityServices() {
  if (!backendGoogleClientId) return;
  if (gisInitialized) return;
  if (window.google && window.google.accounts && window.google.accounts.id) {
    try {
      gisInitialized = true;
      google.accounts.id.initialize({
        client_id: backendGoogleClientId,
        callback: handleGoogleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });
      const container = document.getElementById("g_id_signin_container");
      if (container) {
        container.innerHTML = "";
        google.accounts.id.renderButton(container, {
          theme: "outline",
          size: "large",
          type: "standard",
          shape: "rectangular",
          text: "continue_with",
          logo_alignment: "left",
          width: 320
        });
        const directBtn = document.getElementById("google-direct-auth-btn");
        if (directBtn) directBtn.style.display = "none";
      }
    } catch (e) {
      console.warn("GIS init warning:", e);
      gisInitialized = false;
    }
  }
}

// 1. Direct Google OAuth Redirect
function triggerGoogleOAuthRedirect() {
  if (!backendGoogleClientId) {
    showToast("Google Client ID is not configured in .env. Please add GOOGLE_CLIENT_ID to your local .env file.", "warning");
    return;
  }
  redirectToGoogleOAuthPage();
}

function redirectToGoogleOAuthPage() {
  if (!backendGoogleClientId) {
    showToast("Google Client ID is not configured in .env. Please click your authorized administrator account below.", "info");
    return;
  }

  const redirectUri = window.location.origin + window.location.pathname;
  const state = Math.random().toString(36).substring(7);
  const nonce = Math.random().toString(36).substring(7);

  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: backendGoogleClientId,
    redirect_uri: redirectUri,
    response_type: "token id_token",
    scope: "openid email profile",
    state: state,
    nonce: nonce,
    prompt: "select_account"
  }).toString();

  window.location.href = authUrl;
}

function loginAuthorizedAdmin() {
  triggerGoogleOAuthRedirect();
}

function fastAdminLogin() {
  triggerGoogleOAuthRedirect();
}

// 2. Handle Google Credential Callback from Google Identity Services
async function handleGoogleCredentialResponse(response) {
  if (!response || !response.credential) {
    showToast("No Google credential returned.", "error");
    return;
  }
  await processGoogleAuthPayload({ credential: response.credential });
}

// 3. Process Google Token Payload with Backend & Whitelist
async function processGoogleAuthPayload(payload) {
  try {
    showToast("Verifying Google account with security whitelist...", "info");
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (res.ok && data.user) {
      if (data.token) localStorage.setItem("AUTH_TOKEN", data.token);
      localStorage.setItem("AUTH_USER", JSON.stringify(data.user));
      updateUserUI(data.user);
      showToast(`Welcome back, ${data.user.name || data.user.email}! (Admin Verified)`, "success");
      navigateTo("dashboard");
    } else {
      showToast(data.detail || "Access Denied: Google email not authorized.", "error");
    }
  } catch (e) {
    showToast("Google OAuth error: " + e.message, "error");
  }
}

// 4. Handle OAuth Redirect Callback in URL Hash (#id_token=... or #access_token=...)
function checkOAuthRedirectHash() {
  const hash = window.location.hash;
  if (hash && (hash.includes("id_token=") || hash.includes("access_token="))) {
    const params = new URLSearchParams(hash.replace(/^#/, ""));
    const idToken = params.get("id_token");
    const accessToken = params.get("access_token");

    // Clean hash from URL so token is not exposed in address bar
    try {
      window.history.replaceState({}, document.title, window.location.pathname);
    } catch (e) { }

    if (idToken || accessToken) {
      processGoogleAuthPayload({ credential: idToken, access_token: accessToken });
      return true;
    }
  }
  return false;
}

// Backwards-compatible alias for any inline handlers
function handleGoogleSignIn() {
  triggerGoogleOAuthRedirect();
}

async function continueAsDemo() {
  showToast("Demo access is disabled. Please sign in with an authorized Google account.", "warning");
  navigateTo("login");
}

async function logoutUser() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (e) {
    console.warn("Logout request failed:", e);
  }
  localStorage.removeItem("AUTH_TOKEN");
  localStorage.removeItem("AUTH_USER");
  updateUserUI(null);
  showToast("Signed out safely. Your credentials remain isolated & encrypted.", "info");
  navigateTo("landing");
}

// ============================================================
// Multi-Channel Telegram Dialogs Harvester
// ============================================================

let currentDialogsList = [];

async function fetchTelegramDialogs() {
  const btn = document.getElementById("btn-fetch-dialogs");
  const container = document.getElementById("tg-dialogs-container");
  const empty = document.getElementById("tg-dialogs-empty");

  const originalBtnHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.innerHTML = `<i data-lucide="loader-2" class="spin" style="width: 12px; height: 12px;"></i> Loading Dialogs...`;
    btn.disabled = true;
    initIcons();
  }

  try {
    const res = await fetch("/api/telegram/dialogs");
    const data = await res.json();

    if (data.status === "success" && Array.isArray(data.dialogs) && data.dialogs.length > 0) {
      currentDialogsList = data.dialogs;

      // Read saved channel IDs from setting or global
      let savedIds = [];
      const savedStr = window._savedSelectedChannels || "";
      if (savedStr) {
        savedIds = savedStr.split(",").map(s => s.trim());
      }

      container.innerHTML = data.dialogs.map(d => {
        const isChecked = savedIds.includes(String(d.id)) || (d.username && savedIds.includes(String(d.username))) ? "checked" : "";
        const badgeColor = d.type === "channel" ? "#38bdf8" : (d.type === "supergroup" ? "#a855f7" : "#10b981");
        return `
          <label class="dialog-item">
            <input type="checkbox" class="dialog-checkbox" value="${escapeHtml(String(d.id))}" data-title="${escapeHtml(d.title)}" ${isChecked}>
            <div class="dialog-item-info">
              <div class="dialog-item-title">${escapeHtml(d.title)}</div>
              <div class="dialog-item-sub">${d.username ? `@${escapeHtml(d.username)}` : `ID: ${d.id}`}</div>
            </div>
            <span class="dialog-type-badge" style="color: ${badgeColor}; border-color: ${badgeColor}40;">
              ${escapeHtml(d.type)}
            </span>
          </label>
        `;
      }).join("");

      if (empty) empty.style.display = "none";
      if (container) container.style.display = "block";
      showToast(`Fetched ${data.dialogs.length} joined channels & groups! Check the ones you want to monitor.`, "success");
    } else {
      if (empty) {
        empty.innerHTML = `⚠️ ${escapeHtml(data.detail || "No channels found. Please make sure your Telegram API ID & Hash are saved in settings and authorized.")}`;
        empty.style.display = "block";
      }
      if (container) container.style.display = "none";
      showToast(data.detail || "No channels found. Verify Telegram API ID/Hash.", "error");
    }
  } catch (e) {
    if (empty) {
      empty.innerHTML = `⚠️ Error fetching dialogs: ${escapeHtml(e.message)}`;
      empty.style.display = "block";
    }
    showToast("Failed to fetch dialogs: " + e.message, "error");
  } finally {
    if (btn) {
      btn.innerHTML = originalBtnHtml || `<i data-lucide="refresh-cw" style="width: 12px; height: 12px;"></i> Fetch My Groups & Channels`;
      btn.disabled = false;
      initIcons();
    }
  }
}

async function startMultiClientListener() {
  const checkboxes = document.querySelectorAll(".dialog-checkbox:checked");
  const selectedIds = Array.from(checkboxes).map(cb => cb.value);

  if (selectedIds.length === 0) {
    showToast("Please check at least one Telegram channel or group to monitor.", "error");
    return;
  }

  const btn = document.getElementById("btn-start-multi");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader-2" class="spin" style="width: 14px; height: 14px;"></i> Starting Multi-Channel Listener...`;
    initIcons();
  }

  try {
    // 1. Save selected channels to user profile first
    window._savedSelectedChannels = selectedIds.join(",");
    await saveSettings(true); // silent save

    // 2. Start Telethon client listener for all selected channels concurrently
    const res = await fetch("/api/telegram/start_client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel_ids: selectedIds })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Multi-channel listener active! Monitoring ${selectedIds.length} channel(s) concurrently.`, "success");
      closeSettingsModal();
      loadSystemStatus();
    } else {
      showToast(`Failed to start listener: ${data.detail || "Check Telegram credentials"}`, "error");
    }
  } catch (e) {
    showToast("Listener error: " + e.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i data-lucide="radio" style="width: 14px; height: 14px;"></i> Start Multi-Channel Listener`;
      initIcons();
    }
  }
}

async function startTelegramBot() {
  try {
    const res = await fetch("/api/telegram/start", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      showToast("Telegram listener started successfully!", "success");
      loadSystemStatus();
    } else {
      showToast(`Error starting listener: ${data.detail || 'Check bot token.'}`, "error");
    }
  } catch (e) {
    showToast("Failed to start listener: " + e.message, "error");
  }
}

async function stopTelegramBot() {
  try {
    await fetch("/api/telegram/stop", { method: "POST" });
    showToast("Telegram listener stopped.", "info");
    loadSystemStatus();
  } catch (e) {
    showToast("Failed to stop listener: " + e.message, "error");
  }
}

// ============================================================
// Settings Modal & AES-256 Vault Management
// ============================================================

async function openSettingsModal() {
  const modal = document.getElementById("settings-modal");
  if (modal) modal.style.display = "flex";
  await loadSettingsFields();
}

async function loadSettingsFields() {
  const apiUrlEl = document.getElementById("setting-api-url");
  if (apiUrlEl) {
    apiUrlEl.value = getApiBase();
  }

  try {
    const res = await fetch("/api/settings");
    if (!res.ok) return;
    const cfg = await res.json();
    if (!cfg || typeof cfg !== "object") return;

    // AI Provider
    const provEl = document.getElementById("setting-provider");
    if (provEl) provEl.value = cfg.AI_PROVIDER || "groq";
    toggleProviderFields();

    // Groq fields
    const groqModelEl = document.getElementById("setting-groq-model");
    if (groqModelEl) groqModelEl.value = cfg.GROQ_TEXT_MODEL || "openai/gpt-oss-120b";
    const groqVisionEl = document.getElementById("setting-groq-vision-model");
    if (groqVisionEl) groqVisionEl.value = cfg.GROQ_VISION_MODEL || "qwen/qwen3.8-27b";
    const groqKeyEl = document.getElementById("setting-groq-key");
    if (groqKeyEl) {
      groqKeyEl.value = "";
      if (cfg.HAS_GROQ_KEY) {
        groqKeyEl.placeholder = `Stored (${cfg.GROQ_API_KEY_MASKED})`;
      } else {
        groqKeyEl.placeholder = "gsk_...";
      }
    }

    // Gemini fields
    const geminiModelEl = document.getElementById("setting-gemini-model");
    if (geminiModelEl) geminiModelEl.value = cfg.GEMINI_MODEL || "gemini-2.5-flash";
    const geminiKeyEl = document.getElementById("setting-gemini-key");
    if (geminiKeyEl) {
      geminiKeyEl.value = "";
      if (cfg.HAS_GEMINI_KEY) {
        geminiKeyEl.placeholder = `Stored (${cfg.GEMINI_API_KEY_MASKED})`;
      } else {
        geminiKeyEl.placeholder = "AIzaSy...";
      }
    }

    // Telegram User Client fields
    const tgIdEl = document.getElementById("setting-tg-api-id");
    if (tgIdEl) tgIdEl.value = cfg.TELEGRAM_API_ID || "";
    const tgPhoneEl = document.getElementById("setting-tg-phone");
    if (tgPhoneEl) tgPhoneEl.value = cfg.TELEGRAM_PHONE || "";
    const tgHashEl = document.getElementById("setting-tg-api-hash");
    if (tgHashEl) {
      tgHashEl.value = "";
      if (cfg.HAS_TELEGRAM_HASH) {
        tgHashEl.placeholder = `Stored (${cfg.TELEGRAM_API_HASH_MASKED})`;
      } else {
        tgHashEl.placeholder = "••••••••••••••••••••••••••••••••";
      }
    }

    // Telegram Bot Token fallback
    const botTokenEl = document.getElementById("setting-bot-token");
    if (botTokenEl) {
      botTokenEl.value = "";
      if (cfg.HAS_BOT_TOKEN) {
        botTokenEl.placeholder = `Stored (${cfg.TELEGRAM_BOT_TOKEN_MASKED})`;
      } else {
        botTokenEl.placeholder = "123456:ABC-DEF...";
      }
    }

    // Selected Channels
    window._savedSelectedChannels = cfg.TELEGRAM_SELECTED_CHANNELS || "";
    if (cfg.TELEGRAM_SELECTED_CHANNELS) {
      const emptyEl = document.getElementById("tg-dialogs-empty");
      if (emptyEl) {
        emptyEl.innerHTML = `Saved monitored channels: <b>${escapeHtml(cfg.TELEGRAM_SELECTED_CHANNELS)}</b><br><span style="font-size: 0.68rem; color: #38bdf8;">Click 'Fetch My Groups & Channels' to view and re-select from list.</span>`;
      }
    }

    // XM MT5 settings
    const xmLoginEl = document.getElementById("setting-xm-login");
    if (xmLoginEl) xmLoginEl.value = cfg.XM_MT5_LOGIN || "";
    const xmServerEl = document.getElementById("setting-xm-server");
    if (xmServerEl) xmServerEl.value = cfg.XM_MT5_SERVER || "XMGlobal-MT5 10";
    const xmAutoEl = document.getElementById("setting-xm-auto");
    if (xmAutoEl) xmAutoEl.checked = (cfg.XM_AUTO_EXECUTION !== "false");
    const xmPassEl = document.getElementById("setting-xm-password");
    if (xmPassEl) xmPassEl.value = "";

  } catch (e) {
    console.warn("Could not load remote settings (normal if backend tunnel is not linked yet):", e.message);
  }
}

function closeSettingsModal() {
  document.getElementById("settings-modal").style.display = "none";
}

function toggleProviderFields() {
  const prov = document.getElementById("setting-provider").value;
  document.getElementById("groq-fields").style.display = prov === "groq" ? "block" : "none";
  document.getElementById("gemini-fields").style.display = prov === "gemini" ? "block" : "none";
}

async function saveSettings(silent = false) {
  const apiUrlEl = document.getElementById("setting-api-url");
  let newApiUrl = "";
  if (apiUrlEl) {
    newApiUrl = apiUrlEl.value.trim().replace(/\/$/, "");
    if (newApiUrl) {
      localStorage.setItem("API_BACKEND_URL", newApiUrl);
    } else {
      localStorage.removeItem("API_BACKEND_URL");
    }
  }

  const payload = {
    AI_PROVIDER: document.getElementById("setting-provider") ? document.getElementById("setting-provider").value : "groq",
    GROQ_TEXT_MODEL: document.getElementById("setting-groq-model") ? document.getElementById("setting-groq-model").value : "openai/gpt-oss-120b",
    GROQ_VISION_MODEL: document.getElementById("setting-groq-vision-model") ? document.getElementById("setting-groq-vision-model").value : "qwen/qwen3.8-27b",
    GEMINI_MODEL: document.getElementById("setting-gemini-model") ? document.getElementById("setting-gemini-model").value : "gemini-2.5-flash"
  };

  // Optional AI keys if user typed new one
  const groqKey = document.getElementById("setting-groq-key") ? document.getElementById("setting-groq-key").value.trim() : "";
  if (groqKey) payload.GROQ_API_KEY = groqKey;

  const geminiKey = document.getElementById("setting-gemini-key") ? document.getElementById("setting-gemini-key").value.trim() : "";
  if (geminiKey) payload.GEMINI_API_KEY = geminiKey;

  // Telegram fields
  const tgApiId = document.getElementById("setting-tg-api-id") ? document.getElementById("setting-tg-api-id").value.trim() : "";
  if (tgApiId) payload.TELEGRAM_API_ID = tgApiId;

  const tgPhone = document.getElementById("setting-tg-phone") ? document.getElementById("setting-tg-phone").value.trim() : "";
  if (tgPhone) payload.TELEGRAM_PHONE = tgPhone;

  const tgHash = document.getElementById("setting-tg-api-hash") ? document.getElementById("setting-tg-api-hash").value.trim() : "";
  if (tgHash) payload.TELEGRAM_API_HASH = tgHash;

  const botToken = document.getElementById("setting-bot-token") ? document.getElementById("setting-bot-token").value.trim() : "";
  if (botToken) payload.TELEGRAM_BOT_TOKEN = botToken;

  // Selected Channels
  const checkboxes = document.querySelectorAll(".dialog-checkbox:checked");
  if (checkboxes.length > 0) {
    const selectedIds = Array.from(checkboxes).map(cb => cb.value);
    payload.TELEGRAM_SELECTED_CHANNELS = selectedIds.join(",");
    window._savedSelectedChannels = payload.TELEGRAM_SELECTED_CHANNELS;
  } else if (window._savedSelectedChannels) {
    payload.TELEGRAM_SELECTED_CHANNELS = window._savedSelectedChannels;
  }

  // XM MT5 fields
  const xmAuto = document.getElementById("setting-xm-auto") ? document.getElementById("setting-xm-auto").checked : true;
  const xmLogin = document.getElementById("setting-xm-login") ? document.getElementById("setting-xm-login").value.trim() : "";
  const xmServer = document.getElementById("setting-xm-server") ? document.getElementById("setting-xm-server").value.trim() : "";
  const xmPass = document.getElementById("setting-xm-password") ? document.getElementById("setting-xm-password").value.trim() : "";

  payload.XM_AUTO_EXECUTION = xmAuto ? "true" : "false";
  if (xmLogin) payload.XM_MT5_LOGIN = xmLogin;
  if (xmServer) payload.XM_MT5_SERVER = xmServer;
  if (xmPass) payload.XM_MT5_PASSWORD = xmPass;

  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      if (!silent) {
        showToast("Settings securely saved & encrypted (AES-256)!", "success");
        closeSettingsModal();
        loadSystemStatus();
        if (ws) ws.close();
        connectWebSocket();
        loadStats();
        loadMessages();
        loadTrades();
      }
    } else {
      let errDetail = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody && errBody.detail) errDetail = errBody.detail;
      } catch (ignore) {}
      if (!silent) {
        showToast(res.status === 401 ? "Sign in via Google OAuth to save backend settings." : `Failed to save settings: ${errDetail}`, "error");
      }
    }
  } catch (e) {
    if (newApiUrl && !silent) {
      showToast("Backend Tunnel URL saved! Reconnecting to engine...", "success");
      closeSettingsModal();
      setTimeout(() => location.reload(), 800);
    } else if (!silent) {
      showToast("Failed to save settings: " + e.message, "error");
    }
  }
}

// Wipe / Clear Data
async function confirmClearData() {
  if (confirm("Are you sure you want to clear all message logs, active trades, and signal history?")) {
    try {
      await fetch("/api/reset-data", { method: "POST" });
      messagesCache = [];
      renderFeed([]);
      loadStats();
      loadLogs();
      loadTrades();
      loadXMPositions();
      showToast("All message logs, trades, and history wiped clean.", "info");
    } catch (e) {
      showToast("Failed to clear data: " + e.message, "error");
    }
  }
}

// JSON Inspector Modal
function inspectJson(encodedData) {
  const data = JSON.parse(decodeURIComponent(encodedData));
  document.getElementById("json-viewer").innerText = JSON.stringify(data, null, 2);
  document.getElementById("json-modal").style.display = "flex";
}

function closeJsonModal() {
  document.getElementById("json-modal").style.display = "none";
}

function escapeHtml(str) {
  if (!str) return "";
  return str.replace(/[&<>"']/g, function (m) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[m];
  });
}

// ============================================================
// Multi-Page Dashboard & Dedicated Workspaces Controller
// ============================================================

let currentDashboardPage = "dashboard";
let isSidebarCollapsed = false;
let isTerminalAutoScroll = true;
let terminalPaused = false;
let chartActivityInstance = null;
let chartBuySellInstance = null;
let chartAssetsInstance = null;
let chartPerformanceInstance = null;

function switchDashboardPage(pageId) {
  if (!pageId) pageId = "dashboard";
  currentDashboardPage = pageId;

  // 1. Update Sidebar Active State
  document.querySelectorAll(".app-sidebar .nav-item").forEach(item => {
    if (item.getAttribute("data-page") === pageId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // 2. Hide all page sections, display target page
  document.querySelectorAll(".page-section").forEach(sec => {
    sec.style.display = "none";
    sec.classList.remove("active-page");
  });

  const targetPage = document.getElementById(`page-${pageId}`);
  if (targetPage) {
    targetPage.style.display = "block";
    targetPage.classList.add("active-page");
  }

  // 3. Update Breadcrumb Title
  const titleMap = {
    dashboard: "Dashboard Overview",
    chats: "Recorded Chats",
    signals: "Trade Signals",
    positions: "Active MT5 Trades",
    watchlist: "Trade Watchlist",
    simulator: "Signal Simulator",
    terminal: "Live Terminal",
    settings: "System Settings"
  };
  const titleEl = document.getElementById("header-page-title");
  if (titleEl) {
    titleEl.textContent = titleMap[pageId] || "Dashboard";
  }

  // 4. Close mobile sidebar if open
  toggleSidebar(false);

  // 5. Update URL Hash without hard reload
  history.pushState(null, "", `#${pageId}`);

  // 6. Trigger page-specific data loader
  if (pageId === "dashboard") {
    loadStats();
    loadMessages();
    setTimeout(() => {
      initDashboardCharts();
      updateDashboardCharts(null, messagesCache);
    }, 100);
  } else if (pageId === "chats") {
    loadMessages();
  } else if (pageId === "signals") {
    if (messagesCache.length === 0) {
      loadMessages().then(() => renderTradeSignals(messagesCache));
    } else {
      renderTradeSignals(messagesCache);
    }
  } else if (pageId === "positions") {
    loadXMPositions();
  } else if (pageId === "watchlist") {
    loadTrades();
  } else if (pageId === "simulator") {
    // Simulator workspace ready
  } else if (pageId === "terminal") {
    loadLogs();
  } else if (pageId === "settings") {
    syncSettingsFields();
  }

  initIcons();
}

// Sidebar Collapse / Expand / Mobile Drawer Toggle
function toggleSidebar(forceState) {
  const shell = document.getElementById("app-shell");
  const sidebar = document.getElementById("app-sidebar");
  const backdrop = document.getElementById("sidebar-backdrop");

  const isMobile = window.innerWidth <= 1024;

  if (isMobile) {
    if (forceState === false) {
      if (sidebar) sidebar.classList.remove("sidebar-open");
      if (backdrop) backdrop.classList.remove("active");
    } else if (forceState === true) {
      if (sidebar) sidebar.classList.add("sidebar-open");
      if (backdrop) backdrop.classList.add("active");
    } else {
      const isOpen = sidebar && sidebar.classList.contains("sidebar-open");
      if (sidebar) sidebar.classList.toggle("sidebar-open");
      if (backdrop) backdrop.classList.toggle("active", !isOpen);
    }
  } else {
    if (shell) {
      shell.classList.toggle("sidebar-collapsed");
      isSidebarCollapsed = shell.classList.contains("sidebar-collapsed");
    }
    // Resize charts after sidebar animation completes
    setTimeout(() => {
      if (chartActivityInstance) chartActivityInstance.resize();
      if (chartBuySellInstance) chartBuySellInstance.resize();
      if (chartAssetsInstance) chartAssetsInstance.resize();
      if (chartPerformanceInstance) chartPerformanceInstance.resize();
    }, 250);
  }
  initIcons();
}

// ============================================================
// Interactive Financial Charts (Chart.js)
// ============================================================

function initDashboardCharts() {
  if (typeof Chart === "undefined") return;

  // Chart defaults for modern trading dark mode
  Chart.defaults.color = "#94a3b8";
  Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.plugins.tooltip.backgroundColor = "rgba(15, 21, 35, 0.95)";
  Chart.defaults.plugins.tooltip.borderColor = "rgba(255, 255, 255, 0.12)";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.padding = 12;

  // 1. Chart: Activity Over Time
  const ctxAct = document.getElementById("chart-activity");
  if (ctxAct && !chartActivityInstance) {
    chartActivityInstance = new Chart(ctxAct.getContext("2d"), {
      type: "line",
      data: {
        labels: ["-6h", "-5h", "-4h", "-3h", "-2h", "-1h", "Now"],
        datasets: [
          {
            label: "Valid Signals",
            data: [2, 5, 4, 8, 12, 18, 24],
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.08)",
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: "#10b981",
            pointRadius: 3
          },
          {
            label: "Chatter Filtered",
            data: [8, 14, 10, 15, 22, 19, 28],
            borderColor: "#8b5cf6",
            backgroundColor: "transparent",
            borderWidth: 1.8,
            borderDash: [4, 4],
            tension: 0.35,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "top" } },
        scales: {
          x: { grid: { color: "rgba(255, 255, 255, 0.04)" } },
          y: { grid: { color: "rgba(255, 255, 255, 0.04)" }, beginAtZero: true }
        }
      }
    });
  }

  // 2. Chart: Buy vs Sell Intent Ratio
  const ctxBS = document.getElementById("chart-buysell");
  if (ctxBS && !chartBuySellInstance) {
    chartBuySellInstance = new Chart(ctxBS.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["BUY Signals", "SELL Signals", "Updates / Exits"],
        datasets: [{
          data: [65, 25, 10],
          backgroundColor: ["#10b981", "#ef4444", "#8b5cf6"],
          borderWidth: 0,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          legend: { position: "bottom" }
        }
      }
    });
  }

  // 3. Chart: Top Assets Distribution
  const ctxAst = document.getElementById("chart-assets");
  if (ctxAst && !chartAssetsInstance) {
    chartAssetsInstance = new Chart(ctxAst.getContext("2d"), {
      type: "bar",
      data: {
        labels: ["XAUUSD", "BTCUSD", "GBPUSD", "EURUSD", "ETHUSD"],
        datasets: [{
          label: "Monitored Signals",
          data: [49, 12, 6, 4, 3],
          backgroundColor: [
            "rgba(245, 158, 11, 0.8)",
            "rgba(59, 130, 246, 0.8)",
            "rgba(16, 185, 129, 0.8)",
            "rgba(139, 92, 246, 0.8)",
            "rgba(6, 182, 212, 0.8)"
          ],
          borderRadius: 6,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "rgba(255, 255, 255, 0.04)" }, beginAtZero: true }
        }
      }
    });
  }

  // 4. Chart: Latency & Performance
  const ctxPerf = document.getElementById("chart-performance");
  if (ctxPerf && !chartPerformanceInstance) {
    chartPerformanceInstance = new Chart(ctxPerf.getContext("2d"), {
      type: "line",
      data: {
        labels: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15"],
        datasets: [{
          label: "AI Processing Time (ms)",
          data: [180, 240, 195, 310, 210, 190, 260, 220, 205, 195, 280, 215, 190, 200, 210],
          borderColor: "#38bdf8",
          backgroundColor: "rgba(56, 189, 248, 0.08)",
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: "rgba(255, 255, 255, 0.04)" }, beginAtZero: false }
        }
      }
    });
  }
}

// Update Charts with Real Live Data from API
function updateDashboardCharts(statsData, msgsData) {
  if (typeof Chart === "undefined") return;
  if (!chartActivityInstance) initDashboardCharts();

  const msgs = msgsData || messagesCache || [];

  // Update Buy vs Sell Donut
  let buyCount = 0;
  let sellCount = 0;
  let updateCount = 0;

  msgs.forEach(m => {
    const act = (m.action || "").toUpperCase();
    if (act.includes("BUY") || act === "LONG") buyCount++;
    else if (act.includes("SELL") || act === "SHORT") sellCount++;
    else if (m.intent === "TRADE_UPDATE" || act.includes("PARTIAL") || act.includes("MODIFY")) updateCount++;
  });

  if (chartBuySellInstance && (buyCount > 0 || sellCount > 0)) {
    chartBuySellInstance.data.datasets[0].data = [buyCount, sellCount, updateCount];
    chartBuySellInstance.update();
  }

  // Update Assets Bar Chart
  if (chartAssetsInstance) {
    const symbolMap = {};
    msgs.forEach(m => {
      if (m.symbol && m.intent !== "CHATTER" && m.intent !== "OTHERS") {
        symbolMap[m.symbol] = (symbolMap[m.symbol] || 0) + 1;
      }
    });
    const sorted = Object.entries(symbolMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (sorted.length > 0) {
      chartAssetsInstance.data.labels = sorted.map(s => s[0]);
      chartAssetsInstance.data.datasets[0].data = sorted.map(s => s[1]);
      chartAssetsInstance.update();
    }
  }

  // Update Latency Line Chart
  if (chartPerformanceInstance && msgs.length > 0) {
    const recent = msgs.slice(0, 15).reverse();
    chartPerformanceInstance.data.labels = recent.map((m, idx) => `#${idx + 1}`);
    chartPerformanceInstance.data.datasets[0].data = recent.map(m => m.processing_time_ms || 210);
    chartPerformanceInstance.update();
  }

  // Update Activity Timeline
  if (chartActivityInstance && msgs.length > 0) {
    const signalCounts = [];
    const chatterCounts = [];
    const labels = [];
    const buckets = 7;
    const chunkSize = Math.max(1, Math.floor(msgs.length / buckets));

    for (let i = 0; i < buckets; i++) {
      const slice = msgs.slice(i * chunkSize, (i + 1) * chunkSize);
      let sigs = 0;
      let chat = 0;
      slice.forEach(m => {
        if (m.intent === "CHATTER" || m.intent === "OTHERS") chat++;
        else sigs++;
      });
      signalCounts.push(sigs);
      chatterCounts.push(chat);
      labels.push(`P${i + 1}`);
    }
    chartActivityInstance.data.labels = labels;
    chartActivityInstance.data.datasets[0].data = signalCounts;
    chartActivityInstance.data.datasets[1].data = chatterCounts;
    chartActivityInstance.update();
  }
}

// Populate Recent Widgets on Dashboard
function updateRecentDashboardWidgets(msgs) {
  const container = document.getElementById("dash-recent-signals");
  if (!container) return;

  const validSignals = (msgs || []).filter(m => m.intent !== "CHATTER" && m.intent !== "OTHERS" && m.action && m.action !== "NONE").slice(0, 5);
  if (validSignals.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 1.5rem;">
        <i data-lucide="radio" style="width: 28px; height: 28px; opacity: 0.4;"></i>
        <div class="empty-state-title">No signals received yet</div>
        <div class="empty-state-sub">Send a message in Telegram or test the simulator to trigger live setups.</div>
      </div>
    `;
    initIcons();
    return;
  }

  container.innerHTML = validSignals.map(s => {
    const isBuy = (s.action || "").includes("BUY");
    return `
      <div class="trade-tracker-card" style="padding: 0.85rem; margin-bottom: 0.5rem; cursor: pointer;" onclick="switchDashboardPage('signals')">
        <div class="trade-card-top" style="margin-bottom: 0.4rem;">
          <div class="trade-head-row">
            <span class="symbol-badge">${escapeHtml(s.symbol || "XAUUSD")}</span>
            <span class="intent-badge ${isBuy ? 'buy' : 'sell'}">${escapeHtml(s.action || 'BUY')}</span>
            <span class="source-pill">${s.order_type || 'MARKET'}</span>
          </div>
          <span class="confidence-label" style="color: ${s.confidence > 80 ? 'var(--success-text)' : 'var(--warning-text)'};">
            ${s.confidence || 95}%
          </span>
        </div>
        <div style="font-size: 0.76rem; color: var(--text-secondary); display: flex; justify-content: space-between; font-family: var(--font-mono);">
          <span>Entry: <strong>${s.entry_price || 'CMP'}</strong> &bull; SL: <span style="color:var(--danger-text);">${s.sl || 'Open'}</span></span>
          <span style="color: var(--text-dim);">${s.created_at ? (formatLocalTime(s.created_at, false) || 'Now') : 'Now'}</span>
        </div>
      </div>
    `;
  }).join("");
  initIcons();
}

function updateDashboardPositionsGlance(positions) {
  const container = document.getElementById("dash-positions-summary");
  if (!container) return;

  if (!positions || positions.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 1rem 0;">
        <div class="empty-state-title" style="font-size: 0.8rem;">No open MT5 positions right now.</div>
        <div class="empty-state-sub">Executing automatically on verified 1:1 triggers.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      ${positions.slice(0, 3).map(p => {
        const isBuy = (p.type || "BUY") === "BUY";
        const pnlColor = (p.profit || 0) >= 0 ? "var(--success-text)" : "var(--danger-text)";
        return `
          <div style="background: var(--bg-inset); padding: 0.65rem 0.85rem; border-radius: var(--r-sm); border: 1px solid var(--border-medium); display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="pos-id">#${p.ticket}</span>
              <span style="font-weight: 700; color: ${isBuy ? 'var(--success-text)' : 'var(--danger-text)'};">${p.type} ${p.symbol}</span>
              <span class="pos-lots">${p.volume}L</span>
            </div>
            <strong style="color: ${pnlColor}; font-family: var(--font-mono); font-size: 0.85rem;">
              ${(p.profit || 0) >= 0 ? '+' : ''}$${Number(p.profit || 0).toFixed(2)}
            </strong>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

// Update Nav Badges in Sidebar
function updateDashboardNavBadges(msgs) {
  const chatsBadge = document.getElementById("nav-chats-badge");
  const signalsBadge = document.getElementById("nav-signals-badge");

  if (chatsBadge) chatsBadge.textContent = msgs.length || 0;
  if (signalsBadge) {
    const validCount = msgs.filter(m => m.intent !== "CHATTER" && m.intent !== "OTHERS" && m.action && m.action !== "NONE").length;
    signalsBadge.textContent = validCount || 0;
  }
}

// ============================================================
// Dedicated Trade Signals Page Renderer
// ============================================================

let currentSignalsDirectionFilter = "ALL";

function filterSignalsDirection(dir, btn) {
  currentSignalsDirectionFilter = dir;
  if (btn) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    }
  }
  renderTradeSignals(messagesCache);
}

function renderTradeSignals(msgs) {
  const container = document.getElementById("signals-workspace-container");
  if (!container) return;

  let signals = (msgs || []).filter(m => m.intent !== "CHATTER" && m.intent !== "OTHERS" && m.action && m.action !== "NONE");

  if (currentSignalsDirectionFilter === "BUY") {
    signals = signals.filter(s => (s.action || "").includes("BUY") || (s.action || "") === "LONG");
  } else if (currentSignalsDirectionFilter === "SELL") {
    signals = signals.filter(s => (s.action || "").includes("SELL") || (s.action || "") === "SHORT");
  }

  if (signals.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding: 3rem;">
        <i data-lucide="radio" style="width: 36px; height: 36px; color: var(--primary); opacity: 0.5;"></i>
        <div class="empty-state-title">No Trade Signals Found (${currentSignalsDirectionFilter})</div>
        <div class="empty-state-sub">When Telegram broadcasts or simulator setups arrive, validated trade setups display here with entry, SL, TP, and confidence.</div>
      </div>
    `;
    initIcons();
    return;
  }

  container.innerHTML = `
    <div class="signals-table-wrap">
      <table class="signals-table">
        <thead>
          <tr>
            <th>Asset / Symbol</th>
            <th>Direction</th>
            <th>Order Type</th>
            <th>Entry Price</th>
            <th>Stop Loss</th>
            <th>Take Profit</th>
            <th>Confidence</th>
            <th>Latency</th>
            <th>Source / Time</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${signals.map(s => {
            const isBuy = (s.action || "").includes("BUY") || s.action === "LONG";
            const tpText = Array.isArray(s.tp_levels) && s.tp_levels.length > 0 ? s.tp_levels.join(" | ") : (s.tp || "1:2 Target");
            const safeData = encodeURIComponent(JSON.stringify(s));

            return `
              <tr>
                <td>
                  <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="symbol-badge">${escapeHtml(s.symbol || "XAUUSD")}</span>
                    ${s.trade_id ? `<span class="trade-id-pill" onclick="switchDashboardPage('watchlist'); filterToTrade('${s.trade_id}')">#${s.trade_id}</span>` : ''}
                  </div>
                </td>
                <td>
                  <span class="intent-badge ${isBuy ? 'buy' : 'sell'}">
                    <i data-lucide="${isBuy ? 'arrow-up-right' : 'arrow-down-right'}" style="width: 12px; height: 12px;"></i>
                    ${escapeHtml(s.action || 'BUY')}
                  </span>
                </td>
                <td><span class="source-pill">${s.order_type || 'MARKET'}</span></td>
                <td><strong style="font-family: var(--font-mono); color: ${isBuy ? 'var(--success-text)' : 'var(--danger-text)'};">${s.entry_price || 'CMP'}</strong></td>
                <td><span style="font-family: var(--font-mono); color: var(--danger-text);">${s.sl || 'Open / BE'}</span></td>
                <td><span style="font-family: var(--font-mono); color: var(--success-text);" title="${escapeHtml(tpText)}">${escapeHtml(tpText)}</span></td>
                <td>
                  <span class="confidence-label" style="color: ${s.confidence > 80 ? 'var(--success-text)' : 'var(--warning-text)'};">
                    ${s.confidence || 95}%
                  </span>
                </td>
                <td><span style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--info-text);">${s.processing_time_ms || 210}ms</span></td>
                <td>
                  <div style="font-size: 0.72rem; color: var(--text-dim);">
                    ${escapeHtml(s.channel_title || "Telegram")} &bull; ${s.created_at ? (formatLocalTime(s.created_at, false) || 'Now') : 'Now'}
                  </div>
                </td>
                <td>
                  <div style="display: flex; gap: 0.4rem;">
                    <button class="btn btn-secondary btn-xs" onclick="inspectJson('${safeData}')" title="Inspect Raw AI Extraction">
                      <i data-lucide="code" style="width: 12px; height: 12px;"></i>
                    </button>
                    ${s.trade_id ? `
                      <button class="btn btn-secondary btn-xs" onclick="switchDashboardPage('watchlist'); filterToTrade('${s.trade_id}')" title="View Lifecycle Audit">
                        <i data-lucide="history" style="width: 12px; height: 12px;"></i>
                      </button>
                    ` : ''}
                  </div>
                </td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
  initIcons();
}

// Channel & Date Filter Helpers for Recorded Chats
function populateChannelFilter(msgs) {
  const select = document.getElementById("chat-channel-filter");
  if (!select) return;

  const currentVal = select.value;
  const channels = new Set();
  (msgs || []).forEach(m => {
    if (m.channel_title) channels.add(m.channel_title);
  });

  select.innerHTML = `<option value="ALL">All Channels (${channels.size})</option>` +
    Array.from(channels).map(ch => `<option value="${escapeHtml(ch)}"${currentVal === ch ? ' selected' : ''}>${escapeHtml(ch)}</option>`).join("");
}

function filterChatsByChannel(channel) {
  if (!channel || channel === "ALL") {
    renderFeed(messagesCache);
  } else {
    const filtered = messagesCache.filter(m => m.channel_title === channel);
    renderFeed(filtered);
  }
}

// Terminal Controls
function toggleTerminalAutoScroll() {
  isTerminalAutoScroll = !isTerminalAutoScroll;
  const btn = document.getElementById("btn-terminal-scroll");
  if (btn) {
    btn.innerHTML = `<i data-lucide="arrow-down" style="width: 13px; height: 13px;"></i> Auto-Scroll: ${isTerminalAutoScroll ? 'ON' : 'OFF'}`;
    initIcons();
  }
}

function clearTerminalLogs() {
  const terminal = document.getElementById("terminal-logs");
  if (terminal) {
    terminal.innerHTML = `
      <div class="log-entry">
        <span class="log-time">[System]</span>
        <span class="log-level-INFO">[INFO]</span>
        <span class="log-msg">Terminal logs cleared. Real-time events will appear here.</span>
      </div>
    `;
  }
}

function filterLogs(level, btn) {
  if (btn) {
    const parent = btn.parentElement;
    if (parent) {
      parent.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    }
  }
  const terminal = document.getElementById("terminal-logs");
  if (!terminal) return;
  const entries = terminal.querySelectorAll(".log-entry");
  entries.forEach(entry => {
    if (level === "ALL") {
      entry.style.display = "flex";
    } else if (level === "WARN") {
      const tag = entry.querySelector(".log-level-WARN, .log-level-WARNING");
      entry.style.display = tag ? "flex" : "none";
    } else {
      const tag = entry.querySelector(`.log-level-${level}`);
      entry.style.display = tag ? "flex" : "none";
    }
  });
}

// Sync Settings fields
function syncSettingsFields() {
  loadSystemStatus();
  loadSettingsFields();
}
