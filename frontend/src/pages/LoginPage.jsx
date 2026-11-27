import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Lock, Settings, ShieldCheck } from 'lucide-react';
import Particles from '../components/reactbits/Particles/Particles';
import SpotlightCard from '../components/reactbits/SpotlightCard/SpotlightCard';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useReducedMotion } from '../hooks/useReducedMotion';

export default function LoginPage() {
  const {
    googleClientId,
    processGoogleAuthPayload,
    triggerGoogleOAuthRedirect,
    handleDashboardAccess,
  } = useAuth();
  const { openQuickSettings } = useAlphaSignal();
  const { showToast } = useToast();
  const reducedMotion = useReducedMotion();

  const gisContainerRef = useRef(null);
  const [gisRendered, setGisRendered] = useState(false);

  useEffect(() => {
    if (!googleClientId) return undefined;
    let cancelled = false;
    let pollTimer = null;

    const tryInitGis = () => {
      if (cancelled) return true;
      const gsi = window.google?.accounts?.id;
      const container = gisContainerRef.current;
      if (gsi && container) {
        try {
          gsi.initialize({
            client_id: googleClientId,
            callback: (response) => {
              if (!response?.credential) {
                showToast('No Google credential returned.', 'error');
                return;
              }
              processGoogleAuthPayload({ credential: response.credential });
            },
            auto_select: false,
            cancel_on_tap_outside: true,
          });
          container.innerHTML = '';
          gsi.renderButton(container, {
            theme: 'outline',
            size: 'large',
            type: 'standard',
            shape: 'rectangular',
            text: 'continue_with',
            logo_alignment: 'left',
            width: 320,
          });
          setGisRendered(true);
          return true;
        } catch (e) {
          console.warn('GIS init warning:', e);
        }
      }
      return false;
    };

    if (!tryInitGis()) {
      let attempts = 0;
      pollTimer = setInterval(() => {
        attempts += 1;
        if (tryInitGis() || attempts > 20) {
          clearInterval(pollTimer);
        }
      }, 200);
    }

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [googleClientId, processGoogleAuthPayload, showToast]);

  return (
    <div id="view-login" className="spa-view" style={{ position: 'relative' }}>
      {!reducedMotion && (
        <Particles
          className="particles-bg-layer"
          particleCount={35}
          particleSpread={10}
          speed={0.05}
          particleColors={['#3b82f6', '#38bdf8', '#8b5cf6']}
          alphaParticles
          particleBaseSize={65}
        />
      )}

      <div className="auth-page-container view-foreground">
        <SpotlightCard
          className="auth-box"
          spotlightColor="rgba(59, 130, 246, 0.22)"
          intensity={0.14}
          borderGlow={0.5}
          flare={false}
        >
          <div className="auth-box-top">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleDashboardAccess}
            >
              <ArrowLeft size={14} />
              Enter Dashboard
            </button>
            <div className="brand-logo auth-box-logo">α</div>
          </div>

          <div className="auth-box-heading">
            <h2 className="auth-box-title" id="auth-view-title">
              Admin Access Vault
            </h2>
            <p className="auth-box-subtitle" id="auth-view-subtitle">
              Restricted to authorized administrator Google accounts
            </p>
          </div>

          <div className="auth-notice">
            <div className="auth-notice-title">
              <ShieldCheck size={16} />
              Strict Google OAuth Whitelist
            </div>
            Access requires authenticating via Google. Only the following whitelisted Google
            accounts are permitted:
            <ul className="auth-notice-list">
              <li>rxxxxxxh.fxxxxe@gmail.com</li>
              <li>axxxxxx6@gmail.com</li>
            </ul>
          </div>

          {/* Google OAuth Official Sign-In Button */}
          <div id="g_id_signin_container" ref={gisContainerRef} className="auth-google-gis" />

          {!gisRendered && (
            <button
              type="button"
              className="btn w-full auth-google-btn"
              id="google-direct-auth-btn"
              onClick={triggerGoogleOAuthRedirect}
            >
              <svg style={{ width: 20, height: 20 }} viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              Sign In with Google
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary w-full auth-settings-link"
            onClick={openQuickSettings}
          >
            <Settings size={14} />
            Configure Engine Backend URL
          </button>

          <div className="auth-footnote">
            <Lock size={14} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              <b>Zero-Knowledge Security</b>: Only <code>rxxxxxxxh.fxxxxxe@gmail.com</code> and{' '}
              <code>axxxxxx6@gmail.com</code> are permitted to execute trades or configure keys. All
              credentials are AES-256 encrypted at rest.
            </span>
          </div>
        </SpotlightCard>
      </div>
    </div>
  );
}
