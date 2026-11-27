import { useEffect } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { TradeCard } from '../components/common/TradeCard';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { useToast } from '../context/ToastContext';
import { updateTradeStatusManual } from '../services/alphaSignalApi';

const TRADE_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PENDING', label: 'Pending' },
  { key: 'TP_HIT', label: 'TP Hit' },
  { key: 'SL_HIT', label: 'SL Hit' },
];

export default function WatchlistPage() {
  const {
    trades,
    tradesLoaded,
    tradeFilter,
    setTradeFilter,
    highlightTradeId,
    setHighlightTradeId,
    loadTrades,
    loadMessages,
    loadStats,
  } = useAlphaSignal();
  const { showToast } = useToast();

  // Scroll to highlighted trade card when jumped from signal card/table
  useEffect(() => {
    if (!highlightTradeId || trades.length === 0) return undefined;
    const scrollTimer = setTimeout(() => {
      const card = document.getElementById(`trade-card-${highlightTradeId}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);

    const clearTimer = setTimeout(() => {
      setHighlightTradeId(null);
    }, 2600);

    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(clearTimer);
    };
  }, [highlightTradeId, trades.length, setHighlightTradeId]);

  const handleManualCancel = async (tradeId, newStatus) => {
    if (!newStatus) return;
    try {
      const { ok, data } = await updateTradeStatusManual(tradeId, {
        status: newStatus,
        notes: `Manual operator outcome update to ${newStatus}`,
      });
      if (ok) {
        showToast(`Outcome updated to ${newStatus}`, 'success');
        loadTrades();
        loadMessages();
        loadStats();
      } else {
        showToast('Error: ' + (data?.detail || 'Failed to update outcome'), 'error');
      }
    } catch (e) {
      showToast('Request failed: ' + e.message, 'error');
    }
  };

  return (
    <div id="page-watchlist" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">Trade Lifecycle Watchlist</h2>
          <p className="page-header-desc">
            Complete state machine audit trail: pending taps, active trades, 1:1 Breakeven hits, and
            closures
          </p>
        </div>
        <div className="page-header-actions">
          <div className="filter-group" role="group" aria-label="Trade status filter">
            {TRADE_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                className={`filter-btn${tradeFilter === f.key ? ' active' : ''}`}
                onClick={() => setTradeFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadTrades()}
          >
            <RefreshCw size={13} />
            Refresh
          </button>
        </div>
      </div>

      <div id="watchlist-container" className="watchlist-container">
        {!tradesLoaded ? (
          <>
            <div className="trade-tracker-card skeleton-card skeleton" style={{ opacity: 0.5 }} />
            <div className="trade-tracker-card skeleton-card skeleton" style={{ opacity: 0.35 }} />
          </>
        ) : trades.length === 0 ? (
          <div className="empty-state">
            <ShieldCheck size={36} style={{ opacity: 0.5 }} />
            <p>No trades matching filter ({tradeFilter}).</p>
            <p className="empty-state-sub">
              Simulate a trade setup or receive a Telegram broadcast to track lifecycle states.
            </p>
          </div>
        ) : (
          trades.map((trade) => (
            <TradeCard
              key={trade.trade_id}
              trade={trade}
              isHighlighted={highlightTradeId === trade.trade_id}
              onManualCancel={handleManualCancel}
            />
          ))
        )}
      </div>
    </div>
  );
}
