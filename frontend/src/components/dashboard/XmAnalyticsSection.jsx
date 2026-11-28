import { useMemo, useState } from 'react';
import {
  Activity,
  Award,
  BarChart2,
  CalendarDays,
  DollarSign,
  Flame,
  Layers,
  Percent,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import CountUp from '../reactbits/CountUp/CountUp';
import SpotlightCard from '../reactbits/SpotlightCard/SpotlightCard';
import { ChartContainer, ChartTooltip } from '../ui/chart';
import { formatLocalTime } from '../../utils/dateUtils';

const DAILY_PNL_CHART_CONFIG = {
  realized_pnl: {
    label: 'Daily Net PnL',
    color: '#10b981',
  },
};

const EQUITY_CHART_CONFIG = {
  ending_balance: {
    label: 'Ending Balance',
    color: '#3b82f6',
  },
  range_cumulative_pnl: {
    label: 'Cumulative PnL',
    color: '#10b981',
  },
};

const RANGE_LABELS = {
  '7d': '7 Days',
  '14d': '14 Days',
  '30d': '30 Days',
  all: 'All Time',
};

function formatSignedCurrency(value, { showPlus = true, decimals = 2 } = {}) {
  const num = Number(value || 0);
  const absFormatted = Math.abs(num).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (num < -0.004) return `-$${absFormatted}`;
  if (num > 0.004 && showPlus) return `+$${absFormatted}`;
  return `$${absFormatted}`;
}

function formatDayFull(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3) return dateStr;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function getCountUpPrefix(value, { showPlus = true } = {}) {
  const num = Number(value || 0);
  if (num < -0.004) return '-$';
  if (num > 0.004 && showPlus) return '+$';
  return '$';
}

function getCloseReasonClass(reason) {
  const r = String(reason || '').toLowerCase();
  if (r.includes('tp')) return 'badge-tp-hit';
  if (r.includes('ctc') || r.includes('1:1')) return 'badge-1to1';
  if (r.includes('sl')) return 'badge-sl-hit';
  if (r.includes('manual')) return 'badge-pending';
  return 'badge-cancelled';
}

function DailyPnlTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const pnl = Number(row.realized_pnl || 0);
  const pnlColor = pnl >= 0 ? 'var(--success-text)' : 'var(--danger-text)';

  return (
    <div className="shadcn-chart-tooltip" style={{ minWidth: '12.5rem' }}>
      <div className="shadcn-chart-tooltip-label" style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span>{formatDayFull(row.date)}</span>
        {row.is_today && <span className="xm-today-pill">TODAY</span>}
      </div>
      <div className="shadcn-chart-tooltip-list">
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">Net PnL</span>
            <span className="shadcn-chart-tooltip-value" style={{ color: pnlColor }}>
              {formatSignedCurrency(pnl)}
            </span>
          </div>
        </div>
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">Trades (W/L)</span>
            <span className="shadcn-chart-tooltip-value">
              {row.closed_trades} ({row.wins}W / {row.losses}L)
            </span>
          </div>
        </div>
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">Win Rate</span>
            <span className="shadcn-chart-tooltip-value">{Number(row.win_rate || 0).toFixed(1)}%</span>
          </div>
        </div>
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">1:1 Secured / Lots</span>
            <span className="shadcn-chart-tooltip-value">
              {row.partial_1to1_hits} &bull; {Number(row.volume_lots || 0).toFixed(2)}L
            </span>
          </div>
        </div>
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">Ending Balance</span>
            <span className="shadcn-chart-tooltip-value">
              {formatSignedCurrency(row.ending_balance, { showPlus: false })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EquityCurveTooltip({ active, payload, curveMode }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  const dayPnl = Number(row.realized_pnl || 0);
  const cumPnl = Number(row.range_cumulative_pnl || 0);

  return (
    <div className="shadcn-chart-tooltip" style={{ minWidth: '12rem' }}>
      <div className="shadcn-chart-tooltip-label">{formatDayFull(row.date)}</div>
      <div className="shadcn-chart-tooltip-list">
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">
              {curveMode === 'balance' ? 'Ending Balance' : 'Range Cum. PnL'}
            </span>
            <span
              className="shadcn-chart-tooltip-value"
              style={{
                color:
                  curveMode === 'balance'
                    ? 'var(--info-text)'
                    : cumPnl >= 0
                      ? 'var(--success-text)'
                      : 'var(--danger-text)',
              }}
            >
              {curveMode === 'balance'
                ? formatSignedCurrency(row.ending_balance, { showPlus: false })
                : formatSignedCurrency(cumPnl)}
            </span>
          </div>
        </div>
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">Day Net PnL</span>
            <span
              className="shadcn-chart-tooltip-value"
              style={{ color: dayPnl >= 0 ? 'var(--success-text)' : 'var(--danger-text)' }}
            >
              {formatSignedCurrency(dayPnl)}
            </span>
          </div>
        </div>
        <div className="shadcn-chart-tooltip-item">
          <div className="shadcn-chart-tooltip-row">
            <span className="shadcn-chart-tooltip-name">Day ROI</span>
            <span className="shadcn-chart-tooltip-value">
              {Number(row.roi_pct || 0) > 0 ? '+' : ''}
              {Number(row.roi_pct || 0).toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function XmAnalyticsSection({
  xmAnalytics,
  xmAnalyticsLoaded,
  xmAnalyticsRange,
  onNavigatePositions,
}) {
  const [curveMode, setCurveMode] = useState('balance');

  const account = xmAnalytics?.account || {};
  const summary = xmAnalytics?.summary || {};
  const dailyMetrics = useMemo(() => xmAnalytics?.daily_metrics || [], [xmAnalytics]);
  const symbolBreakdown = useMemo(() => xmAnalytics?.symbol_breakdown || [], [xmAnalytics]);
  const recentClosedTrades = useMemo(
    () => xmAnalytics?.recent_closed_trades || [],
    [xmAnalytics]
  );

  const dailyMetricsDesc = useMemo(
    () => [...dailyMetrics].reverse(),
    [dailyMetrics]
  );

  const isLiveMt5 = xmAnalytics?.mode === 'LIVE_MT5';
  const rangeLabel = RANGE_LABELS[xmAnalyticsRange] || '30 Days';

  const todayPnl = Number(summary.today_pnl || 0);
  const floatingPnl = Number(summary.floating_pnl || 0);
  const balance = Number(account.balance || 0);
  const equity = Number(account.equity || balance);
  const rangePnl = Number(summary.range_realized_pnl || 0);
  const allTimePnl = Number(summary.all_time_realized_pnl || 0);
  const winRate = Number(summary.win_rate || 0);
  const profitFactor = summary.profit_factor;
  const expectancy = Number(summary.expectancy || 0);
  const avgWin = Number(summary.avg_win || 0);
  const avgLoss = Number(summary.avg_loss || 0);
  const maxDrawdown = Number(summary.max_drawdown || 0);
  const maxDrawdownPct = Number(summary.max_drawdown_pct || 0);
  const bestTrade = Number(summary.best_trade || 0);
  const worstTrade = Number(summary.worst_trade || 0);
  const secured1to1 = Number(summary.partial_1to1_secured || 0);
  const secured1to1Rate = Number(summary.partial_1to1_rate || 0);

  const streak = summary.current_streak || { type: 'NONE', count: 0 };
  const streakText =
    streak.type === 'WIN'
      ? `${streak.count}W`
      : streak.type === 'LOSS'
        ? `${streak.count}L`
        : '—';

  const cumPositive =
    dailyMetrics.length > 0 &&
    Number(dailyMetrics[dailyMetrics.length - 1]?.range_cumulative_pnl || 0) >= 0;

  const equityDataKey = curveMode === 'balance' ? 'ending_balance' : 'range_cumulative_pnl';
  const equityStroke =
    curveMode === 'balance' ? '#3b82f6' : cumPositive ? '#10b981' : '#ef4444';

  return (
    <section className="xm-analytics-section" aria-label="XM Broker Day-Wise Metrics and PnL">
      {/* Section Header */}
      <div className="xm-section-header">
        <div className="xm-section-title-group">
          <div className="xm-section-title">
            <Wallet size={17} style={{ color: 'var(--warning-text)' }} />
            <h3>XM MT5 Broker PnL &amp; Day-Wise Metrics</h3>
          </div>
          <span
            className={`xm-mode-pill ${isLiveMt5 ? 'live' : 'sandbox'}`}
            id="xm-analytics-mode-pill"
          >
            <span className={`pulse-dot${isLiveMt5 ? '' : ' idle'}`} />
            {isLiveMt5
              ? `Live MT5 #${account.login || ''} · ${account.server || 'XMGlobal-MT5'}`
              : 'Demo Sandbox (SQLite Fallback)'}
          </span>
        </div>

        <div className="xm-section-actions">
          {Number(summary.open_positions_count || 0) > 0 && (
            <span
              className="xm-floating-pill"
              style={{
                color: floatingPnl >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
                borderColor:
                  floatingPnl >= 0 ? 'var(--success-soft-border)' : 'var(--danger-soft-border)',
              }}
            >
              Open ({summary.open_positions_count}): {formatSignedCurrency(floatingPnl)}
            </span>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={onNavigatePositions}
          >
            Active Positions &rarr;
          </button>
        </div>
      </div>

      {/* 4 Primary XM Financial KPI Cards */}
      <div className="stats-grid xm-kpi-grid" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <SpotlightCard
          className="stat-card xm-today"
          spotlightColor={
            todayPnl >= 0 ? 'rgba(16, 185, 129, 0.24)' : 'rgba(239, 68, 68, 0.24)'
          }
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">Today&apos;s XM Realized PnL</div>
          <div
            className="stat-value"
            id="kpi-xm-today-pnl"
            style={{
              color:
                todayPnl > 0.004
                  ? 'var(--success-text)'
                  : todayPnl < -0.004
                    ? 'var(--danger-text)'
                    : 'var(--text-primary)',
            }}
          >
            <CountUp
              to={Math.abs(todayPnl)}
              decimals={2}
              duration={0.8}
              separator=","
              prefix={getCountUpPrefix(todayPnl)}
              trigger="load"
            />
          </div>
          <div className="stat-sub">
            {summary.today_trades || 0} closed today ({summary.today_wins || 0}W /{' '}
            {summary.today_losses || 0}L) &bull; Floating:{' '}
            <strong
              style={{
                color: floatingPnl >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
              }}
            >
              {formatSignedCurrency(floatingPnl)}
            </strong>
          </div>
        </SpotlightCard>

        <SpotlightCard
          className="stat-card xm-balance"
          spotlightColor="rgba(59, 130, 246, 0.25)"
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">XM Balance &amp; Equity</div>
          <div className="stat-value" id="kpi-xm-balance" style={{ color: 'var(--info-text)' }}>
            <CountUp
              to={balance}
              decimals={2}
              duration={0.8}
              separator=","
              prefix="$"
              trigger="load"
            />
          </div>
          <div className="stat-sub">
            Equity: {formatSignedCurrency(equity, { showPlus: false })} &bull; Net Deposited:{' '}
            {formatSignedCurrency(summary.net_deposits || 0, { showPlus: false })}
          </div>
        </SpotlightCard>

        <SpotlightCard
          className="stat-card xm-range-pnl"
          spotlightColor={
            rangePnl >= 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.24)'
          }
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">Realized Net PnL ({rangeLabel})</div>
          <div
            className="stat-value"
            id="kpi-xm-range-pnl"
            style={{
              color:
                rangePnl > 0.004
                  ? 'var(--success-text)'
                  : rangePnl < -0.004
                    ? 'var(--danger-text)'
                    : 'var(--text-primary)',
            }}
          >
            <CountUp
              to={Math.abs(rangePnl)}
              decimals={2}
              duration={0.8}
              separator=","
              prefix={getCountUpPrefix(rangePnl)}
              trigger="load"
            />
          </div>
          <div className="stat-sub">
            ROI: {Number(summary.range_roi_pct || 0) > 0 ? '+' : ''}
            {Number(summary.range_roi_pct || 0).toFixed(2)}% &bull;{' '}
            {summary.profitable_days || 0} green / {summary.losing_days || 0} red days
          </div>
        </SpotlightCard>

        <SpotlightCard
          className="stat-card xm-winrate"
          spotlightColor="rgba(245, 158, 11, 0.25)"
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">Win Rate &amp; Profit Factor</div>
          <div className="stat-value" id="kpi-xm-winrate" style={{ color: 'var(--warning-text)' }}>
            <CountUp
              to={winRate}
              decimals={1}
              duration={0.8}
              suffix="%"
              trigger="load"
            />
          </div>
          <div className="stat-sub">
            PF {profitFactor != null ? profitFactor.toFixed(2) : '—'} &bull;{' '}
            {summary.wins || 0}W / {summary.losses || 0}L / {summary.breakeven || 0}BE (
            {summary.total_closed_trades || 0} trades)
          </div>
        </SpotlightCard>
      </div>

      {/* 6 Important Quantitative Risk & Execution Metrics */}
      <div className="xm-diagnostics-grid">
        <div className="xm-diag-tile">
          <div className="xm-diag-label">
            <DollarSign size={12} /> Expectancy / Trade
          </div>
          <div
            className="xm-diag-val"
            style={{
              color: expectancy >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
            }}
          >
            {formatSignedCurrency(expectancy)}
          </div>
          <div className="xm-diag-sub">
            Avg Daily: {formatSignedCurrency(summary.avg_daily_pnl || 0)}
          </div>
        </div>

        <div className="xm-diag-tile">
          <div className="xm-diag-label">
            <BarChart2 size={12} /> Avg Win / Avg Loss
          </div>
          <div className="xm-diag-val">
            <span style={{ color: 'var(--success-text)' }}>
              {formatSignedCurrency(avgWin)}
            </span>
            <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>/</span>
            <span style={{ color: 'var(--danger-text)' }}>
              -{formatSignedCurrency(avgLoss, { showPlus: false })}
            </span>
          </div>
          <div className="xm-diag-sub">
            Payoff Ratio: {summary.payoff_ratio != null ? `${summary.payoff_ratio.toFixed(2)}x` : '—'}
          </div>
        </div>

        <div className="xm-diag-tile">
          <div className="xm-diag-label">
            <TrendingDown size={12} style={{ color: 'var(--danger-text)' }} /> Max Drawdown
          </div>
          <div className="xm-diag-val" style={{ color: 'var(--danger-text)' }}>
            -{formatSignedCurrency(maxDrawdown, { showPlus: false })}
          </div>
          <div className="xm-diag-sub">
            {maxDrawdownPct.toFixed(2)}% peak-to-trough
          </div>
        </div>

        <div className="xm-diag-tile">
          <div className="xm-diag-label">
            <Award size={12} style={{ color: 'var(--warning-text)' }} /> Best / Worst Trade
          </div>
          <div className="xm-diag-val">
            <span style={{ color: 'var(--success-text)' }}>
              {formatSignedCurrency(bestTrade)}
            </span>
            <span style={{ color: 'var(--text-dim)', margin: '0 4px' }}>/</span>
            <span style={{ color: 'var(--danger-text)' }}>
              {formatSignedCurrency(worstTrade)}
            </span>
          </div>
          <div className="xm-diag-sub">
            All-Time Net: {formatSignedCurrency(allTimePnl)}
          </div>
        </div>

        <div className="xm-diag-tile">
          <div className="xm-diag-label">
            <ShieldCheck size={12} style={{ color: 'var(--purple-text)' }} /> 1:1 CTC Secured
          </div>
          <div className="xm-diag-val" style={{ color: 'var(--purple-text)' }}>
            {secured1to1}{' '}
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
              / {summary.total_closed_trades || 0}
            </span>
          </div>
          <div className="xm-diag-sub">{secured1to1Rate.toFixed(1)}% auto scale-out rate</div>
        </div>

        <div className="xm-diag-tile">
          <div className="xm-diag-label">
            <Flame size={12} style={{ color: 'var(--info-text)' }} /> Volume &amp; Streak
          </div>
          <div className="xm-diag-val">
            {Number(summary.total_volume_lots || 0).toFixed(2)} L{' '}
            <span
              className="xm-streak-chip"
              style={{
                color:
                  streak.type === 'WIN'
                    ? 'var(--success-text)'
                    : streak.type === 'LOSS'
                      ? 'var(--danger-text)'
                      : 'var(--text-muted)',
              }}
            >
              {streakText}
            </span>
          </div>
          <div className="xm-diag-sub">
            Best Streak: {summary.longest_win_streak || 0}W &bull; Worst:{' '}
            {summary.longest_loss_streak || 0}L
          </div>
        </div>
      </div>

      {/* Day-Wise XM Charts: Daily Net PnL & Balance/Equity Progression */}
      <div className="dashboard-charts-grid">
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <CalendarDays size={16} style={{ color: 'var(--success-text)' }} />
              Day-Wise XM Realized PnL ($)
            </div>
            <span className="chart-card-badge">
              {summary.best_day
                ? `Best: ${summary.best_day.label} (${formatSignedCurrency(summary.best_day.pnl)})`
                : `${dailyMetrics.length} Days`}
            </span>
          </div>
          <div className="chart-box" id="chart-xm-daily-pnl">
            {!xmAnalyticsLoaded ? (
              <div className="skeleton" style={{ width: '100%', height: '100%' }} />
            ) : dailyMetrics.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem', height: '100%', justifyContent: 'center' }}>
                <CalendarDays size={26} style={{ opacity: 0.4 }} />
                <div className="empty-state-title">No XM closed deals in this range</div>
                <div className="empty-state-sub">
                  Execute trades on XM MT5 or switch to All Time to inspect historical days.
                </div>
              </div>
            ) : (
              <ChartContainer id="xmDailyPnl" config={DAILY_PNL_CHART_CONFIG}>
                <BarChart data={dailyMetrics} margin={{ top: 12, right: 10, left: -6, bottom: 0 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={56}
                    tickFormatter={(v) => (v < 0 ? `-$${Math.abs(v)}` : `$${v}`)}
                  />
                  <ReferenceLine y={0} stroke="rgba(148, 163, 184, 0.35)" strokeDasharray="3 3" />
                  <ChartTooltip content={<DailyPnlTooltip />} />
                  <Bar dataKey="realized_pnl" radius={[5, 5, 5, 5]} maxBarSize={42}>
                    {dailyMetrics.map((d) => (
                      <Cell
                        key={d.date}
                        fill={Number(d.realized_pnl || 0) >= 0 ? '#10b981' : '#ef4444'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <TrendingUp size={16} style={{ color: 'var(--info-text)' }} />
              {curveMode === 'balance' ? 'XM Balance Progression ($)' : 'Cumulative XM PnL ($)'}
            </div>
            <div className="filter-group" style={{ padding: '2px' }}>
              <button
                type="button"
                className={`filter-btn${curveMode === 'balance' ? ' active' : ''}`}
                style={{ padding: '0.2rem 0.55rem', fontSize: '0.68rem' }}
                onClick={() => setCurveMode('balance')}
              >
                Balance
              </button>
              <button
                type="button"
                className={`filter-btn${curveMode === 'cum_pnl' ? ' active' : ''}`}
                style={{ padding: '0.2rem 0.55rem', fontSize: '0.68rem' }}
                onClick={() => setCurveMode('cum_pnl')}
              >
                Cum. PnL
              </button>
            </div>
          </div>
          <div className="chart-box" id="chart-xm-equity">
            {!xmAnalyticsLoaded ? (
              <div className="skeleton" style={{ width: '100%', height: '100%' }} />
            ) : dailyMetrics.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem', height: '100%', justifyContent: 'center' }}>
                <TrendingUp size={26} style={{ opacity: 0.4 }} />
                <div className="empty-state-title">No equity history in this range</div>
                <div className="empty-state-sub">
                  Daily ending balances from XM MT5 appear here once deals settle.
                </div>
              </div>
            ) : (
              <ChartContainer id="xmEquity" config={EQUITY_CHART_CONFIG}>
                <AreaChart data={dailyMetrics} margin={{ top: 12, right: 10, left: -4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fillXmCurve" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={equityStroke} stopOpacity={0.34} />
                      <stop offset="95%" stopColor={equityStroke} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={60}
                    domain={curveMode === 'balance' ? ['auto', 'auto'] : ['auto', 'auto']}
                    tickFormatter={(v) => (v < 0 ? `-$${Math.abs(v)}` : `$${v}`)}
                  />
                  {curveMode === 'cum_pnl' && (
                    <ReferenceLine y={0} stroke="rgba(148, 163, 184, 0.35)" strokeDasharray="3 3" />
                  )}
                  <ChartTooltip content={<EquityCurveTooltip curveMode={curveMode} />} />
                  <Area
                    dataKey={equityDataKey}
                    type="monotone"
                    fill="url(#fillXmCurve)"
                    stroke={equityStroke}
                    strokeWidth={2.4}
                    dot={{ r: 3.5, fill: equityStroke }}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </div>
        </div>
      </div>

      {/* Day-Wise XM Performance Breakdown Table */}
      <div className="panel-container" style={{ marginBottom: '1.25rem' }}>
        <div className="panel-header">
          <div className="panel-title">
            <CalendarDays size={16} style={{ color: 'var(--warning-text)' }} />
            Day-Wise XM Performance Ledger
          </div>
          <span className="chart-card-badge">
            {dailyMetricsDesc.length} Active Day{dailyMetricsDesc.length === 1 ? '' : 's'} &bull;{' '}
            {rangeLabel}
          </span>
        </div>

        <div className="signals-table-wrap" style={{ padding: '0.4rem 0.65rem 0.75rem' }}>
          {!xmAnalyticsLoaded ? (
            <div className="skeleton" style={{ height: 140, margin: '0.6rem' }} />
          ) : dailyMetricsDesc.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <CalendarDays size={28} style={{ opacity: 0.4 }} />
              <div className="empty-state-title">No day-wise XM trades recorded in {rangeLabel}</div>
              <div className="empty-state-sub">
                Try switching the date range selector above to All Time or execute new signals.
              </div>
            </div>
          ) : (
            <table className="signals-table xm-daily-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Symbols</th>
                  <th>Trades</th>
                  <th>W / L / BE</th>
                  <th>Win Rate</th>
                  <th>1:1 Hits</th>
                  <th>Volume</th>
                  <th>Gross P / L</th>
                  <th>Best / Worst</th>
                  <th>Daily PnL</th>
                  <th>Daily ROI</th>
                  <th>End Balance</th>
                </tr>
              </thead>
              <tbody>
                {dailyMetricsDesc.map((d) => {
                  const pnl = Number(d.realized_pnl || 0);
                  const wr = Number(d.win_rate || 0);
                  const roi = Number(d.roi_pct || 0);
                  return (
                    <tr key={d.date}>
                      <td>
                        <div className="xm-day-cell">
                          <strong>{formatDayFull(d.date)}</strong>
                          {d.is_today && <span className="xm-today-pill">TODAY</span>}
                        </div>
                      </td>
                      <td>
                        <div className="xm-sym-chips">
                          {(d.symbols || []).map((sym) => (
                            <span key={sym} className="xm-mini-sym">
                              {sym}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="mono-cell">{d.closed_trades}</td>
                      <td className="mono-cell">
                        <span style={{ color: 'var(--success-text)' }}>{d.wins}W</span>
                        <span style={{ color: 'var(--text-dim)' }}> / </span>
                        <span style={{ color: 'var(--danger-text)' }}>{d.losses}L</span>
                        {d.breakeven > 0 && (
                          <>
                            <span style={{ color: 'var(--text-dim)' }}> / </span>
                            <span style={{ color: 'var(--text-secondary)' }}>{d.breakeven}BE</span>
                          </>
                        )}
                      </td>
                      <td>
                        <div className="xm-wr-cell">
                          <span
                            className="mono-cell"
                            style={{
                              color: wr >= 50 ? 'var(--success-text)' : 'var(--warning-text)',
                            }}
                          >
                            {wr.toFixed(1)}%
                          </span>
                          <div className="xm-wr-bar">
                            <div
                              className="xm-wr-bar-fill"
                              style={{
                                width: `${Math.min(100, Math.max(0, wr))}%`,
                                background: wr >= 50 ? 'var(--success)' : 'var(--warning)',
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="xm-1to1-pill">{d.partial_1to1_hits || 0}</span>
                      </td>
                      <td className="mono-cell">{Number(d.volume_lots || 0).toFixed(2)} L</td>
                      <td className="mono-cell">
                        <span style={{ color: 'var(--success-text)' }}>
                          {formatSignedCurrency(d.gross_profit || 0)}
                        </span>
                        <span style={{ color: 'var(--text-dim)' }}> / </span>
                        <span style={{ color: 'var(--danger-text)' }}>
                          -{formatSignedCurrency(d.gross_loss || 0, { showPlus: false })}
                        </span>
                      </td>
                      <td className="mono-cell">
                        <span style={{ color: 'var(--success-text)' }}>
                          {formatSignedCurrency(d.best_trade || 0)}
                        </span>
                        <span style={{ color: 'var(--text-dim)' }}> / </span>
                        <span style={{ color: 'var(--danger-text)' }}>
                          {formatSignedCurrency(d.worst_trade || 0)}
                        </span>
                      </td>
                      <td
                        className="mono-cell"
                        style={{
                          fontWeight: 800,
                          color:
                            pnl > 0.004
                              ? 'var(--success-text)'
                              : pnl < -0.004
                                ? 'var(--danger-text)'
                                : 'var(--text-primary)',
                        }}
                      >
                        {formatSignedCurrency(pnl)}
                      </td>
                      <td
                        className="mono-cell"
                        style={{
                          color: roi >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
                        }}
                      >
                        {roi > 0 ? '+' : ''}
                        {roi.toFixed(2)}%
                      </td>
                      <td className="mono-cell" style={{ fontWeight: 700 }}>
                        {formatSignedCurrency(d.ending_balance || 0, { showPlus: false })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="xm-table-total-row">
                  <td colSpan={2}>
                    <strong>Range Total ({dailyMetricsDesc.length} Days)</strong>
                  </td>
                  <td className="mono-cell">
                    <strong>{summary.total_closed_trades || 0}</strong>
                  </td>
                  <td className="mono-cell">
                    <strong>
                      {summary.wins || 0}W / {summary.losses || 0}L
                    </strong>
                  </td>
                  <td className="mono-cell">
                    <strong>{winRate.toFixed(1)}%</strong>
                  </td>
                  <td className="mono-cell">
                    <strong>{secured1to1}</strong>
                  </td>
                  <td className="mono-cell">
                    <strong>{Number(summary.total_volume_lots || 0).toFixed(2)} L</strong>
                  </td>
                  <td className="mono-cell">
                    <span style={{ color: 'var(--success-text)' }}>
                      {formatSignedCurrency(summary.gross_profit || 0)}
                    </span>
                    <span style={{ color: 'var(--text-dim)' }}> / </span>
                    <span style={{ color: 'var(--danger-text)' }}>
                      -{formatSignedCurrency(summary.gross_loss || 0, { showPlus: false })}
                    </span>
                  </td>
                  <td className="mono-cell">
                    <span style={{ color: 'var(--success-text)' }}>
                      {formatSignedCurrency(bestTrade)}
                    </span>
                    <span style={{ color: 'var(--text-dim)' }}> / </span>
                    <span style={{ color: 'var(--danger-text)' }}>
                      {formatSignedCurrency(worstTrade)}
                    </span>
                  </td>
                  <td
                    className="mono-cell"
                    style={{
                      fontWeight: 800,
                      color: rangePnl >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
                    }}
                  >
                    <strong>{formatSignedCurrency(rangePnl)}</strong>
                  </td>
                  <td
                    className="mono-cell"
                    style={{
                      color:
                        Number(summary.range_roi_pct || 0) >= 0
                          ? 'var(--success-text)'
                          : 'var(--danger-text)',
                    }}
                  >
                    <strong>
                      {Number(summary.range_roi_pct || 0) > 0 ? '+' : ''}
                      {Number(summary.range_roi_pct || 0).toFixed(2)}%
                    </strong>
                  </td>
                  <td className="mono-cell">
                    <strong>{formatSignedCurrency(balance, { showPlus: false })}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* Symbol Breakdown & Recent Closed XM Positions */}
      <div className="dashboard-split-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="panel-container">
          <div className="panel-header">
            <div className="panel-title">
              <Layers size={16} style={{ color: 'var(--info-text)' }} />
              Symbol Attribution (XM MT5)
            </div>
            <span className="chart-card-badge">{symbolBreakdown.length} Assets</span>
          </div>
          <div className="panel-body dash-preview-list">
            {symbolBreakdown.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem' }}>
                <Percent size={24} style={{ opacity: 0.4 }} />
                <div className="empty-state-title">No symbol statistics in this window</div>
              </div>
            ) : (
              symbolBreakdown.map((sym) => {
                const pnl = Number(sym.net_pnl || 0);
                return (
                  <div key={sym.symbol} className="xm-symbol-card">
                    <div className="xm-symbol-top">
                      <div className="trade-head-row">
                        <span className="symbol-badge">{sym.symbol}</span>
                        <span className="source-pill">{sym.trades} Trades</span>
                        <span className="xm-mini-pill">
                          {Number(sym.volume_lots || 0).toFixed(2)} Lots
                        </span>
                      </div>
                      <strong
                        className="mono-cell"
                        style={{
                          fontSize: '0.95rem',
                          color: pnl >= 0 ? 'var(--success-text)' : 'var(--danger-text)',
                        }}
                      >
                        {formatSignedCurrency(pnl)}
                      </strong>
                    </div>
                    <div className="xm-symbol-meta">
                      <span>
                        Win Rate:{' '}
                        <strong
                          style={{
                            color:
                              sym.win_rate >= 50 ? 'var(--success-text)' : 'var(--warning-text)',
                          }}
                        >
                          {Number(sym.win_rate || 0).toFixed(1)}%
                        </strong>{' '}
                        ({sym.wins}W / {sym.losses}L)
                      </span>
                      <span>
                        PF: <strong>{sym.profit_factor != null ? sym.profit_factor.toFixed(2) : '—'}</strong>
                        {' · '}1:1: <strong>{sym.secured_1to1}</strong>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="panel-container">
          <div className="panel-header">
            <div className="panel-title">
              <Activity size={16} style={{ color: 'var(--success-text)' }} />
              Recent Closed XM Positions
            </div>
            <span className="chart-card-badge">Last {recentClosedTrades.length} Closed</span>
          </div>
          <div className="panel-body dash-preview-list">
            {recentClosedTrades.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem' }}>
                <Activity size={24} style={{ opacity: 0.4 }} />
                <div className="empty-state-title">No closed XM executions in this range</div>
              </div>
            ) : (
              recentClosedTrades.map((tr) => {
                const pnl = Number(tr.net_pnl || 0);
                const isBuy = tr.side === 'BUY';
                return (
                  <div key={tr.ticket} className="xm-closed-row">
                    <div className="xm-closed-left">
                      <div className="trade-head-row">
                        <span className="pos-id">#{tr.ticket}</span>
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: '0.82rem',
                            color: isBuy ? 'var(--success-text)' : 'var(--danger-text)',
                          }}
                        >
                          {tr.side} {tr.symbol}
                        </span>
                        <span className="pos-lots">{Number(tr.volume || 0).toFixed(2)}L</span>
                        {tr.had_1to1 && (
                          <span className="outcome-badge badge-1to1 outcome-badge-sm">1:1</span>
                        )}
                        <span
                          className={`outcome-badge outcome-badge-sm ${getCloseReasonClass(
                            tr.close_reason
                          )}`}
                        >
                          {tr.close_reason}
                        </span>
                      </div>
                      <div className="xm-closed-prices">
                        {tr.open_price} &rarr; {tr.close_price} &bull;{' '}
                        {tr.close_day} {formatLocalTime(tr.closed_at, false)}
                      </div>
                    </div>
                    <strong
                      className="mono-cell"
                      style={{
                        fontSize: '0.9rem',
                        color:
                          pnl > 0.004
                            ? 'var(--success-text)'
                            : pnl < -0.004
                              ? 'var(--danger-text)'
                              : 'var(--text-secondary)',
                      }}
                    >
                      {formatSignedCurrency(pnl)}
                    </strong>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
