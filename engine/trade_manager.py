import json
import re
import time
from datetime import datetime
from typing import Dict, Any, Optional, List
from database import (
    create_trade,
    update_trade_outcome,
    get_trade_by_id,
    get_channel_pending_trades,
    get_channel_active_trades,
    generate_trade_id,
    update_message_trade_id,
    log_event,
    get_db
)
from engine.xm_executor import xm_executor

# Clean Lifecycle Outcomes (Artificial labels like "level given but executed early" and "partial 1:1" removed)
TRADE_OUTCOMES = {
    "PENDING": {
        "code": "PENDING",
        "title": "Pending Setup (Awaiting Owner Confirmation)",
        "badge_class": "badge-pending",
        "color": "#eab308",
        "is_terminal": False,
        "is_active": 1,
        "description": "Setup detected in channel; awaiting owner activation message before executing on XM MT5."
    },
    "EXECUTED": {
        "code": "EXECUTED",
        "title": "XM MT5: Running Hands-Off",
        "badge_class": "badge-executed",
        "color": "#10b981",
        "is_terminal": False,
        "is_active": 1,
        "description": "Executed on XM MT5 with mandatory SL and TP. Running hands-off until SL or TP is reached."
    },
    "CANCELLED": {
        "code": "CANCELLED",
        "title": "Cancelled / Expired",
        "badge_class": "badge-cancelled",
        "color": "#64748b",
        "is_terminal": True,
        "is_active": 0,
        "description": "Setup cancelled by owner or automatically expired after 2 hours without activation."
    },
    "SL_HIT": {
        "code": "SL_HIT",
        "title": "Stop Loss Hit",
        "badge_class": "badge-sl-hit",
        "color": "#ef4444",
        "is_terminal": True,
        "is_active": 0,
        "description": "Position hit Stop Loss on XM MT5 terminal."
    },
    "TP_HIT": {
        "code": "TP_HIT",
        "title": "Take Profit Hit",
        "badge_class": "badge-tp-hit",
        "color": "#10b981",
        "is_terminal": True,
        "is_active": 0,
        "description": "Position hit Take Profit on XM MT5 terminal."
    }
}

def normalize_symbol(symbol: Optional[str], text: Optional[str] = None) -> str:
    """Normalizes symbol string to standard broker codes."""
    s = (symbol or "").upper().strip()
    t = (text or "").upper().strip()
    
    if "GOLD" in s or "XAU" in s or "GOLD" in t or "XAU" in t:
        return "XAUUSD"
    if "BTC" in s or "BITCOIN" in s or "BTC" in t or "BITCOIN" in t:
        return "BTCUSDT"
    if "ETH" in s or "ETHEREUM" in s or "ETH" in t:
        return "ETHUSDT"
    if "EUR" in s or "EUR" in t:
        return "EURUSD"
    if "GBP" in s or "CABLE" in s or "GBP" in t:
        return "GBPUSD"
    
    return s if s else "XAUUSD"

def parse_entry_price(val: Any) -> float:
    """Parses numeric price from single values, ranges (e.g. '2640-2642'), or text."""
    if not val:
        return 0.0
    s = str(val).strip().replace(",", "")
    numbers = [float(x) for x in re.findall(r'\d+(?:\.\d+)?', s)]
    if len(numbers) >= 2 and any(sep in s for sep in ["-", "/", "TO", "to"]):
        return round((numbers[0] + numbers[1]) / 2.0, 2)
    elif len(numbers) >= 1:
        return numbers[0]
    return 0.0

def parse_price(val: Any) -> float:
    """Extracts first valid float from a string or number."""
    if not val:
        return 0.0
    numbers = [float(x) for x in re.findall(r'\d+(?:\.\d+)?', str(val).replace(",", ""))]
    return numbers[0] if numbers else 0.0

