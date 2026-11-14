import json
import re
from typing import Dict, Any, Optional, List, Tuple
from database import (
    create_trade,
    update_trade_outcome,
    get_active_trades_for_symbol,
    get_trade_by_id,
    get_preceding_message_trade_id,
    generate_trade_id,
    update_message_trade_id,
    log_event,
    get_db
)
from engine.xm_executor import xm_executor

# --- The 6 Specific Outcomes Requested ---
TRADE_OUTCOMES = {
    "SL_HIT": {
        "code": "SL_HIT",
        "title": "Trade executed and SL hit",
        "badge_class": "badge-sl-hit",
        "color": "#ef4444",
        "is_terminal": True,
        "is_active": 0,
        "description": "Price moved against the position and hit Stop Loss."
    },
    "TP_HIT": {
        "code": "TP_HIT",
        "title": "Trade executed and TP hit",
        "badge_class": "badge-tp-hit",
        "color": "#10b981",
        "is_terminal": True,
        "is_active": 0,
        "description": "Full Take Profit target reached. Profit booked."
    },
    "BREAK_EVEN": {
        "code": "BREAK_EVEN",
        "title": "Trade executed and break even",
        "badge_class": "badge-breakeven",
        "color": "#06b6d4",
        "is_terminal": False,
        "is_active": 1,
        "description": "Stop Loss moved to cost / entry (Risk Free trade)."
    },
    "PARTIAL_1_TO_1": {
        "code": "PARTIAL_1_TO_1",
        "title": "1:1 Hit (50% Closed, SL to BE, TP to 1:2)",
        "badge_class": "badge-1to1",
        "color": "#8b5cf6",
        "is_terminal": False,
        "is_active": 1,
        "description": "50% lots closed at 1:1 RR. Stop loss moved to entry price (Risk-Free) and TP extended to 1:2."
    },
    "MISSED_NOT_TAPPED": {
        "code": "MISSED_NOT_TAPPED",
        "title": "Trade given but level didn't tapped",
        "badge_class": "badge-missed",
        "color": "#64748b",
        "is_terminal": True,
        "is_active": 0,
        "description": "Pending level was not reached by market price; setup cancelled or invalidated."
    },
    "EARLY_EXECUTION": {
        "code": "EARLY_EXECUTION",
        "title": "Level given but executed early (Active sign)",
        "badge_class": "badge-early",
        "color": "#f59e0b",
        "is_terminal": False,
        "is_active": 1,
        "description": "Pending level was entered before exact tap because owner signaled 'ACTIVE'."
    },
    "LEVEL_TAPPED": {
        "code": "LEVEL_TAPPED",
        "title": "Level Tapped (Alert - Wait for Confirmation)",
        "badge_class": "badge-tapped",
        "color": "#f59e0b",
        "is_terminal": False,
        "is_active": 1,
        "description": "Price reached/tapped the pending zone. Alert sent to traders to prepare; awaiting candle confirmation/active call."
    },
    "ACTIVE": {
        "code": "ACTIVE",
        "title": "Trade Active & Running",
        "badge_class": "badge-active",
        "color": "#3b82f6",
        "is_terminal": False,
        "is_active": 1,
        "description": "Position is actively running in the market."
    },
    "PENDING": {
        "code": "PENDING",
        "title": "Pending Level (Waiting for Tap)",
        "badge_class": "badge-pending",
        "color": "#eab308",
        "is_terminal": False,
        "is_active": 1,
        "description": "Setup given; waiting for market price to tap level or candlestick confirmation."
    }
}

def normalize_symbol(symbol: Optional[str], text: Optional[str] = None) -> Optional[str]:
    s = (symbol or "").upper().strip()
    t = (text or "").upper().strip()

    if "GOLD" in s or "XAU" in s or "GOLD" in t or "XAU" in t:
        return "XAUUSD"
    if "BTC" in s or "BITCOIN" in s or "BTC" in t or "BITCOIN" in t:
        return "BTCUSDT"
    if "ETH" in s or "ETHEREUM" in s or "ETH" in t or "ETHEREUM" in t:
        return "ETHUSDT"
    if "GBP" in s or "CABLE" in s or "GBP" in t:
        return "GBPUSD"
    
    return s if s else None

