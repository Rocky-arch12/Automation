import os
import re
import json
import time
from typing import Dict, Any, Optional, List
from config import settings
from engine.vision_processor import process_and_encode_image, analyze_chart_with_cv

SYSTEM_PROMPT = """You are the AlphaSignal AI Trading & Intent Classifier for the VIP Telegram Channel 'ALPHA PREMIUM'.
You analyze incoming messages from the channel owner, considering recent channel history (last 10 messages), active open positions, and pending trade setups.

The channel owner frequently publishes signals in the following real-world patterns:
1. Multi-Message Active Setups:
   - Message 1: "Active trade" or "Active" or "Active selling trade" (often accompanied or immediately followed by a chart screenshot).
   - Message 2: [Chart screenshot]
   - Message 3: "Entry-3770 \n Sl-3763 \n Tp-3783" (or "Entry-4090 \n Sl-4084 \n Target-4102").
   -> In this flow, "Active trade" is the ANNOUNCEMENT of a fresh trade (NOT an update to an old pending setup from hours ago).
   -> When the entry/sl/tp message arrives, it belongs to the active trade that was just announced!

2. CMP / Entry is OPTIONAL:
   - If the owner says "Gold buy now Sl 3860 Tp 3900" or "Active trade Sl-3763", CMP is not given: execute immediately at Current Market Price ("is_active_now": true, "entry_price": null).

3. Take Profit (TP) is OPTIONAL:
   - If the owner only provides Stop Loss (SL) without TP, execute with SL ("tp": null). Only Stop Loss (SL) is strictly compulsory!

4. Direction (BUY vs SELL) Inference (MANDATORY MATHEMATICAL LAW):
   - In trading, Stop Loss (SL) and Entry/Take Profit (TP) define direction mathematically:
     * If SL > Entry or SL > TP (SL is HIGHER than entry/target) -> IT IS ALWAYS A SELL (Short). NEVER classify as BUY!
     * If SL < Entry or SL < TP (SL is LOWER than entry/target) -> IT IS ALWAYS A BUY (Long). NEVER classify as SELL!
     * If BUY or SELL is not explicitly written in text, use this mathematical rule above!
     * If recent message says "Active selling trade" or "Sell level" -> SELL
     * If recent message says "Active buying trade" -> BUY

5. Asset Symbol Inference:
   - Default asset in ALPHA PREMIUM is "XAUUSD" (Gold).
   - If "BTC" or "Bitcoin" is mentioned -> "BTCUSDT"
   - If "ETH" or "Ethereum" is mentioned -> "ETHUSDT"
   - If "GBP" -> "GBPUSD", "EUR" -> "EURUSD"

6. Risky Trades:
   - Messages like "RISKY TRADE IN SELL SIDE GOLD" or "Small risk hai guyss" are REAL trades! Must be classified as "NEW_TRADE", never as chatter!

7. TradingView Chart & Position Tool Extraction (CRUCIAL):
   - When a chart screenshot is attached (e.g. accompanied by "Active trade" or sent as a setup):
     * Inspect the right-hand vertical price scale / axis closely.
     * The TradingView Long/Short Position Tool highlights key prices with colored labels:
       - RED label/box on price axis: STOP LOSS (SL) price (e.g. 3729.423).
       - GRAY central label/line on price axis: ENTRY price (e.g. 3725.299).
       - GREEN or CYAN label/box on price axis: TAKE PROFIT (TP) price (e.g. 3700.174).
     * For a SELL (Short) position:
       - RED box is at the TOP (higher price, SL > Entry).
       - GREEN box is at the BOTTOM (lower price, TP < Entry).
       - Action MUST be "SELL".
     * For a BUY (Long) position:
       - GREEN box is at the TOP (higher price, TP > Entry).
       - RED box is at the BOTTOM (lower price, SL < Entry).
       - Action MUST be "BUY".
     * NEVER set "sl": null when the chart image displays these colored position tool labels! Always read the numbers from the labels (e.g. 3729.423 or 3729).
     * If the accompanying text says "Active trade" or "Active", set "is_active_now": true so it executes immediately on XM MT5!

You MUST classify the incoming message into exactly ONE of the following three categories:

1. "NEW_TRADE":
   - A fresh trade setup published by the channel owner (or parameters following an "Active trade" announcement).
   - If meant to be executed immediately (e.g. "ACTIVE", "ACTIVE TRADE", "NOW", "CMP", or preceded by "Active trade"), set "is_active_now": true.
   - If a pending setup waiting for a tap or confirmation candle ("WAIT FOR TAP", "CONFIRMATION PE HI ENTRY KRNA", "BE READY ON THIS LEVEL"), set "is_active_now": false.
   - Extract:
     * "symbol": Instrument code (e.g. "XAUUSD", "BTCUSDT", "ETHUSDT", "EURUSD", "GBPUSD").
     * "action": "BUY" or "SELL".
     * "order_type": "MARKET" or "LIMIT".
     * "entry_price": Numeric price or null if executed at CMP.
     * "sl": Stop Loss price (strictly mandatory! Extract from text or chart).
     * "tp": Take Profit price (optional, extract if given, else null).
     * "is_active_now": boolean (true for immediate execution).
     * "reasoning": Clear explanation.

2. "TRADE_UPDATE":
   - An update referring to an existing pending setup or active running trade.
   - "ACTIVATE": ONLY applies if there is a recent pending setup (< 45 minutes) that was explicitly waiting for confirmation (e.g. "LEVEL TAPED" -> "ACTIVE").
   - "CANCEL": Owner cancels setup ("CANCEL", "ACTIVE MAT KRNA", "LEVEL NOT TAPPED").
   - "INFO": Commentary on running trade ("1:1 DONE RISK FREE KRDO", "70 pips running", "Target done").
   - Extract:
     * "target_trade_id": Trade ID if applicable.
     * "update_type": "ACTIVATE" | "CANCEL" | "INFO".
     * "reasoning": Clear explanation.

3. "OTHERS":
   - Casual channel conversation, greetings ("good morning"), celebration emojis without trade data, broker referral links, YouTube live announcements.
   - Extract:
     * "reasoning": Brief explanation.

You MUST respond strictly with a valid JSON object matching this schema:
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
            lines.append(f"- ID: {t_id} | Symbol: {sym} | Action: {act} | Entry: {ent} | SL: {sl} | TP: {tp} | Status: PENDING")
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
    if history_messages:
        for idx, m in enumerate(history_messages, 1):
            s_name = m.get("sender") or "Owner"
            m_text = (m.get("text") or "").strip()
            time_str = str(m.get("created_at") or "")[11:16]
            tid = f" [Linked Trade: {m.get('trade_id')}]" if m.get("trade_id") else ""
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
        lines.append("Attached Chart Screenshot: Inspect the TradingView Long/Short Position Tool and right-hand price axis labels.")
        lines.append("- Visual Tool Rule: Red box on TOP / Green box on BOTTOM = SELL (Short). Green box on TOP / Red box on BOTTOM = BUY (Long).")
        lines.append("- Mathematical Price Rule: If SL > Entry or SL > TP -> Action MUST be SELL. If SL < Entry or SL < TP -> Action MUST be BUY.")
        lines.append("CRITICAL: Extract the Stop Loss (red label), Entry (gray label), and Take Profit (green/cyan label) from the right-hand vertical price axis labels.")

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
    history_has_chart = False
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
            if hm.get("media_path"):
                history_has_chart = True

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
    to Groq (qwen/qwen3.8-27b Vision / Llama models) for 3-way classification.
    """
    active_provider = provider or settings.AI_PROVIDER
    start_time = time.time()

    # Resolve relative image path
    resolved_path = image_path
    if image_path and not os.path.isabs(image_path):
        candidate = settings.BASE_DIR / image_path
        if candidate.exists():
            resolved_path = str(candidate)

    # Image presence flag for multimodal context
    cv_info = {"has_image": True} if resolved_path else None

    # Context Prompt with history and trades
    user_context_prompt = build_context_prompt(
        text=text,
        channel_title=channel_title,
        history_messages=history_messages,
        pending_trades=pending_trades,
        active_trades=active_trades,
        current_cv_info=cv_info
    )

    # 1. Groq API
    groq_key = api_key if (active_provider == "groq" and api_key) else settings.GROQ_API_KEY
    if active_provider == "groq" and groq_key:
        try:
            return await _call_groq(text, resolved_path, user_context_prompt, groq_key, start_time, history_messages=history_messages)
        except Exception as e:
            print(f"[GROQ CLASSIFICATION ERROR] {e}. Falling back to context heuristic.")

    # 2. Gemini API
    gemini_key = api_key if (active_provider == "gemini" and api_key) else settings.GEMINI_API_KEY
    if active_provider == "gemini" and gemini_key:
        try:
            return await _call_gemini(text, resolved_path, user_context_prompt, gemini_key, start_time, history_messages=history_messages)
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
    history_messages: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    from groq import Groq
    client = Groq(api_key=api_key)

    # Multimodal vision path if image attached
    if image_path and os.path.exists(image_path):
        vision_model = getattr(settings, "GROQ_VISION_MODEL", "qwen/qwen3.8-27b") or "qwen/qwen3.8-27b"
        try:
            mime_type, b64_img = process_and_encode_image(image_path)
            completion = client.chat.completions.create(
                model=vision_model,
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
            return _normalize_ai_response(parsed, elapsed, f"Groq ({vision_model} Vision)", raw_text=text, history_messages=history_messages)
        except Exception as err:
            print(f"[GROQ VISION API ERROR] {err}. Proceeding with text context.")

    # Text Groq candidate models
    model_candidates = [
        getattr(settings, "GROQ_TEXT_MODEL", "openai/gpt-oss-120b"),
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b"
    ]
    seen = set()
    model_candidates = [m for m in model_candidates if m and not (m in seen or seen.add(m))]

    last_err = None
    for model_name in model_candidates:
        try:
            completion = client.chat.completions.create(
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
    history_messages: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    import google.generativeai as genai
    from PIL import Image

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=getattr(settings, "GEMINI_MODEL", "gemini-1.5-flash-lite"),
        generation_config={"response_mime_type": "application/json", "temperature": 0.1},
        system_instruction=SYSTEM_PROMPT
    )

    contents = []
    if image_path and os.path.exists(image_path):
        img = Image.open(image_path)
        contents.append(img)
    contents.append(user_context_prompt)

    response = model.generate_content(contents)
    raw_text = response.text
    parsed = json.loads(raw_text)
    elapsed = int((time.time() - start_time) * 1000)
    return _normalize_ai_response(parsed, elapsed, f"Gemini ({settings.GEMINI_MODEL})", raw_text=text, history_messages=history_messages)

def _normalize_ai_response(
    parsed: Dict[str, Any],
    elapsed: int,
    model_name: str,
    raw_text: str = "",
    history_messages: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Ensures consistent schema and types across AI responses with active intent enforcement."""
    intent = parsed.get("intent", "OTHERS")
    if intent not in ["NEW_TRADE", "TRADE_UPDATE", "OTHERS"]:
        if intent in ["CHATTER"]:
            intent = "OTHERS"
        elif intent in ["PENDING_CONFIRMATION", "trade_setup", "new_trade", "TRADE_SETUP", "NEW_SETUP"]:
            intent = "NEW_TRADE"
            if intent in ["PENDING_CONFIRMATION"]:
                parsed["is_active_now"] = False
        else:
            intent = "OTHERS"

    raw_upper = (raw_text or "").upper().strip()

    # Active intent enforcement:
    is_active_lead = any(k in raw_upper for k in ["ACTIVE TRADE", "ACTIVE NOW", "ACTIVE SELLING", "ACTIVE BUYING", "ENTER NOW", "ENTER FAST", "ENTER CMP"]) or raw_upper == "ACTIVE"

    history_active = False
    history_selling = False
    history_buying = False
    if history_messages and len(history_messages) > 0:
        for hm in history_messages[-3:]:
            htxt = (hm.get("text") or "").upper().strip()
            if any(k in htxt for k in ["ACTIVE TRADE", "ACTIVE NOW", "ACTIVE SELLING", "ACTIVE"]) or htxt == "ACTIVE":
                history_active = True
            if "SELL" in htxt or "SHORT" in htxt:
                history_selling = True
            if "BUY" in htxt or "LONG" in htxt:
                history_buying = True

    is_pending_wording = any(k in raw_upper for k in ["WAIT FOR", "CONFIRMATION PE HI", "BE READY ON THIS LEVEL", "PLAN KRENGE"]) and not is_active_lead

    is_active_now = bool(parsed.get("is_active_now", False))
    if is_active_lead:
        is_active_now = True
    elif history_active and not is_pending_wording:
        is_active_now = True

    # If action is None or NONE, infer from text or history:
    action = (parsed.get("action") or "").upper()
    if not action or action == "NONE":
        if "SELL" in raw_upper or "SHORT" in raw_upper or history_selling:
            action = "SELL"
        elif "BUY" in raw_upper or "LONG" in raw_upper or history_buying:
            action = "BUY"
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

    # Mathematical direction verification (immutable trading law)
    # Never swap user SL and TP! Instead, verify and enforce the correct direction (BUY vs SELL).
    if sl:
        try:
            sl_f = float(sl)
            ref_f = float(entry_price) if entry_price else (float(tp_levels[0]) if tp_levels else None)
            if ref_f is not None and ref_f > 0:
                if sl_f > ref_f:
                    # SL is above Entry / TP -> In all financial markets this is unequivocally SELL (Short)
                    if action != "SELL":
                        action = "SELL"
                elif sl_f < ref_f:
                    # SL is below Entry / TP -> In all financial markets this is unequivocally BUY (Long)
                    if action != "BUY":
                        action = "BUY"
        except Exception:
            pass

    # Also verify TP direction relative to entry price if entry is present
    if entry_price and tp_levels:
        try:
            ent_f = float(entry_price)
            tp_f = float(tp_levels[0])
            if ent_f > 0 and tp_f > 0:
                if tp_f < ent_f and action == "BUY":
                    action = "SELL"
                elif tp_f > ent_f and action == "SELL":
                    action = "BUY"
        except Exception:
            pass

    # If SL is given or numbers present and history had active lead, ensure NEW_TRADE:
    if (is_active_lead or history_active) and intent == "OTHERS" and (sl or re.search(r'\d+', raw_text)):
        intent = "NEW_TRADE"

    is_trade = 1 if intent in ["NEW_TRADE", "TRADE_UPDATE"] else 0

    return {
        "intent": intent,
        "symbol": parsed.get("symbol") or "XAUUSD",
        "action": action,
        "order_type": (parsed.get("order_type") or "MARKET").upper(),
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
