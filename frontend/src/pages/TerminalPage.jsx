import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Trash2 } from 'lucide-react';
import { useAlphaSignal } from '../context/AlphaSignalContext';

const LOG_LEVELS = ['ALL', 'INFO', 'SIGNAL', 'WARN', 'ERROR'];

export default function TerminalPage() {
  const { logs, clearTerminalLogs } = useAlphaSignal();
  const [levelFilter, setLevelFilter] = useState('ALL');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalRef = useRef(null);

  const visibleLogs = useMemo(() => {
    if (levelFilter === 'ALL') return logs;
    if (levelFilter === 'WARN') {
      return logs.filter((l) => l.level === 'WARN' || l.level === 'WARNING');
    }
    return logs.filter((l) => l.level === levelFilter);
  }, [logs, levelFilter]);

  useEffect(() => {
    if (autoScroll && terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [visibleLogs, autoScroll]);

  return (
    <div id="page-terminal" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">Live System Terminal</h2>
          <p className="page-header-desc">
            Real-time WebSocket event bus, AI inference logs, and MT5 broker execution receipts
          </p>
        </div>
        <div className="page-header-actions">
          <div className="filter-group" role="group" aria-label="Terminal log level filter">
            {LOG_LEVELS.map((lvl) => (
              <button
                key={lvl}
                type="button"
                className={`filter-btn${levelFilter === lvl ? ' active' : ''}`}
                onClick={() => setLevelFilter(lvl)}
              >
                {lvl === 'ALL' ? 'All' : lvl}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            id="btn-terminal-scroll"
            onClick={() => setAutoScroll((prev) => !prev)}
          >
            <ArrowDown size={13} />
            Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={clearTerminalLogs}
          >
            <Trash2 size={13} />
            Clear Terminal
          </button>
        </div>
      </div>

      <div className="terminal-card-container">
        <div
          ref={terminalRef}
          className="terminal-window"
          id="terminal-logs"
          style={{ height: 'calc(100vh - 250px)' }}
        >
          {visibleLogs.map((entry) => (
            <div className="log-entry" key={entry.id}>
              <span className="log-time">[{entry.time}]</span>
              <span className={`log-level-${entry.level === 'WARNING' ? 'WARN' : entry.level}`}>
                [{entry.level}]
              </span>
              <span className="log-msg">{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