def detect_outcome_from_message(
    text: str,
    interpretation: Dict[str, Any],
    has_image: bool = False
) -> Optional[str]:
    """
    Detects which of the lifecycle outcomes is indicated by the message text or intent.
    Respects negations (e.g. 'active mat krna abhi') and treats 'LEVEL TAPPED' strictly
    as a preparatory alert rather than an trade activation.
    """
    t = (text or "").upper()
    action = (interpretation.get("action") or "").upper()
    intent = (interpretation.get("intent") or "").upper()

    # Negation guard: Check for explicit "do not enter / wait" phrases in Hinglish/English
    is_negated = any(k in t for k in [
        "MAT KRNA", "MAT KARNA", "ABHI NAHI", "ABHI NHI", "NOT ACTIVE", "DONT ENTER",
        "DON'T ENTER", "DO NOT ENTER", "NO ENTRY", "ENTRY MAT LENA", "WAIT FOR",
        "WAIT", "ROKO", "CONFIRMATION BAKI", "HOLD ON", "HOLD ENTRY"
    ])

    # 5. MISSED / NOT TAPPED / CANCELLED (Check first so cancellations are caught)
    if any(k in t for k in [
        "NOT TAPPED", "DIDNT TAP", "DIDN'T TAP", "LEVEL NOT TAPPED", "CANCEL SETUP",
        "CANCEL ORDER", "CANCEL", "IGNORE THIS LEVEL", "SETUP CANCELLED", "MISSED THIS", "INVALIDATED"
    ]):
        return "MISSED_NOT_TAPPED"

    # LEVEL TAPPED ALERT (User Rule: Level tapped is strictly an alert for users, NOT active yet!)
    if any(k in t for k in [
        "LEVEL TAPPED", "LEVEL TAPED", "ZONE TAPPED", "ZONE REACHED", "LEVEL REACHED"
    ]) or (re.search(r"\b(tapped|taped)\b", t) and not any(k in t for k in ["NOT", "DIDNT", "CANCEL"])):
        return "LEVEL_TAPPED"

    # 1. SL HIT
    if any(k in t for k in ["SL HIT", "STOP LOSS HIT", "SL TOUCHED", "HIT SL", "HIT OUR SL"]):
        return "SL_HIT"

    # 4. PARTIAL 1:1 (User Highlighted Focus)
    if any(k in t for k in [
        "1:1", "1;1", "1:1 DONE", "1;1 DON", "1:1 ACHIEVED", "1:1 BHI HO GAYA", "1:1 GIVEN",
        "BOOK PARTIAL", "PARTIAL BOOK", "HALF BOOK", "SAFE TRADERS BOOK",
        "SAFE TRADERS OUT", "BOOK 50%", "HALF PROFIT", "1:2 ALREADY GIVEN", "1:2 DONE", "1:2 BHI HO GAYA"
    ]) or action in ["PARTIAL_CLOSE", "BOOK_PARTIAL"]:
        return "PARTIAL_1_TO_1"

    # 3. BREAK EVEN / RISK FREE
    if any(k in t for k in [
        "RISK FREE", "RISK FREE KRDO", "RISK FREE KARLO", "RISK FREE KR LENA", "RISK FREEE",
        "SL TO COST", "SL TO ENTRY", "BREAKEVEN", "BREAK EVEN", "MOVE SL TO ENTRY", "COST PE SL"
    ]) or action in ["MODIFY_SL"]:
        return "BREAK_EVEN"

    # 2. TP HIT / FULL PROFIT BOOKING
    if any(k in t for k in [
        "FULL TP", "ALL TP", "TP HIT", "TARGET HIT", "BOOK ALL YOUR PROFITS",
        "BOOK ALL PROFITS", "BOOK FULL", "FINAL TP", "BOOK YOUR PROFITSS", "PIPS BOOKED", "POINTS BOOKED"
    ]) or intent == "CLOSE_TRADE":
        return "TP_HIT"

    # 6. EARLY EXECUTION / ACTIVE (Only if NOT negated!)
    if not is_negated and any(k in t for k in [
        "ACTIVE", "RUNNING", "ACTIVE NOW", "TRIGGERED EARLY", "EXECUTED EARLY", "ENTER CMP", "ACTIVE TRADE"
    ]):
        return "EARLY_EXECUTION"

    return None

