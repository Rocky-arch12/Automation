# AlphaSignal AI — Complete Functionality Mapping & Migration Audit

This document maps 100% of the legacy HTML/CSS/Vanilla JS frontend (`static/index.html`, `static/style.css`, `static/app.js`) to the migrated React + Vite + React Bits architecture in `frontend/`.

---

## 1. Views, Routes & Navigation Structure

| Legacy View / Page | Legacy ID / Hash | React Route / Component | Notes & Preserved Behavior |
|---|---|---|---|
| Public Landing View | `#view-landing` (`#landing`, `#features`, `#architecture`, `#security`) | `/landing` (`LandingPage.jsx`) | Sticky nav with mobile hamburger menu, hero section, telemetry preview card, 4 feature cards, footer, quick settings modal trigger |
| Auth / Admin Access Vault | `#view-login` (`#login`, `#register`) | `/login` (`LoginPage.jsx`) | Whitelisted email notice, official Google Identity Services (`google.accounts.id`) button + OAuth2 implicit redirect fallback, backend URL modal trigger |
| Dashboard Shell | `#view-dashboard` | `DashboardLayout.jsx` | Persistent collapsible sidebar (desktop) / slide-out drawer (mobile), sticky header with breadcrumbs, 5 status badges, Settings/Sign Out/Clear actions |
| Overview Analytics | `#page-dashboard` (`#dashboard`, `/`) | `/dashboard` (`OverviewPage.jsx`) | 4 KPI cards (`total`, `trades`, `chatter`, `latency`), 4 responsive shadcn/ui Recharts charts (`activity`, `buysell`, `assets`, `performance`), recent signals list, system health & MT5 live glance |
| Recorded Telegram Chats | `#page-chats` (`#chats`) | `/chats` (`ChatsPage.jsx`) | Search input (300ms debounce), channel dropdown filter, intent segmented filters (`ALL`, `TRADES`, `UPDATES`, `CHATTER`), message feed cards with image preview + JSON inspector |
| Trade Signals Table | `#page-signals` (`#signals`) | `/signals` (`SignalsPage.jsx`) | Direction filter (`ALL`, `BUY`, `SELL`), structured table of validated signals with trade link, entry/SL/TP, confidence, latency, JSON modal & watchlist jump |
| Active MT5 Trades | `#page-positions` (`#positions`) | `/positions` (`PositionsPage.jsx`) | Account meta bar (`Server`, `Account`, `Open Positions`, `Floating PnL`), open position cards with 50%/100% lot presets, custom lot input, confirmation dialog & `POST /api/xm/close` |
| Trade Lifecycle Watchlist | `#page-watchlist` (`#watchlist`) | `/watchlist` (`WatchlistPage.jsx`) | Status filters (`ALL`, `ACTIVE`, `PENDING`, `TP_HIT`, `SL_HIT`), trade cards, XM execution receipts, safety shield notes, expandable lifecycle audit timeline (`GET /api/trades/:id`), manual `Cancel Setup` |
| Signal Simulator | `#page-simulator` (`#simulator`) | `/simulator` (`SimulatorPage.jsx`) | 5 quick presets (`PENDING`, `ACTIVE_MARKET`, `ACTIVATE_CONFIRM`, `CANCEL`, `CHATTER`), form inputs, drag-and-drop + click image upload with preview, `POST /api/simulate` multipart submission & live feedback card |
| Live System Terminal | `#page-terminal` (`#terminal`) | `/terminal` (`TerminalPage.jsx`) | Log level filter (`ALL`, `INFO`, `SIGNAL`, `WARN`, `ERROR`), auto-scroll toggle, clear terminal logs, real-time WebSocket + REST `/api/logs` stream |
| System Settings | `#page-settings` (`#settings`) | `/settings` (`SettingsPage.jsx`) | AI provider toggle (Groq/Gemini) + masked keys, Telegram API ID/Hash/Phone + dialog harvester + multi-channel checkboxes + Start/Stop listeners, XM MT5 broker fields & auto-execution toggle, Vercel Bridge Tunnel URL (`localStorage`), risk management display |
| Quick Settings Modal | `#settings-modal` | `QuickSettingsModal.jsx` | Quick connection modal linking to full Settings page |
| Raw JSON Modal | `#json-modal` | `JsonInspectorModal.jsx` | Pretty-printed JSON payload inspector for any signal/message |
| Toast System | `showToast(msg, type)` | `ToastContext.jsx` | Auto-dismissing (4.2s) status notifications (`info`, `success`, `warning`, `error`) |

> **Routing compatibility:** Both clean paths (`/dashboard`, `/chats`, `/landing`, etc.) AND legacy hash routes (`#dashboard`, `#chats`, `#features`, `#id_token=...`) are supported so bookmarks, OAuth redirects, and Vercel refreshes all work identically.

---

## 2. Backend API & WebSocket Integrations (Preserved 1:1)

