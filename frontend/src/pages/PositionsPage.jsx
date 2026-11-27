import { useMemo, useState } from 'react';
import { Activity, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { closeXmPosition } from '../services/alphaSignalApi';

export default function PositionsPage() {
  const { xmPositionsData, loadXmPositions, appendLog } = useAlphaSignal();
  const { positions, count, account } = xmPositionsData;

  const [closeLotsMap, setCloseLotsMap] = useState({});
  const [closingTickets, setClosingTickets] = useState({});

  const totalProfit = useMemo(
    () => positions.reduce((sum, p) => sum + Number(p.profit || 0), 0),
    [positions]
  );

  const handleClosePosition = async (ticket) => {
    const rawVal = closeLotsMap[ticket];
    const lots = rawVal !== undefined && rawVal !== '' ? parseFloat(rawVal) : null;
    const volText = lots ? `${lots} lots` : 'this position';

    if (!window.confirm(`Are you sure you want to close ${volText} on MT5 Ticket #${ticket}?`)) {
      return;
    }

    setClosingTickets((prev) => ({ ...prev, [ticket]: true }));
    try {
      const { ok, data } = await closeXmPosition({ ticket, lots });
      if (!ok || data?.error) {
        window.alert(
          'Failed to close position: ' + (data?.detail || data?.error || 'Unknown error')
        );
        return;
      }
      appendLog(
        'SIGNAL',
        'XM_EXECUTION',
        `SUCCESS: Closed ${data.closed_lots} lots on #${ticket} (${data.status}).`
      );
      await loadXmPositions();
    } catch (err) {
      console.error('Error closing position:', err);
      window.alert('Network or server error while closing position: ' + err.message);
    } finally {
      setClosingTickets((prev) => ({ ...prev, [ticket]: false }));
    }
  };

  return (
    <div id="page-positions" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <div className="trade-head-row">
            <h2 className="page-header-title">Live MT5 Positions</h2>
            <span className="settings-chip settings-chip-amber" id="xm-account-badge">
              XM MT5 Demo
            </span>
          </div>
          <p className="page-header-desc">
            Autonomous hands-off order execution with 0.02 Gold / 0.04 Bitcoin lot normalization and
            1:1 Breakeven trailing
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadXmPositions()}
          >
            <RefreshCw size={13} />
            Refresh Positions
          </button>
        </div>
      </div>

      <div id="xm-positions-meta" className="xm-positions-meta">
        <div>
          <span className="meta-label">Server:</span>{' '}
          <strong id="xm-meta-server">{account?.server || 'XMGlobal-MT5'}</strong>
        </div>
        <div>
          <span className="meta-label">Account:</span>{' '}
          <strong id="xm-meta-account">#{account?.login || 'Demo'}</strong>
        </div>
        <div>
          <span className="meta-label">Open Positions:</span>{' '}
          <strong id="xm-meta-count" style={{ color: 'var(--success-text)' }}>
            {count}
          </strong>
        </div>
        <div>
          <span className="meta-label">Floating PnL:</span>{' '}
          <strong
            id="xm-meta-pnl"
            style={{ color: totalProfit >= 0 ? '#10b981' : '#ef4444' }}
          >
            {totalProfit >= 0 ? '+$' : '-$'}
            {Math.abs(totalProfit).toFixed(2)}
          </strong>
        </div>
      </div>

      <div id="positions-container">
        {positions.length === 0 ? (
          <div className="empty-state">
            <ShieldCheck size={34} style={{ color: 'var(--success-text)' }} />
            <div className="empty-state-title">No Active Running Trades in XM MT5</div>
            <div className="empty-state-sub">
              When a pending setup activates or a direct market order arrives, it executes
              automatically on XM MT5 with strict SL, TP, and lot size.
            </div>
          </div>
        ) : (
          <div className="pos-list">
            {positions.map((p) => {
              const isBuy = (p.type || 'BUY') === 'BUY';
              const profit = Number(p.profit || 0);
              const profitColor = profit >= 0 ? 'var(--success-text)' : 'var(--danger-text)';
              const profitSign = profit >= 0 ? '+' : '';
              const isClosing = Boolean(closingTickets[p.ticket]);
              const currentLotsVal = closeLotsMap[p.ticket] ?? String(p.volume);

              return (
                <div className="pos-card" key={p.ticket}>
                  <div className="pos-card-top">
                    <div className="trade-head-row">
                      <span className="pos-id">#{p.ticket}</span>
                      <span
                        className="pos-symbol"
                        style={{ color: isBuy ? 'var(--success-text)' : 'var(--danger-text)' }}
                      >
                        {p.type} {p.symbol}
                      </span>
                      <span className="pos-lots">{p.volume} Lots</span>
                    </div>
                    <div className="pos-pnl" style={{ color: profitColor }}>
                      {profitSign}${profit.toFixed(2)}
                    </div>
                  </div>

                  <div className="pos-grid">
                    <div>
                      <div className="pos-grid-label">Open Price</div>
                      <div className="pos-grid-value">{p.price_open}</div>
                    </div>
                    <div>
                      <div className="pos-grid-label">Market Price</div>
                      <div className="pos-grid-value">{p.price_current}</div>
                    </div>
                    <div>
                      <div className="pos-grid-label">Stop Loss (SL)</div>
                      <div className="pos-grid-value" style={{ color: 'var(--danger-text)' }}>
                        {p.sl || 'Open'}
                      </div>
                    </div>
                    <div>
                      <div className="pos-grid-label">Take Profit (TP)</div>
                      <div className="pos-grid-value" style={{ color: 'var(--success-text)' }}>
                        {p.tp || 'Open'}
                      </div>
                    </div>
                  </div>

                  <div
                    className="pos-actions"
                    style={{
                      marginTop: 10,
                      paddingTop: 10,
                      borderTop: '1px solid rgba(255,255,255,0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 }}>
                        Lots:
                      </span>
                      <input
                        type="number"
                        id={`close-lots-${p.ticket}`}
                        step="0.01"
                        min="0.01"
                        max={p.volume}
                        value={currentLotsVal}
                        onChange={(e) =>
                          setCloseLotsMap((prev) => ({ ...prev, [p.ticket]: e.target.value }))
                        }
                        aria-label={`Lots to close for ticket ${p.ticket}`}
                        style={{
                          width: 64,
                          padding: '4px 6px',
                          fontSize: 12,
                          background: 'rgba(0,0,0,0.3)',
                          border: '1px solid var(--border-color)',
                          borderRadius: 4,
                          color: '#fff',
                          textAlign: 'center',
                        }}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        style={{ fontSize: 10, padding: '3px 6px' }}
                        onClick={() =>
                          setCloseLotsMap((prev) => ({
                            ...prev,
                            [p.ticket]: (Number(p.volume) / 2).toFixed(2),
                          }))
                        }
                      >
                        50%
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        style={{ fontSize: 10, padding: '3px 6px' }}
                        onClick={() =>
                          setCloseLotsMap((prev) => ({ ...prev, [p.ticket]: String(p.volume) }))
                        }
                      >
                        100%
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      id={`btn-close-${p.ticket}`}
                      disabled={isClosing}
                      style={{
                        fontSize: 11,
                        padding: '4px 10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      onClick={() => handleClosePosition(p.ticket)}
                    >
                      {isClosing ? (
                        <>
                          <span className="spin" style={{ display: 'inline-block' }}>
                            ⏳
                          </span>{' '}
                          Closing...
                        </>
                      ) : (
                        <>
                          <XCircle size={12} />
                          Close Trade
                        </>
                      )}
                    </button>
                  </div>

                  <div className="pos-footer" style={{ marginTop: 8 }}>
                    <span>Opened: {p.time || 'Recently'}</span>
                    <span className="pos-handsoff">
                      <Activity size={10} />
                      Auto 1:1 Monitored
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
