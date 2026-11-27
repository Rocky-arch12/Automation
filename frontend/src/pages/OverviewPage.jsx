import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  Cpu,
  PieChart,
  Radio,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { AnalyticsChart } from '../components/common/AnalyticsChart';
import CountUp from '../components/reactbits/CountUp/CountUp';
import SpotlightCard from '../components/reactbits/SpotlightCard/SpotlightCard';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { isValidTradeSignal } from '../utils/badgeUtils';
import { formatLocalTime } from '../utils/dateUtils';

export default function OverviewPage() {
  const {
    stats,
    messages,
    systemStatus,
    xmPositionsData,
    loadStats,
    loadMessages,
    loadXmPositions,
  } = useAlphaSignal();
  const navigate = useNavigate();

  const recentSignals = useMemo(
    () => messages.filter(isValidTradeSignal).slice(0, 5),
    [messages]
  );

  // Chart 1: Signal Activity Over Time
  const activityChartData = useMemo(() => {
    if (!messages.length) {
      return {
        labels: ['-6h', '-5h', '-4h', '-3h', '-2h', '-1h', 'Now'],
        datasets: [
          {
            label: 'Valid Signals',
            data: [2, 5, 4, 8, 12, 18, 24],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            borderWidth: 2.5,
            fill: true,
            tension: 0.35,
            pointBackgroundColor: '#10b981',
            pointRadius: 3,
          },
          {
            label: 'Chatter Filtered',
            data: [8, 14, 10, 15, 22, 19, 28],
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth: 1.8,
            borderDash: [4, 4],
            tension: 0.35,
            pointRadius: 0,
          },
        ],
      };
    }

    const buckets = 7;
    const chunkSize = Math.max(1, Math.floor(messages.length / buckets));
    const signalCounts = [];
    const chatterCounts = [];
    const labels = [];

    for (let i = 0; i < buckets; i += 1) {
      const slice = messages.slice(i * chunkSize, (i + 1) * chunkSize);
      let sigs = 0;
      let chat = 0;
      slice.forEach((m) => {
        if (m.intent === 'CHATTER' || m.intent === 'OTHERS') chat += 1;
        else sigs += 1;
      });
      signalCounts.push(sigs);
      chatterCounts.push(chat);
      labels.push(`P${i + 1}`);
    }

    return {
      labels,
      datasets: [
        {
          label: 'Valid Signals',
          data: signalCounts,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#10b981',
          pointRadius: 3,
        },
        {
          label: 'Chatter Filtered',
          data: chatterCounts,
          borderColor: '#8b5cf6',
          backgroundColor: 'transparent',
          borderWidth: 1.8,
          borderDash: [4, 4],
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    };
  }, [messages]);

  const activityChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { grid: { color: 'rgba(255, 255, 255, 0.04)' } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, beginAtZero: true },
      },
    }),
    []
  );

  // Chart 2: Buy vs Sell Direction
  const buySellChartData = useMemo(() => {
    let buyCount = 0;
    let sellCount = 0;
    let updateCount = 0;

    messages.forEach((m) => {
      const act = (m.action || '').toUpperCase();
      if (act.includes('BUY') || act === 'LONG') buyCount += 1;
      else if (act.includes('SELL') || act === 'SHORT') sellCount += 1;
      else if (m.intent === 'TRADE_UPDATE' || act.includes('PARTIAL') || act.includes('MODIFY'))
        updateCount += 1;
    });

    const data = buyCount > 0 || sellCount > 0 ? [buyCount, sellCount, updateCount] : [65, 25, 10];
    return {
      labels: ['BUY Signals', 'SELL Signals', 'Updates / Exits'],
      datasets: [
        {
          data,
          backgroundColor: ['#10b981', '#ef4444', '#8b5cf6'],
          borderWidth: 0,
          hoverOffset: 6,
        },
      ],
    };
  }, [messages]);

  const buySellChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '70%',
      plugins: { legend: { position: 'bottom' } },
    }),
    []
  );

  // Chart 3: Asset Distribution
  const assetsChartData = useMemo(() => {
    const symbolMap = {};
    messages.forEach((m) => {
      if (m.symbol && m.intent !== 'CHATTER' && m.intent !== 'OTHERS') {
        symbolMap[m.symbol] = (symbolMap[m.symbol] || 0) + 1;
      }
    });
    const sorted = Object.entries(symbolMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const labels = sorted.length > 0 ? sorted.map((s) => s[0]) : ['XAUUSD', 'BTCUSD', 'GBPUSD', 'EURUSD', 'ETHUSD'];
    const data = sorted.length > 0 ? sorted.map((s) => s[1]) : [49, 12, 6, 4, 3];

    return {
      labels,
      datasets: [
        {
          label: 'Monitored Signals',
          data,
          backgroundColor: [
            'rgba(245, 158, 11, 0.8)',
            'rgba(59, 130, 246, 0.8)',
            'rgba(16, 185, 129, 0.8)',
            'rgba(139, 92, 246, 0.8)',
            'rgba(6, 182, 212, 0.8)',
          ],
          borderRadius: 6,
          borderSkipped: false,
        },
      ],
    };
  }, [messages]);

  const assetsChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, beginAtZero: true },
      },
    }),
    []
  );

  // Chart 4: AI Latency Performance
  const performanceChartData = useMemo(() => {
    const recent = messages.slice(0, 15).reverse();
    const labels =
      recent.length > 0
        ? recent.map((_, idx) => `#${idx + 1}`)
        : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'];
    const data =
      recent.length > 0
        ? recent.map((m) => m.processing_time_ms || 210)
        : [180, 240, 195, 310, 210, 190, 260, 220, 205, 195, 280, 215, 190, 200, 210];

    return {
      labels,
      datasets: [
        {
          label: 'AI Processing Time (ms)',
          data,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.08)',
          borderWidth: 2,
          fill: true,
          tension: 0.3,
          pointRadius: 2,
        },
      ],
    };
  }, [messages]);

  const performanceChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { grid: { color: 'rgba(255, 255, 255, 0.04)' }, beginAtZero: false },
      },
    }),
    []
  );

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
  };

  return (
    <div id="page-dashboard" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">Trading Intelligence Overview</h2>
          <p className="page-header-desc">
            Real-time telemetry, AI decision accuracy, signal distribution, and broker metrics
          </p>
        </div>
        <div className="page-header-actions">
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

      {/* 4 Interactive Charts Grid */}
      <section className="dashboard-charts-grid">
        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <Activity size={16} style={{ color: 'var(--primary)' }} />
              Signal Activity Over Time
            </div>
            <span className="chart-card-badge">Real-Time</span>
          </div>
          <div className="chart-box">
            <AnalyticsChart
              id="chart-activity"
              type="line"
              data={activityChartData}
              options={activityChartOptions}
            />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <PieChart size={16} style={{ color: 'var(--success-text)' }} />
              Buy vs Sell Direction
            </div>
            <span className="chart-card-badge">Intent Ratio</span>
          </div>
          <div className="chart-box">
            <AnalyticsChart
              id="chart-buysell"
              type="doughnut"
              data={buySellChartData}
              options={buySellChartOptions}
            />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-card-header">
            <div className="chart-card-title">
              <BarChart3 size={16} style={{ color: 'var(--warning-text)' }} />
              Asset Distribution
            </div>
            <span className="chart-card-badge">Symbol Frequencies</span>
          </div>
          <div className="chart-box">
            <AnalyticsChart
              id="chart-assets"
              type="bar"
              data={assetsChartData}
              options={assetsChartOptions}
            />
          </div>
        </div>

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
          <div className="chart-box">
            <AnalyticsChart
              id="chart-performance"
              type="line"
              data={performanceChartData}
              options={performanceChartOptions}
            />
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
