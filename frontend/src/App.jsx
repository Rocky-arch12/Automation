import { Suspense, lazy, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { JsonInspectorModal } from './components/modals/JsonInspectorModal';
import { QuickSettingsModal } from './components/modals/QuickSettingsModal';
import { AlphaSignalProvider } from './context/AlphaSignalContext';
import { AuthProvider, isAuthorizedAdmin, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { DashboardLayout } from './layouts/DashboardLayout';
import { getAuthUser } from './services/apiClient';
import { DASHBOARD_PAGES } from './utils/constants';

const LandingPage = lazy(() => import('./pages/LandingPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const ChatsPage = lazy(() => import('./pages/ChatsPage'));
const SignalsPage = lazy(() => import('./pages/SignalsPage'));
const PositionsPage = lazy(() => import('./pages/PositionsPage'));
const WatchlistPage = lazy(() => import('./pages/WatchlistPage'));
const SimulatorPage = lazy(() => import('./pages/SimulatorPage'));
const TerminalPage = lazy(() => import('./pages/TerminalPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function PageLoader() {
  return (
    <div className="empty-state" style={{ minHeight: '45vh', justifyContent: 'center' }}>
      <div className="empty-state-title">Loading AlphaSignal Workspace...</div>
    </div>
  );
}

function LegacyHashRouterBridge() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const rawHash = window.location.hash || '';
    if (!rawHash || rawHash.includes('id_token=') || rawHash.includes('access_token=')) {
      return;
    }
    const clean = rawHash.replace(/^#/, '').toLowerCase().trim();
    if (!clean) return;

    if (clean === 'landing') {
      navigate('/landing', { replace: true });
    } else if (['features', 'architecture', 'security'].includes(clean)) {
      if (location.pathname !== '/landing') {
        navigate(`/landing#${clean}`, { replace: true });
      }
    } else if (clean === 'login' || clean === 'register') {
      navigate('/login', { replace: true });
    } else if (clean === 'home' || clean === 'dashboard') {
      navigate('/dashboard', { replace: true });
    } else if (clean.startsWith('dashboard/')) {
      const sub = clean.split('/')[1];
      if (sub && DASHBOARD_PAGES.includes(sub)) {
        navigate(`/${sub}`, { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    } else if (DASHBOARD_PAGES.includes(clean)) {
      navigate(`/${clean}`, { replace: true });
    }
  }, [location.hash, location.pathname, navigate]);

  return null;
}

function ProtectedDashboardRoute({ children }) {
  const { user, authReady } = useAuth();
  const { showToast } = useToast();
  const warnedRef = useRef(false);

  const effectiveUser = user || getAuthUser();
  const authorized = isAuthorizedAdmin(effectiveUser);

  useEffect(() => {
    if (authReady && !authorized && !warnedRef.current) {
      warnedRef.current = true;
      showToast(
        'Access Restricted: Please select your authorized administrator account to enter.',
        'warning'
      );
    }
    if (authorized) {
      warnedRef.current = false;
    }
  }, [authReady, authorized, showToast]);

  if (!authReady) {
    return <PageLoader />;
  }

  if (!authorized) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <>
      <LegacyHashRouterBridge />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/landing" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<Navigate to="/login" replace />} />

          <Route
            path="/"
            element={
              <ProtectedDashboardRoute>
                <DashboardLayout />
              </ProtectedDashboardRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<OverviewPage />} />
            <Route path="chats" element={<ChatsPage />} />
            <Route path="signals" element={<SignalsPage />} />
            <Route path="positions" element={<PositionsPage />} />
            <Route path="watchlist" element={<WatchlistPage />} />
            <Route path="simulator" element={<SimulatorPage />} />
            <Route path="terminal" element={<TerminalPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
      <QuickSettingsModal />
      <JsonInspectorModal />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AlphaSignalProvider>
            <AppRoutes />
          </AlphaSignalProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
