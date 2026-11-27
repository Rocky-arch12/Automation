import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Cpu,
  LayoutDashboard,
  Lock,
  Menu,
  Radio,
  Settings,
  ShieldCheck,
} from 'lucide-react';
import BlurText from '../components/reactbits/BlurText/BlurText';
import ClickSpark from '../components/reactbits/ClickSpark/ClickSpark';
import Particles from '../components/reactbits/Particles/Particles';
import ShinyText from '../components/reactbits/ShinyText/ShinyText';
import SpotlightCard from '../components/reactbits/SpotlightCard/SpotlightCard';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { useAuth } from '../context/AuthContext';
import { useReducedMotion } from '../hooks/useReducedMotion';

export default function LandingPage() {
  const { handleDashboardAccess } = useAuth();
  const { openQuickSettings } = useAlphaSignal();
  const navigate = useNavigate();
  const location = useLocation();
  const reducedMotion = useReducedMotion();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Scroll to anchor if navigated with hash (#features, #architecture, #security)
  useEffect(() => {
    const raw = (location.hash || '').replace('#', '');
    if (raw && ['features', 'architecture', 'security'].includes(raw)) {
      const el = document.getElementById(raw);
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' }), 60);
      }
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [location.hash, reducedMotion]);

  const scrollToSection = (e, id) => {
    e.preventDefault();
    setMobileMenuOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
  };

  return (
    <div id="view-landing" className="spa-view" style={{ position: 'relative' }}>
      {!reducedMotion && (
        <Particles
          className="particles-bg-layer"
          particleCount={50}
          particleSpread={10}
          speed={0.07}
          particleColors={['#3b82f6', '#8b5cf6', '#38bdf8', '#10b981']}
          moveParticlesOnHover
          particleHoverFactor={0.8}
          alphaParticles
          particleBaseSize={75}
          twinkle={0.25}
        />
      )}

      <div className="view-foreground">
        <nav className={`landing-nav${mobileMenuOpen ? ' open' : ''}`} id="landing-nav">
          <div
            className="brand-area"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate('/landing')}
          >
            <div className="brand-logo">α</div>
            <div>
              <h1 className="brand-title">AlphaSignal AI</h1>
              <p className="brand-tagline">Autonomous Telegram Signal Intelligence &amp; MT5 Engine</p>
            </div>
          </div>

          <button
            type="button"
            className="landing-menu-btn"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            <Menu size={20} />
          </button>

          <div className="landing-nav-links">
            <a
              href="#features"
              className="landing-nav-link"
              onClick={(e) => scrollToSection(e, 'features')}
            >
              Features
            </a>
            <a
              href="#architecture"
              className="landing-nav-link"
              onClick={(e) => scrollToSection(e, 'architecture')}
            >
              1:1 Trailing
            </a>
            <a
              href="#security"
              className="landing-nav-link"
              onClick={(e) => scrollToSection(e, 'security')}
            >
              Security Vault
            </a>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setMobileMenuOpen(false);
                openQuickSettings();
              }}
              title="Engine & Backend Connection Settings"
            >
              <Settings size={14} />
              <span className="btn-text">Settings</span>
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setMobileMenuOpen(false);
                handleDashboardAccess();
              }}
            >
              <LayoutDashboard size={14} />
              <span className="btn-text">Open Dashboard &rarr;</span>
            </button>
          </div>
        </nav>

        <header className="landing-hero">
          <div className="landing-badge">
            <span className="pulse-dot" style={{ margin: 0 }} />
            <ShinyText
              text="Next-Gen Multi-Tenant Trading Infrastructure"
              color="#38bdf8"
              shineColor="#ffffff"
              speed={3}
              disabled={reducedMotion}
            />
          </div>

          <div role="heading" aria-level={1}>
            <BlurText
              text="Transform Telegram Signal Chaos Into Flawless, Automated MT5 Trades"
              delay={55}
              animateBy="words"
              direction="top"
              trigger="load"
              className="landing-title-blur"
              color="#f8fafc"
              fromColor="#94a3b8"
              stepDuration={0.32}
            />
          </div>

          <p className="landing-subtitle">
            Zero-noise AI intent parsing, strict 0.02 lot Gold / 0.04 lot Bitcoin sizing, automated
            1:1 Breakeven scale-out with 1:2 expansion, multi-channel Telegram harvesting, and
            zero-knowledge AES-256 encrypted profiles.
          </p>

          <ClickSpark
            sparkColor={['#38bdf8', '#3b82f6', '#10b981']}
            sparkSize={12}
            sparkRadius={26}
            sparkCount={8}
            duration={420}
            disabled={reducedMotion}
          >
            <div className="landing-cta-group">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={handleDashboardAccess}
              >
                <LayoutDashboard size={18} />
                Launch Live Dashboard
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-lg"
                onClick={() => navigate('/login')}
              >
                <ShieldCheck size={18} style={{ color: 'var(--info-text)' }} />
                Authorized Sign In &rarr;
              </button>
            </div>
          </ClickSpark>

          {/* Live Interactive Signal Execution Preview */}
          <div className="landing-preview-container" id="architecture">
            <div className="preview-header">
              <div className="preview-header-title">
                <Radio size={16} style={{ color: 'var(--info-text)' }} />
                <span className="preview-header-label">
                  LIVE ENGINE TELEMETRY &amp; TRAILING LOGIC
                </span>
              </div>
              <span className="preview-tag preview-tag-success">1:1 Scale-Out Active</span>
            </div>

            <div className="preview-trade-block">
              <div className="preview-trade-top">
                <div className="preview-trade-id">
                  <span className="preview-symbol">XAUUSD (GOLD)</span>
                  <span className="preview-lot-pill">BUY 0.02 LOTS</span>
                </div>
                <div className="preview-status-pill">
                  <CheckCircle2 size={13} />
                  1:1 HIT: 0.01 EXITED • SL @ BREAKEVEN • TP @ 1:2
                </div>
              </div>

              <div className="preview-trade-prices">
                <div>
                  &bull; Entry: <span className="preview-pr-strong">2640.50</span> &nbsp;|&nbsp;
                  Initial SL: <span className="preview-pr-red">2634.00</span> (Distance: $6.50)
                </div>
                <div>
                  &bull; Trailed SL: <span className="preview-pr-green">2640.50 (Break Even)</span>{' '}
                  &nbsp;|&nbsp; Extended TP:{' '}
                  <span className="preview-pr-blue">2653.50 (1:2 Target)</span>
                </div>
              </div>

              <div className="preview-grid">
                <div className="preview-stat">
                  <div className="preview-stat-label">AI Processing Latency</div>
                  <div className="preview-stat-value" style={{ color: 'var(--info-text)' }}>
                    210 ms
                  </div>
                </div>
                <div className="preview-stat">
                  <div className="preview-stat-label">Intent Confidence</div>
                  <div className="preview-stat-value" style={{ color: 'var(--success-text)' }}>
                    99.4%
                  </div>
                </div>
                <div className="preview-stat">
                  <div className="preview-stat-label">Lot Size Normalization</div>
                  <div className="preview-stat-value" style={{ color: 'var(--warning-text)' }}>
                    0.02 Fixed
                  </div>
                </div>
                <div className="preview-stat">
                  <div className="preview-stat-label">Risk Profile</div>
                  <div className="preview-stat-value" style={{ color: 'var(--primary)' }}>
                    Risk-Free (BE)
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Features Section */}
        <section className="landing-features-grid" id="features">
          <SpotlightCard
            className="feature-card"
            spotlightColor="rgba(59, 130, 246, 0.25)"
            intensity={0.14}
            borderGlow={0.5}
          >
            <div
              className="feature-icon-wrapper"
              style={{ background: 'var(--primary-soft)', color: 'var(--info-text)' }}
            >
              <Cpu size={22} />
            </div>
            <h3 className="feature-title">Zero-Noise LLM Parsing</h3>
            <p className="feature-desc">
              Groq Llama 3.3 and Gemini Vision accurately identify trade intent from trader slang,
              typos, emojis, and raw chart screenshots while rejecting casual chatter.
            </p>
          </SpotlightCard>

          <SpotlightCard
            className="feature-card"
            spotlightColor="rgba(16, 185, 129, 0.25)"
            intensity={0.14}
            borderGlow={0.5}
          >
            <div
              className="feature-icon-wrapper"
              style={{ background: 'var(--success-soft)', color: 'var(--success-text)' }}
            >
              <ShieldCheck size={22} />
            </div>
            <h3 className="feature-title">Automated 1:1 Scale-Out</h3>
            <p className="feature-desc">
              When price hits 1:1 Risk-to-Reward, the engine automatically closes 50% lots, drags
              the Stop Loss directly to entry (Break Even), and stretches Take Profit to 1:2.
            </p>
          </SpotlightCard>

          <SpotlightCard
            className="feature-card"
            spotlightColor="rgba(139, 92, 246, 0.25)"
            intensity={0.14}
            borderGlow={0.5}
          >
            <div
              className="feature-icon-wrapper"
              style={{ background: 'var(--purple-soft)', color: 'var(--purple-text)' }}
            >
              <Radio size={22} />
            </div>
            <h3 className="feature-title">Multi-Channel Telegram Harvester</h3>
            <p className="feature-desc">
              Auto-fetches all your joined Telegram groups and channels. Select and monitor multiple
              sources simultaneously without typing channel IDs.
            </p>
          </SpotlightCard>

          <SpotlightCard
            className="feature-card"
            id="security"
            spotlightColor="rgba(245, 158, 11, 0.25)"
            intensity={0.14}
            borderGlow={0.5}
          >
            <div
              className="feature-icon-wrapper"
              style={{ background: 'var(--warning-soft)', color: 'var(--warning-text)' }}
            >
              <Lock size={22} />
            </div>
            <h3 className="feature-title">AES-256 Zero-Knowledge Vault</h3>
            <p className="feature-desc">
              Every user profile is 100% isolated. XM MT5 credentials, passwords, and API keys are
              stored encrypted at rest using AES-256 with HttpOnly session cookies.
            </p>
          </SpotlightCard>
        </section>

        <footer className="landing-footer">
          <div className="landing-footer-inner">
            <div>&copy; 2026 AlphaSignal AI. Built for institutional-grade autonomous execution.</div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigate('/login')}
            >
              Admin Access
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
