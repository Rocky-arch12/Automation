import os
import re
import json
import time
import asyncio
from datetime import datetime, timedelta, timezone
from typing import Dict, Any, Optional, List
from config import settings
from database import get_all_settings
from engine.vision_processor import process_and_encode_image, analyze_chart_with_cv

SYSTEM_PROMPT = """You are the AlphaSignal AI Trading & Intent Classifier for the VIP Telegram Channels 'ALPHA PREMIUM' and 'Alpha Trades'.
Your primary mission is to discern the TRUE INTENT of the channel owner. You must distinguish between:
1. Genuine, immediate live trades to execute NOW.
2. Conditional plans/ideas waiting for future market confirmation.
3. Casual commentary, past trade profit recaps, promotional affiliate marketing, and chit-chat.

The channel owner communicates in English, Hindi, and Hinglish. Understand the nuances:

1. INTENT CATEGORIES (Strict Evaluation of Owner's True Intent):
   a. "NEW_TRADE" (Genuine Trade Setup):
      - Immediate Execution ("is_active_now": true):
        * The owner explicitly signals immediate market entry (e.g. "Active trade", "Active selling trade", "CMP pe sell kr skte ho", "Gold buy now", "Enter fast", "Another active trade").
        * Or the owner provides explicit parameters (Entry, SL, TP) right after an "Active trade" announcement.
      - Conditional / Pending Setup ("is_active_now": false):
        * The owner is sharing a trading plan or idea that is CONDITIONAL on future confirmation (e.g. "GOLD SELL PLAN FROM THIS LEVEL AFTER 5 MIN CHOCH OR BIG ENGULFING CANDLE CONFIRMATION", "Wait for tap", "Confirmation pe hi entry krna", "Be ready on this level", "Agar level break ho tab").
        * In this case, "is_active_now" MUST BE FALSE! Never mark conditional plans as active.
      - Risky Setups ("is_active_now": true):
        * Messages like "RISKY HAI TRY KR SKTE HO HALF LOTS SE" or "Small risk hai" are intentional active trades ("is_active_now": true).

   b. "TRADE_UPDATE" (Managing an Existing Trade):
      - "ACTIVATE": Owner EXPLICITLY activates a recent pending setup or signals immediate confirmation (e.g. "Level tapped now active", "Confirm candle ban gayi active", "5 min engulfing per active kr dena\nActive").
        * IMPORTANT: If the previous setup in history is already CANCELLED / SL_HIT / TP_HIT (or >2 hours old) and the owner sends a fresh chart with Entry/SL/TP and "Active", classify as "NEW_TRADE" with "is_active_now": true (and "target_trade_id": null)!
      - "CANCEL": Owner cancels a setup ("Cancel this level", "Active mat krna").
      - "INFO": Commentary or level touch alert on a setup/running trade:
        * "Level tapped" / "Level taped" / "Zone tapped" ALONE (without words like "active", "enter", "executed") ONLY means price reached the watchlist zone and is still awaiting candle confirmation -> MUST be "update_type": "INFO" and "is_active_now": false (NEVER "ACTIVATE"!).
        * Running trade commentary ("1:1 done move SL to BE", "Running 100 pips", "Book partials here", "TP1 HIT AGAIN").

   c. "OTHERS" (Non-Actionable Content - NEVER Execute as a Trade!):
      - Profit celebrations / recaps ("200 pips boom 🚀", "250 pips done guys 😂", "Gold flying 💸", "40 PIPS DONE", "110 PIPS DONE").
      - Promotional affiliate marketing, coupon codes, VIP ads (e.g. "🚨 FUNDEDNOW LIMITED TIME ALERT 🚨", "Coupon code Alpha10", "Prop firm discount").
      - YouTube livestream links ("LIVE AFTER 3 DAYS JOIN FAST").
      - News screenshots, general greetings ("Good morning traders"), or casual channel banter.
      - IMPORTANT: Even if a promo or recap quotes old trade numbers (e.g. "Entry-3621 Sl-3631 running 70 pips"), if it is an ad or recap, it MUST BE CLASSIFIED AS "OTHERS"!

2. DYNAMIC ASSET & SYMBOL EXTRACTION:
   - The owner trades multiple instruments: Gold, Forex pairs (USDCHF, EURUSD, GBPUSD, USDJPY, USDCAD, AUDUSD, NZDUSD, etc.), Crypto (BTC, ETH), and Indices (US30, NAS100).
   - ALWAYS extract the exact symbol the owner specifies or shown in the chart top-left header (e.g. "Gold Spot" -> "XAUUSD", "British Pound / U.S. Dollar" -> "GBPUSD", "Bitcoin / U.S. Dollar" -> "BTCUSD"). NEVER default to Gold when a specific pair is named!
   - Only if NO symbol is mentioned in the text or chart, and trade parameters are given in the Gold channel, use "XAUUSD".

3. MATHEMATICAL DIRECTION VALIDATION:
   - If SL > Entry or SL > TP (SL is HIGHER than entry/target) -> Action MUST BE "SELL" (Short).
   - If SL < Entry or SL < TP (SL is LOWER than entry/target) -> Action MUST BE "BUY" (Long).

4. CHART POSITION TOOL & CALLOUT EXTRACTION:
   - When a TradingView screenshot is attached:
     * Read ONLY the numbers visibly printed inside THIS attached image! NEVER copy or hallucinate prices from earlier messages in history.
     * For Long/Short Position Tool screenshots: Red box/label on price scale = STOP LOSS (SL); Gray box/label = ENTRY price; Green box/label = TAKE PROFIT (TP). Red on TOP + Green on BOTTOM = SELL; Green on TOP + Red on BOTTOM = BUY.
     * For conditional zone/level screenshots (without Long/Short boxes): read the white rectangular price callout balloon (e.g. "3,564.02" or "1.31146") pointing to the shaded zone as "entry_price", and leave "sl" and "tp" as null unless explicitly shown.

Respond strictly with a valid JSON object matching this schema:
{
  "intent": "NEW_TRADE" | "TRADE_UPDATE" | "OTHERS",
  "symbol": string or null,
  "action": "BUY" | "SELL" | null,
  "order_type": "MARKET" | "LIMIT" | null,
  "entry_price": string or number or null,
  "sl": string or number or null,
  "tp": string or number or null,
  "is_active_now": boolean,
  "target_trade_id": string or null,
  "update_type": "ACTIVATE" | "CANCEL" | "INFO" | null,
  "confidence": 0-100,
  "reasoning": string
}
Only output the JSON object without markdown quotes or explanation outside the JSON.
"""

