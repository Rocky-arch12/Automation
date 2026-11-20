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

# Clean Lifecycle Outcomes
TRADE_OUTCOMES = {
    "PENDING": {
        "code": "PENDING",
        "title": "Pending Setup (Awaiting Owner Confirmation)",
        "badge_class": "badge-pending",
        "color": "#eab308",
        "is_terminal": False,
        "is_active": 1,
        "description": "Setup detected in channel; awaiting owner confirmation message before executing on XM MT5."
    },
    "PENDING_AWAITING_PARAMS": {
        "code": "PENDING_AWAITING_PARAMS",
        "title": "Active Trade Initiated (Awaiting SL/Levels)",
        "badge_class": "badge-pending",
        "color": "#3b82f6",
        "is_terminal": False,
        "is_active": 1,
        "description": "Owner announced an active trade; awaiting companion message or image with Stop Loss levels."
    },
    "EXECUTED": {
        "code": "EXECUTED",
        "title": "XM MT5: Running Hands-Off",
        "badge_class": "badge-executed",
        "color": "#10b981",
        "is_terminal": False,
        "is_active": 1,
        "description": "Executed on XM MT5 with mandatory Stop Loss. Running hands-off until SL or TP is reached."
    },
    "FAILED_EXECUTION": {
        "code": "FAILED_EXECUTION",
        "title": "XM MT5: Execution Failed",
        "badge_class": "badge-sl-hit",
        "color": "#ef4444",
        "is_terminal": True,
        "is_active": 0,
        "description": "Execution on XM MT5 failed or was rejected by broker terminal."
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

# In-memory registry of active trade initiations waiting for companion parameter messages
_active_initiations: Dict[str, Dict[str, Any]] = {}

def normalize_symbol(symbol: Optional[str], text: Optional[str] = None) -> str:
    """Normalizes symbol string to standard broker codes."""
    s = (symbol or "").upper().strip()
    t = (text or "").upper().strip()
    
    if "BTC" in s or "BITCOIN" in s or "BTC" in t or "BITCOIN" in t:
        return "BTCUSDT"
    if "ETH" in s or "ETHEREUM" in s or "ETH" in t:
        return "ETHUSDT"
    if "GBP" in s or "CABLE" in s or "GBP" in t:
        return "GBPUSD"
    if "EUR" in s or "EUR" in t:
        return "EURUSD"
    if "AUD" in s or "AUD" in t:
        return "AUDUSD"
    
    # Default asset in ALPHA PREMIUM channel is Gold
    return "XAUUSD"

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
    - Automatically executes active trades on XM MT5 even if CMP or TP is omitted.
    - Strictly enforces mandatory Stop Loss (SL).
    - Multi-message chaining: Links "Active trade" announcement to companion image or parameter message.
    - Prevents false activation of stale or unrelated pending trades.
    - Ensures UI accurately reflects live MT5 execution success or rejection.
    """
    intent = interpretation.get("intent", "OTHERS")
    symbol = normalize_symbol(interpretation.get("symbol"), raw_text)
    action = (interpretation.get("action") or "BUY").upper()
    if "BUY" not in action and "SELL" not in action:
        action = "BUY"

    order_type = (interpretation.get("order_type") or "MARKET").upper()
    entry_raw = interpretation.get("entry_price")
    sl_raw = interpretation.get("sl")
    tp_levels = interpretation.get("tp_levels") or []
    is_active_now = bool(interpretation.get("is_active_now", False))

    entry_float = parse_entry_price(entry_raw)
    sl_float = parse_price(sl_raw)

    chan_key = channel_id or channel_title or "default"

    # -------------------------------------------------------------
    # 0. Check for Active Initiation Chaining:
    # If this message contains SL/levels, check if an active trade was recently initiated
    # (e.g. owner sent "Active trade" or chart 30 seconds ago, and now sent "Entry-3770 / Sl-3763 / Tp-3783")
    # -------------------------------------------------------------
    pending_initiation = _active_initiations.pop(chan_key, None)
    if not pending_initiation:
        # Check DB for recent PENDING_AWAITING_PARAMS trade created within last 5 minutes
        async with get_db() as conn:
            cursor = await conn.execute("""
                SELECT trade_id, symbol, action, created_at FROM trades
                WHERE status = 'PENDING_AWAITING_PARAMS' AND is_active = 1
                ORDER BY id DESC LIMIT 1
            """)
            row = await cursor.fetchone()
            if row:
                try:
                    trade_dt = datetime.fromisoformat(str(row["created_at"]).replace("Z", "+00:00"))
                    if (datetime.utcnow().timestamp() - trade_dt.timestamp()) <= 300: # 5 minutes
                        pending_initiation = dict(row)
                except Exception:
                    pass

    if pending_initiation and sl_float > 0:
        target_tid = pending_initiation.get("trade_id")
        sym = pending_initiation.get("symbol") or symbol
        act = action if ("BUY" in raw_text.upper() or "SELL" in raw_text.upper()) else (pending_initiation.get("action") or action)

        is_valid, final_sl, final_tp, val_msg = xm_executor.validate_and_enforce_sl_tp(
            symbol=sym,
            action=act,
            entry=entry_float,
            sl=sl_float,
            tp_levels=tp_levels
        )

        if is_valid:
            xm_res = await xm_executor.execute_new_trade({
                "trade_id": target_tid,
                "symbol": sym,
                "action": act,
                "entry_price": entry_float,
                "sl": final_sl,
                "tp_levels": [final_tp] if final_tp else []
            })

            ticket = xm_res.get("ticket")
            lots = xm_res.get("lots")
            exec_price = xm_res.get("price") or entry_float

            if xm_res.get("success"):
                await update_trade_outcome(
                    trade_id=target_tid,
                    new_status="EXECUTED",
                    outcome="XM MT5: Running Hands-Off",
                    notes=f"Active parameters received ('{raw_text}'). Executed on XM MT5 (Ticket #{ticket}, {lots} lots @ {exec_price}).",
                    message_id=message_id,
                    new_sl=str(final_sl),
                    xm_ticket=ticket,
                    xm_execution_price=exec_price,
                    xm_response=json.dumps(xm_res),
                    xm_lots=lots
                )
                await update_message_trade_id(message_id, target_tid)
                await log_event(
                    "SIGNAL", "TRADE_ACTIVATION",
                    f"SUCCESS: Trade {target_tid} chained with active initiation & FILLED on XM MT5 - Ticket #{ticket} ({lots} lots @ {exec_price}).",
                    details=f"SL: {final_sl}, TP: {final_tp}"
                )
                return {"trade_id": target_tid, "action": "ACTIVATED_AND_EXECUTED", "ticket": ticket, "lots": lots, "xm_response": xm_res}
            else:
                err_msg = xm_res.get("message", "Unknown MT5 error")
                await update_trade_outcome(
                    trade_id=target_tid,
                    new_status="FAILED_EXECUTION",
                    outcome=f"XM MT5: {err_msg}",
                    notes=f"Execution rejected by MT5 terminal: {err_msg}",
                    message_id=message_id,
                    new_sl=str(final_sl),
                    xm_response=json.dumps(xm_res)
                )
                await update_message_trade_id(message_id, target_tid)
                return {"trade_id": target_tid, "action": "EXECUTION_FAILED", "reason": err_msg}

    # -------------------------------------------------------------
    # 1. NEW TRADE SETUP
    # -------------------------------------------------------------
    if intent == "NEW_TRADE":
        trade_id = await generate_trade_id(symbol)

        # Case A: Owner signaled immediate market entry / Active trade
        if is_active_now:
            if sl_float > 0:
                # Valid SL available: Execute immediately on XM MT5
                is_valid, final_sl, final_tp, val_msg = xm_executor.validate_and_enforce_sl_tp(
                    symbol=symbol,
                    action=action,
                    entry=entry_float,
                    sl=sl_float,
                    tp_levels=tp_levels
                )

                if not is_valid:
                    await log_event("WARNING", "XM_SAFETY", f"Execution rejected for {trade_id}: {val_msg}")
                    return {"trade_id": trade_id, "action": "REJECTED", "reason": val_msg}

                xm_res = await xm_executor.execute_new_trade({
                    "trade_id": trade_id,
                    "symbol": symbol,
                    "action": action,
                    "entry_price": entry_float,
                    "sl": final_sl,
                    "tp_levels": [final_tp] if final_tp else []
                })

                ticket = xm_res.get("ticket")
                lots = xm_res.get("lots")
                exec_price = xm_res.get("price") or entry_float

                if xm_res.get("success"):
                    tid = await create_trade({
                        "trade_id": trade_id,
                        "symbol": symbol,
                        "action": action,
                        "order_type": order_type,
                        "entry_price": str(exec_price) if exec_price else "CMP",
                        "sl": str(final_sl),
                        "tp_levels": [str(final_tp)] if final_tp else [],
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
                else:
                    err_msg = xm_res.get("message", "XM MT5 order failed")
                    tid = await create_trade({
                        "trade_id": trade_id,
                        "symbol": symbol,
                        "action": action,
                        "order_type": order_type,
                        "entry_price": str(entry_float) if entry_float else "CMP",
                        "sl": str(final_sl),
                        "tp_levels": [str(final_tp)] if final_tp else [],
                        "status": "FAILED_EXECUTION",
                        "outcome": f"XM MT5: {err_msg}",
                        "initial_message_id": message_id,
                        "channel_id": channel_id,
                        "channel_title": channel_title,
                        "xm_response": json.dumps(xm_res),
                        "pnl_notes": f"Execution rejected by MT5 terminal: {err_msg}"
                    })
                    await update_message_trade_id(message_id, trade_id)
                    return {"trade_id": trade_id, "action": "EXECUTION_FAILED", "reason": err_msg}

            else:
                # Active trade announced without SL yet (e.g. "Active trade" or chart sent first)
                tid = await create_trade({
                    "trade_id": trade_id,
                    "symbol": symbol,
                    "action": action,
                    "order_type": order_type,
                    "entry_price": str(entry_float) if entry_float else None,
                    "sl": None,
                    "tp_levels": tp_levels,
                    "status": "PENDING_AWAITING_PARAMS",
                    "outcome": "Active Trade Initiated (Awaiting SL/Levels)",
                    "initial_message_id": message_id,
                    "channel_id": channel_id,
                    "channel_title": channel_title,
                    "pnl_notes": "Owner signaled active trade. Awaiting companion message or image with Stop Loss."
                })
                await update_message_trade_id(message_id, trade_id)
                _active_initiations[chan_key] = {
                    "trade_id": trade_id,
                    "symbol": symbol,
                    "action": action,
                    "created_at": datetime.utcnow().isoformat()
                }
                await log_event(
                    "SIGNAL", "TRADE_LIFECYCLE",
                    f"Active Trade {trade_id} initiated on {symbol} ({action}). Holding for companion parameter message.",
                    details=f"Owner Message: '{raw_text}'"
                )
                return {"trade_id": trade_id, "action": "ACTIVE_INITIATED_AWAITING_PARAMS"}

        # Case B: Pending setup (Waiting for Tap / Confirmation candle)
        else:
            tid = await create_trade({
                "trade_id": trade_id,
                "symbol": symbol,
                "action": action,
                "order_type": order_type,
                "entry_price": str(entry_float) if entry_float else entry_raw,
                "sl": str(sl_raw) if sl_raw else None,
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

        target_trade = None
        if target_tid:
            target_trade = await get_trade_by_id(target_tid)

        # In case of activation: ONLY target pending trades that are recent (< 45 minutes)
        # and were explicitly awaiting confirmation!
        if update_type == "ACTIVATE" and not target_trade:
            pending_list = await get_channel_pending_trades(channel_id, channel_title)
            for pt in pending_list:
                created_str = pt.get("created_at")
                if created_str:
                    try:
                        trade_dt = datetime.fromisoformat(str(created_str).replace("Z", "+00:00"))
                        age = (datetime.utcnow().timestamp() - trade_dt.timestamp())
                        if age <= 2700: # 45 minutes
                            target_trade = pt
                            target_tid = pt["trade_id"]
                            break
                    except Exception:
                        pass

        if not target_trade and update_type != "ACTIVATE":
            active_list = await get_channel_active_trades(channel_id, channel_title)
            if active_list:
                target_trade = active_list[0]
                target_tid = target_trade["trade_id"]

        # If owner said "ACTIVE" but there is NO eligible recent pending trade:
        # Route to fresh active trade setup!
        if not target_trade and update_type == "ACTIVATE":
            fresh_interp = dict(interpretation)
            fresh_interp["intent"] = "NEW_TRADE"
            fresh_interp["is_active_now"] = True
            return await correlate_and_process_trade(
                message_id=message_id,
                interpretation=fresh_interp,
                raw_text=raw_text,
                channel_id=channel_id,
                channel_title=channel_title,
                has_image=has_image
            )

        if not target_trade:
            return {"action": "NO_TARGET_TRADE", "reason": "No pending or active trade to update."}

        target_status = target_trade.get("status", "PENDING")

        # Hands-off policy for executed positions: Once executed on MT5, Telegram messages are strictly commentary
        # ONLY our system's 5s live price polling and manual UI controls govern the MT5 trade.
        if target_status == "EXECUTED":
            await update_message_trade_id(message_id, target_tid)
            await log_event(
                "INFO", "XM_HANDS_OFF",
                f"Trade {target_tid} is already EXECUTED on XM MT5. Hands-off policy enforced: Position runs untouched by Telegram commentary.",
                details=f"Owner Message: '{raw_text}'"
            )
            async with get_db() as conn:
                await conn.execute("""
                    INSERT INTO trade_events (trade_id, message_id, event_type, previous_status, new_status, notes)
                    VALUES (?, ?, 'COMMENTARY', 'EXECUTED', 'EXECUTED', ?)
                """, (target_tid, message_id, f"Owner follow-up: {raw_text} (Hands-off: MT5 position governed strictly by system 5s polling & UI)"))
                await conn.commit()
            return {
                "trade_id": target_tid,
                "action": "HANDS_OFF_RUNNING",
                "message": "Position is running hands-off on XM MT5 until TP or SL. Telegram message recorded as commentary."
            }

        # Handle pending trade updates
        if target_status in ["PENDING", "PENDING_AWAITING_PARAMS"]:
            await update_message_trade_id(message_id, target_tid)

            if update_type == "ACTIVATE":
                t_symbol = target_trade["symbol"]
                t_action = target_trade["action"]
                t_entry = parse_entry_price(target_trade.get("entry_price")) or entry_float
                t_sl = parse_price(target_trade.get("sl")) or sl_float

                tp_levels_raw = target_trade.get("tp_levels")
                if isinstance(tp_levels_raw, str):
                    try: t_tps = json.loads(tp_levels_raw)
                    except Exception: t_tps = [tp_levels_raw]
                elif isinstance(tp_levels_raw, list):
                    t_tps = tp_levels_raw
                else:
                    t_tps = tp_levels

                is_valid, final_sl, final_tp, val_msg = xm_executor.validate_and_enforce_sl_tp(
                    symbol=t_symbol,
                    action=t_action,
                    entry=t_entry,
                    sl=t_sl,
                    tp_levels=t_tps
                )

                if not is_valid:
                    # Still awaiting SL
                    _active_initiations[chan_key] = {
                        "trade_id": target_tid,
                        "symbol": t_symbol,
                        "action": t_action,
                        "created_at": datetime.utcnow().isoformat()
                    }
                    return {"trade_id": target_tid, "action": "AWAITING_SL", "reason": val_msg}

                xm_res = await xm_executor.execute_new_trade({
                    "trade_id": target_tid,
                    "symbol": t_symbol,
                    "action": t_action,
                    "entry_price": t_entry,
                    "sl": final_sl,
                    "tp_levels": [final_tp] if final_tp else []
                })

                ticket = xm_res.get("ticket")
                lots = xm_res.get("lots")
                exec_price = xm_res.get("price") or t_entry

                if xm_res.get("success"):
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
                        f"SUCCESS: Trade {target_tid} ACTIVATED & FILLED on XM MT5 - Ticket #{ticket} ({lots} lots @ {exec_price}).",
                        details=f"SL: {final_sl}, TP: {final_tp}"
                    )
                    return {"trade_id": target_tid, "action": "ACTIVATED_AND_EXECUTED", "ticket": ticket, "lots": lots, "xm_response": xm_res}
                else:
                    err_msg = xm_res.get("message", "XM MT5 order failed")
                    await update_trade_outcome(
                        trade_id=target_tid,
                        new_status="FAILED_EXECUTION",
                        outcome=f"XM MT5: {err_msg}",
                        notes=f"Execution rejected by MT5 terminal: {err_msg}",
                        message_id=message_id,
                        new_sl=str(final_sl),
                        xm_response=json.dumps(xm_res)
                    )
                    return {"trade_id": target_tid, "action": "EXECUTION_FAILED", "reason": err_msg}

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