| Integration | Method & Path | Consumer | Behavior Preserved |
|---|---|---|---|
| System Status | `GET /api/status` | `useAlphaSignalData` / `api.js` | Listener mode/running state, AI provider & model info |
| XM Status | `GET /api/xm/status` | `useAlphaSignalData` | Account balance, auto-execution state, sandbox vs demo mode |
| Dashboard Stats | `GET /api/stats` | `useAlphaSignalData` | Polled every 5s when dashboard is active & on WS updates |
| Messages Feed | `GET /api/messages?limit=60&intent_filter=...&search=...` | `ChatsPage`, `SignalsPage`, `OverviewPage` | Intent filtering, debounced text search |
| Trade Watchlist | `GET /api/trades?limit=60&status_filter=...` | `WatchlistPage` | Lifecycle state filtering |
| Trade Timeline | `GET /api/trades/{trade_id}` | `TradeCard` | Lazy-fetched on Timeline toggle |
| Manual Trade Status | `POST /api/trades/{trade_id}/status` | `WatchlistPage` | Cancels `PENDING` setups (`{ status, notes }`) |
| XM Open Positions | `GET /api/xm/positions` | `PositionsPage`, `OverviewPage` | Polled every 5s when dashboard active; updates sidebar badge & meta bar |
| Close XM Position | `POST /api/xm/close` | `PositionsPage` | Sends `{ ticket, lots }`, logs receipt, reloads positions |
| Signal Simulator | `POST /api/simulate` | `SimulatorPage` | Multipart `FormData` (`text`, `sender`, `channel_title`, optional `image`) |
| Terminal Logs | `GET /api/logs?limit=40` | `TerminalPage` | Initial log load reversed chronological + real-time appends |
| Reset Data | `POST /api/reset-data` | Header `Clear` button | Confirms with user, wipes messages/trades/logs, refreshes state |
| Auth Config | `GET /api/auth/config` | `AuthContext` | Loads `google_client_id` from backend `.env` |
| Auth Session | `GET /api/auth/me` | `AuthContext` | Verifies HttpOnly cookie / Bearer token |
| Google OAuth | `POST /api/auth/google` | `AuthContext` | Sends `{ credential, access_token }`, stores `AUTH_TOKEN` & `AUTH_USER` |
| Logout | `POST /api/auth/logout` | `AuthContext` | Clears cookie, removes `AUTH_TOKEN` / `AUTH_USER`, navigates to Landing |
| Settings Read/Write | `GET /api/settings`, `POST /api/settings` | `SettingsPage` | Masked credential placeholders, AES-256 backend save |
| Telegram Dialogs | `GET /api/telegram/dialogs` | `SettingsPage` | Fetches joined channels/groups with selection checkboxes |
| Multi-Channel Start | `POST /api/telegram/start_client` | `SettingsPage` | Saves selected channels silently, sends `{ channel_ids }` |
| Stop Listener | `POST /api/telegram/stop` | `SettingsPage` | Stops active Telegram listener |
| Live WebSocket | `WS /ws` | `useWebSocket` | 25s `"ping"` heartbeat, 3s reconnect, handles `NEW_SIGNAL`, `NEW_MESSAGE`, `TRADE_UPDATED`, `TRADES_EXPIRED`, `DATA_RESET`, `POSITION_CLOSED`, `XM_POSITIONS_UPDATE`, `SYSTEM_STATUS` |
| Media & Sample Images | `/uploads/*`, `/sample_signals/*` | `SignalCard` | Resolves against backend URL when remote; includes ngrok skip-warning blob support if needed |

---

## 3. State, Storage, Auth & Tunnel Bridge Rules Preserved

- **`localStorage` keys:** `API_BACKEND_URL`, `AUTH_TOKEN`, `AUTH_USER`.
- **Query param bootstrap:** `?backend=https://...` saved to `API_BACKEND_URL` and removed from address bar via `window.history.replaceState`.
- **Stale tunnel auto-heal:** Migrates known expired `trycloudflare.com` hostnames to `CURRENT_ACTIVE_TUNNEL` (`VITE_API_URL` / `https://plod-exonerate-october.ngrok-free.dev`).
- **Headers & credentials:** Every `/api` and `/uploads` request includes `credentials: "include"`, `ngrok-skip-browser-warning: "true"`, and `Authorization: Bearer <token>` when present.
- **401 handling:** Clears `AUTH_USER` / `AUTH_TOKEN` and redirects to `/login` when on dashboard routes (excluding auth endpoints).
- **Whitelist & protected entry:** Preserves `ALLOWED_EMAILS = ["riddhesh.firake@gmail.com", "acc94926@gmail.com"]` and enforces strict Google OAuth verification across every route (`/`, `/dashboard`, `/chats`, `/signals`, `/positions`, `/watchlist`, `/simulator`, `/terminal`, `/settings`, `/landing`) so unauthenticated/incognito sessions always route to `/login`.

---

## 4. React Bits Enhancements (`https://reactbits.dev/`)

Installed using official React Bits JS-CSS registry specs:
1. **`SpotlightCard` (`SpotlightCard-JS-CSS`)**: Replaces imperative `initSpotlight()` mouse tracking on KPI cards, signal cards, trade cards, and landing feature cards with zero-dependency GPU-friendly spotlight + border sheen.
2. **`CountUp` (`CountUp-JS-CSS`)**: Replaces imperative `animateCount()` DOM innerText loops for dashboard KPI metrics (`Total Messages`, `Valid Trade Signals`, `Chatter Filtered`, `Avg AI Latency`).
3. **`BlurText` (`BlurText-JS-CSS`)**: Smoothly reveals the landing hero headline while respecting `prefers-reduced-motion`.
4. **`ShinyText` (`ShinyText-JS-CSS`)**: Subtle metallic shimmer on the landing infrastructure status pill.
5. **`ClickSpark` (`ClickSpark-JS-CSS`)**: Subtle interactive click spark micro-feedback on primary CTA & simulation actions (disabled automatically when reduced motion is preferred).
6. **`Particles` (`Particles-JS-CSS`)**: Lightweight interactive particle backdrop scoped cleanly to Landing & Login views (leaving data-dense trading desks crisp and distraction-free).