def build_context_prompt(
    text: str,
    channel_title: Optional[str] = None,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    pending_trades: Optional[List[Dict[str, Any]]] = None,
    active_trades: Optional[List[Dict[str, Any]]] = None,
    current_cv_info: Optional[Dict[str, Any]] = None
) -> str:
    lines = []
    lines.append(f"Telegram Channel: {channel_title or 'ALPHA PREMIUM'}")
    lines.append("")

    # 1. Existing Pending Trade Setups
    lines.append("CURRENTLY PENDING TRADE SETUPS (Awaiting owner confirmation to activate):")
    if pending_trades:
        for pt in pending_trades:
            t_id = pt.get("trade_id")
            sym = pt.get("symbol")
            act = pt.get("action")
            ent = pt.get("entry_price")
            sl = pt.get("sl")
            tp = pt.get("tp_levels")
            st = pt.get("status", "PENDING")
            lines.append(f"- ID: {t_id} | Symbol: {sym} | Action: {act} | Entry: {ent} | SL: {sl} | TP: {tp} | Status: {st}")
    else:
        lines.append("- (No pending trade setups in this channel)")
    lines.append("")

    # 2. Existing Active Running Trades
    lines.append("CURRENTLY EXECUTED & RUNNING TRADES ON XM MT5:")
    if active_trades:
        for at in active_trades:
            t_id = at.get("trade_id")
            sym = at.get("symbol")
            act = at.get("action")
            ent = at.get("entry_price")
            sl = at.get("sl")
            tp = at.get("tp_levels")
            ticket = at.get("xm_ticket")
            lines.append(f"- ID: {t_id} | Symbol: {sym} | Action: {act} | Entry: {ent} | SL: {sl} | TP: {tp} | XM Ticket: #{ticket} | Status: EXECUTED (Hands-Off)")
    else:
        lines.append("- (No active running positions)")
    lines.append("")

    # 3. Past 10 Messages
    lines.append("RECENT CHANNEL HISTORY (Last up to 10 messages in chronological order):")
    ist_tz = timezone(timedelta(hours=5, minutes=30))
    if history_messages:
        for idx, m in enumerate(history_messages, 1):
            s_name = m.get("sender") or "Owner"
            m_text = (m.get("text") or "").strip()
            raw_created = str(m.get("created_at") or "")
            time_str = raw_created[11:16]
            try:
                dt_utc = datetime.fromisoformat(raw_created.replace("Z", "+00:00"))
                if dt_utc.tzinfo is None:
                    dt_utc = dt_utc.replace(tzinfo=timezone.utc)
                time_str = dt_utc.astimezone(ist_tz).strftime("%H:%M IST")
            except Exception:
                pass
            t_status = m.get("trade_status")
            tid = f" [Linked Trade: {m.get('trade_id')} ({t_status or 'LINKED'})]" if m.get("trade_id") else ""
            img_note = ""
            if m.get("media_path"):
                if m.get("symbol") and m.get("action"):
                    img_note = f" [Attached Chart: {m.get('action')} {m.get('symbol')} Entry: {m.get('entry_price')}, SL: {m.get('sl')}, TP: {m.get('tp_levels')}]"
                else:
                    img_note = " [Chart Screenshot Attached]"
            lines.append(f"{idx}. [{time_str}] {s_name}: \"{m_text}\"{img_note}{tid}")
    else:
        lines.append("- (No previous message history recorded)")
    lines.append("")

    # 4. Current Message to Classify
    lines.append("CURRENT INCOMING MESSAGE TO CLASSIFY:")
    lines.append(f"Text: \"{text or '[Chart Screenshot Broadcast]'}\"")
    if current_cv_info:
        lines.append("Attached Chart Screenshot: Inspect the TradingView Long/Short Position Tool, white price callout balloons, and right-hand price axis labels.")
        lines.append("- Visual Tool Rule: Red box on TOP / Green box on BOTTOM = SELL (Short). Green box on TOP / Red box on BOTTOM = BUY (Long).")
        lines.append("- Mathematical Price Rule: If SL > Entry or SL > TP -> Action MUST be SELL. If SL < Entry or SL < TP -> Action MUST be BUY.")
        lines.append("CRITICAL: Read the exact digits printed in THIS chart screenshot (Stop Loss red label, Entry gray label or white callout balloon, Take Profit green label). NEVER reuse prices from earlier history messages.")

    return "\n".join(lines)

