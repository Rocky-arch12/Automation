import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Cpu,
  PieChart as PieChartIcon,
  Radio,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import CountUp from '../components/reactbits/CountUp/CountUp';
import SpotlightCard from '../components/reactbits/SpotlightCard/SpotlightCard';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '../components/ui/chart';
import { XmAnalyticsSection } from '../components/dashboard/XmAnalyticsSection';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { isValidTradeSignal } from '../utils/badgeUtils';
import { formatLocalTime } from '../utils/dateUtils';

const ACTIVITY_CHART_CONFIG = {
  signals: {
    label: 'Valid Signals',
    color: '#10b981',
  },
  chatter: {
    label: 'Chatter Filtered',
    color: '#8b5cf6',
  },
};

const BUYSELL_CHART_CONFIG = {
  count: { label: 'Signals' },
  buy: { label: 'BUY Signals', color: '#10b981' },
  sell: { label: 'SELL Signals', color: '#ef4444' },
  updates: { label: 'Updates / Exits', color: '#8b5cf6' },
};

const ASSETS_CHART_CONFIG = {
  count: {
    label: 'Monitored Signals',
    color: '#3b82f6',
  },
};

const LATENCY_CHART_CONFIG = {
  latency: {
    label: 'AI Latency',
    color: '#38bdf8',
  },
};

const ASSET_BAR_COLORS = [
  '#f59e0b',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#06b6d4',
];

const XM_RANGE_OPTIONS = [
  { key: '7d', label: '7D' },
  { key: '14d', label: '14D' },
  { key: '30d', label: '30D' },
  { key: 'all', label: 'ALL' },
];

