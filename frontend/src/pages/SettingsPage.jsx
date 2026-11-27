import { useCallback, useEffect, useState } from 'react';
import { Loader2, Radio, RefreshCw, Save, Square } from 'lucide-react';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { useToast } from '../context/ToastContext';
import {
  fetchSettings,
  fetchTelegramDialogs,
  saveSettingsPayload,
  startTelegramClient,
  stopTelegramListener,
} from '../services/alphaSignalApi';
import { getApiBase, setApiBase } from '../services/apiClient';

export default function SettingsPage() {
  const {
    loadSystemStatus,
    reconnectWebSocket,
    loadStats,
    loadMessages,
    loadTrades,
  } = useAlphaSignal();
  const { showToast } = useToast();

  // AI Configuration
  const [aiProvider, setAiProvider] = useState('groq');
  const [groqKey, setGroqKey] = useState('');
  const [groqKeyPlaceholder, setGroqKeyPlaceholder] = useState('gsk_...');
  const [groqTextModel, setGroqTextModel] = useState('openai/gpt-oss-120b');
  const [groqVisionModel, setGroqVisionModel] = useState('qwen/qwen3.8-27b');

  const [geminiKey, setGeminiKey] = useState('');
  const [geminiKeyPlaceholder, setGeminiKeyPlaceholder] = useState('AIzaSy...');
  const [geminiModel, setGeminiModel] = useState('gemini-2.5-flash');

  // Telegram Configuration
  const [tgApiId, setTgApiId] = useState('');
  const [tgPhone, setTgPhone] = useState('');
  const [tgApiHash, setTgApiHash] = useState('');
  const [tgHashPlaceholder, setTgHashPlaceholder] = useState('••••••••••••••••••••••••••••••••');
  const [botToken, setBotToken] = useState('');
  const [botTokenPlaceholder, setBotTokenPlaceholder] = useState('123456:ABC-DEF...');

  const [savedSelectedChannels, setSavedSelectedChannels] = useState('');
  const [dialogs, setDialogs] = useState([]);
  const [selectedDialogIds, setSelectedDialogIds] = useState([]);
  const [fetchingDialogs, setFetchingDialogs] = useState(false);
  const [dialogsError, setDialogsError] = useState('');
  const [startingClient, setStartingClient] = useState(false);

  // XM MT5 Configuration
  const [xmAutoExecution, setXmAutoExecution] = useState(true);
  const [xmLogin, setXmLogin] = useState('');
  const [xmServer, setXmServer] = useState('XMGlobal-MT5 10');
  const [xmPassword, setXmPassword] = useState('');

  // Tunnel URL
  const [apiUrl, setApiUrl] = useState(() => getApiBase());

  const loadSettingsData = useCallback(async () => {
    try {
      const { ok, data: cfg } = await fetchSettings();
      if (!ok || !cfg || typeof cfg !== 'object') return;

      setAiProvider(cfg.AI_PROVIDER || 'groq');
      setGroqTextModel(cfg.GROQ_TEXT_MODEL || 'openai/gpt-oss-120b');
      setGroqVisionModel(cfg.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b');
      setGroqKey('');
      setGroqKeyPlaceholder(
        cfg.HAS_GROQ_KEY ? `Stored (${cfg.GROQ_API_KEY_MASKED})` : 'gsk_...'
      );

      setGeminiModel(cfg.GEMINI_MODEL || 'gemini-2.5-flash');
      setGeminiKey('');
      setGeminiKeyPlaceholder(
        cfg.HAS_GEMINI_KEY ? `Stored (${cfg.GEMINI_API_KEY_MASKED})` : 'AIzaSy...'
      );

      setTgApiId(cfg.TELEGRAM_API_ID || '');
      setTgPhone(cfg.TELEGRAM_PHONE || '');
      setTgApiHash('');
      setTgHashPlaceholder(
        cfg.HAS_TELEGRAM_HASH
          ? `Stored (${cfg.TELEGRAM_API_HASH_MASKED})`
          : '••••••••••••••••••••••••••••••••'
      );

      setBotToken('');
      setBotTokenPlaceholder(
        cfg.HAS_BOT_TOKEN ? `Stored (${cfg.TELEGRAM_BOT_TOKEN_MASKED})` : '123456:ABC-DEF...'
      );

      setSavedSelectedChannels(cfg.TELEGRAM_SELECTED_CHANNELS || '');

      setXmLogin(cfg.XM_MT5_LOGIN || '');
      setXmServer(cfg.XM_MT5_SERVER || 'XMGlobal-MT5 10');
      setXmAutoExecution(cfg.XM_AUTO_EXECUTION !== 'false');
      setXmPassword('');
    } catch (e) {
      console.warn(
        'Could not load remote settings (normal if backend tunnel is not linked yet):',
        e.message
      );
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      loadSystemStatus();
      loadSettingsData();
    }, 0);
    return () => clearTimeout(t);
  }, [loadSettingsData, loadSystemStatus]);

  const handleFetchDialogs = async () => {
    setFetchingDialogs(true);
    setDialogsError('');
    try {
      const data = await fetchTelegramDialogs();
      if (data.status === 'success' && Array.isArray(data.dialogs) && data.dialogs.length > 0) {
        setDialogs(data.dialogs);
        const savedIds = savedSelectedChannels
          ? savedSelectedChannels.split(',').map((s) => s.trim())
          : [];
        const preChecked = data.dialogs
          .filter(
            (d) =>
              savedIds.includes(String(d.id)) ||
              (d.username && savedIds.includes(String(d.username)))
          )
          .map((d) => String(d.id));
        setSelectedDialogIds(preChecked);
        showToast(
          `Fetched ${data.dialogs.length} joined channels & groups! Check the ones you want to monitor.`,
          'success'
        );
      } else {
        const msg =
          data.detail ||
          'No channels found. Please make sure your Telegram API ID & Hash are saved in settings and authorized.';
        setDialogs([]);
        setDialogsError(msg);
        showToast(data.detail || 'No channels found. Verify Telegram API ID/Hash.', 'error');
      }
    } catch (e) {
      setDialogsError(`Error fetching dialogs: ${e.message}`);
      showToast('Failed to fetch dialogs: ' + e.message, 'error');
    } finally {
      setFetchingDialogs(false);
    }
  };

  const toggleDialogCheckbox = (idStr) => {
    setSelectedDialogIds((prev) =>
      prev.includes(idStr) ? prev.filter((item) => item !== idStr) : [...prev, idStr]
    );
  };

  const handleSaveSettings = async (silent = false, overrideChannels = null) => {
    const cleanedApiUrl = setApiBase(apiUrl);

    const payload = {
      AI_PROVIDER: aiProvider || 'groq',
      GROQ_TEXT_MODEL: groqTextModel || 'openai/gpt-oss-120b',
      GROQ_VISION_MODEL: groqVisionModel || 'qwen/qwen3.8-27b',
      GEMINI_MODEL: geminiModel || 'gemini-2.5-flash',
      XM_AUTO_EXECUTION: xmAutoExecution ? 'true' : 'false',
    };

    if (groqKey.trim()) payload.GROQ_API_KEY = groqKey.trim();
    if (geminiKey.trim()) payload.GEMINI_API_KEY = geminiKey.trim();
    if (tgApiId.trim()) payload.TELEGRAM_API_ID = tgApiId.trim();
    if (tgPhone.trim()) payload.TELEGRAM_PHONE = tgPhone.trim();
    if (tgApiHash.trim()) payload.TELEGRAM_API_HASH = tgApiHash.trim();
    if (botToken.trim()) payload.TELEGRAM_BOT_TOKEN = botToken.trim();

    if (overrideChannels !== null) {
      payload.TELEGRAM_SELECTED_CHANNELS = overrideChannels;
    } else if (selectedDialogIds.length > 0) {
      const joined = selectedDialogIds.join(',');
      payload.TELEGRAM_SELECTED_CHANNELS = joined;
      setSavedSelectedChannels(joined);
    } else if (savedSelectedChannels) {
      payload.TELEGRAM_SELECTED_CHANNELS = savedSelectedChannels;
    }

    if (xmLogin.trim()) payload.XM_MT5_LOGIN = xmLogin.trim();
    if (xmServer.trim()) payload.XM_MT5_SERVER = xmServer.trim();
    if (xmPassword.trim()) payload.XM_MT5_PASSWORD = xmPassword.trim();

    try {
      const { ok, status, data } = await saveSettingsPayload(payload);
      if (ok) {
        if (!silent) {
          showToast('Settings securely saved & encrypted (AES-256)!', 'success');
          loadSystemStatus();
          reconnectWebSocket();
          loadStats();
          loadMessages();
          loadTrades();
          loadSettingsData();
        }
      } else if (!silent) {
        const errDetail = data?.detail || `HTTP ${status}`;
        showToast(
          status === 401
            ? 'Sign in via Google OAuth to save backend settings.'
            : `Failed to save settings: ${errDetail}`,
          'error'
        );
      }
    } catch (e) {
      if (cleanedApiUrl && !silent) {
        showToast('Backend Tunnel URL saved! Reconnecting to engine...', 'success');
        reconnectWebSocket();
        loadSystemStatus();
        loadStats();
        loadMessages();
        loadTrades();
      } else if (!silent) {
        showToast('Failed to save settings: ' + e.message, 'error');
      }
    }
  };

  const handleStartMultiClientListener = async () => {
    if (selectedDialogIds.length === 0) {
      showToast('Please check at least one Telegram channel or group to monitor.', 'error');
      return;
    }

    setStartingClient(true);
    try {
      const joined = selectedDialogIds.join(',');
      setSavedSelectedChannels(joined);
      await handleSaveSettings(true, joined);

      const { ok, data } = await startTelegramClient(selectedDialogIds);
      if (ok) {
        showToast(
          `Multi-channel listener active! Monitoring ${selectedDialogIds.length} channel(s) concurrently.`,
          'success'
        );
        loadSystemStatus();
      } else {
        showToast(
          `Failed to start listener: ${data?.detail || 'Check Telegram credentials'}`,
          'error'
        );
      }
    } catch (e) {
      showToast('Listener error: ' + e.message, 'error');
    } finally {
      setStartingClient(false);
    }
  };

  const handleStopTelegramBot = async () => {
    try {
      await stopTelegramListener();
      showToast('Telegram listener stopped.', 'info');
      loadSystemStatus();
    } catch (e) {
      showToast('Failed to stop listener: ' + e.message, 'error');
    }
  };

  return (
    <div id="page-settings" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">System Settings &amp; Integrations</h2>
          <p className="page-header-desc">
            Configure Telegram multi-channel listeners, Groq/Gemini AI credentials, XM MT5 broker
            accounts, and tunnels
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => handleSaveSettings(false)}
          >
            <Save size={14} />
            Save Configuration
          </button>
        </div>
      </div>

      <div className="settings-page-grid">
        {/* Section 1: AI Provider */}
        <section className="settings-section-card">
          <h3 className="settings-section-title settings-section-blue">
            1. Free AI Provider Configuration
          </h3>

          <div className="form-group">
            <label className="form-label" htmlFor="setting-provider">
              Active AI Provider
            </label>
            <select
              id="setting-provider"
              className="form-control"
              value={aiProvider}
              onChange={(e) => setAiProvider(e.target.value)}
            >
              <option value="groq">Groq API (Recommended — 100% Free Tier, Ultra Fast)</option>
              <option value="gemini">Google Gemini API (100% Free Tier, Multimodal)</option>
            </select>
          </div>

          {aiProvider === 'groq' && (
            <div id="groq-fields">
              <div className="form-group">
                <label className="form-label" htmlFor="setting-groq-key">
                  Groq API Key
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link"
                  >
                    Get Free Groq Key &rarr;
                  </a>
                </label>
                <input
                  type="password"
                  id="setting-groq-key"
                  className="form-control"
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder={groqKeyPlaceholder}
                />
                <small className="settings-hint">
                  Free tier with high limits. Stored encrypted at rest.
                </small>
              </div>

              <div className="form-row-2col">
                <div className="form-group">
                  <label className="form-label" htmlFor="setting-groq-model">
                    Groq Text Model
                  </label>
                  <input
                    type="text"
                    id="setting-groq-model"
                    className="form-control"
                    value={groqTextModel}
                    onChange={(e) => setGroqTextModel(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="setting-groq-vision-model">
                    Groq Vision Model
                  </label>
                  <input
                    type="text"
                    id="setting-groq-vision-model"
                    className="form-control"
                    value={groqVisionModel}
                    onChange={(e) => setGroqVisionModel(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          {aiProvider === 'gemini' && (
            <div id="gemini-fields">
              <div className="form-group">
                <label className="form-label" htmlFor="setting-gemini-key">
                  Google Gemini API Key
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="settings-link"
                  >
                    Get Free Gemini Key &rarr;
                  </a>
                </label>
                <input
                  type="password"
                  id="setting-gemini-key"
                  className="form-control"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder={geminiKeyPlaceholder}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="setting-gemini-model">
                  Gemini Model
                </label>
                <input
                  type="text"
                  id="setting-gemini-model"
                  className="form-control"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                />
              </div>
            </div>
          )}
        </section>

        {/* Section 2: Telegram Integration */}
        <section className="settings-section-card">
          <h3 className="settings-section-title settings-section-title-row">
            <span>2. Telegram Account &amp; Multi-Channel Listener</span>
            <span className="settings-chip settings-chip-green">Multi-Channel Harvester</span>
          </h3>
          <p className="settings-desc">
            Enter your Telegram API credentials from{' '}
            <a href="https://my.telegram.org/apps" target="_blank" rel="noopener noreferrer">
              my.telegram.org
            </a>
            . Then click below to automatically load and select from all your joined channels and
            groups.
          </p>

          <div className="form-row-2col">
            <div className="form-group">
              <label className="form-label" htmlFor="setting-tg-api-id">
                Telegram API ID
              </label>
              <input
                type="text"
                id="setting-tg-api-id"
                className="form-control"
                value={tgApiId}
                onChange={(e) => setTgApiId(e.target.value)}
                placeholder="e.g. 21434478"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="setting-tg-phone">
                Telegram Phone
              </label>
              <input
                type="text"
                id="setting-tg-phone"
                className="form-control"
                value={tgPhone}
                onChange={(e) => setTgPhone(e.target.value)}
                placeholder="e.g. +1234567890"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="setting-tg-api-hash">
              Telegram API Hash (AES-256 Encrypted)
            </label>
            <input
              type="password"
              id="setting-tg-api-hash"
              className="form-control"
              value={tgApiHash}
              onChange={(e) => setTgApiHash(e.target.value)}
              placeholder={tgHashPlaceholder}
            />
          </div>

          <div className="dialogs-picker-wrap">
            <div className="dialogs-picker-top">
              <span className="dialogs-picker-title">Joined Channels &amp; Groups</span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                id="btn-fetch-dialogs"
                disabled={fetchingDialogs}
                onClick={handleFetchDialogs}
              >
                {fetchingDialogs ? (
                  <>
                    <Loader2 size={12} className="spin" />
                    Loading Dialogs...
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} />
                    Fetch My Groups &amp; Channels
                  </>
                )}
              </button>
            </div>

            {dialogs.length > 0 ? (
              <div id="tg-dialogs-container" className="dialogs-picker-container">
                {dialogs.map((d) => {
                  const idStr = String(d.id);
                  const badgeColor =
                    d.type === 'channel'
                      ? '#38bdf8'
                      : d.type === 'supergroup'
                        ? '#a855f7'
                        : '#10b981';
                  return (
                    <label key={idStr} className="dialog-item">
                      <input
                        type="checkbox"
                        className="dialog-checkbox"
                        value={idStr}
                        checked={selectedDialogIds.includes(idStr)}
                        onChange={() => toggleDialogCheckbox(idStr)}
                      />
                      <div className="dialog-item-info">
                        <div className="dialog-item-title">{d.title}</div>
                        <div className="dialog-item-sub">
                          {d.username ? `@${d.username}` : `ID: ${d.id}`}
                        </div>
                      </div>
                      <span
                        className="dialog-type-badge"
                        style={{ color: badgeColor, borderColor: `${badgeColor}40` }}
                      >
                        {d.type}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div id="tg-dialogs-empty" className="dialogs-empty">
                {dialogsError ? (
                  <>⚠️ {dialogsError}</>
                ) : savedSelectedChannels ? (
                  <>
                    Saved monitored channels: <b>{savedSelectedChannels}</b>
                    <br />
                    <span style={{ fontSize: '0.68rem', color: '#38bdf8' }}>
                      Click &apos;Fetch My Groups &amp; Channels&apos; to view and re-select from
                      list.
                    </span>
                  </>
                ) : (
                  'Click "Fetch My Groups & Channels" to load your joined signal chats.'
                )}
              </div>
            )}
          </div>

          <div className="modal-btn-row">
            <button
              type="button"
              className="btn btn-primary"
              id="btn-start-multi"
              disabled={startingClient}
              onClick={handleStartMultiClientListener}
              style={{ flex: 1 }}
            >
              {startingClient ? (
                <>
                  <Loader2 size={14} className="spin" />
                  Starting Multi-Channel Listener...
                </>
              ) : (
                <>
                  <Radio size={14} />
                  Start Multi-Channel Listener
                </>
              )}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              id="btn-stop-bot"
              onClick={handleStopTelegramBot}
            >
              <Square size={14} />
              Stop Listener
            </button>
          </div>

          <div className="settings-subsection">
            <label className="form-label" htmlFor="setting-bot-token">
              Bot Token (Optional fallback for single test channel)
            </label>
            <input
              type="password"
              id="setting-bot-token"
              className="form-control"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={botTokenPlaceholder}
            />
          </div>
        </section>

        {/* Section 3: XM MT5 Broker */}
        <section className="settings-section-card">
          <h3 className="settings-section-title settings-section-title-row">
            <span>3. XM MT5 Broker &amp; Automated Execution</span>
            <span className="settings-chip settings-chip-amber">Demo &amp; Live Supported</span>
          </h3>

          <div className="form-group xm-auto-row">
            <div>
              <div className="xm-auto-title">Autonomous XM MT5 Order Execution</div>
              <div className="xm-auto-desc">
                When ON, approved trades automatically fire in MT5 with strict SL and 1:1 scale-out
                trailing.
              </div>
            </div>
            <label className="toggle-switch">
              <input
                type="checkbox"
                id="setting-xm-auto"
                checked={xmAutoExecution}
                onChange={(e) => setXmAutoExecution(e.target.checked)}
              />
              <span className="toggle-slider" />
            </label>
          </div>

          <div className="form-row-2col">
            <div className="form-group">
              <label className="form-label" htmlFor="setting-xm-login">
                XM MT5 Login (Account ID)
              </label>
              <input
                type="number"
                id="setting-xm-login"
                className="form-control"
                value={xmLogin}
                onChange={(e) => setXmLogin(e.target.value)}
                placeholder="e.g. 346554725"
              />
            </div>
            <div className="form-group">
              <label className="form-label" htmlFor="setting-xm-server">
                XM Server Name
              </label>
              <input
                type="text"
                id="setting-xm-server"
                className="form-control"
                value={xmServer}
                onChange={(e) => setXmServer(e.target.value)}
                placeholder="e.g. XMGlobal-MT5 10"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="setting-xm-password">
              XM MT5 Password
              <span className="settings-secure-note">🔒 Stored AES-256 Encrypted</span>
            </label>
            <input
              type="password"
              id="setting-xm-password"
              className="form-control"
              value={xmPassword}
              onChange={(e) => setXmPassword(e.target.value)}
              placeholder="••••••••••••"
            />
          </div>
        </section>

        {/* Section 4: Hosting & Backend Tunnel */}
        <section className="settings-section-card">
          <h3 className="settings-section-title settings-section-title-row">
            <span>4. 24/7 Free Hosting &amp; Backend Tunnel</span>
            <span className="settings-chip settings-chip-blue">Vercel Bridge</span>
          </h3>
          <div className="form-group">
            <label className="form-label" htmlFor="setting-api-url">
              Backend Tunnel URL (Cloudflare Tunnel / Ngrok)
            </label>
            <input
              type="text"
              id="setting-api-url"
              className="form-control"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://your-tunnel.trycloudflare.com"
            />
            <div className="settings-hint">
              When hosting frontend on Vercel, enter your free Cloudflare Tunnel URL here.
              Automatically persists across refreshes.
            </div>
          </div>
        </section>

        {/* Section 5: Risk Management Parameters */}
        <section className="settings-section-card">
          <h3 className="settings-section-title settings-section-title-row">
            <span>5. Risk Management &amp; Lot Normalization</span>
            <span className="settings-chip settings-chip-green">Policy Active</span>
          </h3>
          <div className="risk-policy-grid">
            <div className="risk-policy-item">
              <div className="risk-policy-label">Gold (XAUUSD) Lot Size</div>
              <div className="risk-policy-val">0.02 Fixed</div>
            </div>
            <div className="risk-policy-item">
              <div className="risk-policy-label">Bitcoin (BTCUSD) Lot Size</div>
              <div className="risk-policy-val">0.04 Fixed</div>
            </div>
            <div className="risk-policy-item">
              <div className="risk-policy-label">Forex Pairs Lot Size</div>
              <div className="risk-policy-val">0.01 Standard</div>
            </div>
            <div className="risk-policy-item">
              <div className="risk-policy-label">1:1 Breakeven Trailing</div>
              <div className="risk-policy-val" style={{ color: 'var(--success-text)' }}>
                50% Scale-Out + BE
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
