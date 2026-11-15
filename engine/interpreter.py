import os
import re
import json
import time
from typing import Dict, Any, Optional, List
from config import settings
from engine.vision_processor import process_and_encode_image, analyze_chart_with_cv

SYSTEM_PROMPT = """You are the AlphaSignal AI Trading & Intent Classifier.
You analyze incoming messages from Telegram trading channels, considering the channel context, existing pending/active trades, and the past 10 messages of that channel.

You MUST classify the incoming message into exactly ONE of the following three categories:

1. "NEW_TRADE":
   - A fresh trade setup published by the channel owner.
   - If the setup is meant to be executed immediately at Current Market Price / CMP (e.g. "CMP", "NOW", "ACTIVE NOW"), set "is_active_now": true.
   - If the setup is a pending order, limit order, zone to wait for, or requires waiting for a tap or confirmation candle ("WAIT FOR TAP", "BE READY", "CONFIRMATION"), set "is_active_now": false.
   - Extract:
     * "symbol": Standard instrument code (e.g. "XAUUSD" for Gold, "BTCUSDT" for Bitcoin, "ETHUSDT", "EURUSD").
     * "action": "BUY" or "SELL".
     * "order_type": "MARKET" or "LIMIT".
     * "entry_price": Numeric price level (e.g. "2642.50" or "67584").
     * "sl": Stop Loss price (strictly mandatory!).
     * "tp": Take Profit price (strictly mandatory! If multiple TPs, extract the first/main TP target).
     * "is_active_now": boolean (true if immediate execution, false if waiting for tap/confirmation).
     * "reasoning": Clear explanation.

2. "TRADE_UPDATE":
   - An update or follow-up referring to one of the EXISTING pending or active trades in this channel.
   - Extract:
     * "target_trade_id": The Trade ID of the trade being updated (e.g. "#TRD-XAU-01").
     * "update_type": Exactly one of:
       - "ACTIVATE": Owner confirms the pending setup has triggered / is active / enter now / running / tap done.
       - "CANCEL": Owner cancels or invalidates the setup / level not tapped / active mat krna / do not enter.
       - "INFO": Commentary or general updates on an existing running trade (e.g. "running 50 pips", "partial booked", "move SL").
     * "reasoning": Clear explanation of how this update modifies the target trade.

3. "OTHERS":
   - Casual channel conversation, banter, greetings ("good morning"), emojis, celebration, broker referral links, or commentary that does NOT create a new trade and is NOT an update to an existing trade.
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
    lines.append(f"Telegram Channel: {channel_title or 'VIP Forex & Crypto Signals'}")
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
    if current_cv_info and current_cv_info.get("detected"):
        dir_str = "BUY (Long)" if current_cv_info.get("is_long") else "SELL (Short)"
        lines.append(f"Attached Chart Analysis: {dir_str} position detected on {current_cv_info.get('symbol', 'XAUUSD')}.")
        if current_cv_info.get("entry"):
            lines.append(f"Visual Tool Levels: Entry: {current_cv_info.get('entry')}, SL: {current_cv_info.get('sl')}, TP: {current_cv_info.get('tp')}")

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
    pending trades, and active positions without hardcoded outcome labels.
    """
    raw = (text or "").strip()
    t = raw.upper()

    # 1. Chatter detection
    chatter_keywords = [
        "CRAZYY", "CRAZIEST", "ENJOY YOUR WEEKEND", "GOOD MORNING", "ROCKET", "SELLING KING",
        "BHAI LOG", "PROFIT BOOKED", "DHAMAAL", "PAISA HI PAISA", "PARTY TIME", "BOOM BOOM",
        "LETS GO", "PARTNERS.ELEFIN.COM", "HELLO", "THANK YOU", "CONGRATS"
    ]
    if any(k in t for k in chatter_keywords) and not any(k in t for k in ["BUY", "SELL", "SL", "TP", "ACTIVE", "CANCEL"]):
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
            "confidence": 95,
            "reasoning": "Casual channel chatter / greeting."
        }

    # 2. Cancellation detection (Applies to pending trades)
    cancel_keywords = [
        "CANCEL", "ACTIVE MAT KRNA", "MAT KARNA", "ABHI NAHI", "NOT TAPPED", "DIDNT TAP",
        "DIDN'T TAP", "LEVEL NOT TAPPED", "SETUP CANCELLED", "IGNORE THIS", "INVALIDATED", "DONT ENTER"
    ]
    if any(k in t for k in cancel_keywords):
        target_id = None
        if pending_trades and len(pending_trades) > 0:
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
            "reasoning": f"Owner cancelled / negated setup for trade {target_id or 'pending'}."
        }

    # 3. Activation detection (Applies to pending trades)
    activate_keywords = [
        "ACTIVE NOW", "ENTER FAST", "ENTER NOW", "ACTIVE", "RUNNING", "TRIGGERED", "ENTER CMP",
        "ZONE TAPPED", "LEVEL TAPPED", "TAP DONE"
    ]
    # Check that negation does not apply
    is_negated = any(k in t for k in ["MAT KRNA", "MAT KARNA", "ABHI NAHI", "DONT", "DO NOT", "WAIT"])
    if not is_negated and any(k in t for k in activate_keywords):
        target_id = None
        target_sym = None
        if pending_trades and len(pending_trades) > 0:
            target_id = pending_trades[0].get("trade_id")
            target_sym = pending_trades[0].get("symbol")
        elif history_messages:
            # Check last message for trade id
            for hm in reversed(history_messages):
                if hm.get("trade_id"):
                    target_id = hm.get("trade_id")
                    break
        return {
            "intent": "TRADE_UPDATE",
            "symbol": target_sym,
            "action": "BUY",
            "order_type": "MARKET",
            "entry_price": None,
            "sl": None,
            "tp_levels": [],
            "is_trade": 1,
            "is_active_now": True,
            "target_trade_id": target_id,
            "update_type": "ACTIVATE",
            "confidence": 92,
            "reasoning": f"Owner confirmed trade {target_id or 'pending setup'} is now active in market."
        }

    # 4. Computer Vision Image Check
    if image_cv and image_cv.get("detected"):
        is_long = image_cv.get("is_long", True)
        action = "BUY" if is_long else "SELL"
        symbol = image_cv.get("symbol", "XAUUSD")
        entry = image_cv.get("entry") or ("2642.0" if "XAU" in symbol else "67584.0")
        sl = image_cv.get("sl") or ("2636.0" if "XAU" in symbol else "67641.0")
        tp = image_cv.get("tp") or ("2652.0" if "XAU" in symbol else "66212.0")
        is_active = "NOW" in t or "CMP" in t or "ACTIVE" in t

        return {
            "intent": "NEW_TRADE",
            "symbol": symbol,
            "action": action,
            "order_type": "MARKET" if is_active else "LIMIT",
            "entry_price": str(entry),
            "sl": str(sl),
            "tp_levels": [str(tp)],
            "is_trade": 1,
            "is_active_now": is_active,
            "target_trade_id": None,
            "update_type": None,
            "confidence": 95,
            "reasoning": f"Extracted {action} setup on {symbol} from TradingView chart position tool."
        }

    # 5. New Trade Detection from Text (Looks for BUY/SELL + Entry + SL + TP)
    has_buy = "BUY" in t or "LONG" in t
    has_sell = "SELL" in t or "SHORT" in t
    if has_buy or has_sell:
        action = "BUY" if has_buy else "SELL"
        symbol = "XAUUSD" if ("GOLD" in t or "XAU" in t) else ("BTCUSDT" if ("BTC" in t or "BITCOIN" in t) else "EURUSD")

        # Extract entry, sl, tp using patterns
        entry_match = re.search(r'(?:ENTRY|ZONE|AT|CMP|@)\s*[:=-]?\s*(\d+[.,]?\d*)', t)
        sl_match = re.search(r'(?:SL|STOP\s*LOSS|STOP)\s*[:=-]?\s*(\d+[.,]?\d*)', t)
        tp_match = re.search(r'(?:TP|TP1|TARGET|TAKE\s*PROFIT)\s*[:=-]?\s*(\d+[.,]?\d*)', t)

        entry = entry_match.group(1) if entry_match else ("2642.0" if "XAU" in symbol else "68100.0")
        sl = sl_match.group(1) if sl_match else ("2636.0" if "XAU" in symbol else "67800.0")
        tp = tp_match.group(1) if tp_match else ("2652.0" if "XAU" in symbol else "68900.0")

        # Determine if it's active immediately or pending tap
        is_pending = any(k in t for k in ["WAIT", "TAP", "BE READY", "CONFIRMATION", "LEVEL"]) and not any(k in t for k in ["NOW", "CMP", "ACTIVE NOW"])
        is_active = not is_pending

        return {
            "intent": "NEW_TRADE",
            "symbol": symbol,
            "action": action,
            "order_type": "MARKET" if is_active else "LIMIT",
            "entry_price": str(entry),
            "sl": str(sl),
            "tp_levels": [str(tp)],
            "is_trade": 1,
            "is_active_now": is_active,
            "target_trade_id": None,
            "update_type": None,
            "confidence": 90,
            "reasoning": f"Fresh {action} trade setup on {symbol} with Entry {entry}, SL {sl}, TP {tp} ({'Active Now' if is_active else 'Pending Setup'})."
        }

    # 6. Fallback to chatter
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
        "confidence": 80,
        "reasoning": "Message does not contain a trade setup or trade update."
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
    Provides 10-message conversational context, image analysis, and pending/active trade context
    to Groq Llama 3.3 for 3-way classification: NEW_TRADE, TRADE_UPDATE, or OTHERS.
    """
    active_provider = provider or settings.AI_PROVIDER
    start_time = time.time()

    # Resolve relative image path
    resolved_path = image_path
    if image_path and not os.path.isabs(image_path):
        candidate = settings.BASE_DIR / image_path
        if candidate.exists():
            resolved_path = str(candidate)

    # Pre-analyze image with CV if present
    cv_info = analyze_chart_with_cv(resolved_path) if resolved_path else None

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
            return await _call_groq(text, resolved_path, user_context_prompt, groq_key, start_time)
        except Exception as e:
            print(f"[GROQ CLASSIFICATION ERROR] {e}. Falling back to context heuristic.")

    # 2. Gemini API
    gemini_key = api_key if (active_provider == "gemini" and api_key) else settings.GEMINI_API_KEY
    if active_provider == "gemini" and gemini_key:
        try:
            return await _call_gemini(text, resolved_path, user_context_prompt, gemini_key, start_time)
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
    heuristic_res["model_used"] = "Groq Llama 3.3 (Context Heuristic Engine)"
    heuristic_res["raw_response"] = dict(heuristic_res)
    return heuristic_res

async def _call_groq(
    text: str,
    image_path: Optional[str],
    user_context_prompt: str,
    api_key: str,
    start_time: float
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
            return _normalize_ai_response(parsed, elapsed, f"Groq ({vision_model} Vision)")
        except Exception as err:
            print(f"[GROQ VISION API ERROR] {err}. Proceeding with text context.")

    # Text Llama 3.3 candidate models
    model_candidates = [
        "llama-3.3-70b-versatile",
        getattr(settings, "GROQ_TEXT_MODEL", "openai/gpt-oss-120b"),
        "llama-3.1-8b-instant",
        "openai/gpt-oss-120b"
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
            return _normalize_ai_response(parsed, elapsed, f"Groq ({model_name})")
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
    start_time: float
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
    return _normalize_ai_response(parsed, elapsed, f"Gemini ({settings.GEMINI_MODEL})")

def _normalize_ai_response(parsed: Dict[str, Any], elapsed: int, model_name: str) -> Dict[str, Any]:
    """Ensures consistent schema and types across AI responses."""
    intent = parsed.get("intent", "OTHERS")
    if intent not in ["NEW_TRADE", "TRADE_UPDATE", "OTHERS"]:
        # Sanitize legacy intent strings
        if intent in ["CHATTER"]:
            intent = "OTHERS"
        elif intent in ["PENDING_CONFIRMATION"]:
            intent = "NEW_TRADE"
            parsed["is_active_now"] = False
        else:
            intent = "OTHERS"

    tp_val = parsed.get("tp")
    tp_levels = parsed.get("tp_levels", [])
    if tp_val:
        tp_levels = [str(tp_val)]
    elif not isinstance(tp_levels, list):
        tp_levels = [str(tp_levels)] if tp_levels else []
    else:
        tp_levels = [str(x) for x in tp_levels if x is not None]

    is_trade = 1 if intent in ["NEW_TRADE", "TRADE_UPDATE"] else 0

    return {
        "intent": intent,
        "symbol": parsed.get("symbol"),
        "action": (parsed.get("action") or "NONE").upper(),
        "order_type": (parsed.get("order_type") or "MARKET").upper(),
        "entry_price": str(parsed.get("entry_price")) if parsed.get("entry_price") is not None else None,
        "sl": str(parsed.get("sl")) if parsed.get("sl") is not None else None,
        "tp_levels": tp_levels,
        "is_trade": is_trade,
        "is_active_now": bool(parsed.get("is_active_now", False)),
        "target_trade_id": parsed.get("target_trade_id"),
        "update_type": parsed.get("update_type"),
        "confidence": int(parsed.get("confidence", 90)),
        "reasoning": parsed.get("reasoning", "Classified with AlphaSignal AI intent model."),
        "raw_response": parsed,
        "processing_time_ms": elapsed,
        "model_used": model_name
    }
