export const CURRENT_ACTIVE_TUNNEL =
  (import.meta.env.VITE_API_URL || '').trim().replace(/\/$/, '') ||
  'https://plod-exonerate-october.ngrok-free.dev';

export const STALE_TUNNELS = [
  'trycloudflare.com',
  'recorders-retirement-prostores-touch.trycloudflare.com',
  'effectiveness-welfare-multimedia-storage.trycloudflare.com',
  'warm-table-appropriate-dept.trycloudflare.com',
  'thoroughly-imagination-pam-shake.trycloudflare.com',
  'cpu-baseline-injection-patrol.trycloudflare.com',
  'demanding-reports-street-plugins.trycloudflare.com',
  'composition-logos-settle-manually.trycloudflare.com',
];

export const ALLOWED_GOOGLE_EMAILS = [
  'riddhesh.firake@gmail.com',
  'acc94926@gmail.com',
];

export const DEFAULT_FALLBACK_USER = {
  email: 'riddhesh.firake@gmail.com',
  name: 'Riddhesh Firake (Admin)',
  provider: 'google',
};

export const SIMULATOR_PRESETS = {
  PENDING:
    'BE READY ON THIS LEVEL 2640-2642 XAUUSD BUY WAIT FOR 1 MIN ENGULFING OR EVENING STAR CONFIRMATION SL 2634 TP 2655',
  ACTIVE_MARKET: 'BUY BTCUSDT CMP 68100 SL 67800 TP 68900 ACTIVE NOW',
  ACTIVATE_CONFIRM: 'ACTIVE NOW, ENTER FAST! 1m confirmation candle closed.',
  ACTIVATE: 'ACTIVE NOW, ENTER FAST! 1m confirmation candle closed.',
  CANCEL: 'Setup cancelled guys, level not tapped do not enter.',
  CHATTER: 'Good morning traders! Hope everyone had a great weekend 🚀',
  gold_buy: 'BUY GOLD NOW 2642.50 SL 2636.00 TP1 2648.00 TP2 2656.00',
  btc_short: 'BTC SHORT NOW 91250 SL 91900 TP1 90400 TP2 89500',
};

export const DASHBOARD_PAGES = [
  'dashboard',
  'chats',
  'signals',
  'positions',
  'watchlist',
  'simulator',
  'terminal',
  'settings',
];

export const PAGE_TITLES = {
  dashboard: 'Dashboard Overview',
  chats: 'Recorded Chats',
  signals: 'Trade Signals',
  positions: 'Active MT5 Trades',
  watchlist: 'Trade Watchlist',
  simulator: 'Signal Simulator',
  terminal: 'Live Terminal',
  settings: 'System Settings',
};
