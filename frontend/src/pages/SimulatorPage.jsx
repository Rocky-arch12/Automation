import { useRef, useState } from 'react';
import { Cpu, FlaskConical, ImagePlus, Loader2, Send, Sparkles } from 'lucide-react';
import { SignalCard } from '../components/common/SignalCard';
import ClickSpark from '../components/reactbits/ClickSpark/ClickSpark';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { useToast } from '../context/ToastContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { simulateIncomingSignal } from '../services/alphaSignalApi';
import { SIMULATOR_PRESETS } from '../utils/constants';

export default function SimulatorPage() {
  const { loadMessages, loadStats, loadTrades, loadXmPositions } = useAlphaSignal();
  const { showToast } = useToast();
  const reducedMotion = useReducedMotion();

  const [sender, setSender] = useState('Channel Owner');
  const [channelTitle, setChannelTitle] = useState('VIP Forex & Crypto Signals');
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewSrc, setPreviewSrc] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [textFlash, setTextFlash] = useState(false);

  const [feedbackResult, setFeedbackResult] = useState(null);
  const [rejectedStatus, setRejectedStatus] = useState(null);

  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  const handleInjectPreset = (key) => {
    const upper = String(key || '').toUpperCase().trim();
    const presetText = SIMULATOR_PRESETS[upper] || SIMULATOR_PRESETS[key] || key;
    if (presetText) {
      setText(presetText);
      setTextFlash(true);
      textareaRef.current?.focus();
      setTimeout(() => setTextFlash(false), 500);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (e) => setPreviewSrc(String(e.target?.result || ''));
    reader.readAsDataURL(file);
  };

  const clearFile = (e) => {
    if (e?.stopPropagation) e.stopPropagation();
    setSelectedFile(null);
    setPreviewSrc('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmedText = text.trim();

    if (!trimmedText && !selectedFile) {
      showToast('Please enter message text or attach a chart screenshot.', 'error');
      return;
    }

    setSubmitting(true);
    setRejectedStatus(null);
    try {
      const { ok, status, data } = await simulateIncomingSignal({
        text: trimmedText,
        sender: sender.trim() || 'Channel Owner',
        channelTitle: channelTitle.trim() || 'VIP Signals',
        image: selectedFile,
      });

      if (!ok) {
        const msg = data?.detail || `HTTP ${status}`;
        showToast(
          status === 401
            ? 'Sign in via Google OAuth to run simulations.'
            : `Simulation failed: ${msg}`,
          'error'
        );
        setFeedbackResult(null);
        setRejectedStatus({ status, message: msg });
        return;
      }

      setText('');
      clearFile();
      showToast('Signal simulated & parsed successfully!', 'success');

      if (data?.result) {
        setFeedbackResult(data.result);
      }

      loadMessages();
      loadStats();
      loadTrades();
      loadXmPositions();
    } catch (err) {
      showToast(`Simulation failed: ${err.message}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div id="page-simulator" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">Signal Simulator Workspace</h2>
          <p className="page-header-desc">
            Test real-time AI parsing against raw trader slang, typo-filled text, or chart
            screenshots
          </p>
        </div>
      </div>

      <div className="simulator-layout-grid">
        <div className="panel-container">
          <div className="simulator-presets-bar">
            <div className="presets-label">
              <Sparkles size={13} />
              Instant Signal Presets (10-Message History Intent Classifier)
            </div>
            <div className="presets-row">
              <button
                type="button"
                className="preset-btn preset-pending"
                onClick={() => handleInjectPreset('PENDING')}
              >
                🟡 Pending Signal (Wait for Tap)
              </button>
              <button
                type="button"
                className="preset-btn preset-active"
                onClick={() => handleInjectPreset('ACTIVE_MARKET')}
              >
                🟢 Market Trade (Active Now)
              </button>
              <button
                type="button"
                className="preset-btn preset-confirm"
                onClick={() => handleInjectPreset('ACTIVATE_CONFIRM')}
              >
                ⚡ Owner: &quot;ACTIVE NOW, ENTER CMP!&quot;
              </button>
              <button
                type="button"
                className="preset-btn preset-cancel"
                onClick={() => handleInjectPreset('CANCEL')}
              >
                🛑 Owner: &quot;Cancel Setup / Do Not Enter&quot;
              </button>
              <button
                type="button"
                className="preset-btn preset-chatter"
                onClick={() => handleInjectPreset('CHATTER')}
              >
                💬 Channel Chatter
              </button>
            </div>
          </div>

          <form id="simulator-form" onSubmit={handleSubmit} style={{ padding: '1.25rem' }}>
            <div className="form-row-2col">
              <div className="form-group">
                <label className="form-label" htmlFor="sim-sender">
                  Simulated Sender Name
                </label>
                <input
                  type="text"
                  id="sim-sender"
                  className="form-control"
                  value={sender}
                  onChange={(e) => setSender(e.target.value)}
                  placeholder="e.g. VIP Admin, Owner"
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="sim-channel">
                  Channel Name
                </label>
                <input
                  type="text"
                  id="sim-channel"
                  className="form-control"
                  value={channelTitle}
                  onChange={(e) => setChannelTitle(e.target.value)}
                  placeholder="e.g. ALPHA PREMIUM Signals"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="sim-text">
                Message Content (Text, Slang, Pips, SL/TP, or Casual Chatter)
              </label>
              <textarea
                ref={textareaRef}
                id="sim-text"
                className={`form-control${textFlash ? ' sim-textarea-flash' : ''}`}
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="E.g., BUY GOLD 2640-2642 SL 2634 TP1 2648... or '1:1 DONE book partial' or 'RISK FREE KRDO'"
              />
            </div>

            <div className="form-group">
              <label className="form-label">
                Attach Chart Screenshot / Image (Optional for Vision AI)
              </label>
              <div
                className={`drop-zone${isDragOver ? ' dragover' : ''}`}
                id="drop-zone"
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (e.dataTransfer?.files?.length) {
                    handleFile(e.dataTransfer.files[0]);
                  }
                }}
              >
                <ImagePlus size={28} style={{ color: 'var(--text-muted)' }} />
                <div className="drop-zone-title">Click to upload or drag screenshot here</div>
                <div className="drop-zone-hint">
                  Supports PNG, JPG, WEBP (MT4/5 screenshots, TradingView charts)
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  id="sim-file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files?.length) handleFile(e.target.files[0]);
                  }}
                />
              </div>

              {selectedFile && (
                <div id="file-preview-area" className="file-preview-area">
                  <div className="file-preview-info">
                    <img
                      id="preview-thumbnail"
                      src={previewSrc}
                      className="file-preview-thumb"
                      alt="Selected screenshot preview"
                    />
                    <span id="preview-filename" className="file-preview-name">
                      {selectedFile.name}
                    </span>
                  </div>
                  <button type="button" className="btn btn-danger btn-sm" onClick={clearFile}>
                    Remove
                  </button>
                </div>
              )}
            </div>

            <ClickSpark
              sparkColor={['#3b82f6', '#38bdf8', '#10b981']}
              sparkSize={10}
              sparkRadius={22}
              sparkCount={7}
              duration={380}
              disabled={reducedMotion || submitting}
            >
              <button
                type="submit"
                className="btn btn-primary btn-block btn-lg"
                id="btn-sim-submit"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Analyzing Intent with AI...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Process &amp; Filter with AI
                  </>
                )}
              </button>
            </ClickSpark>
          </form>
        </div>

        {/* Simulation Output Panel */}
        <div className="panel-container">
          <div className="panel-header">
            <div className="panel-title">
              <Cpu size={16} style={{ color: 'var(--info-text)' }} />
              Real-Time Simulation Feedback
            </div>
          </div>
          <div className="panel-body" id="sim-feedback-container" style={{ padding: '1.25rem' }}>
            {rejectedStatus ? (
              <div className="empty-state">
                <div className="empty-state-title" style={{ color: 'var(--danger-text)' }}>
                  Simulation Rejected ({rejectedStatus.status})
                </div>
                <div className="empty-state-sub">{rejectedStatus.message}</div>
              </div>
            ) : feedbackResult ? (
              <SignalCard msg={feedbackResult} />
            ) : (
              <div className="empty-state">
                <FlaskConical
                  size={36}
                  style={{ color: 'var(--info-text)', opacity: 0.5 }}
                />
                <div className="empty-state-title">Simulator Ready</div>
                <div className="empty-state-sub">
                  Select a preset above or enter custom message text, then click &quot;Process
                  &amp; Filter with AI&quot; to inspect intent extraction.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