async def correlate_and_process_trade(
    message_id: int,
    interpretation: Dict[str, Any],
    raw_text: str,
    channel_id: Optional[str] = None,
    channel_title: Optional[str] = None,
    has_image: bool = False
) -> Dict[str, Any]:
    """
    AI-Driven Trade Correlation & Execution Manager:
    - 3-Way Intent Routing: NEW_TRADE, TRADE_UPDATE, OTHERS.
    - NEW_TRADE:
        * If is_active_now=True: Strictly validates SL/TP -> executes on XM MT5 -> marks EXECUTED.
        * If is_active_now=False: Saves as PENDING in system, awaiting owner confirmation.
    - TRADE_UPDATE:
        * If update_type="ACTIVATE": Activates pending trade -> executes on XM MT5 with strict lots -> marks EXECUTED.
        * If update_type="CANCEL": Cancels setup in system -> marks CANCELLED.
        * If trade was already EXECUTED: Enforces hands-off policy (trade runs untouched on MT5).
        * If trade is CANCELLED or > 2 hours old: Ignores update.
    - OTHERS:
        * Casual chatter, ignored.
    """
    intent = interpretation.get("intent", "OTHERS")
    symbol = normalize_symbol(interpretation.get("symbol"), raw_text)

    # -------------------------------------------------------------
    # 1. NEW TRADE SETUP
    # -------------------------------------------------------------
    if intent == "NEW_TRADE":
        action = (interpretation.get("action") or "BUY").upper()
        if "BUY" not in action and "SELL" not in action:
            action = "BUY"

        order_type = (interpretation.get("order_type") or "MARKET").upper()
        entry_raw = interpretation.get("entry_price")
        sl_raw = interpretation.get("sl")
        tp_levels = interpretation.get("tp_levels") or []
        is_active_now = bool(interpretation.get("is_active_now", False))

        # Parse numeric entry and SL safely (supports zones like 2640-2642)
        entry_float = parse_entry_price(entry_raw)
        sl_float = parse_price(sl_raw)

        trade_id = await generate_trade_id(symbol)

        # Case A: Owner signaled immediate market entry / CMP
        if is_active_now:
            # Strictly validate mandatory SL and TP
            is_valid, final_sl, final_tp, val_msg = xm_executor.validate_and_enforce_sl_tp(
                symbol=symbol,
                action=action,
                entry=entry_float,
                sl=sl_float,
                tp_levels=tp_levels
            )

            if not is_valid:
                # Reject trade: strictly no execution without proper SL and TP
                await log_event(
                    "WARNING", "XM_SAFETY",
                    f"Execution rejected for {trade_id}: {val_msg}",
                    details=f"Symbol: {symbol}, Entry: {entry_float}, SL: {sl_raw}, TP: {tp_levels}"
                )
                tid = await create_trade({
                    "trade_id": trade_id,
                    "symbol": symbol,
                    "action": action,
                    "order_type": order_type,
                    "entry_price": str(entry_float) if entry_float else entry_raw,
                    "sl": str(sl_raw),
                    "tp_levels": tp_levels,
                    "status": "REJECTED_NO_SL_TP",
                    "outcome": f"Rejected: {val_msg}",
                    "initial_message_id": message_id,
                    "channel_id": channel_id,
                    "channel_title": channel_title,
                    "pnl_notes": f"Safety Shield: {val_msg}"
                })
                await update_message_trade_id(message_id, trade_id)
                return {"trade_id": trade_id, "action": "REJECTED", "reason": val_msg}

            # Execute trade on XM MT5 with strict lots (0.02 Gold, 0.04 BTC, 0.01 other)
            xm_res = await xm_executor.execute_new_trade({
                "trade_id": trade_id,
                "symbol": symbol,
                "action": action,
                "entry_price": entry_float,
                "sl": final_sl,
                "tp_levels": [final_tp]
            })

            ticket = xm_res.get("ticket")
            lots = xm_res.get("lots")
            exec_price = xm_res.get("price") or entry_float

            tid = await create_trade({
                "trade_id": trade_id,
                "symbol": symbol,
                "action": action,
                "order_type": order_type,
                "entry_price": str(exec_price),
                "sl": str(final_sl),
                "tp_levels": [str(final_tp)],
                "status": "EXECUTED",
                "outcome": "XM MT5: Running Hands-Off",
                "initial_message_id": message_id,
                "channel_id": channel_id,
                "channel_title": channel_title,
                "xm_ticket": ticket,
                "xm_execution_price": exec_price,
                "xm_lots": lots,
                "xm_response": json.dumps(xm_res),
                "pnl_notes": f"XM Ticket #{ticket} ({lots} lots) FILLED @ {exec_price} | Hands-Off"
            })
            await update_message_trade_id(message_id, trade_id)
            return {"trade_id": trade_id, "action": "EXECUTED_ON_XM", "ticket": ticket, "lots": lots, "xm_response": xm_res}

        # Case B: Pending setup (Waiting for Tap / Confirmation)
        else:
            tid = await create_trade({
                "trade_id": trade_id,
                "symbol": symbol,
                "action": action,
                "order_type": order_type,
                "entry_price": str(entry_float) if entry_float else entry_raw,
                "sl": str(sl_raw),
                "tp_levels": tp_levels,
                "status": "PENDING",
                "outcome": "Pending Setup (Awaiting Owner Confirmation)",
                "initial_message_id": message_id,
                "channel_id": channel_id,
                "channel_title": channel_title,
                "pnl_notes": "Setup recorded. Awaiting owner 'ACTIVE NOW' confirmation to execute."
            })
            await update_message_trade_id(message_id, trade_id)
            await log_event(
                "SIGNAL", "TRADE_LIFECYCLE",
                f"Pending Trade {trade_id} detected on {symbol} @ {entry_raw}. Waiting for owner activation.",
                details=f"SL: {sl_raw}, TP: {tp_levels}"
            )
            return {"trade_id": trade_id, "action": "PENDING_AWAITING_CONFIRMATION"}

    # -------------------------------------------------------------
    # 2. TRADE UPDATE (Follow-up regarding an existing trade)
    # -------------------------------------------------------------
    elif intent == "TRADE_UPDATE":
        target_tid = interpretation.get("target_trade_id")
        update_type = (interpretation.get("update_type") or "INFO").upper()

        # Find target trade
        target_trade = None
        if target_tid:
            target_trade = await get_trade_by_id(target_tid)

        if not target_trade:
            # Fallback to most recent pending trade for this channel/symbol
            pending_list = await get_channel_pending_trades(channel_id, channel_title)
            if pending_list:
                target_trade = pending_list[0]
                target_tid = target_trade["trade_id"]

        if not target_trade:
            # Check most recent active trade
            active_list = await get_channel_active_trades(channel_id, channel_title)
            if active_list:
                target_trade = active_list[0]
                target_tid = target_trade["trade_id"]

        if not target_trade:
            # No existing trade found to update
            return {"action": "NO_TARGET_TRADE", "reason": "No pending or active trade to update."}

        target_status = target_trade.get("status", "PENDING")

        # RULE: If trade is CANCELLED, ignore new messages regarding it
        if target_status == "CANCELLED":
            await log_event("INFO", "TRADE_LIFECYCLE", f"Ignoring message for already cancelled trade {target_tid}.")
            return {"trade_id": target_tid, "action": "IGNORED", "reason": "Trade is cancelled/expired."}

        # RULE: 2-Hour Inactivity Expiration check
        created_str = target_trade.get("created_at")
        if created_str:
            try:
                # Parse created_at timestamp
                trade_dt = datetime.fromisoformat(str(created_str).replace("Z", "+00:00"))
                age_seconds = (datetime.utcnow().timestamp() - trade_dt.timestamp())
                if target_status == "PENDING" and age_seconds > 7200:
                    # Expire trade
                    await update_trade_outcome(
                        trade_id=target_tid,
                        new_status="CANCELLED",
                        outcome="Auto-Cancelled (No update within 2 hours)",
                        notes="Setup expired: 2 hours elapsed without activation.",
                        message_id=message_id
                    )
                    await log_event("INFO", "TRADE_LIFECYCLE", f"Trade {target_tid} expired after 2 hours. Message ignored.")
                    return {"trade_id": target_tid, "action": "IGNORED", "reason": "Trade expired after 2 hours."}
            except Exception:
                pass

        # RULE: Hands-Off Policy for EXECUTED trades
        # "once trade has been executed then we should not do anything from our side even if the owner say any other thing"
        if target_status == "EXECUTED":
            await update_message_trade_id(message_id, target_tid)
            # Log event in trade timeline as commentary, but DO NOT touch XM position!
            await log_event(
                "INFO", "XM_HANDS_OFF",
                f"Trade {target_tid} is already EXECUTED on XM MT5. Hands-off policy enforced: Position runs untouched.",
                details=f"Owner Message: '{raw_text}'"
            )
            async with get_db() as conn:
                await conn.execute("""
                    INSERT INTO trade_events (trade_id, message_id, event_type, previous_status, new_status, notes)
                    VALUES (?, ?, 'COMMENTARY', 'EXECUTED', 'EXECUTED', ?)
                """, (target_tid, message_id, f"Owner follow-up: {raw_text} (Hands-off: MT5 position runs untouched)"))
                await conn.commit()
            return {
                "trade_id": target_tid,
                "action": "HANDS_OFF_RUNNING",
                "message": "Position is running hands-off on XM MT5 until TP or SL."
            }

        # Handle PENDING trades
        if target_status == "PENDING":
            await update_message_trade_id(message_id, target_tid)

            # Sub-case: Owner confirmed activation ("ACTIVE NOW", "ENTER CMP", "RUNNING")
            if update_type == "ACTIVATE":
                t_symbol = target_trade["symbol"]
                t_action = target_trade["action"]
                t_entry = parse_entry_price(target_trade.get("entry_price"))
                t_sl = parse_price(target_trade.get("sl"))

                tp_levels_raw = target_trade.get("tp_levels")
                if isinstance(tp_levels_raw, str):
                    try:
                        t_tps = json.loads(tp_levels_raw)
                    except Exception:
                        t_tps = [tp_levels_raw]
                elif isinstance(tp_levels_raw, list):
                    t_tps = tp_levels_raw
                else:
                    t_tps = []

                # If entry was zone or not set, use default market level
                if t_entry <= 0:
                    t_entry = 2642.0 if "XAU" in t_symbol or "GOLD" in t_symbol else 68500.0

                # Validate proper SL and TP
                is_valid, final_sl, final_tp, val_msg = xm_executor.validate_and_enforce_sl_tp(
                    symbol=t_symbol,
                    action=t_action,
                    entry=t_entry,
                    sl=t_sl,
                    tp_levels=t_tps
                )

                if not is_valid:
                    await log_event("WARNING", "XM_SAFETY", f"Cannot activate {target_tid} on XM: {val_msg}")
                    return {"trade_id": target_tid, "action": "ACTIVATION_FAILED", "reason": val_msg}

                # Submit to XM MT5
                xm_res = await xm_executor.execute_new_trade({
                    "trade_id": target_tid,
                    "symbol": t_symbol,
                    "action": t_action,
                    "entry_price": t_entry,
                    "sl": final_sl,
                    "tp_levels": [final_tp]
                })

                ticket = xm_res.get("ticket")
                lots = xm_res.get("lots")
                exec_price = xm_res.get("price") or t_entry

                await update_trade_outcome(
                    trade_id=target_tid,
                    new_status="EXECUTED",
                    outcome="XM MT5: Running Hands-Off",
                    notes=f"Owner confirmed activation ('{raw_text}'). Executed on XM MT5 (Ticket #{ticket}, {lots} lots @ {exec_price}).",
                    message_id=message_id,
                    new_sl=str(final_sl),
                    xm_ticket=ticket,
                    xm_execution_price=exec_price,
                    xm_response=json.dumps(xm_res),
                    xm_lots=lots
                )

                await log_event(
                    "SIGNAL", "TRADE_ACTIVATION",
                    f"SUCCESS: Trade {target_tid} ACTIVATED & FILLED on XM MT5 - Ticket #{ticket} ({lots} lots @ {exec_price}). Hands-off until TP/SL.",
                    details=f"SL: {final_sl}, TP: {final_tp}"
                )
                return {"trade_id": target_tid, "action": "ACTIVATED_AND_EXECUTED", "ticket": ticket, "lots": lots, "xm_response": xm_res}

            # Sub-case: Owner cancelled / invalidated the setup
            elif update_type == "CANCEL":
                await update_trade_outcome(
                    trade_id=target_tid,
                    new_status="CANCELLED",
                    outcome="Cancelled by Channel Owner",
                    notes=f"Owner explicitly cancelled setup: '{raw_text}'",
                    message_id=message_id
                )
                await log_event("SIGNAL", "TRADE_CANCEL", f"Trade {target_tid} cancelled per owner message: '{raw_text}'")
                return {"trade_id": target_tid, "action": "CANCELLED_BY_OWNER"}

            # Sub-case: Informational commentary while pending
            else:
                async with get_db() as conn:
                    await conn.execute("""
                        INSERT INTO trade_events (trade_id, message_id, event_type, previous_status, new_status, notes)
                        VALUES (?, ?, 'COMMENTARY', 'PENDING', 'PENDING', ?)
                    """, (target_tid, message_id, f"Channel update: {raw_text}"))
                    await conn.commit()
                return {"trade_id": target_tid, "action": "PENDING_COMMENTARY"}

    # -------------------------------------------------------------
    # 3. OTHERS / CHATTER
    # -------------------------------------------------------------
    return {"action": "OTHERS_FILTERED"}
