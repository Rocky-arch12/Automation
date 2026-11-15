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
  if (hash === "dashboard" || hash === "home") {
    if (user) {
      navigateTo("dashboard");
    } else {
      navigateTo("login");
    }
  } else if (hash === "login") {
    navigateTo("login");
  } else if (hash === "register") {
    navigateTo("register");
  } else if (["features", "architecture", "security"].includes(hash)) {
    navigateTo("landing", hash);
  } else {
    // Default view: Landing page accessible to all users
    navigateTo("landing");
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
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "NEW_SIGNAL" || msg.type === "NEW_MESSAGE") {
        handleIncomingMessage(msg.data);
        loadTrades();
        loadXMPositions();
      } else if (msg.type === "TRADE_UPDATED" || msg.type === "TRADES_EXPIRED" || msg.type === "DATA_RESET") {
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
    updateWsStatus(false, "Live: Reconnecting...");
    setTimeout(connectWebSocket, 3000);
  };

  ws.onerror = (err) => {
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

    // Load XM MT5 status
    try {
      const xmRes = await fetch("/api/xm/status");
      const xm = await xmRes.json();
      const xmEl = document.getElementById("xm-status-text");
      const xmBadge = document.getElementById("xm-status-badge");
      if (xmEl && xm) {
        const bal = xm.account ? `$${xm.account.balance.toLocaleString()}` : "";
        if (xm.auto_execution) {
          xmEl.innerText = `XM MT5: Demo Active (${bal})`;
          if (xmBadge) xmBadge.style.borderColor = "rgba(16, 185, 129, 0.4)";
        } else {
          xmEl.innerText = `XM MT5: Execution Off`;
          if (xmBadge) xmBadge.style.borderColor = "rgba(100, 116, 139, 0.4)";
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
      <div style="text-align: center; color: var(--text-dim); padding: 3rem 1rem;">
        <i data-lucide="inbox" style="width: 36px; height: 36px; margin-bottom: 0.5rem; opacity: 0.5;"></i>
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
    'EXECUTED': 'badge-executed',
    'CANCELLED': 'badge-cancelled',
    'SL_HIT': 'badge-sl-hit',
    'TP_HIT': 'badge-tp-hit',
    'ACTIVE': 'badge-active'
  };
  return map[status] || 'badge-pending';
}

function createSignalCardHtml(msg) {
  const intent = msg.intent || "CHATTER";
  const action = msg.action || "NONE";
  const isBuy = action.includes("BUY") || action === "LONG";
  const isSell = action.includes("SELL") || action === "SHORT";
  const isUpdate = intent === "TRADE_UPDATE" || action.includes("MODIFY") || action.includes("PARTIAL");
  const isChatter = intent === "CHATTER";

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

  const timeFormatted = msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Just now';
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
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="sender-tag">${escapeHtml(msg.sender || "Channel Owner")}</span>
          <span style="font-size: 0.7rem; color: var(--text-dim);">in ${escapeHtml(msg.channel_title || "Channel")}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
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
      return `<div style="margin-top: 0.6rem;"><img src="${p}" class="raw-image-thumb" onclick="window.open(this.src)" title="Click to view full image" onerror="this.parentElement.style.display='none'"></div>`;
    })()}
      </div>

      <!-- AI Interpretation Box -->
      <div class="ai-box">
        ${msg.trade_id ? `
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.65rem; padding: 0.35rem 0.65rem; background: rgba(15, 23, 42, 0.7); border-radius: 6px; border: 1px solid rgba(59, 130, 246, 0.25);">
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
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <span class="${badgeClass}">
              <i data-lucide="${badgeIcon}" style="width: 13px; height: 13px;"></i>
              ${intent === "CHATTER" ? "CHATTER / FILTERED" : `${action} ${msg.symbol || ''}`}
            </span>
            ${msg.symbol && !isChatter ? `<span class="symbol-badge">${msg.symbol}</span>` : ''}
          </div>
          <div style="font-size: 0.75rem; font-weight: 700; color: ${confidence > 80 ? '#34d399' : '#fbbf24'};">
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
          <span style="font-weight: 600; color: #94a3b8;">AI Intent:</span> ${escapeHtml(msg.reasoning || "Analyzed intent.")}
        </div>

        <div class="meta-footer">
          <div>
            <i data-lucide="cpu" style="width: 12px; height: 12px; display: inline-block; vertical-align: middle;"></i>
            ${escapeHtml(msg.model_used || "Smart Engine")} &bull; ${msg.processing_time_ms || 12}ms
          </div>
          <button class="btn btn-secondary" style="padding: 0.2rem 0.5rem; font-size: 0.68rem;" onclick="inspectJson('${safeJsonData}')">
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
  appendLog(
    data.intent === "CHATTER" ? "INFO" : "SIGNAL",
    "STREAM",
    `[${data.intent}] ${data.action || ''} ${data.symbol || ''} - "${(data.text || '').substring(0, 45)}..."`
  );

  // Re-render feed if matches current filter
  if (currentFilter === "ALL" ||
    (currentFilter === "TRADES" && data.is_trade === 1) ||
    (currentFilter === "CHATTER" && data.intent === "CHATTER") ||
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

    // Clear inputs
    document.getElementById("sim-text").value = "";
    clearSelectedFile();
    showToast("Signal simulated & parsed successfully!", "success");

    // Refresh feed and stats
    loadMessages();
    loadStats();
    loadTrades();

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
    btn.parentElement.querySelectorAll(".chip-btn").forEach(el => el.classList.remove("active"));
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
      <div style="text-align: center; color: var(--text-dim); padding: 2.5rem 1rem;">
        <i data-lucide="shield-check" style="width: 36px; height: 36px; margin-bottom: 0.5rem; opacity: 0.5;"></i>
        <p>No trades matching filter (${currentTradeFilter}).</p>
        <p style="font-size: 0.72rem; margin-top: 0.3rem;">Simulate a trade setup or receive a Telegram broadcast to track lifecycle states.</p>
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
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <span class="trade-id-pill" title="Unique Trade Identifier">
                <i data-lucide="tag" style="width: 11px; height: 11px;"></i> #${t.trade_id}
              </span>
              <span class="trade-card-symbol">
                <span style="color: ${isBuy ? '#34d399' : '#f87171'};">${t.action || 'BUY'}</span>
                <span>${t.symbol || 'XAUUSD'}</span>
              </span>
              <span class="source-pill">${t.order_type || 'MARKET'}</span>
            </div>
            <div style="font-size: 0.72rem; color: var(--text-dim); margin-top: 0.35rem;">
              Started: ${t.created_at ? new Date(t.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today'}
              ${t.updated_at && t.updated_at !== t.created_at ? `&bull; Updated: ${new Date(t.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
            </div>
          </div>
          <div style="text-align: right;">
            <span class="outcome-badge ${badgeCls}">
              ${escapeHtml(t.outcome || t.status)}
            </span>
          </div>
        </div>

        <!-- Prices Row -->
        <div class="params-grid" style="margin-bottom: 0.5rem;">
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
            <div class="param-value" style="color: #60a5fa;">${t.risk_reward || '1:2+'}</div>
          </div>
        </div>

        ${t.xm_ticket ? `
          <div class="xm-execution-receipt" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 6px; padding: 0.5rem 0.75rem; margin-bottom: 0.5rem; font-size: 0.75rem;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.25rem;">
              <span style="font-weight: 700; color: #34d399; display: flex; align-items: center; gap: 0.35rem;">
                <i data-lucide="check-circle-2" style="width: 14px; height: 14px;"></i>
                XM MT5 Order Executed
              </span>
              <span style="font-size: 0.7rem; color: #a7f3d0; background: rgba(16, 185, 129, 0.2); padding: 1px 7px; border-radius: 4px; font-weight: 700;">
                Ticket #${t.xm_ticket}
              </span>
            </div>
            <div style="display: flex; gap: 0.8rem; font-size: 0.72rem; color: var(--text-muted);">
              <div>Lots: <strong style="color:var(--text-main);">${t.xm_lots || (t.symbol && t.symbol.includes('BTC') ? '0.04' : (t.symbol && (t.symbol.includes('XAU') || t.symbol.includes('GOLD')) ? '0.02' : '0.01'))}</strong></div>
              <div>Fill Price: <strong style="color:var(--text-main);">${t.xm_execution_price || t.entry_price || 'CMP'}</strong></div>
              <div>SL: <strong style="color:#f87171;">${t.sl || 'Open'}</strong></div>
              <div>TP: <strong style="color:#34d399;">${tpDisplay}</strong></div>
            </div>
            <div style="font-size: 0.68rem; color: #34d399; margin-top: 0.3rem; font-weight: 600;">
              🛡️ XM Policy: Running Hands-Off until TP or SL is reached.
            </div>
          </div>
        ` : (t.pnl_notes ? `
          <div style="font-size: 0.72rem; padding: 0.35rem 0.6rem; border-radius: 5px; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.4rem; ${t.pnl_notes.includes('SAFETY SHIELD') || t.pnl_notes.includes('REJECTED') ? 'background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5;' : 'background: rgba(0,0,0,0.25); color: var(--text-muted);'}">
            <i data-lucide="${t.pnl_notes.includes('SAFETY SHIELD') || t.pnl_notes.includes('REJECTED') ? 'shield-alert' : 'info'}" style="width: 13px; height: 13px; flex-shrink: 0;"></i>
            <span>${escapeHtml(t.pnl_notes)}</span>
          </div>
        ` : '')}

        <!-- Actions & Timeline Row -->
        <div class="trade-card-actions">
          <button class="btn btn-sm btn-secondary" onclick="toggleTimeline('${t.trade_id}')" style="padding: 0.25rem 0.6rem; font-size: 0.7rem;">
            <i data-lucide="history" style="width: 12px; height: 12px;"></i>
            Timeline (${t.event_count || 1})
          </button>

          <div style="margin-left: auto; display: flex; align-items: center; gap: 0.35rem;">
            ${t.status === 'PENDING' ? `
              <button class="btn btn-sm" onclick="updateTradeStatusManual('${t.trade_id}', 'CANCELLED')" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.7rem; padding: 0.2rem 0.5rem;">
                <i data-lucide="x" style="width: 11px; height: 11px;"></i> Cancel Setup
              </button>
            ` : t.status === 'EXECUTED' ? `
              <span style="font-size: 0.72rem; color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 0.25rem;">
                <i data-lucide="lock" style="width: 11px; height: 11px;"></i> XM Hands-Off
              </span>
            ` : `
              <span style="font-size: 0.72rem; color: var(--text-dim);">
                ${escapeHtml(t.outcome || t.status)}
              </span>
            `}
          </div>
        </div>

        <!-- Hidden Timeline Container -->
        <div id="timeline-${t.trade_id}" class="trade-timeline-container" style="display: none;">
          <div style="text-align: center; color: var(--text-dim); padding: 0.5rem;">Loading trade lifecycle audit...</div>
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
      container.innerHTML = `<div style="color: var(--text-dim);">No logged events yet.</div>`;
      return;
    }

    container.innerHTML = `
      <div style="font-weight: 700; color: #94a3b8; margin-bottom: 0.5rem; font-size: 0.72rem;">
        Lifecycle Audit Trail (${events.length} events)
      </div>
      ${events.map(ev => `
        <div class="trade-timeline-step">
          <div class="timeline-dot"></div>
          <div>
            <div style="display: flex; gap: 0.4rem; align-items: center;">
              <span class="outcome-badge ${getOutcomeBadgeClass(ev.new_status)}" style="font-size: 0.62rem; padding: 0.15rem 0.45rem;">
                ${escapeHtml(ev.new_status)}
              </span>
              <span style="color: var(--text-dim); font-size: 0.65rem;">
                ${ev.created_at ? new Date(ev.created_at).toLocaleTimeString() : ''}
              </span>
            </div>
            <div style="margin-top: 0.2rem; color: #e2e8f0; font-size: 0.72rem;">
              ${escapeHtml(ev.notes || '')}
            </div>
            ${ev.text ? `
              <div style="font-style: italic; color: var(--text-muted); font-size: 0.68rem; margin-top: 0.15rem;">
                Telegram: "${escapeHtml(ev.text)}"
              </div>
            ` : ''}
          </div>
        </div>
      `).join("")}
    `;
  } catch (err) {
    container.innerHTML = `<div style="color: #ef4444;">Failed to load events: ${escapeHtml(err.message)}</div>`;
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
        <div style="text-align: center; color: var(--text-dim); padding: 3rem 1rem;">
          <i data-lucide="shield-check" style="width: 32px; height: 32px; margin-bottom: 0.5rem; color: #10b981;"></i>
          <div style="font-weight: 600; font-size: 0.85rem; color: var(--text-muted);">No Active Running Trades in XM MT5</div>
          <div style="font-size: 0.72rem; margin-top: 0.25rem;">When a pending setup activates or a direct market order arrives, it executes automatically on XM MT5 with strict SL, TP, and lot size.</div>
        </div>
      `;
      initIcons();
      return;
    }

    container.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.6rem;">
        ${positions.map(p => {
      const isBuy = (p.type || "BUY") === "BUY";
      const profitColor = (p.profit || 0) >= 0 ? "#10b981" : "#ef4444";
      const profitSign = (p.profit || 0) >= 0 ? "+" : "";

      return `
            <div class="xm-position-card" style="background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 0.75rem; display: flex; flex-direction: column; gap: 0.45rem;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span style="font-size: 0.7rem; font-weight: 700; background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; color: var(--text-dim);">
                    #${p.ticket}
                  </span>
                  <span style="font-weight: 700; font-size: 0.9rem; color: ${isBuy ? '#34d399' : '#f87171'};">
                    ${p.type} ${p.symbol}
                  </span>
                  <span style="font-size: 0.72rem; background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 1px 6px; border-radius: 4px; font-weight: 600;">
                    ${p.volume} Lots
                  </span>
                </div>
                <div style="font-size: 0.85rem; font-weight: 700; color: ${profitColor};">
                  ${profitSign}$${Number(p.profit || 0).toFixed(2)}
                </div>
              </div>

              <!-- Price levels -->
              <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem; background: rgba(0,0,0,0.25); border-radius: 6px; padding: 0.4rem 0.6rem; font-size: 0.72rem;">
                <div>
                  <div style="color: var(--text-dim); font-size: 0.65rem;">Open Price</div>
                  <div style="font-weight: 600; color: var(--text-main);">${p.price_open}</div>
                </div>
                <div>
                  <div style="color: var(--text-dim); font-size: 0.65rem;">Market Price</div>
                  <div style="font-weight: 600; color: var(--text-main);">${p.price_current}</div>
                </div>
                <div>
                  <div style="color: var(--text-dim); font-size: 0.65rem;">Stop Loss (SL)</div>
                  <div style="font-weight: 600; color: #f87171;">${p.sl || 'Open'}</div>
                </div>
                <div>
                  <div style="color: var(--text-dim); font-size: 0.65rem;">Take Profit (TP)</div>
                  <div style="font-weight: 600; color: #34d399;">${p.tp || 'Open'}</div>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.68rem; color: var(--text-dim);">
                <span>Opened: ${p.time || 'Recently'}</span>
                <span style="color: #10b981; font-weight: 600; display: flex; align-items: center; gap: 0.25rem;">
                  <i data-lucide="lock" style="width: 10px; height: 10px;"></i>
                  Hands-Off: Position runs until TP/SL
                </span>
              </div>
            </div>
          `;
    }).join("")}
      </div>
    `;
    initIcons();
  } catch (e) {
    console.error("Failed to load XM positions:", e);
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
        <span class="log-time">[${new Date(l.created_at).toLocaleTimeString()}]</span>
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
  terminal.scrollTop = terminal.scrollHeight;
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
  if (hash === "dashboard" || hash === "home") {
    handleDashboardAccess();
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

// ============================================================
// Multi-Tenant Authentication & Session Recovery
// ============================================================

let currentAuthTab = "login";

async function checkAuthSession() {
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
  if (window.google && window.google.accounts && window.google.accounts.id) {
    try {
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
    }
  }
}

// 1. Direct Google OAuth Redirect
function triggerGoogleOAuthRedirect() {
  if (!backendGoogleClientId) {
    showToast("Google Client ID is not set in .env. Click your authorized administrator account below for 1-click access.", "info");
    return;
  }
  if (window.google && window.google.accounts && window.google.accounts.id) {
    try {
      google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          redirectToGoogleOAuthPage();
        }
      });
      return;
    } catch (e) { }
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
  showToast("Demo access is disabled. Please sign in with an authorized Google account (riddhesh.firake@gmail.com or acc94926@gmail.com).", "warning");
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
          <label class="dialog-item" style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.65rem; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; margin-bottom: 5px; cursor: pointer; transition: all 0.2s;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="checkbox" class="dialog-checkbox" value="${escapeHtml(String(d.id))}" data-title="${escapeHtml(d.title)}" ${isChecked} style="accent-color: #38bdf8; width: 16px; height: 16px; cursor: pointer;">
              <div>
                <div style="font-size: 0.8rem; font-weight: 600; color: #f1f5f9;">${escapeHtml(d.title)}</div>
                <div style="font-size: 0.68rem; color: var(--text-dim);">${d.username ? `@${escapeHtml(d.username)}` : `ID: ${d.id}`}</div>
              </div>
            </div>
            <span style="font-size: 0.65rem; font-weight: 700; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.05); color: ${badgeColor}; border: 1px solid ${badgeColor}40;">
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
    if (groqModelEl) groqModelEl.value = cfg.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile";
    const groqVisionEl = document.getElementById("setting-groq-vision-model");
    if (groqVisionEl) groqVisionEl.value = cfg.GROQ_VISION_MODEL || "llama-3.2-11b-vision-preview";
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
    if (geminiModelEl) geminiModelEl.value = cfg.GEMINI_MODEL || "gemini-1.5-flash";
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
    GROQ_TEXT_MODEL: document.getElementById("setting-groq-model") ? document.getElementById("setting-groq-model").value : "llama-3.3-70b-versatile",
    GROQ_VISION_MODEL: document.getElementById("setting-groq-vision-model") ? document.getElementById("setting-groq-vision-model").value : "llama-3.2-11b-vision-preview",
    GEMINI_MODEL: document.getElementById("setting-gemini-model") ? document.getElementById("setting-gemini-model").value : "gemini-1.5-flash"
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
      if (!silent) {
        showToast("Backend Tunnel URL saved! Reconnecting...", "success");
        closeSettingsModal();
        setTimeout(() => location.reload(), 800);
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