def classify_with_context_heuristic(
    text: str,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    pending_trades: Optional[List[Dict[str, Any]]] = None,
    active_trades: Optional[List[Dict[str, Any]]] = None,
    image_cv: Optional[Dict[str, Any]] = None,
    has_image: bool = False
) -> Dict[str, Any]:
    """
    Context-aware fallback classifier: Evaluates incoming messages against channel history,
    pending trades, and active positions.
    """
    raw = (text or "").strip()
    t = raw.upper()

    # Analyze history context
    history_has_active = False
    history_has_selling = False
    history_has_buying = False
    history_symbol = "XAUUSD"

    if history_messages and len(history_messages) > 0:
        recent_h = history_messages[-3:] # Last 3 messages
        for hm in reversed(recent_h):
            htxt = (hm.get("text") or "").upper()
            if any(k in htxt for k in ["ACTIVE TRADE", "ACTIVE", "ACTIVE NOW", "ACTIVE SELLING"]):
                history_has_active = True
            if "SELL" in htxt or "SHORT" in htxt:
                history_has_selling = True
            if "BUY" in htxt or "LONG" in htxt:
                history_has_buying = True
            if "ETH" in htxt:
                history_symbol = "ETHUSDT"
            elif "BTC" in htxt:
                history_symbol = "BTCUSDT"
            elif "GBP" in htxt:
                history_symbol = "GBPUSD"

    # 1. Cancellation detection
    cancel_keywords = [
        "CANCEL", "CANCLE", "ACTIVE MAT KRNA", "MAT KARNA", "ABHI NAHI", "NOT TAPPED", "DIDNT TAP",
        "DIDN'T TAP", "LEVEL NOT TAPPED", "SETUP CANCELLED", "IGNORE THIS", "INVALIDATED", "DONT ENTER", "CTC"
    ]
    if any(k in t for k in cancel_keywords):
        target_id = None
        if active_trades and len(active_trades) > 0:
            target_id = active_trades[0].get("trade_id")
        elif pending_trades and len(pending_trades) > 0:
            target_id = pending_trades[0].get("trade_id")
        return {
            "intent": "TRADE_UPDATE",
            "symbol": None,
            "action": "NONE",
            "order_type": "NONE",
            "entry_price": None,
            "sl": None,
            "tp_levels": [],
            "is_trade": 1,
            "is_active_now": False,
            "target_trade_id": target_id,
            "update_type": "CANCEL",
            "confidence": 92,
            "reasoning": f"Owner cancelled / closed setup for trade {target_id or 'running'}."
        }

    # 2. Extract numeric parameters from text: Entry, SL, TP / Target
    entry_match = re.search(r'(?:ENTRY|ZONE|AT|CMP|@)\s*[-:=]?\s*(\d+[.,]?\d*)', t)
    sl_match = re.search(r'(?:SL|STOP\s*LOSS|STOP|SL\s*BELOW\s*THIS)\s*[-:=]?\s*(\d+[.,]?\d*)', t)
    tp_match = re.search(r'(?:TP|TP1|TARGET|TAKE\s*PROFIT)\s*[-:=]?\s*(\d+[.,]?\d*)', t)

    # Multi-line or 3-line format support:
    # Entry-3770 / Sl-3763 / Tp-3783 OR Entry-4090 / Sl-4084 / Target-4102 OR Entry-2022 / Sl-2054 / 1943
    numbers = [float(x) for x in re.findall(r'\b(?:\d{2,6}(?:\.\d{1,4})?)\b', t.replace(",", ""))]

    entry_val = entry_match.group(1).replace(",", "") if entry_match else None
    sl_val = sl_match.group(1).replace(",", "") if sl_match else None
    tp_val = tp_match.group(1).replace(",", "") if tp_match else None

    # If numbers found and SL missing, look for line patterns
    lines = [line.strip().upper() for line in raw.split("\n") if line.strip()]
    for line in lines:
        if not entry_val and ("ENTRY" in line or line.startswith("E-") or line.startswith("E:")):
            m = re.search(r'(\d+[.,]?\d*)', line)
            if m: entry_val = m.group(1).replace(",", "")
        if not sl_val and ("SL" in line or "STOP" in line):
            m = re.search(r'(\d+[.,]?\d*)', line)
            if m: sl_val = m.group(1).replace(",", "")
        if not tp_val and ("TP" in line or "TARGET" in line):
            m = re.search(r'(\d+[.,]?\d*)', line)
            if m: tp_val = m.group(1).replace(",", "")

    # If 3 numbers present and only entry/sl found, 3rd number is likely TP
    if entry_val and sl_val and not tp_val and len(numbers) >= 3:
        for num in numbers:
            if str(num) != str(entry_val) and str(num) != str(sl_val):
                tp_val = str(num)
                break

    # Determine Symbol
    symbol = history_symbol
    if "ETH" in t: symbol = "ETHUSDT"
    elif "BTC" in t or "BITCOIN" in t: symbol = "BTCUSDT"
    elif "GBP" in t: symbol = "GBPUSD"
    elif "EUR" in t: symbol = "EURUSD"
    elif "GOLD" in t or "XAU" in t: symbol = "XAUUSD"

    # Determine Action (BUY vs SELL)
    has_buy = "BUY" in t or "LONG" in t
    has_sell = "SELL" in t or "SHORT" in t
    if has_sell and not has_buy:
        action = "SELL"
    elif has_buy and not has_sell:
        action = "BUY"
    elif entry_val and sl_val:
        # Mathematical deduction: SL < Entry -> BUY, SL > Entry -> SELL
        try:
            e_f = float(entry_val)
            s_f = float(sl_val)
            action = "BUY" if s_f < e_f else "SELL"
        except Exception:
            action = "BUY"
    elif sl_val and tp_val:
        # Mathematical deduction: SL < TP -> BUY, SL > TP -> SELL
        try:
            s_f = float(sl_val)
            t_f = float(tp_val)
            action = "BUY" if s_f < t_f else "SELL"
        except Exception:
            action = "BUY"
    elif history_has_selling:
        action = "SELL"
    elif history_has_buying:
        action = "BUY"
    elif image_cv and image_cv.get("detected"):
        action = image_cv.get("action", "BUY")
    else:
        action = "BUY"

    # Determine if trade is active now or pending confirmation
    is_active_explicit = any(k in t for k in ["ACTIVE", "ACTIVVE", "NOW", "CMP", "RUNNING"])
    is_pending_explicit = any(k in t for k in ["CONFIRMATION", "WAIT", "BE READY", "TAP PE", "PLAN KRENGE"]) and not is_active_explicit

    is_active_now = is_active_explicit or history_has_active or (not is_pending_explicit and (entry_val is not None or sl_val is not None))

    # Case A: We have parameters (SL or Entry+SL), e.g. "Entry-3770 \n Sl-3763 \n Tp-3783" or "Gold buy now Sl 3860"
    if sl_val is not None or (entry_val is not None and tp_val is not None):
        tp_levels = [str(tp_val)] if tp_val else []
        return {
            "intent": "NEW_TRADE",
            "symbol": symbol,
            "action": action,
            "order_type": "MARKET" if is_active_now else "LIMIT",
            "entry_price": str(entry_val) if entry_val else None,
            "sl": str(sl_val),
            "tp_levels": tp_levels,
            "is_trade": 1,
            "is_active_now": is_active_now,
            "target_trade_id": None,
            "update_type": None,
            "confidence": 95,
            "reasoning": f"Identified {action} setup on {symbol} (Entry: {entry_val or 'CMP'}, SL: {sl_val}, TP: {tp_val or 'None'}). Active: {is_active_now}."
        }

    # Case B: Standalone "Active trade" / "Active" / "Active selling trade" (with or without image)
    if is_active_explicit or "ACTIVE TRADE" in t or t == "ACTIVE":
        # Check if there is a pending confirmation trade created within 45 mins that was awaiting tap/confirmation
        is_confirmation_activation = False
        target_id = None
        if pending_trades and len(pending_trades) > 0:
            candidate = pending_trades[0]
            cand_notes = str(candidate.get("outcome") or "") + str(candidate.get("pnl_notes") or "")
            if any(k in cand_notes.upper() for k in ["CONFIRMATION", "TAP", "PENDING SETUP"]):
                is_confirmation_activation = True
                target_id = candidate.get("trade_id")

        if is_confirmation_activation and target_id:
            return {
                "intent": "TRADE_UPDATE",
                "symbol": symbol,
                "action": action,
                "order_type": "MARKET",
                "entry_price": None,
                "sl": None,
                "tp_levels": [],
                "is_trade": 1,
                "is_active_now": True,
                "target_trade_id": target_id,
                "update_type": "ACTIVATE",
                "confidence": 92,
                "reasoning": f"Owner confirmed pending confirmation setup {target_id} is active."
            }

        # Otherwise, "Active trade" is the start of a fresh active trade setup!
        return {
            "intent": "NEW_TRADE",
            "symbol": symbol,
            "action": action,
            "order_type": "MARKET",
            "entry_price": None,
            "sl": None,
            "tp_levels": [],
            "is_trade": 1,
            "is_active_now": True,
            "target_trade_id": None,
            "update_type": None,
            "confidence": 90,
            "reasoning": f"Owner announced active {action} trade on {symbol}. Awaiting parameters or executing at CMP."
        }

    # Case C: Risky Trade announcement ("RISKY TRADE IN SELL SIDE GOLD", "Small risk hai guyss")
    if any(k in t for k in ["RISKY TRADE", "SMALL RISK", "RISK TRADERS"]):
        return {
            "intent": "NEW_TRADE",
            "symbol": symbol,
            "action": action,
            "order_type": "MARKET" if is_active_now else "LIMIT",
            "entry_price": None,
            "sl": None,
            "tp_levels": [],
            "is_trade": 1,
            "is_active_now": is_active_now,
            "target_trade_id": None,
            "update_type": None,
            "confidence": 88,
            "reasoning": f"Owner announced risky {action} trade on {symbol}."
        }

    # Case D: Image Attached with Computer Vision detected position
    if image_cv and image_cv.get("detected"):
        action = image_cv.get("action", "BUY")
        return {
            "intent": "NEW_TRADE",
            "symbol": symbol,
            "action": action,
            "order_type": "MARKET" if history_has_active else "LIMIT",
            "entry_price": None,
            "sl": None,
            "tp_levels": [],
            "is_trade": 1,
            "is_active_now": history_has_active,
            "target_trade_id": None,
            "update_type": None,
            "confidence": 90,
            "reasoning": f"TradingView chart position detected: {action} on {symbol}."
        }

    # Case E: Running Trade Updates & Commentary ("1:1 DONE", "RISK FREE KRDO", "PIPS DONE")
    info_keywords = [
        "1:1 DONE", "1:2 DONE", "RISK FREE", "PIPS DONE", "PIPS RUNNING", "TARGET DONE",
        "FULL TP", "BOOK YOUR PROFITS", "BOOK PARTIALS", "SL HIT", "HOLD IT"
    ]
    if any(k in t for k in info_keywords):
        target_id = None
        if active_trades and len(active_trades) > 0:
            target_id = active_trades[0].get("trade_id")
        return {
            "intent": "TRADE_UPDATE",
            "symbol": symbol,
            "action": "NONE",
            "order_type": "NONE",
            "entry_price": None,
            "sl": None,
            "tp_levels": [],
            "is_trade": 1,
            "is_active_now": False,
            "target_trade_id": target_id,
            "update_type": "INFO",
            "confidence": 92,
            "reasoning": f"Running trade status commentary for {target_id or 'active position'}."
        }

    # Case F: Chatter & Noise
    return {
        "intent": "OTHERS",
        "symbol": None,
        "action": "NONE",
        "order_type": "NONE",
        "entry_price": None,
        "sl": None,
        "tp_levels": [],
        "is_trade": 0,
        "is_active_now": False,
        "target_trade_id": None,
        "update_type": None,
        "confidence": 85,
        "reasoning": "Channel commentary, greeting, or promotional message."
    }