async def correlate_and_process_trade(
    message_id: int,
    interpretation: Dict[str, Any],
    raw_text: str,
    has_image: bool = False
) -> Dict[str, Any]:
    """
    Correlates an incoming message to an existing active trade or spawns a new unique trade.
    Enforces strict rules:
      - 'LEVEL TAPPED' is an alert (status = LEVEL_TAPPED, is_active = 1), NOT an activation.
      - Negations (e.g. 'active mat krna abhi') do NOT trigger active.
      - Any follow-up lacking brand-new complete order parameters (new entry + new SL) strictly
        links to the earlier trade on that asset/chat.
      - A new Trade ID is created ONLY if the message explicitly contains a complete new setup
        (both entry + SL) that differs from the active trade.
    """
    symbol = normalize_symbol(interpretation.get("symbol"), raw_text)
    detected_outcome = detect_outcome_from_message(raw_text, interpretation, has_image)

    t = (raw_text or "").upper()
    is_negated = any(k in t for k in [
        "MAT KRNA", "MAT KARNA", "ABHI NAHI", "ABHI NHI", "NOT ACTIVE", "DONT ENTER",
        "DON'T ENTER", "DO NOT ENTER", "NO ENTRY", "ENTRY MAT LENA", "WAIT FOR",
        "WAIT", "ROKO", "CONFIRMATION BAKI", "HOLD ON", "HOLD ENTRY"
    ])

    intent = interpretation.get("intent", "CHATTER")

    # If outcome matched, ensure intent reflects trade update
    if detected_outcome and intent == "CHATTER":
        interpretation["intent"] = "TRADE_UPDATE"
        interpretation["is_trade"] = 1

    # Check whether the message explicitly contains a complete new order structure (new entry + new SL)
    new_entry_raw = interpretation.get("entry_price")
    new_sl_raw = interpretation.get("sl")
    sl_str = str(new_sl_raw or "").upper().strip()
    is_sl_be = any(k in sl_str for k in ["BREAKEVEN", "ENTRY", "COST", "OPEN", "NONE", "NULL"]) or not sl_str
    
    # Must have both a specific entry AND a non-breakeven protective SL to count as a brand-new setup
    has_full_order = bool(
        new_entry_raw and 
        new_sl_raw and 
        not is_sl_be and 
        intent in ["NEW_TRADE", "PENDING_CONFIRMATION"]
    )

    # 1. Look for existing open trades for this symbol
    open_trades = await get_active_trades_for_symbol(symbol)

    # 2. If no open trade found for this symbol, look for ANY active trade globally in the system
    if not open_trades:
        async with get_db() as conn:
            cursor = await conn.execute("SELECT * FROM trades WHERE is_active = 1 ORDER BY id DESC LIMIT 1")
            row = await cursor.fetchone()
            if row:
                open_trades = [dict(row)]

    # 3. If STILL no active trade (e.g. earlier trade was marked closed, or message is a follow-up),
    # look at the most recent trade referenced by earlier messages in the system
    if not open_trades and (detected_outcome or not has_full_order):
        async with get_db() as conn:
            cursor = await conn.execute("""
                SELECT trade_id FROM messages 
                WHERE trade_id IS NOT NULL AND trade_id != '' 
                ORDER BY id DESC LIMIT 1
            """)
            last_m = await cursor.fetchone()
            if last_m:
                last_trade = await get_trade_by_id(last_m["trade_id"])
                if last_trade:
                    open_trades = [last_trade]

    # === SCENARIO A: Follow-Up Message / Message Lacking Complete Order (Entry + SL) ===
    # User Strict Rule: Follow-up messages (LEVEL TAPED, ACTIVE, HOLD, RISK FREE, 1:1, etc.)
    # MUST strictly anchor to the earlier/above message in the timeline and link to THAT trade ID!
    if not has_full_order:
        target_trade = None

        # 1. Primary Rule: Check the trade_id of the immediate preceding message in the channel/timeline
        preceding_trade_id = await get_preceding_message_trade_id(message_id, symbol)
        if preceding_trade_id:
            target_trade = await get_trade_by_id(preceding_trade_id)

        # 2. Fallback: If preceding message had no trade, use active trade for symbol
        if not target_trade and open_trades:
            target_trade = open_trades[0]

        if target_trade:
            trade_id = target_trade["trade_id"]

            # Outcome matched
            if detected_outcome:
                outcome_info = TRADE_OUTCOMES[detected_outcome]
                notes = f"Owner update: '{raw_text[:60]}'. Status -> {outcome_info['title']}."

                new_sl = None
                if detected_outcome == "BREAK_EVEN":
                    new_sl = target_trade.get("entry_price") or "BREAKEVEN"
                    notes = f"Risk-Free update: Stop loss moved to Entry ({new_sl}). Trade secured."
                    if xm_executor.auto_execution_enabled:
                        try:
                            e_num = float(re.sub(r'[^\d.]', '', str(target_trade.get("entry_price") or "0")))
                            if e_num > 0:
                                await xm_executor.execute_modify_sl_breakeven(trade_id, e_num)
                        except Exception:
                            pass
                elif detected_outcome == "PARTIAL_1_TO_1":
                    notes = f"1:1 target hit: 50% partial lots booked. SL dragged to Entry (Break Even) & TP extended to 1:2. ({raw_text[:40]})"
                    if xm_executor.auto_execution_enabled:
                        await xm_executor.execute_partial_exit_and_extend_1to2(trade_id)
                elif detected_outcome == "LEVEL_TAPPED":
                    notes = f"Level tapped alert: market reached pending zone. Traders alert; waiting for entry confirmation."
                elif detected_outcome == "EARLY_EXECUTION":
                    if target_trade.get("status") in ["PENDING", "LEVEL_TAPPED"]:
                        notes = "Pending setup executed early after owner signaled 'ACTIVE'."
                        if xm_executor.auto_execution_enabled:
                            await xm_executor.execute_new_trade({
                                "trade_id": trade_id,
                                "symbol": target_trade.get("symbol"),
                                "action": target_trade.get("action"),
                                "order_type": "MARKET",
                                "entry_price": target_trade.get("entry_price"),
                                "sl": target_trade.get("sl"),
                                "tp_levels": target_trade.get("tp_levels", [])
                            })
                    else:
                        detected_outcome = "ACTIVE"
                        notes = "Owner confirmed trade is active and running."

                await update_trade_outcome(
                    trade_id=trade_id,
                    new_status=detected_outcome,
                    outcome=outcome_info["title"],
                    notes=notes,
                    message_id=message_id,
                    new_sl=new_sl
                )

                await log_event(
                    "SIGNAL", "LIFECYCLE",
                    f"Trade {trade_id} ({symbol}) status updated -> {outcome_info['title']}",
                    details=notes
                )

                return {
                    "action": "UPDATED_TRADE",
                    "trade_id": trade_id,
                    "status": detected_outcome,
                    "outcome": outcome_info["title"],
                    "badge_class": outcome_info["badge_class"]
                }

            # If message contains negation (e.g. "active mat krna abhi")
            if is_negated:
                notes = f"Owner advisory: '{raw_text}'. Hold position, do not activate yet."
                await update_message_trade_id(message_id, trade_id)
                await log_event(
                    "INFO", "LIFECYCLE",
                    f"Trade {trade_id} ({symbol}) advisory: {notes}",
                    details=raw_text
                )
                return {
                    "action": "LINKED_TRADE",
                    "trade_id": trade_id,
                    "status": target_trade.get("status"),
                    "outcome": target_trade.get("outcome"),
                    "badge_class": TRADE_OUTCOMES.get(target_trade.get("status", "ACTIVE"), {}).get("badge_class", "badge-active")
                }

            # Generic update or pips chatter on existing trade
            await update_message_trade_id(message_id, trade_id)
            return {
                "action": "LINKED_TRADE",
                "trade_id": trade_id,
                "status": target_trade.get("status"),
                "outcome": target_trade.get("outcome"),
                "badge_class": TRADE_OUTCOMES.get(target_trade.get("status", "ACTIVE"), {}).get("badge_class", "badge-active")
            }

        # If no active or earlier trade exists and message has no entry+SL, it's chatter/noise
        return {"action": "NO_TRADE", "trade_id": None}

    # === SCENARIO B: Complete Order Structure Present (Entry + SL) ===
    # Check if this setup is different from the currently open trade
    if open_trades:
        target_trade = open_trades[0]
        trade_id = target_trade["trade_id"]
        new_action = interpretation.get("action") or "BUY"
        existing_action = target_trade.get("action")
        existing_entry = str(target_trade.get("entry_price") or "")

        # Check if same direction and price within 1.5% -> treat as same trade repost
        is_different = (new_action != existing_action)
        try:
            if new_entry_raw and existing_entry:
                ne_val = float(re.sub(r'[^\d.]', '', str(new_entry_raw)))
                ee_val = float(re.sub(r'[^\d.]', '', existing_entry))
                if abs(ne_val - ee_val) / ee_val > 0.015:
                    is_different = True
        except Exception:
            pass

        if not is_different:
            # Same setup / repost of existing trade
            await update_message_trade_id(message_id, trade_id)
            return {
                "action": "LINKED_TRADE",
                "trade_id": trade_id,
                "status": target_trade.get("status"),
                "outcome": target_trade.get("outcome"),
                "badge_class": TRADE_OUTCOMES.get(target_trade.get("status", "ACTIVE"), {}).get("badge_class", "badge-active")
            }

    # Brand new distinct trade setup! Create new unique Trade ID
    symbol = symbol or "XAUUSD"
    new_trade_id = await generate_trade_id(symbol)

    # Determine initial status
    is_pending = any(k in t for k in [
        "BE READY", "CONFIRMATION", "WAIT FOR TAP", "LIMIT", "IF THIS LEVEL",
        "WAIT FOR", "LEVEL TAP", "IF I CONFIRM"
    ])

    initial_status = "PENDING" if is_pending else "ACTIVE"
    outcome_info = TRADE_OUTCOMES.get(initial_status, TRADE_OUTCOMES["ACTIVE"])

    # XM Execution Trigger (Enforces proper SL & TP, 0.01 Gold, 0.04 BTC, $15 Risk rest)
    xm_exec_note = ""
    if initial_status == "ACTIVE" and xm_executor.auto_execution_enabled:
        xm_res = await xm_executor.execute_new_trade({
            "trade_id": new_trade_id,
            "symbol": symbol,
            "action": interpretation.get("action", "BUY"),
            "order_type": interpretation.get("order_type", "MARKET"),
            "entry_price": interpretation.get("entry_price"),
            "sl": interpretation.get("sl"),
            "tp_levels": interpretation.get("tp_levels", [])
        })
        if xm_res.get("success"):
            xm_exec_note = f" | XM #{xm_res.get('ticket')} ({xm_res.get('lots')} lots, 1:1 TP: {xm_res.get('tp')})"
        elif xm_res.get("status") == "BLOCKED_BY_SAFETY_SHIELD":
            xm_exec_note = f" | [SAFETY SHIELD: {xm_res.get('message')}]"

    await create_trade({
        "trade_id": new_trade_id,
        "symbol": symbol,
        "action": interpretation.get("action", "BUY"),
        "order_type": interpretation.get("order_type", "MARKET"),
        "entry_price": interpretation.get("entry_price"),
        "sl": interpretation.get("sl"),
        "tp_levels": interpretation.get("tp_levels", []),
        "risk_reward": interpretation.get("risk_reward"),
        "status": initial_status,
        "outcome": outcome_info["title"],
        "initial_message_id": message_id,
        "pnl_notes": f"Initial setup published. {outcome_info['title']}{xm_exec_note}"
    })

    await update_message_trade_id(message_id, new_trade_id)

    await log_event(
        "SIGNAL", "LIFECYCLE",
        f"Trade {new_trade_id} created for {symbol} with status: {outcome_info['title']}",
        details=f"Owner intent: {interpretation.get('reasoning')}"
    )

    return {
        "action": "CREATED_TRADE",
        "trade_id": new_trade_id,
        "status": initial_status,
        "outcome": outcome_info["title"],
        "badge_class": outcome_info["badge_class"]
    }
