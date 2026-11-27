import { Suspense, lazy, useEffect, useRef } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { JsonInspectorModal } from './components/modals/JsonInspectorModal';
import { QuickSettingsModal } from './components/modals/QuickSettingsModal';
import { AlphaSignalProvider } from './context/AlphaSignalContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { DashboardLayout } from './layouts/DashboardLayout';
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
      <div className="empty-state-title">Verifying Session...</div>
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

function ProtectedRoute({ children }) {
  const { isAuthenticated, authReady } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const warnedRef = useRef(false);

  useEffect(() => {
    if (authReady && !isAuthenticated && !warnedRef.current) {
      warnedRef.current = true;
      if (location.pathname !== '/' && location.pathname !== '/dashboard') {
        showToast(
          'Authentication required. Please sign in with your authorized Google account.',
          'warning'
        );
      }
    }
    if (isAuthenticated) {
      warnedRef.current = false;
    }
  }, [authReady, isAuthenticated, location.pathname, showToast]);

  if (!authReady) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function AppRoutes() {
  return (
    <>
      <LegacyHashRouterBridge />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<Navigate to="/login" replace />} />

          <Route
            path="/landing"
            element={
              <ProtectedRoute>
                <LandingPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardLayout />
              </ProtectedRoute>
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

          <Route path="*" element={<Navigate to="/login" replace />} />
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
