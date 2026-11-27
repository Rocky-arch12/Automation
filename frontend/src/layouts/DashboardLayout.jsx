import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ChevronLeft,
  Cpu,
  Crosshair,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Radio,
  Settings,
  ShieldCheck,
  Sliders,
  Terminal,
  Trash2,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { useAuth } from '../context/AuthContext';
import { isValidTradeSignal } from '../utils/badgeUtils';
import { PAGE_TITLES } from '../utils/constants';

export function DashboardLayout() {
  const {
    setDashboardMounted,
    systemStatus,
    xmStatus,
    messages,
    unfilteredMessages,
    xmPositionsData,
    wsConnected,
    wsStatusText,
    openQuickSettings,
    handleConfirmClearData,
  } = useAlphaSignal();
  const { user, logoutUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Activate dashboard polling & WebSocket lifecycle while shell is mounted
  useEffect(() => {
    setDashboardMounted(true);
    return () => setDashboardMounted(false);
  }, [setDashboardMounted]);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const currentPageKey = useMemo(() => {
    const seg = location.pathname.replace(/^\//, '').split('/')[0] || 'dashboard';
    return PAGE_TITLES[seg] ? seg : 'dashboard';
  }, [location.pathname]);

  const badgeSource = unfilteredMessages.length > 0 ? unfilteredMessages : messages;
  const validSignalsCount = useMemo(
    () => badgeSource.filter(isValidTradeSignal).length,
    [badgeSource]
  );

  const listenerRunning = Boolean(systemStatus?.listener?.running);
  const listenerMode = systemStatus?.listener?.mode || 'standby';

  const aiLabel = useMemo(() => {
    if (!systemStatus?.ai) return 'AI: Groq (Llama 3.3)';
    return `AI: ${systemStatus.ai.mode}`;
  }, [systemStatus]);

  const xmBadge = useMemo(() => {
    if (!xmStatus) {
      return { text: 'XM MT5: Demo Active', borderColor: 'rgba(245, 158, 11, 0.4)' };
    }
    const bal = xmStatus.account ? `$${Number(xmStatus.account.balance || 0).toLocaleString()}` : '';
    if (!xmStatus.auto_execution) {
      return { text: 'XM MT5: Execution Off', borderColor: 'rgba(100, 116, 139, 0.4)' };
    }
    if (xmStatus.mode === 'XM_DEMO_SANDBOX') {
      return { text: `XM MT5: Sandbox (${bal})`, borderColor: 'rgba(245, 158, 11, 0.4)' };
    }
    return { text: `XM MT5: Demo Active (${bal})`, borderColor: 'rgba(16, 185, 129, 0.4)' };
  }, [xmStatus]);

  const handleToggleSidebar = () => {
    if (window.innerWidth <= 1024) {
      setMobileMenuOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  };

  return (
    <div id="view-dashboard" className="spa-view">
      <div
        id="app-shell"
        className={`app-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}
      >
        {/* Mobile Sidebar Backdrop */}
        <div
          id="sidebar-backdrop"
          className={`sidebar-backdrop${mobileMenuOpen ? ' active' : ''}`}
          onClick={() => setMobileMenuOpen(false)}
        />

        {/* Persistent Left Sidebar Navigation */}
        <aside
          id="app-sidebar"
          className={`app-sidebar${mobileMenuOpen ? ' sidebar-open' : ''}`}
        >
          <div className="sidebar-header">
            <div
              className="brand-area"
              onClick={() => navigate('/dashboard')}
              style={{ cursor: 'pointer' }}
            >
              <div className="brand-logo">α</div>
              <div className="brand-info">
                <h1 className="brand-title">AlphaSignal AI</h1>
                <p className="brand-tagline">Autonomous MT5 Engine</p>
              </div>
            </div>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={handleToggleSidebar}
              title="Collapse / Expand Sidebar"
              aria-label="Toggle sidebar width"
            >
              <ChevronLeft size={16} className="collapse-icon" />
            </button>
          </div>

          <nav className="sidebar-nav" aria-label="Primary dashboard navigation">
            <div className="nav-section-title">TRADING DESK</div>
            <NavLink
              to="/dashboard"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <LayoutDashboard size={18} />
              <span className="nav-text">Dashboard</span>
            </NavLink>
            <NavLink
              to="/chats"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <MessageSquare size={18} />
              <span className="nav-text">Recorded Chats</span>
              <span className="nav-badge" id="nav-chats-badge">
                {badgeSource.length}
              </span>
            </NavLink>
            <NavLink
              to="/signals"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Radio size={18} />
              <span className="nav-text">Trade Signals</span>
              <span className="nav-badge nav-badge-accent" id="nav-signals-badge">
                {validSignalsCount}
              </span>
            </NavLink>
            <NavLink
              to="/positions"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <TrendingUp size={18} />
              <span className="nav-text">Active Trades</span>
              {xmPositionsData.count > 0 && (
                <span
                  className="badge"
                  id="open-positions-badge"
                  style={{ marginLeft: 'auto' }}
                >
                  {xmPositionsData.count}
                </span>
              )}
            </NavLink>
            <NavLink
              to="/watchlist"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Crosshair size={18} />
              <span className="nav-text">Trade Watchlist</span>
            </NavLink>

            <div className="nav-section-title">INTELLIGENCE TOOLS</div>
            <NavLink
              to="/simulator"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <FlaskConical size={18} />
              <span className="nav-text">Signal Simulator</span>
            </NavLink>
            <NavLink
              to="/terminal"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Terminal size={18} />
              <span className="nav-text">Live Terminal</span>
            </NavLink>
            <NavLink
              to="/settings"
              onClick={closeMobileMenu}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <Sliders size={18} />
              <span className="nav-text">Settings</span>
            </NavLink>
          </nav>

          <div className="sidebar-footer">
            <div className="sidebar-status-card">
              <div className="sidebar-status-row">
                <span className="pulse-dot" />
                <span className="sidebar-status-title">Engine Autonomous</span>
              </div>
              <div className="sidebar-status-sub">Zero-Knowledge AES-256 Vault</div>
            </div>
          </div>
        </aside>

        {/* Main Workspace */}
        <div className="app-main">
          <header className="app-header">
            <div className="header-left">
              <button
                type="button"
                className="sidebar-toggle-btn"
                id="sidebar-toggle-btn"
                onClick={handleToggleSidebar}
                aria-label="Toggle navigation menu"
              >
                <Menu size={18} />
              </button>
              <div className="header-breadcrumbs">
                <span
                  className="breadcrumb-root"
                  onClick={() => navigate('/dashboard')}
                  style={{ cursor: 'pointer' }}
                >
                  AlphaSignal
                </span>
                <span className="breadcrumb-sep">/</span>
                <span className="breadcrumb-current" id="header-page-title">
                  {PAGE_TITLES[currentPageKey] || 'Dashboard'}
                </span>
              </div>
            </div>

            <div className="header-status-group">
              <div className="status-badges-scroller">
                <div className="status-badge" id="tg-status-badge">
                  <span
                    className={`pulse-dot${listenerRunning ? '' : ' idle'}`}
                    id="tg-pulse"
                  />
                  <span id="tg-status-text">
                    {listenerRunning
                      ? `Telegram: Listening (${listenerMode})`
                      : 'Telegram: Standby'}
                  </span>
                </div>

                <div className="status-badge" id="ai-status-badge">
                  <Cpu size={14} style={{ color: 'var(--info-text)' }} />
                  <span id="ai-status-text">{aiLabel}</span>
                </div>

                <div
                  className="status-badge"
                  id="xm-status-badge"
                  onClick={() => navigate('/positions')}
                  style={{ cursor: 'pointer', borderColor: xmBadge.borderColor }}
                  title="XM MT5 Execution Status (Click to view positions)"
                >
                  <Zap size={14} style={{ color: 'var(--warning-text)' }} />
                  <span id="xm-status-text">{xmBadge.text}</span>
                </div>

                <div
                  className="status-badge"
                  id="ws-status-badge"
                  style={{
                    borderColor: wsConnected
                      ? 'rgba(16, 185, 129, 0.4)'
                      : 'rgba(239, 68, 68, 0.4)',
                  }}
                >
                  <Activity size={14} style={{ color: 'var(--success-text)' }} />
                  <span id="ws-status-text">{wsStatusText}</span>
                </div>

                {user && (
                  <div
                    id="user-profile-badge"
                    className="status-badge"
                    style={{ display: 'flex', borderColor: 'rgba(56, 189, 248, 0.4)' }}
                    title="Active Trader Profile"
                  >
                    <ShieldCheck size={14} style={{ color: 'var(--info-text)' }} />
                    <span id="user-display-name">
                      {user.name || (user.email ? user.email.split('@')[0] : 'Trader')}
                    </span>
                  </div>
                )}
              </div>

              <div className="header-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={openQuickSettings}
                  title="System Settings"
                >
                  <Settings size={15} />
                  <span className="btn-text">Settings</span>
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={logoutUser}
                  title="Sign out of your session"
                >
                  <LogOut size={15} />
                  <span className="btn-text">Sign Out</span>
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={handleConfirmClearData}
                  title="Clear Live Stream"
                >
                  <Trash2 size={15} />
                  <span className="btn-text">Clear</span>
                </button>
              </div>
            </div>
          </header>

          <main className="app-page-container">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
