export function getOutcomeBadgeClass(status) {
  const map = {
    PENDING: 'badge-pending',
    PENDING_AWAITING_PARAMS: 'badge-pending',
    EXECUTED: 'badge-executed',
    FAILED_EXECUTION: 'badge-sl-hit',
    CANCELLED: 'badge-cancelled',
    SL_HIT: 'badge-sl-hit',
    TP_HIT: 'badge-tp-hit',
    ACTIVE: 'badge-active',
  };
  return map[status] || 'badge-pending';
}

export function getSignalClassification(msg) {
  const intent = msg?.intent || 'CHATTER';
  const action = msg?.action || 'NONE';
  const isChatter = intent === 'CHATTER' || intent === 'OTHERS';
  const isBuy = !isChatter && (action.includes('BUY') || action === 'LONG');
  const isSell = !isChatter && (action.includes('SELL') || action === 'SHORT');
  const isUpdate =
    !isChatter &&
    (intent === 'TRADE_UPDATE' ||
      intent === 'CLOSE_TRADE' ||
      action.includes('MODIFY') ||
      action.includes('PARTIAL'));

  let cardClass = 'signal-card';
  let badgeClass = 'intent-badge chatter';
  let badgeIcon = 'message-circle';
  let spotlightColor = 'rgba(148, 163, 184, 0.25)';

  if (isBuy) {
    cardClass += ' trade-card';
    badgeClass = 'intent-badge buy';
    badgeIcon = 'arrow-up-right';
    spotlightColor = 'rgba(16, 185, 129, 0.24)';
  } else if (isSell) {
    cardClass += ' sell-card';
    badgeClass = 'intent-badge sell';
    badgeIcon = 'arrow-down-right';
    spotlightColor = 'rgba(239, 68, 68, 0.24)';
  } else if (isUpdate) {
    cardClass += ' update-card';
    badgeClass = 'intent-badge update';
    badgeIcon = 'refresh-cw';
    spotlightColor = 'rgba(139, 92, 246, 0.24)';
  } else {
    cardClass += ' chatter-card';
  }

  return {
    intent,
    action,
    isChatter,
    isBuy,
    isSell,
    isUpdate,
    cardClass,
    badgeClass,
    badgeIcon,
    spotlightColor,
  };
}

export function isValidTradeSignal(msg) {
  return (
    msg &&
    msg.intent !== 'CHATTER' &&
    msg.intent !== 'OTHERS' &&
    Boolean(msg.action) &&
    msg.action !== 'NONE'
  );
}

export function formatTpLevels(tpLevels, fallback = 'N/A') {
  if (Array.isArray(tpLevels) && tpLevels.length > 0) {
    return tpLevels.map((t, idx) => `TP${idx + 1}: ${t}`).join(' | ');
  }
  return fallback;
}
