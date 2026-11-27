import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Sliders } from 'lucide-react';
import { useAlphaSignal } from '../../context/AlphaSignalContext';
import { useToast } from '../../context/ToastContext';
import { getApiBase, setApiBase } from '../../services/apiClient';

function QuickSettingsDialog({ onClose }) {
  const {
    reconnectWebSocket,
    loadSystemStatus,
    loadStats,
    loadMessages,
    loadTrades,
  } = useAlphaSignal();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [tunnelUrl, setTunnelUrl] = useState(() => getApiBase());

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const isInDashboard =
    location.pathname !== '/landing' && location.pathname !== '/login';

  const handleSaveTunnel = () => {
    setApiBase(tunnelUrl);
    showToast('Backend Tunnel URL saved! Reconnecting to engine...', 'success');
    onClose();
    if (isInDashboard) {
      reconnectWebSocket();
      loadSystemStatus();
      loadStats();
      loadMessages();
      loadTrades();
    }
  };

  return (
    <div
      className="modal-overlay"
      id="settings-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content modal-content-lg">
        <div className="modal-header">
          <div className="modal-title" id="quick-settings-title">
            <Sliders size={18} style={{ color: 'var(--primary)' }} />
            Quick System Settings
          </div>
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="modal-body">
          <p className="settings-desc">
            You can configure full settings directly in the Settings page or save quick
            backend tunnel connection settings here.
          </p>

          <div className="form-group">
            <label className="form-label" htmlFor="quick-setting-api-url">
              Backend Tunnel URL (Cloudflare Tunnel / Ngrok)
            </label>
            <input
              type="text"
              id="quick-setting-api-url"
              className="form-control"
              value={tunnelUrl}
              onChange={(e) => setTunnelUrl(e.target.value)}
              placeholder="https://plod-exonerate-october.ngrok-free.dev"
            />
            <span className="settings-hint">
              When hosting frontend on Vercel, enter your tunnel URL here. Automatically
              persists across refreshes.
            </span>
          </div>

          <button
            type="button"
            className="btn btn-secondary w-full"
            onClick={() => {
              onClose();
              navigate('/settings');
            }}
          >
            <Sliders size={14} />
            Open Full Settings Dashboard
          </button>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSaveTunnel}>
            Save Tunnel URL
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuickSettingsModal() {
  const { quickSettingsOpen, closeQuickSettings } = useAlphaSignal();
  if (!quickSettingsOpen) return null;
  return <QuickSettingsDialog onClose={closeQuickSettings} />;
}