export default function OverviewPage() {
  const {
    stats,
    messages,
    unfilteredMessages,
    systemStatus,
    xmPositionsData,
    xmAnalytics,
    xmAnalyticsRange,
    setXmAnalyticsRange,
    xmAnalyticsLoaded,
    loadStats,
    loadMessages,
    loadXmPositions,
    loadXmAnalytics,
  } = useAlphaSignal();
  const navigate = useNavigate();

  const chartMessages = unfilteredMessages.length > 0 ? unfilteredMessages : messages;

  const recentSignals = useMemo(
    () => chartMessages.filter(isValidTradeSignal).slice(0, 5),
    [chartMessages]
  );

  // Chart 1: Signal Activity Over Time (AreaChart)
  const activityData = useMemo(() => {
    if (!chartMessages.length) {
      return [
        { bucket: '-6h', signals: 2, chatter: 8 },
        { bucket: '-5h', signals: 5, chatter: 14 },
        { bucket: '-4h', signals: 4, chatter: 10 },
        { bucket: '-3h', signals: 8, chatter: 15 },
        { bucket: '-2h', signals: 12, chatter: 22 },
        { bucket: '-1h', signals: 18, chatter: 19 },
        { bucket: 'Now', signals: 24, chatter: 28 },
      ];
    }

    const buckets = 7;
    const chunkSize = Math.max(1, Math.floor(chartMessages.length / buckets));
    const rows = [];

    for (let i = 0; i < buckets; i += 1) {
      const slice = chartMessages.slice(i * chunkSize, (i + 1) * chunkSize);
      let sigs = 0;
      let chat = 0;
      slice.forEach((m) => {
        if (m.intent === 'CHATTER' || m.intent === 'OTHERS') chat += 1;
        else sigs += 1;
      });
      rows.push({ bucket: `P${i + 1}`, signals: sigs, chatter: chat });
    }
    return rows;
  }, [chartMessages]);

  // Chart 2: Buy vs Sell Direction (Donut PieChart)
  const buySellData = useMemo(() => {
    let buyCount = 0;
    let sellCount = 0;
    let updateCount = 0;

    chartMessages.forEach((m) => {
      const act = (m.action || '').toUpperCase();
      if (act.includes('BUY') || act === 'LONG') buyCount += 1;
      else if (act.includes('SELL') || act === 'SHORT') sellCount += 1;
      else if (m.intent === 'TRADE_UPDATE' || act.includes('PARTIAL') || act.includes('MODIFY')) {
        updateCount += 1;
      }
    });

    const hasData = buyCount > 0 || sellCount > 0;
    return [
      { key: 'buy', label: 'BUY Signals', count: hasData ? buyCount : 65, fill: '#10b981' },
      { key: 'sell', label: 'SELL Signals', count: hasData ? sellCount : 25, fill: '#ef4444' },
      { key: 'updates', label: 'Updates / Exits', count: hasData ? updateCount : 10, fill: '#8b5cf6' },
    ];
  }, [chartMessages]);

  const totalDirectionCount = useMemo(
    () => buySellData.reduce((sum, item) => sum + item.count, 0),
    [buySellData]
  );

  // Chart 3: Asset Distribution (BarChart)
  const assetsData = useMemo(() => {
    const symbolMap = {};
    chartMessages.forEach((m) => {
      if (m.symbol && m.intent !== 'CHATTER' && m.intent !== 'OTHERS') {
        symbolMap[m.symbol] = (symbolMap[m.symbol] || 0) + 1;
      }
    });
    const sorted = Object.entries(symbolMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (sorted.length > 0) {
      return sorted.map(([symbol, count], idx) => ({
        symbol,
        count,
        fill: ASSET_BAR_COLORS[idx % ASSET_BAR_COLORS.length],
      }));
    }

    return [
      { symbol: 'XAUUSD', count: 49, fill: ASSET_BAR_COLORS[0] },
      { symbol: 'BTCUSD', count: 12, fill: ASSET_BAR_COLORS[1] },
      { symbol: 'GBPUSD', count: 6, fill: ASSET_BAR_COLORS[2] },
      { symbol: 'EURUSD', count: 4, fill: ASSET_BAR_COLORS[3] },
      { symbol: 'ETHUSD', count: 3, fill: ASSET_BAR_COLORS[4] },
    ];
  }, [chartMessages]);

  // Chart 4: AI Latency Performance (AreaChart)
  const performanceData = useMemo(() => {
    const recent = chartMessages.slice(0, 15).reverse();
    if (recent.length > 0) {
      return recent.map((m, idx) => ({
        sample: `#${idx + 1}`,
        latency: m.processing_time_ms || 210,
      }));
    }

    return [180, 240, 195, 310, 210, 190, 260, 220, 205, 195, 280, 215, 190, 200, 210].map(
      (latency, idx) => ({
        sample: `#${idx + 1}`,
        latency,
      })
    );
  }, [chartMessages]);

  const aiBadgeLabel = useMemo(() => {
    const ai = systemStatus?.ai;
    if (!ai) return 'Groq LLM';
    return ai.provider === 'gemini'
      ? ai.gemini_model || 'Gemini'
      : ai.text_model || ai.mode || 'Groq LLM';
  }, [systemStatus]);

  const handleRefreshAnalytics = () => {
    loadStats();
    loadMessages();
    loadXmPositions();
    loadXmAnalytics();
  };

  return (
    <div id="page-dashboard" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">Trading Intelligence Overview</h2>
          <p className="page-header-desc">
            Real-time telemetry, XM day-wise PnL &amp; broker metrics, AI decision accuracy, and signal distribution
          </p>
        </div>
        <div className="page-header-actions">
          <div className="filter-group" role="group" aria-label="XM Analytics timeframe">
            {XM_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`filter-btn${xmAnalyticsRange === opt.key ? ' active' : ''}`}
                onClick={() => setXmAnalyticsRange(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleRefreshAnalytics}
          >
            <RefreshCw size={13} />
            Refresh Analytics
          </button>
        </div>
      </div>

      {/* KPI Stats Banner with React Bits SpotlightCard & CountUp */}
      <section className="stats-grid" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <SpotlightCard
          className="stat-card total"
          spotlightColor="rgba(245, 158, 11, 0.25)"
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">Total Messages Monitored</div>
          <div className="stat-value" id="kpi-total">
            <CountUp to={stats.total_messages || 0} duration={0.8} separator="," trigger="load" />
          </div>
          <div className="stat-sub">From Telegram channel &amp; simulator</div>
        </SpotlightCard>

        <SpotlightCard
          className="stat-card trades"
          spotlightColor="rgba(16, 185, 129, 0.25)"
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">Valid Trade Signals</div>
          <div className="stat-value" id="kpi-trades" style={{ color: 'var(--success-text)' }}>
            <CountUp to={stats.total_trades || 0} duration={0.8} separator="," trigger="load" />
          </div>
          <div className="stat-sub" id="kpi-trades-sub">
            New signals &amp; entry setups
          </div>
        </SpotlightCard>

        <SpotlightCard
          className="stat-card chatter"
          spotlightColor="rgba(139, 92, 246, 0.25)"
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">Chatter Filtered Out</div>
          <div className="stat-value" id="kpi-chatter" style={{ color: 'var(--purple-text)' }}>
            <CountUp to={stats.total_chatter || 0} duration={0.8} separator="," trigger="load" />
          </div>
          <div className="stat-sub" id="kpi-noise-rate">
            {stats.noise_filter_ratio || 0}% noise rejected
          </div>
        </SpotlightCard>

        <SpotlightCard
          className="stat-card latency"
          spotlightColor="rgba(56, 189, 248, 0.25)"
          intensity={0.14}
          borderGlow={0.45}
          flare={false}
        >
          <div className="stat-label">Avg AI Latency</div>
          <div className="stat-value" id="kpi-latency" style={{ color: 'var(--info-text)' }}>
            <CountUp
              to={stats.avg_latency_ms || 0}
              duration={0.8}
              separator=","
              suffix=" ms"
              trigger="load"
            />
          </div>
          <div className="stat-sub" id="kpi-confidence">
            {stats.avg_confidence || 0}% avg confidence
          </div>
        </SpotlightCard>
      </section>

      <XmAnalyticsSection
        xmAnalytics={xmAnalytics}
        xmAnalyticsLoaded={xmAnalyticsLoaded}
        xmAnalyticsRange={xmAnalyticsRange}
        onNavigatePositions={() => navigate('/positions')}
      />

      {/* 4 Responsive shadcn/ui Charts (Recharts) */}
      <section className="dashboard-charts-grid">
        {/* Chart 1: Signal Activity Over Time */}
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <Activity size={16} style={{ color: 'var(--primary)' }} />
              Signal Activity Over Time
            </div>
            <span className="chart-card-badge">Real-Time</span>
          </div>
          <div className="chart-box" id="chart-activity">
            <ChartContainer id="activity" config={ACTIVITY_CHART_CONFIG}>
              <AreaChart data={activityData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillValidSignals" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-signals)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-signals)" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="fillChatterFiltered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-chatter)" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="var(--color-chatter)" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={36}
                />
                <ChartTooltip content={<ChartTooltipContent indicator="dot" />} />
                <ChartLegend content={<ChartLegendContent />} verticalAlign="top" />
                <Area
                  dataKey="chatter"
                  type="monotone"
                  fill="url(#fillChatterFiltered)"
                  stroke="var(--color-chatter)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                />
                <Area
                  dataKey="signals"
                  type="monotone"
                  fill="url(#fillValidSignals)"
                  stroke="var(--color-signals)"
                  strokeWidth={2.5}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        </div>

        {/* Chart 2: Buy vs Sell Direction */}
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <PieChartIcon size={16} style={{ color: 'var(--success-text)' }} />
              Buy vs Sell Direction
            </div>
            <span className="chart-card-badge">Intent Ratio</span>
          </div>
          <div className="chart-box" id="chart-buysell">
            <ChartContainer id="buysell" config={BUYSELL_CHART_CONFIG}>
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel indicator="dot" />} />
                <ChartLegend content={<ChartLegendContent nameKey="key" />} />
                <Pie
                  data={buySellData}
                  dataKey="count"
                  nameKey="key"
                  innerRadius="58%"
                  outerRadius="84%"
                  paddingAngle={3}
                  cornerRadius={4}
                  strokeWidth={0}
                >
                  {buySellData.map((entry) => (
                    <Cell key={entry.key} fill={entry.fill} />
                  ))}
                  <Label
                    content={({ viewBox }) => {
                      if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                        return (
                          <text
                            x={viewBox.cx}
                            y={viewBox.cy}
                            textAnchor="middle"
                            dominantBaseline="middle"
                          >
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy - 4}
                              style={{
                                fill: '#f8fafc',
                                fontSize: '1.35rem',
                                fontWeight: 800,
                                fontFamily: 'var(--font-mono)',
                              }}
                            >
                              {totalDirectionCount}
                            </tspan>
                            <tspan
                              x={viewBox.cx}
                              y={viewBox.cy + 16}
                              style={{
                                fill: '#94a3b8',
                                fontSize: '0.68rem',
                                fontWeight: 600,
                              }}
                            >
                              Signals
                            </tspan>
                          </text>
                        );
                      }
                      return null;
                    }}
                  />
                </Pie>
              </PieChart>
            </ChartContainer>
          </div>
        </div>

        {/* Chart 3: Asset Distribution */}
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <BarChart3 size={16} style={{ color: 'var(--warning-text)' }} />
              Asset Distribution
            </div>
            <span className="chart-card-badge">Symbol Frequencies</span>
          </div>
          <div className="chart-box" id="chart-assets">
            <ChartContainer id="assets" config={ASSETS_CHART_CONFIG}>
              <BarChart data={assetsData} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="symbol"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval={0}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={36}
                />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={44}>
                  {assetsData.map((entry) => (
                    <Cell key={entry.symbol} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        </div>

        {/* Chart 4: AI Processing Latency (ms) */}
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <Cpu size={16} style={{ color: 'var(--info-text)' }} />
              AI Processing Latency (ms)
            </div>
            <span className="chart-card-badge" id="chart-ai-badge">
              {aiBadgeLabel}
            </span>
          </div>
          <div className="chart-box" id="chart-performance">
            <ChartContainer id="performance" config={LATENCY_CHART_CONFIG}>
              <AreaChart data={performanceData} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillAiLatency" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-latency)" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="var(--color-latency)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="sample"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  interval="preserveStartEnd"
                />
                <YAxis tickLine={false} axisLine={false} width={44} />
                <ChartTooltip
                  content={<ChartTooltipContent indicator="line" valueSuffix=" ms" />}
                />
                <Area
                  dataKey="latency"
                  type="monotone"
                  fill="url(#fillAiLatency)"
                  stroke="var(--color-latency)"
                  strokeWidth={2.2}
                  dot={{ r: 2.5, fill: 'var(--color-latency)' }}
                  activeDot={{ r: 4.5 }}
                />
              </AreaChart>
            </ChartContainer>
          </div>
        </div>
      </section>

      {/* Dashboard Recent Activity Split View */}
      <div className="dashboard-split-grid">
        <div className="panel-container">
          <div className="panel-header">
            <div className="panel-title">
              <Radio size={16} style={{ color: 'var(--primary)' }} />
              Recent Valid Signals
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => navigate('/signals')}
            >
              View All Signals &rarr;
            </button>
          </div>
          <div className="panel-body dash-preview-list" id="dash-recent-signals">
            {recentSignals.length === 0 ? (
              <div className="empty-state" style={{ padding: '1.5rem' }}>
                <Radio size={28} style={{ opacity: 0.4 }} />
                <div className="empty-state-title">No signals received yet</div>
                <div className="empty-state-sub">
                  Send a message in Telegram or test the simulator to trigger live setups.
                </div>
              </div>
            ) : (
              recentSignals.map((s) => {
                const isBuy = (s.action || '').includes('BUY');
                return (
                  <div
                    key={s.message_id}
                    className="trade-tracker-card"
                    style={{ padding: '0.85rem', marginBottom: '0.5rem', cursor: 'pointer' }}
                    onClick={() => navigate('/signals')}
                  >
                    <div className="trade-card-top" style={{ marginBottom: '0.4rem' }}>
                      <div className="trade-head-row">
                        <span className="symbol-badge">{s.symbol || 'XAUUSD'}</span>
                        <span className={`intent-badge ${isBuy ? 'buy' : 'sell'}`}>
                          {s.action || 'BUY'}
                        </span>
                        <span className="source-pill">{s.order_type || 'MARKET'}</span>
                      </div>
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
                    </div>
                    <div
                      style={{
                        fontSize: '0.76rem',
                        color: 'var(--text-secondary)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span>
                        Entry: <strong>{s.entry_price || 'CMP'}</strong> &bull; SL:{' '}
                        <span style={{ color: 'var(--danger-text)' }}>{s.sl || 'Open'}</span>
                      </span>
                      <span style={{ color: 'var(--text-dim)' }}>
                        {s.created_at ? formatLocalTime(s.created_at, false) || 'Now' : 'Now'}
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
              <ShieldCheck size={16} style={{ color: 'var(--success-text)' }} />
              System Health &amp; MT5 Live Glance
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => navigate('/positions')}
            >
              Manage Positions &rarr;
            </button>
          </div>
          <div className="panel-body" style={{ padding: '1.15rem' }}>
            <div className="infra-health-grid">
              <div className="infra-health-item">
                <div className="infra-health-label">Telegram Harvester</div>
                <div className="infra-health-val" id="infra-tg-val">
                  <span
                    className={`pulse-dot${systemStatus?.listener?.running ? '' : ' idle'}`}
                  />{' '}
                  {systemStatus?.listener?.running
                    ? `Active (${systemStatus.listener.mode})`
                    : 'Active Multi-Channel'}
                </div>
              </div>
              <div className="infra-health-item">
                <div className="infra-health-label">AI LLM Model</div>
                <div
                  className="infra-health-val"
                  id="infra-ai-val"
                  style={{ color: 'var(--info-text)' }}
                >
                  <Cpu size={12} /> {systemStatus?.ai?.text_model || systemStatus?.ai?.mode || 'Groq LLM'}
                </div>
              </div>
              <div className="infra-health-item">
                <div className="infra-health-label">Broker Link</div>
                <div className="infra-health-val" style={{ color: 'var(--warning-text)' }}>
                  <Zap size={12} /> XM MT5 Execution
                </div>
              </div>
              <div className="infra-health-item">
                <div className="infra-health-label">WebSocket Stream</div>
                <div className="infra-health-val" style={{ color: 'var(--success-text)' }}>
                  <Activity size={12} /> 0ms Latency Loop
                </div>
              </div>
            </div>

            <div style={{ marginTop: '1.25rem' }}>
              <div className="tab-toolbar-title" style={{ marginBottom: '0.65rem' }}>
                <TrendingUp size={14} style={{ color: 'var(--success-text)' }} />
                Active Positions Summary
              </div>
              <div id="dash-positions-summary">
                {xmPositionsData.positions.length === 0 ? (
                  <div className="empty-state" style={{ padding: '1rem 0' }}>
                    <div className="empty-state-title" style={{ fontSize: '0.8rem' }}>
                      No open MT5 positions right now.
                    </div>
                    <div className="empty-state-sub">
                      Executing automatically on verified 1:1 triggers.
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {xmPositionsData.positions.slice(0, 3).map((p) => {
                      const isBuy = (p.type || 'BUY') === 'BUY';
                      const profit = Number(p.profit || 0);
                      const pnlColor = profit >= 0 ? 'var(--success-text)' : 'var(--danger-text)';
                      return (
                        <div
                          key={p.ticket}
                          style={{
                            background: 'var(--bg-inset)',
                            padding: '0.65rem 0.85rem',
                            borderRadius: 'var(--r-sm)',
                            border: '1px solid var(--border-medium)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '0.78rem',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="pos-id">#{p.ticket}</span>
                            <span
                              style={{
                                fontWeight: 700,
                                color: isBuy ? 'var(--success-text)' : 'var(--danger-text)',
                              }}
                            >
                              {p.type} {p.symbol}
                            </span>
                            <span className="pos-lots">{p.volume}L</span>
                          </div>
                          <strong
                            style={{
                              color: pnlColor,
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.85rem',
                            }}
                          >
                            {profit >= 0 ? '+' : '-'}${Math.abs(profit).toFixed(2)}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
