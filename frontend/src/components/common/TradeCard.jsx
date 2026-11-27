import { memo, useState } from 'react';
import {
  CheckCircle2,
  History,
  Info,
  Lock,
  ShieldAlert,
  Tag,
  X,
} from 'lucide-react';
import SpotlightCard from '../reactbits/SpotlightCard/SpotlightCard';
import { fetchTradeTimeline } from '../../services/alphaSignalApi';
import { getOutcomeBadgeClass } from '../../utils/badgeUtils';
import { formatLocalTime } from '../../utils/dateUtils';

function TradeCardComponent({ trade, isHighlighted, onManualCancel }) {
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState('');

  const isBuy = (trade.action || '').includes('BUY') || (trade.action || '') === 'LONG';
  const status = trade.status || 'ACTIVE';
  const badgeCls = getOutcomeBadgeClass(status);
  const tpDisplay =
    Array.isArray(trade.tp_levels) && trade.tp_levels.length > 0
      ? trade.tp_levels.join(' | ')
      : 'N/A';

  const defaultLots = trade.symbol?.includes('BTC')
    ? '0.04'
    : trade.symbol && (trade.symbol.includes('XAU') || trade.symbol.includes('GOLD'))
      ? '0.02'
      : '0.01';

  const handleToggleTimeline = async () => {
    if (timelineOpen) {
      setTimelineOpen(false);
      return;
    }
    setTimelineOpen(true);
    setTimelineLoading(true);
    setTimelineError('');
    try {
      const data = await fetchTradeTimeline(trade.trade_id);
      setTimelineEvents(data.events || []);
    } catch (err) {
      setTimelineError(err.message || 'Failed to load events');
    } finally {
      setTimelineLoading(false);
    }
  };

  const isShieldNote =
    trade.pnl_notes &&
    (trade.pnl_notes.includes('SAFETY SHIELD') || trade.pnl_notes.includes('REJECTED'));

  return (
    <SpotlightCard
      id={`trade-card-${trade.trade_id}`}
      className={`trade-tracker-card${isHighlighted ? ' trade-highlight' : ''}`}
      spotlightColor={isBuy ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'}
      intensity={0.12}
      borderGlow={0.4}
      spotlightSize={250}
      flare={false}
    >
      <div className="trade-card-top">
        <div>
          <div className="trade-head-row">
            <span className="trade-id-pill" title="Unique Trade Identifier">
              <Tag size={11} /> #{trade.trade_id}
            </span>
            <span className="trade-card-symbol">
              <span style={{ color: isBuy ? 'var(--success-text)' : 'var(--danger-text)' }}>
                {trade.action || 'BUY'}
              </span>
              <span>{trade.symbol || 'XAUUSD'}</span>
            </span>
            <span className="source-pill">{trade.order_type || 'MARKET'}</span>
          </div>
          <div className="trade-start-meta">
            Started: {trade.created_at ? formatLocalTime(trade.created_at, false) || 'Today' : 'Today'}
            {trade.updated_at && trade.updated_at !== trade.created_at && (
              <> &bull; Updated: {formatLocalTime(trade.updated_at, false)}</>
            )}
          </div>
        </div>
        <div className="trade-outcome-wrap">
          <span className={`outcome-badge ${badgeCls}`}>
            {trade.outcome || trade.status}
          </span>
        </div>
      </div>

      {/* Prices Row */}
      <div className="params-grid params-grid-tight">
        <div className="param-item">
          <div className="param-title">Entry</div>
          <div className={`param-value ${isBuy ? 'green' : 'red'}`}>
            {trade.entry_price || 'CMP'}
          </div>
        </div>
        <div className="param-item">
          <div className="param-title">Stop Loss (SL)</div>
          <div className="param-value red">{trade.sl || 'Open / BE'}</div>
        </div>
        <div className="param-item">
          <div className="param-title">Take Profit (TP)</div>
          <div className="param-value green" title={tpDisplay}>
            {tpDisplay}
          </div>
        </div>
        <div className="param-item">
          <div className="param-title">Risk:Reward</div>
          <div className="param-value blue">{trade.risk_reward || '1:2+'}</div>
        </div>
      </div>

      {trade.xm_ticket ? (
        <div className="xm-execution-receipt">
          <div className="xm-receipt-top">
            <span className="xm-receipt-title">
              <CheckCircle2 size={14} />
              XM MT5 Order Executed
            </span>
            <span className="xm-receipt-ticket">Ticket #{trade.xm_ticket}</span>
          </div>
          <div className="xm-receipt-stats">
            <div>
              Lots: <strong className="xm-stat-strong">{trade.xm_lots || defaultLots}</strong>
            </div>
            <div>
              Fill Price:{' '}
              <strong className="xm-stat-strong">
                {trade.xm_execution_price || trade.entry_price || 'CMP'}
              </strong>
            </div>
            <div>
              SL: <strong style={{ color: 'var(--danger-text)' }}>{trade.sl || 'Open'}</strong>
            </div>
            <div>
              TP: <strong style={{ color: 'var(--success-text)' }}>{tpDisplay}</strong>
            </div>
          </div>
          <div className="xm-receipt-policy">
            🛡️ XM Policy: Running Hands-Off until TP or SL is reached.
          </div>
        </div>
      ) : trade.pnl_notes ? (
        <div className={`pnl-note ${isShieldNote ? 'pnl-note-shield' : 'pnl-note-info'}`}>
          {isShieldNote ? (
            <ShieldAlert size={13} style={{ flexShrink: 0 }} />
          ) : (
            <Info size={13} style={{ flexShrink: 0 }} />
          )}
          <span>{trade.pnl_notes}</span>
        </div>
      ) : null}

      {/* Actions & Timeline Row */}
      <div className="trade-card-actions">
        <button type="button" className="btn btn-secondary btn-xs" onClick={handleToggleTimeline}>
          <History size={12} />
          Timeline ({trade.event_count || 1})
        </button>

        <div className="trade-action-spacer">
          {trade.status === 'PENDING' ? (
            <button
              type="button"
              className="btn btn-danger btn-xs"
              onClick={() => onManualCancel(trade.trade_id, 'CANCELLED')}
            >
              <X size={11} /> Cancel Setup
            </button>
          ) : trade.status === 'EXECUTED' ? (
            <span className="trade-action-state">
              <Lock size={11} /> XM Hands-Off
            </span>
          ) : (
            <span className="trade-action-dim">{trade.outcome || trade.status}</span>
          )}
        </div>
      </div>

      {/* Expandable Timeline Container */}
      {timelineOpen && (
        <div className="trade-timeline-container">
          {timelineLoading ? (
            <div className="timeline-loading">Loading trade lifecycle audit...</div>
          ) : timelineError ? (
            <div className="timeline-error">Failed to load events: {timelineError}</div>
          ) : !timelineEvents || timelineEvents.length === 0 ? (
            <div className="timeline-no-events">No logged events yet.</div>
          ) : (
            <>
              <div className="timeline-audit-title">
                Lifecycle Audit Trail ({timelineEvents.length} events)
              </div>
              {timelineEvents.map((ev, idx) => (
                <div key={`${ev.created_at}-${idx}`} className="trade-timeline-step">
                  <div className="timeline-dot" />
                  <div>
                    <div className="timeline-step-meta">
                      <span
                        className={`outcome-badge outcome-badge-sm ${getOutcomeBadgeClass(ev.new_status)}`}
                      >
                        {ev.new_status}
                      </span>
                      <span className="timeline-step-time">
                        {ev.created_at ? formatLocalTime(ev.created_at, true) : ''}
                      </span>
                    </div>
                    <div className="timeline-step-note">{ev.notes || ''}</div>
                    {ev.text && (
                      <div className="timeline-step-quote">Telegram: &quot;{ev.text}&quot;</div>
                    )}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </SpotlightCard>
  );
}

export const TradeCard = memo(TradeCardComponent);
