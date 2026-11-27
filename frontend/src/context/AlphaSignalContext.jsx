import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  fetchDashboardStats,
  fetchLogs,
  fetchMessages,
  fetchSystemStatus,
  fetchTrades,
  fetchXmPositions,
  fetchXmStatus,
  resetAllData,
} from '../services/alphaSignalApi';
import { getWebSocketUrl } from '../services/apiClient';
import { formatLocalTime } from '../utils/dateUtils';
import { useToast } from './ToastContext';

const AlphaSignalContext = createContext(null);

export function AlphaSignalProvider({ children }) {
  const { showToast } = useToast();

  // Dashboard active flag (controls WebSocket & 5s polling)
  const [dashboardMounted, setDashboardMounted] = useState(false);

  // Core server data state
  const [systemStatus, setSystemStatus] = useState(null);
  const [xmStatus, setXmStatus] = useState(null);
  const [stats, setStats] = useState({
    total_messages: 0,
    total_trades: 0,
    total_chatter: 0,
    avg_latency_ms: 0,
    noise_filter_ratio: 0,
    avg_confidence: 0,
  });
  const [messages, setMessages] = useState([]);
  const [unfilteredMessages, setUnfilteredMessages] = useState([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [trades, setTrades] = useState([]);
  const [tradesLoaded, setTradesLoaded] = useState(false);
  const [xmPositionsData, setXmPositionsData] = useState({
    positions: [],
    count: 0,
    account: null,
    mode: 'DEMO_SANDBOX',
  });

  // Filters
  const [messageFilter, setMessageFilter] = useState('ALL');
  const [messageSearch, setMessageSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('ALL');
  const [tradeFilter, setTradeFilter] = useState('ALL');
  const [signalsDirectionFilter, setSignalsDirectionFilter] = useState('ALL');
  const [highlightTradeId, setHighlightTradeId] = useState(null);

  // Terminal logs
  const [logs, setLogs] = useState([
    {
      id: 'boot-1',
      time: 'System',
      level: 'INFO',
      message: 'Terminal ready. Real-time background events will appear here.',
    },
  ]);

  // WebSocket state
  const [wsConnected, setWsConnected] = useState(false);
  const [wsStatusText, setWsStatusText] = useState('Live: Connecting...');
  const wsRef = useRef(null);
  const heartbeatRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const mountedRef = useRef(false);

  // Modals
  const [selectedJsonData, setSelectedJsonData] = useState(null);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);

  const filterRefs = useRef({ messageFilter, messageSearch, tradeFilter });
  const connectWebSocketRef = useRef(null);

  useEffect(() => {
    filterRefs.current = { messageFilter, messageSearch, tradeFilter };
  }, [messageFilter, messageSearch, tradeFilter]);

  const appendLog = useCallback((level, _category, message) => {
    setLogs((prev) => [
      ...prev.slice(-249),
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        time: new Date().toLocaleTimeString(),
        level: level || 'INFO',
        message: message || '',
      },
    ]);
  }, []);

  const loadSystemStatus = useCallback(async () => {
    try {
      const data = await fetchSystemStatus();
      setSystemStatus(data);
    } catch (e) {
      console.error('Failed to load status', e);
    }
    try {
      const xm = await fetchXmStatus();
      setXmStatus(xm);
    } catch (xe) {
      console.warn('XM status check', xe);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await fetchDashboardStats();
      setStats((prev) => ({ ...prev, ...data }));
    } catch (e) {
      console.error('Failed to load stats', e);
    }
  }, []);

  const loadMessages = useCallback(
    async (overrideFilter, overrideSearch) => {
      const intentFilter = overrideFilter ?? filterRefs.current.messageFilter;
      const search = overrideSearch ?? filterRefs.current.messageSearch;
      try {
        const data = await fetchMessages({ limit: 60, intentFilter, search });
        const list = data.messages || [];
        setMessages(list);
        if (intentFilter === 'ALL' && !search) {
          setUnfilteredMessages(list);
        }
        setMessagesLoaded(true);
      } catch (e) {
        console.error('Failed to load messages', e);
      }
    },
    []
  );

  const loadTrades = useCallback(async (overrideFilter) => {
    const statusFilter = overrideFilter ?? filterRefs.current.tradeFilter;
    try {
      const data = await fetchTrades({ limit: 60, statusFilter });
      setTrades(data.trades || []);
      setTradesLoaded(true);
    } catch (err) {
      console.error('Failed to load trades:', err);
    }
  }, []);

  const loadXmPositions = useCallback(async () => {
    try {
      const data = await fetchXmPositions();
      setXmPositionsData({
        positions: data.positions || [],
        count: data.count || 0,
        account: data.account || null,
        mode: data.mode || 'DEMO_SANDBOX',
      });
    } catch (e) {
      console.error('Failed to load XM positions:', e);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const data = await fetchLogs(40);
      const formatted = (data.logs || [])
        .slice()
        .reverse()
        .map((l, idx) => ({
          id: l.id || `api-log-${idx}-${l.created_at}`,
          time: formatLocalTime(l.created_at, true) || 'Log',
          level: l.level || 'INFO',
          message: l.message || '',
        }));
      setLogs(
        formatted.length > 0
          ? formatted
          : [
              {
                id: 'empty-log',
                time: 'System',
                level: 'INFO',
                message: 'Terminal ready. Real-time background events will appear here.',
              },
            ]
      );
    } catch (e) {
      console.error('Failed to load logs', e);
    }
  }, []);

  const clearTerminalLogs = useCallback(() => {
    setLogs([
      {
        id: `cleared-${Date.now()}`,
        time: 'System',
        level: 'INFO',
        message: 'Terminal logs cleared. Real-time events will appear here.',
      },
    ]);
  }, []);

  const handleConfirmClearData = useCallback(async () => {
    if (
      !window.confirm(
        'Are you sure you want to clear all message logs, active trades, and signal history?'
      )
    ) {
      return;
    }
    try {
      await resetAllData();
      setMessages([]);
      setUnfilteredMessages([]);
      await Promise.all([loadStats(), loadLogs(), loadTrades(), loadXmPositions()]);
      showToast('All message logs, trades, and history wiped clean.', 'info');
    } catch (e) {
      showToast('Failed to clear data: ' + e.message, 'error');
    }
  }, [loadLogs, loadStats, loadTrades, loadXmPositions, showToast]);

  const disconnectWebSocket = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);
    clearInterval(heartbeatRef.current);
    if (wsRef.current) {
      const socket = wsRef.current;
      wsRef.current = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      try {
        socket.close();
      } catch {
        // Ignore
      }
    }
  }, []);

  const connectWebSocket = useCallback(() => {
    disconnectWebSocket();
    const wsUrl = getWebSocketUrl();
    if (!wsUrl) {
      setWsConnected(false);
      setWsStatusText('Live: Connect Tunnel in Settings');
      return;
    }

    let socket;
    try {
      socket = new WebSocket(wsUrl);
      wsRef.current = socket;
    } catch {
      setWsConnected(false);
      setWsStatusText('Live: Disconnected');
      return;
    }

    socket.onopen = () => {
      setWsConnected(true);
      setWsStatusText('Live: Connected');
      appendLog('INFO', 'SYSTEM', 'Real-time WebSocket stream connected.');

      clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            wsRef.current.send('ping');
          } catch {
            // Ignore
          }
        }
      }, 25000);
    };

    socket.onmessage = (event) => {
      try {
        if (event.data === 'pong') return;
        const msg = JSON.parse(event.data);
        if (msg.type === 'NEW_SIGNAL' || msg.type === 'NEW_MESSAGE') {
          const data = msg.data;
          const isChat = data.intent === 'CHATTER' || data.intent === 'OTHERS';
          appendLog(
            isChat ? 'INFO' : 'SIGNAL',
            'STREAM',
            `[${data.intent}] ${data.action || ''} ${data.symbol || ''} - "${(data.text || '').substring(0, 45)}..."`
          );

          const curFilter = filterRefs.current.messageFilter;
          const matchesFilter =
            curFilter === 'ALL' ||
            (curFilter === 'TRADES' && data.is_trade === 1) ||
            (curFilter === 'CHATTER' && isChat) ||
            (curFilter === 'UPDATES' &&
              (data.intent === 'TRADE_UPDATE' || data.intent === 'CLOSE_TRADE')) ||
            curFilter === data.intent;

          if (matchesFilter) {
            setMessages((prev) => [data, ...prev]);
          }
          setUnfilteredMessages((prev) => [data, ...prev]);
          loadStats();
          loadTrades();
          loadXmPositions();
        } else if (
          msg.type === 'TRADE_UPDATED' ||
          msg.type === 'TRADES_EXPIRED' ||
          msg.type === 'DATA_RESET' ||
          msg.type === 'POSITION_CLOSED' ||
          msg.type === 'XM_POSITIONS_UPDATE'
        ) {
          loadTrades();
          loadXmPositions();
          loadMessages();
          loadStats();
        } else if (msg.type === 'SYSTEM_STATUS') {
          setSystemStatus((prev) => ({
            ...(prev || {}),
            listener: {
              ...(prev?.listener || {}),
              running: msg.data.listener_running,
              mode: msg.data.listener_mode,
            },
          }));
        }
      } catch (e) {
        console.error('WS Parse error', e);
      }
    };

    socket.onclose = () => {
      clearInterval(heartbeatRef.current);
      setWsConnected(false);
      setWsStatusText('Live: Reconnecting...');
      if (mountedRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          if (mountedRef.current) connectWebSocketRef.current?.();
        }, 3000);
      }
    };

    socket.onerror = (err) => {
      clearInterval(heartbeatRef.current);
      console.warn('WS error:', err);
      setWsConnected(false);
      setWsStatusText('Live: Offline');
    };
  }, [appendLog, disconnectWebSocket, loadMessages, loadStats, loadTrades, loadXmPositions]);

  useEffect(() => {
    connectWebSocketRef.current = connectWebSocket;
  }, [connectWebSocket]);

  // Manage dashboard lifecycle: initial data load + WebSocket + 5s polling
  useEffect(() => {
    mountedRef.current = dashboardMounted;
    if (!dashboardMounted) {
      disconnectWebSocket();
      return undefined;
    }

    const initDashboard = async () => {
      await Promise.all([
        loadSystemStatus(),
        loadStats(),
        loadXmPositions(),
        loadLogs(),
      ]);
      if (mountedRef.current) {
        connectWebSocket();
      }
    };
    initDashboard();

    const pollInterval = setInterval(() => {
      loadStats();
      loadXmPositions();
    }, 5000);

    return () => {
      mountedRef.current = false;
      clearInterval(pollInterval);
      disconnectWebSocket();
    };
  }, [
    dashboardMounted,
    connectWebSocket,
    disconnectWebSocket,
    loadLogs,
    loadStats,
    loadSystemStatus,
    loadXmPositions,
  ]);

  // Refetch messages when intent filter or debounced search changes while mounted
  useEffect(() => {
    if (!dashboardMounted) return;
    const t = setTimeout(() => {
      loadMessages(messageFilter, messageSearch);
    }, 0);
    return () => clearTimeout(t);
  }, [dashboardMounted, messageFilter, messageSearch, loadMessages]);

  // Refetch trades when trade status filter changes while mounted
  useEffect(() => {
    if (!dashboardMounted) return;
    const t = setTimeout(() => {
      loadTrades(tradeFilter);
    }, 0);
    return () => clearTimeout(t);
  }, [dashboardMounted, tradeFilter, loadTrades]);

  return (
    <AlphaSignalContext.Provider
      value={{
        setDashboardMounted,
        systemStatus,
        xmStatus,
        stats,
        messages,
        unfilteredMessages,
        messagesLoaded,
        trades,
        tradesLoaded,
        xmPositionsData,
        logs,
        wsConnected,
        wsStatusText,
        messageFilter,
        setMessageFilter,
        messageSearch,
        setMessageSearch,
        channelFilter,
        setChannelFilter,
        tradeFilter,
        setTradeFilter,
        signalsDirectionFilter,
        setSignalsDirectionFilter,
        highlightTradeId,
        setHighlightTradeId,
        selectedJsonData,
        openJsonInspector: (data) => setSelectedJsonData(data),
        closeJsonInspector: () => setSelectedJsonData(null),
        quickSettingsOpen,
        openQuickSettings: () => setQuickSettingsOpen(true),
        closeQuickSettings: () => setQuickSettingsOpen(false),
        loadSystemStatus,
        loadStats,
        loadMessages,
        loadTrades,
        loadXmPositions,
        loadLogs,
        appendLog,
        clearTerminalLogs,
        handleConfirmClearData,
        reconnectWebSocket: connectWebSocket,
      }}
    >
      {children}
    </AlphaSignalContext.Provider>
  );
}

export function useAlphaSignal() {
  const ctx = useContext(AlphaSignalContext);
  if (!ctx) throw new Error('useAlphaSignal must be used within AlphaSignalProvider');
  return ctx;
}
