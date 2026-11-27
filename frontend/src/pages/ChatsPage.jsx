import { useEffect, useMemo, useState } from 'react';
import { Inbox, RefreshCw, Search } from 'lucide-react';
import { SignalCard } from '../components/common/SignalCard';
import { useAlphaSignal } from '../context/AlphaSignalContext';
import { useDebouncedValue } from '../hooks/useDebouncedValue';

const INTENT_FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'TRADES', label: 'Trades' },
  { key: 'UPDATES', label: 'Updates' },
  { key: 'CHATTER', label: 'Chatter' },
];

export default function ChatsPage() {
  const {
    messages,
    messagesLoaded,
    messageFilter,
    setMessageFilter,
    messageSearch,
    setMessageSearch,
    channelFilter,
    setChannelFilter,
    loadMessages,
  } = useAlphaSignal();

  const [searchInput, setSearchInput] = useState(messageSearch);
  const debouncedSearch = useDebouncedValue(searchInput, 300);

  useEffect(() => {
    setMessageSearch(debouncedSearch.trim());
  }, [debouncedSearch, setMessageSearch]);

  const channels = useMemo(() => {
    const set = new Set();
    messages.forEach((m) => {
      if (m.channel_title) set.add(m.channel_title);
    });
    return Array.from(set);
  }, [messages]);

  const displayedMessages = useMemo(() => {
    if (!channelFilter || channelFilter === 'ALL') return messages;
    return messages.filter((m) => m.channel_title === channelFilter);
  }, [messages, channelFilter]);

  return (
    <div id="page-chats" className="page-section active-page">
      <div className="page-header-bar">
        <div>
          <h2 className="page-header-title">Recorded Telegram Chats</h2>
          <p className="page-header-desc">
            Complete multi-channel Telegram message stream, AI classifications, and raw screenshots
          </p>
        </div>
        <div className="page-header-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => loadMessages()}
          >
            <RefreshCw size={13} />
            Refresh Chats
          </button>
        </div>
      </div>

      <div className="panel-container">
        <div className="panel-header chats-filter-header">
          <div className="search-box chats-search-box">
            <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              type="text"
              id="signal-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search chats, text, symbols, senders..."
              aria-label="Search chats, text, symbols, or senders"
            />
          </div>

          <div className="chats-filters-row">
            <select
              id="chat-channel-filter"
              className="form-control chats-filter-select"
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              aria-label="Filter chats by Telegram channel"
            >
              <option value="ALL">All Channels ({channels.length})</option>
              {channels.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>

            <div className="filter-group" role="group" aria-label="Intent filter">
              {INTENT_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`filter-btn${messageFilter === f.key ? ' active' : ''}`}
                  data-filter={f.key}
                  onClick={() => setMessageFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          className="panel-body feed-scroll"
          id="message-feed"
          style={{ maxHeight: 'calc(100vh - 250px)' }}
        >
          {!messagesLoaded ? (
            <>
              <div className="signal-card skeleton-card skeleton" style={{ opacity: 0.5 }} />
              <div className="signal-card skeleton-card skeleton" style={{ opacity: 0.4 }} />
              <div className="signal-card skeleton-card skeleton" style={{ opacity: 0.3 }} />
            </>
          ) : displayedMessages.length === 0 ? (
            <div className="empty-state">
              <Inbox size={36} style={{ opacity: 0.5 }} />
              <p>No messages match current filter ({messageFilter}).</p>
            </div>
          ) : (
            displayedMessages.map((msg) => (
              <SignalCard key={msg.message_id || `${msg.created_at}-${msg.text}`} msg={msg} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
