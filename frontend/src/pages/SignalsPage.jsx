import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownRight,
  ArrowUpRight,
  Code,
  History,
  Radio,
  RefreshCw,
} from 'lucide-react';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { isValidTradeSignal } from '../utils/badgeUtils';
import { formatLocalTime } from '../utils/dateUtils';

export default function SignalsPage() {
  const {
    messages,
    signalsDirectionFilter,
    setSignalsDirectionFilter,
    loadMessages,
    openJsonInspector,
    setHighlightTradeId,
  } = useAlphaSignal();
  const navigate = useNavigate();

  const signals = useMemo(() => {
    let list = messages.filter(isValidTradeSignal);
    if (signalsDirectionFilter === 'BUY') {
      list = list.filter((s) => (s.action || '').includes('BUY') || s.action === 'LONG');
    } else if (signalsDirectionFilter === 'SELL') {
      list = list.filter((s) => (s.action || '').includes('SELL') || s.action === 'SHORT');
    }
    return list;
  }, [messages, signalsDirectionFilter]);

  const jumpToWatchlist = (tradeId) => {
    if (!tradeId) return;
    setHighlightTradeId(tradeId);
    navigate('/watchlist');
  };

  return (
    <div id="page-signals" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">Detected Trading Signals</h2>
          <p className="page-header-desc">
            AI-validated trading setups with entry, Stop Loss, Take Profit, and confidence ratings
          </p>
        </div>
        <div className="page-header-actions">
          <div className="filter-group" role="group" aria-label="Signal direction filter">
            {[
              { key: 'ALL', label: 'All Signals' },
              { key: 'BUY', label: 'BUY Only' },
              { key: 'SELL', label: 'SELL Only' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`filter-btn${signalsDirectionFilter === item.key ? ' active' : ''}`}
                onClick={() => setSignalsDirectionFilter(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadMessages()}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div className="panel-container">
        <div id="signals-workspace-container" className="signals-workspace-container">
          {signals.length === 0 ? (
            <div className="empty-state" style={{ padding: '3rem' }}>
              <Radio size={36} style={{ color: 'var(--primary)', opacity: 0.5 }} />
              <div className="empty-state-title">
                No Trade Signals Found ({signalsDirectionFilter})
              </div>
              <div className="empty-state-sub">
                When Telegram broadcasts or simulator setups arrive, validated trade setups display
                here with entry, SL, TP, and confidence.
              </div>
            </div>
          ) : (
            <div className="signals-table-wrap">
              <table className="signals-table">
                <thead>
                  <tr>
                    <th>Asset / Symbol</th>
                    <th>Direction</th>
                    <th>Order Type</th>
                    <th>Entry Price</th>
                    <th>Stop Loss</th>
                    <th>Take Profit</th>
                    <th>Confidence</th>
                    <th>Latency</th>
                    <th>Source / Time</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s) => {
                    const isBuy = (s.action || '').includes('BUY') || s.action === 'LONG';
                    const tpText =
                      Array.isArray(s.tp_levels) && s.tp_levels.length > 0
                        ? s.tp_levels.join(' | ')
                        : s.tp || '1:2 Target';

                    return (
                      <tr key={s.message_id || `${s.symbol}-${s.created_at}`}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="symbol-badge">{s.symbol || 'XAUUSD'}</span>
                            {s.trade_id && (
                              <button
                                type="button"
                                className="trade-id-pill"
                                onClick={() => jumpToWatchlist(s.trade_id)}
                              >
                                #{s.trade_id}
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className={`intent-badge ${isBuy ? 'buy' : 'sell'}`}>
                            {isBuy ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                            {s.action || 'BUY'}
                          </span>
                        </td>
                        <td>
                          <span className="source-pill">{s.order_type || 'MARKET'}</span>
                        </td>
                        <td>
                          <strong
                            style={{
                              fontFamily: 'var(--font-mono)',
                              color: isBuy ? 'var(--success-text)' : 'var(--danger-text)',
                            }}
                          >
                            {s.entry_price || 'CMP'}
                          </strong>
                        </td>
                        <td>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--danger-text)',
                            }}
                          >
                            {s.sl || 'Open / BE'}
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--success-text)',
                            }}
                            title={tpText}
                          >
                            {tpText}
                          </span>
                        </td>
                        <td>
                          <span
                            className="confidence-label"
                            style={{
                              color:
                                (s.confidence || 95) > 80
                                  ? 'var(--success-text)'
                                  : 'var(--warning-text)',
                            }}
                          >
                            {s.confidence || 95}%
                          </span>
                        </td>
                        <td>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.72rem',
                              color: 'var(--info-text)',
                            }}
                          >
                            {s.processing_time_ms || 210}ms
                          </span>
                        </td>
                        <td>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                            {s.channel_title || 'Telegram'} &bull;{' '}
                            {s.created_at ? formatLocalTime(s.created_at, false) || 'Now' : 'Now'}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-xs"
                              onClick={() => openJsonInspector(s)}
                              title="Inspect Raw AI Extraction"
                            >
                              <Code size={12} />
                            </button>
                            {s.trade_id && (
                              <button
                                type="button"
                                className="btn btn-secondary btn-xs"
                                onClick={() => jumpToWatchlist(s.trade_id)}
                                title="View Lifecycle Audit"
                              >
                                <History size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