async def analyze_message_with_ai(
    text: str,
    image_path: Optional[str] = None,
    channel_title: Optional[str] = None,
    channel_id: Optional[str] = None,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    pending_trades: Optional[List[Dict[str, Any]]] = None,
    active_trades: Optional[List[Dict[str, Any]]] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Primary AI Intent & Classification Engine.
    Passes 10-message conversational context, image analysis, and pending/active trade context
    to Groq (qwen/qwen3.8-27b Vision / gpt-oss-120b) or Gemini for 3-way classification.
    """
    stored = {}
    try:
        stored = await get_all_settings()
    except Exception:
        pass

    active_provider = (provider or stored.get("AI_PROVIDER") or settings.AI_PROVIDER or "groq").lower()
    start_time = time.time()

    # Resolve relative image path
    resolved_path = image_path
    if image_path and not os.path.isabs(image_path):
        candidate = settings.BASE_DIR / image_path
        if candidate.exists():
            resolved_path = str(candidate)

    # Run fast local CV check for chart presence / TradingView zones
    cv_info = None
    if resolved_path and os.path.exists(resolved_path):
        cv_info = analyze_chart_with_cv(resolved_path) or {"has_image": True}

    # Context Prompt with history and trades
    user_context_prompt = build_context_prompt(
        text=text,
        channel_title=channel_title,
        history_messages=history_messages,
        pending_trades=pending_trades,
        active_trades=active_trades,
        current_cv_info=cv_info
    )

    groq_key = api_key if (active_provider == "groq" and api_key) else (stored.get("GROQ_API_KEY") or settings.GROQ_API_KEY)
    gemini_key = api_key if (active_provider == "gemini" and api_key) else (stored.get("GEMINI_API_KEY") or settings.GEMINI_API_KEY)
    groq_text_model = stored.get("GROQ_TEXT_MODEL") or settings.GROQ_TEXT_MODEL
    groq_vision_model = stored.get("GROQ_VISION_MODEL") or settings.GROQ_VISION_MODEL
    gemini_model = stored.get("GEMINI_MODEL") or settings.GEMINI_MODEL

    # 1. Groq API
    if active_provider == "groq" and groq_key:
        try:
            return await _call_groq(
                text, resolved_path, user_context_prompt, groq_key, start_time,
                history_messages=history_messages,
                text_model=groq_text_model,
                vision_model=groq_vision_model,
                has_gemini_fallback=bool(gemini_key)
            )
        except Exception as e:
            print(f"[GROQ CLASSIFICATION ERROR] {e}. Falling back.")

    # 2. Gemini API (selected or fallback if Groq failed)
    if (active_provider == "gemini" or (active_provider == "groq" and (not groq_key or True))) and gemini_key:
        try:
            return await _call_gemini(
                text, resolved_path, user_context_prompt, gemini_key, start_time,
                history_messages=history_messages,
                gemini_model=gemini_model
            )
        except Exception as e:
            print(f"[GEMINI CLASSIFICATION ERROR] {e}. Falling back to context heuristic.")

    # 3. Context Heuristic Fallback
    heuristic_res = classify_with_context_heuristic(
        text=text,
        history_messages=history_messages,
        pending_trades=pending_trades,
        active_trades=active_trades,
        image_cv=cv_info,
        has_image=bool(resolved_path)
    )
    elapsed = int((time.time() - start_time) * 1000)
    heuristic_res["processing_time_ms"] = elapsed
    heuristic_res["model_used"] = "Context Heuristic Engine"
    heuristic_res["raw_response"] = dict(heuristic_res)
    return heuristic_res

async def _call_groq(
    text: str,
    image_path: Optional[str],
    user_context_prompt: str,
    api_key: str,
    start_time: float,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    text_model: Optional[str] = None,
    vision_model: Optional[str] = None,
    has_gemini_fallback: bool = False
) -> Dict[str, Any]:
    from groq import Groq
    # max_retries=0 prevents 37s sleeps on 429 rate limits so Gemini/text fallback executes immediately
    client = Groq(api_key=api_key, timeout=25.0, max_retries=0)

    # Multimodal vision path if image attached
    if image_path and os.path.exists(image_path):
        v_model = vision_model or getattr(settings, "GROQ_VISION_MODEL", "qwen/qwen3.8-27b") or "qwen/qwen3.8-27b"
        try:
            mime_type, b64_img = await asyncio.to_thread(process_and_encode_image, image_path)
            completion = await asyncio.to_thread(
                client.chat.completions.create,
                model=v_model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": [
                        {"type": "text", "text": user_context_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_img}"}}
                    ]}
                ],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            raw_text = completion.choices[0].message.content
            parsed = json.loads(raw_text)
            elapsed = int((time.time() - start_time) * 1000)
            return _normalize_ai_response(parsed, elapsed, f"Groq ({v_model} Vision)", raw_text=text, history_messages=history_messages)
        except Exception as err:
            print(f"[GROQ VISION API ERROR] {err}.")
            if has_gemini_fallback:
                raise  # Prefer Gemini Vision with the image over dropping the image to text-only Groq!

    # Text Groq candidate models (only active Groq models)
    model_candidates = [
        text_model or getattr(settings, "GROQ_TEXT_MODEL", "openai/gpt-oss-120b"),
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b"
    ]
    seen = set()
    model_candidates = [m for m in model_candidates if m and not (m in seen or seen.add(m))]

    last_err = None
    for model_name in model_candidates:
        try:
            completion = await asyncio.to_thread(
                client.chat.completions.create,
                model=model_name,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_context_prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            raw_text = completion.choices[0].message.content
            parsed = json.loads(raw_text)
            elapsed = int((time.time() - start_time) * 1000)
            return _normalize_ai_response(parsed, elapsed, f"Groq ({model_name})", raw_text=text, history_messages=history_messages)
        except Exception as e:
            last_err = e
            continue

    if last_err:
        raise last_err

async def _call_gemini(
    text: str,
    image_path: Optional[str],
    user_context_prompt: str,
    api_key: str,
    start_time: float,
    history_messages: Optional[List[Dict[str, Any]]] = None,
    gemini_model: Optional[str] = None
) -> Dict[str, Any]:
    from google import genai
    from google.genai import types
    from PIL import Image

    client = genai.Client(api_key=api_key)
    configured = gemini_model or getattr(settings, "GEMINI_MODEL", "gemini-2.5-flash") or "gemini-2.5-flash"
    candidates = [configured, "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"]
    seen = set()
    candidates = [m for m in candidates if m and not (m in seen or seen.add(m))]

    contents = []
    if image_path and os.path.exists(image_path):
        img = Image.open(image_path)
        contents.append(img)
    contents.append(user_context_prompt)

    last_err = None
    for model_name in candidates:
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_PROMPT,
                    response_mime_type="application/json",
                    temperature=0.1
                )
            )
            raw_text = response.text
            parsed = json.loads(raw_text)
            elapsed = int((time.time() - start_time) * 1000)
            return _normalize_ai_response(parsed, elapsed, f"Gemini ({model_name})", raw_text=text, history_messages=history_messages)
        except Exception as e:
            last_err = e
            continue

    if last_err:
        raise last_err

def _normalize_ai_response(
    parsed: Dict[str, Any],
    elapsed: int,
    model_name: str,
    raw_text: str = "",
    history_messages: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Ensures consistent schema and types across AI responses.
    Strictly preserves the AI's semantic understanding of the owner's true intent
    without clobbering it with naive regex or substring keywords.
    """
    raw_intent = str(parsed.get("intent") or "OTHERS").strip()
    intent = raw_intent
    if intent not in ["NEW_TRADE", "TRADE_UPDATE", "OTHERS"]:
        if intent in ["CHATTER"]:
            intent = "OTHERS"
        elif intent in ["PENDING_CONFIRMATION", "trade_setup", "new_trade", "TRADE_SETUP", "NEW_SETUP"]:
            intent = "NEW_TRADE"
            if raw_intent == "PENDING_CONFIRMATION":
                parsed["is_active_now"] = False
        else:
            intent = "OTHERS"

    # Truly respect AI's semantic decision on whether this is an immediate live execution
    # or a conditional plan/idea (NO naive regex keyword overrides!):
    is_active_now = bool(parsed.get("is_active_now", False)) if intent != "OTHERS" else False

    # Action (BUY vs SELL vs NONE for non-trades / non-directional updates)
    raw_action = (parsed.get("action") or "").upper().strip()
    if intent == "OTHERS":
        action = "NONE"
    elif intent == "TRADE_UPDATE" and raw_action not in ["BUY", "SELL"]:
        action = "NONE"
    elif raw_action in ["BUY", "SELL"]:
        action = raw_action
    elif raw_action == "LONG":
        action = "BUY"
    elif raw_action == "SHORT":
        action = "SELL"
    else:
        action = "BUY"

    entry_price = str(parsed.get("entry_price")).replace(",", "") if parsed.get("entry_price") is not None else None
    if entry_price and entry_price.lower() in ["none", "null", "cmp"]:
        entry_price = None

    sl = str(parsed.get("sl")).replace(",", "") if parsed.get("sl") is not None else None
    if sl and sl.lower() in ["none", "null", "open"]:
        sl = None

    tp_val = parsed.get("tp")
    tp_levels = parsed.get("tp_levels", [])
    if tp_val:
        tp_levels = [str(tp_val).replace(",", "")]
    elif not isinstance(tp_levels, list):
        tp_levels = [str(tp_levels).replace(",", "")] if tp_levels else []
    else:
        tp_levels = [str(x).replace(",", "") for x in tp_levels if x is not None]

    # Mathematical direction verification (immutable trading law) for trades
    if intent == "NEW_TRADE":
        sl_verified = False
        if sl:
            try:
                sl_f = float(sl)
                ref_f = float(entry_price) if entry_price else (float(tp_levels[0]) if tp_levels else None)
                if ref_f is not None and ref_f > 0:
                    if sl_f > ref_f:
                        action = "SELL"
                        sl_verified = True
                    elif sl_f < ref_f:
                        action = "BUY"
                        sl_verified = True
            except Exception:
                pass

        if entry_price and tp_levels:
            try:
                ent_f = float(entry_price)
                tp_f = float(tp_levels[0])
                if ent_f > 0 and tp_f > 0:
                    if sl_verified:
                        # SL+Entry already proved direction; drop contradicting TP rather than inverting direction
                        if (action == "BUY" and tp_f <= ent_f) or (action == "SELL" and tp_f >= ent_f):
                            tp_levels = []
                    else:
                        if tp_f < ent_f and action == "BUY":
                            action = "SELL"
                        elif tp_f > ent_f and action == "SELL":
                            action = "BUY"
            except Exception:
                pass

    is_trade = 1 if intent in ["NEW_TRADE", "TRADE_UPDATE"] else 0

    # Extract clean symbol (e.g. USDCHF, GOLD, BTCUSD, US30)
    raw_sym = parsed.get("symbol")
    clean_sym = str(raw_sym).upper().replace("/", "").strip() if raw_sym else None
    if clean_sym in ["NONE", "NULL", "UNKNOWN"]:
        clean_sym = None

    return {
        "intent": intent,
        "symbol": clean_sym,
        "action": action,
        "order_type": ("NONE" if intent == "OTHERS" else (parsed.get("order_type") or "MARKET").upper()),
        "entry_price": entry_price,
        "sl": sl,
        "tp_levels": tp_levels,
        "is_trade": is_trade,
        "is_active_now": is_active_now,
        "target_trade_id": parsed.get("target_trade_id"),
        "update_type": parsed.get("update_type"),
        "confidence": int(parsed.get("confidence", 90)),
        "reasoning": parsed.get("reasoning", "Classified with AlphaSignal AI intent model."),
        "raw_response": parsed,
        "processing_time_ms": elapsed,
        "model_used": model_name
    }
