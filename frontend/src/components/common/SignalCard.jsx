import { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Code,
  Cpu,
  MessageCircle,
  RefreshCw,
  Tag,
} from 'lucide-react';
import SpotlightCard from '../reactbits/SpotlightCard/SpotlightCard';
import { useAlphaSignal } from '../../context/AlphaSignalContext';
import {
  formatTpLevels,
  getOutcomeBadgeClass,
  getSignalClassification,
} from '../../utils/badgeUtils';
import { formatLocalTime } from '../../utils/dateUtils';
import { SignalImage } from './SignalImage';

function SignalCardComponent({ msg }) {
  const navigate = useNavigate();
  const { openJsonInspector, setHighlightTradeId } = useAlphaSignal();

  const {
    action,
    isChatter,
    isBuy,
    isSell,
    isUpdate,
    cardClass,
    badgeClass,
    spotlightColor,
  } = getSignalClassification(msg);

  const timeFormatted = msg.created_at
    ? formatLocalTime(msg.created_at, true) || 'Just now'
    : 'Just now';
  const confidence = msg.confidence || 0;
  const tpDisplay = formatTpLevels(msg.tp_levels, 'N/A');

  const BadgeIcon = isBuy
    ? ArrowUpRight
    : isSell
      ? ArrowDownRight
      : isUpdate
        ? RefreshCw
        : MessageCircle;

  const handleJumpToTrade = () => {
    if (!msg.trade_id) return;
    setHighlightTradeId(msg.trade_id);
    navigate('/watchlist');
  };

  return (
    <SpotlightCard
      className={cardClass}
      id={`msg-card-${msg.message_id}`}
      spotlightColor={spotlightColor}
      intensity={0.14}
      borderGlow={0.45}
      spotlightSize={260}
      flare={false}
    >
      <div className="signal-card-header">
        <div className="signal-card-meta">
          <span className="sender-tag">{msg.sender || 'Channel Owner'}</span>
          <span className="signal-card-meta-sub">
            in {msg.channel_title || 'Channel'}
          </span>
        </div>
        <div className="signal-card-meta-right">
          <span className="source-pill">{msg.source || 'telegram'}</span>
          <span>{timeFormatted}</span>
        </div>
      </div>

      {/* Raw Telegram Message */}
      <div className="raw-message-box">
        {msg.text || '[Image Broadcast]'}
        <SignalImage mediaPath={msg.media_path} />
      </div>

      {/* AI Interpretation Box */}
      <div className="ai-box">
        {msg.trade_id && (
          <div className="trade-link-row">
            <button
              type="button"
              className="trade-id-pill"
              onClick={handleJumpToTrade}
              title="Click to view full lifecycle in Trade Watchlist"
            >
              <Tag size={11} /> #{msg.trade_id}
            </button>
            {msg.trade_status && (
              <span className={`outcome-badge ${getOutcomeBadgeClass(msg.trade_status)}`}>
                {msg.trade_outcome || msg.trade_status}
              </span>
            )}
          </div>
        )}

        <div className="ai-box-header">
          <div className="ai-box-head-row">
            <span className={badgeClass}>
              <BadgeIcon size={13} />
              {isChatter ? 'CHATTER / FILTERED' : `${action} ${msg.symbol || ''}`}
            </span>
            {msg.symbol && !isChatter && <span className="symbol-badge">{msg.symbol}</span>}
          </div>
          <div
            className="confidence-label"
            style={{
              color: confidence > 80 ? 'var(--success-text)' : 'var(--warning-text)',
            }}
          >
            {confidence}% Confidence
          </div>
        </div>

        {!isChatter && (
          <div className="params-grid">
            <div className="param-item">
              <div className="param-title">Order Type</div>
              <div className="param-value">{msg.order_type || 'MARKET'}</div>
            </div>
            <div className="param-item">
              <div className="param-title">Entry Price</div>
              <div className={`param-value ${isBuy ? 'green' : 'red'}`}>
                {msg.entry_price || 'CMP'}
              </div>
            </div>
            <div className="param-item">
              <div className="param-title">Stop Loss (SL)</div>
              <div className="param-value red">{msg.sl || 'Open / BE'}</div>
            </div>
            <div className="param-item">
              <div className="param-title">Take Profit (TP)</div>
              <div className="param-value green" title={tpDisplay}>
                {tpDisplay}
              </div>
            </div>
          </div>
        )}

        <div className="reasoning-text">
          <span className="ai-intent-label">AI Intent:</span>{' '}
          {msg.reasoning || 'Analyzed intent.'}
        </div>

        <div className="meta-footer">
          <div>
            <Cpu
              size={12}
              style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }}
            />
            {msg.model_used || 'Smart Engine'} &bull; {msg.processing_time_ms || 12}ms
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => openJsonInspector(msg)}
          >
            <Code size={12} /> Inspect Raw JSON
          </button>
        </div>
      </div>
    </SpotlightCard>
  );
}

export const SignalCard = memo(SignalCardComponent);
