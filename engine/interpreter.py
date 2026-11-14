import os
import json
import time
from typing import Dict, Any, Optional
from config import settings
from engine.vision_processor import process_and_encode_image, analyze_chart_with_cv
from engine.mock_engine import parse_with_heuristics

SYSTEM_PROMPT = """You are an elite, highly precise Trading Signal & Telegram Intent Extraction AI.
Your role is to analyze messages and chart screenshots published in the Telegram channel "ALPHA PREMIUM" and determine the EXACT trading intent of the channel owner.

Channel Context & Owner's Exact Communication Patterns:
1. Trade Setups / Orders:
   - Example 1: 'Entry-71704 Sl-72714 Tp 67500' -> Symbol: BTCUSDT, Action: SELL (since SL 72714 > Entry 71704 and TP 67500 < Entry 71704), Order Type: MARKET.
   - Example 2: 'BTC SELL LEVEL WITH 1 MIN ENGULFING OR EVENING STAR CANDLE CONFIRMATION' -> Symbol: BTCUSDT, Action: SELL_LIMIT or PENDING_CONFIRMATION.
   - Example 3: 'BUY GOLD NOW 2642.50 SL 2636.00 TP1 2648.00 TP2 2656.00' -> Symbol: XAUUSD, Action: BUY, SL: 2636, TP: 2648, 2656.

2. Chart Screenshots (TradingView Long / Short Position Tool) - CRUCIAL:
   - When an image is attached without text, inspect the TradingView Position tool:
     * GREEN RECTANGLE: Take Profit (TP) zone. Look at the upper boundary label or price tag on the right axis for the exact TP price (e.g. 1924.28).
     * RED RECTANGLE: Stop Loss (SL) zone. Look at the lower boundary label or price tag on the right axis for the exact SL price (e.g. 1887.40).
     * DIVIDING LINE: Entry level (e.g. 1898.33).
     * DIRECTION:
       - If Green is ABOVE Red -> Long Position -> Action: BUY
       - If Red is ABOVE Green -> Short Position -> Action: SELL
     * INTENT: If the candlestick is already moving through the green box towards TP, classify as 'TRADE_UPDATE' (Action: BUY / LONG, Entry: dividing price, SL: red boundary, TP: green boundary). NEVER classify an active TradingView setup chart as 'CHATTER'!

3. Trade Modifications & Trailing (Crucial Hinglish phrases):
   - 'LEVEL TAPPED' or 'LEVEL TAPED' or 'ZONE TAPPED' -> Intent: TRADE_UPDATE, Action: NONE, Reasoning: 'Price reached/tapped the pending zone. This is an alert for followers to watch charts; the trade is NOT active yet.'
   - 'active mat krna abhi' or 'dont enter' or 'wait for confirmation' -> Intent: TRADE_UPDATE, Action: NONE, Reasoning: 'Owner explicitly warned to wait and NOT activate trade yet.'
   - 'ACTIVE' or 'ACTIVE NOW' or 'ENTER CMP' -> Intent: TRADE_UPDATE, Action: BUY (or SELL), Reasoning: 'Owner confirmed setup is actively running in market.'
   - 'RISK FREE KR LENA' or 'RISK FREE KRDO' -> Intent: TRADE_UPDATE, Action: MODIFY_SL, SL: 'BREAKEVEN / ENTRY', Reasoning: 'Move SL to entry/cost to make trade risk-free.'
   - '1:1 DONE', '1;1 DON', '1:2 BHI HO GAYA 😂❤️‍🔥', '1:2 already given You can book partial' -> Intent: TRADE_UPDATE, Action: PARTIAL_CLOSE.
   - '60 PIPS RUNNING', '130 PIPS', '110 PIPS BOOKED' -> Intent: TRADE_UPDATE, Action: UPDATE.

4. Exits, Outcomes & Cancellations:
   - 'BOOK ALL YOUR PROFITS' or 'FULL TP' or 'TRADERS CAN BOOK ALL YOUR PROFITS HERE' -> Intent: CLOSE_TRADE, Action: CLOSE.
   - 'SL HIT' or 'STOP LOSS HIT' or 'HIT OUR SL' -> Intent: CLOSE_TRADE, Action: CLOSE, Reasoning: 'Stop loss hit on position.'
   - 'LEVEL NOT TAPPED' or 'SETUP CANCELLED' or 'CANCEL ORDER' or 'DIDNT TAP' -> Intent: TRADE_UPDATE, Action: CLOSE, Reasoning: 'Pending level did not tap; setup cancelled.'
   - '1:1 DONE', '1:2 ALREADY GIVEN', 'BOOK PARTIAL' -> Intent: TRADE_UPDATE, Action: PARTIAL_CLOSE.
   - 'RISK FREE', 'RISK FREE KRDO', 'SL TO COST' -> Intent: TRADE_UPDATE, Action: MODIFY_SL, SL: 'BREAKEVEN'.

5. Casual Chatter & Noise (Must be strictly filtered out):
   - 'GOOD MORNING TRADERS❤️‍🔥🚀'
   - 'Craziest trades', 'Full rocket bolte 🚀🧿', 'Selling king for a reason ❤️❤️😉'
   - '3300 points in one way 🚀🚀💰💰💸💸💸'
   - Pure emojis: '🚀🚀', '💸💸'
   - Broker referral links (e.g. 'https://partners.elefin.com/...')
   - Any celebration or banter without actionable trade commands -> Intent: "CHATTER", Action: "NONE", is_trade: 0.

You MUST respond strictly with valid JSON conforming to this exact structure:
{
  "intent": "NEW_TRADE" | "TRADE_UPDATE" | "CLOSE_TRADE" | "CHATTER" | "INCOMPLETE",
  "symbol": "BTCUSDT" | "XAUUSD" | string or null,
  "action": "BUY" | "SELL" | "BUY_LIMIT" | "SELL_LIMIT" | "MODIFY_SL" | "PARTIAL_CLOSE" | "CLOSE" | "NONE",
  "order_type": "MARKET" | "LIMIT" | "STOP" | "NONE",
  "entry_price": "71704" or "2642" or "CMP" or null,
  "sl": "72714" or "BREAKEVEN" or null,
  "tp_levels": ["67500"] or [],
  "risk_reward": "1:2" or null,
  "confidence": 0-100,
  "reasoning": "Clear 1-2 sentence explanation of the owner's intent and extracted visual levels."
}
Only output the JSON object, without markdown quotes or explanation outside the JSON.
"""

async def analyze_message_with_ai(
    text: str,
    image_path: Optional[str] = None,
    provider: Optional[str] = None,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    active_provider = provider or settings.AI_PROVIDER
    start_time = time.time()
    
    # Resolve relative image_path if given
    resolved_path = image_path
    if image_path and not os.path.isabs(image_path):
        candidate = settings.BASE_DIR / image_path
        if candidate.exists():
            resolved_path = str(candidate)

    # 1. Groq API
    groq_key = api_key if (active_provider == "groq" and api_key) else settings.GROQ_API_KEY
    if active_provider == "groq" and groq_key:
        try:
            return await _call_groq(text, resolved_path, groq_key, start_time)
        except Exception as e:
            print(f"[GROQ ERROR] {e}. Falling back to Alpha vision heuristic.")

    # 2. Gemini API
    gemini_key = api_key if (active_provider == "gemini" and api_key) else settings.GEMINI_API_KEY
    if active_provider == "gemini" and gemini_key:
        try:
            return await _call_gemini(text, resolved_path, gemini_key, start_time)
        except Exception as e:
            print(f"[GEMINI ERROR] {e}. Falling back to Alpha vision heuristic.")

    # 3. Computer Vision & Heuristic Fallback
    from engine.vision_processor import analyze_chart_with_cv
    image_cv = analyze_chart_with_cv(resolved_path) if resolved_path else None
    return parse_with_heuristics(text, has_image=bool(resolved_path), image_cv=image_cv)

async def _call_groq(text: str, image_path: Optional[str], api_key: str, start_time: float) -> Dict[str, Any]:
    from groq import Groq
    from engine.vision_processor import process_and_encode_image
    client = Groq(api_key=api_key)

    # Resolve image path if present
    resolved_img = None
    if image_path:
        if os.path.isabs(image_path) and os.path.exists(image_path):
            resolved_img = image_path
        elif os.path.exists(str(settings.BASE_DIR / image_path)):
            resolved_img = str(settings.BASE_DIR / image_path)
        elif os.path.exists(image_path):
            resolved_img = image_path

    # MULTIMODAL VISION PATH (When image is present)
    if resolved_img:
        vision_model = getattr(settings, "GROQ_VISION_MODEL", "qwen/qwen3.8-27b") or "qwen/qwen3.8-27b"
        try:
            mime_type, b64_img = process_and_encode_image(resolved_img)

            vision_prompt = f"""You are an elite Trading Signal & Telegram Intent Extraction AI analyzing a post from the channel "ALPHA PREMIUM".
The channel owner posted the attached chart image with caption/text: "{text or '[Image Broadcast]'}".

CRITICAL INSTRUCTIONS FOR READING THIS TRADINGVIEW / FOREX / CRYPTO CHART:
1. Identify the Trading Instrument / Symbol (e.g. XAUUSD / Gold, BTCUSDT, ETHUSDT, GBPUSD, etc.) shown on the chart header or axes.
2. Carefully inspect the TradingView Position Tool:
   - GREEN RECTANGLE: Take Profit (TP) zone.
   - RED RECTANGLE: Stop Loss (SL) zone.
   - HORIZONTAL LINE dividing Green and Red: Entry Price.
   - DIRECTION:
     * If Green is ABOVE Red: Action is BUY (Long Position).
     * If Red is ABOVE Green: Action is SELL (Short Position).
3. Read the EXACT NUMERIC PRICES from the chart's price axis or position tool labels:
   - "entry_price": Exact numerical price at the dividing line (e.g. 3971.60).
   - "sl": Exact numerical price at the boundary of the red Stop Loss box (e.g. 3969.07).
   - "tp_levels": Array with the exact numerical price(s) at the boundary of the green Take Profit box (e.g. ["3981.05"]).
4. Intent Classification:
   - If candle is moving through the green zone or text says "ACTIVE", "RUNNING", or trade update -> intent: "NEW_TRADE" or "TRADE_UPDATE".
   - NEVER classify an active TradingView position chart as CHATTER!
5. Risk/Reward: Calculate or read the Risk/Reward ratio (e.g. "1:2.5").

You MUST respond strictly with valid JSON adhering to this exact schema:
{{
  "intent": "NEW_TRADE" | "TRADE_UPDATE" | "CLOSE_TRADE",
  "symbol": string,
  "action": "BUY" | "SELL" | "MODIFY_SL" | "PARTIAL_CLOSE",
  "order_type": "MARKET" | "LIMIT",
  "entry_price": string or number,
  "sl": string or number,
  "tp_levels": [string or number],
  "risk_reward": string or null,
  "confidence": 95,
  "reasoning": "Detailed visual reasoning describing instrument, tool direction, exact Entry, SL, and TP extracted."
}}"""

            completion = client.chat.completions.create(
                model=vision_model,
                messages=[
                    {"role": "user", "content": [
                        {"type": "text", "text": vision_prompt},
                        {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64_img}"}}
                    ]}
                ],
                response_format={"type": "json_object"},
                temperature=0.1
            )
            raw_text = completion.choices[0].message.content
            parsed = json.loads(raw_text)
            elapsed = int((time.time() - start_time) * 1000)

            # Ensure tp_levels is list
            tp_list = parsed.get("tp_levels", [])
            if not isinstance(tp_list, list):
                tp_list = [tp_list] if tp_list else []

            return {
                "intent": parsed.get("intent", "NEW_TRADE"),
                "symbol": parsed.get("symbol", "XAUUSD"),
                "action": parsed.get("action", "BUY"),
                "order_type": parsed.get("order_type", "MARKET"),
                "entry_price": str(parsed.get("entry_price")) if parsed.get("entry_price") is not None else None,
                "sl": str(parsed.get("sl")) if parsed.get("sl") is not None else None,
                "tp_levels": [str(x) for x in tp_list if x is not None],
                "risk_reward": parsed.get("risk_reward"),
                "confidence": int(parsed.get("confidence", 95)),
                "reasoning": parsed.get("reasoning", "Extracted via Groq Multimodal Vision AI."),
                "raw_response": parsed,
                "processing_time_ms": elapsed,
                "model_used": f"Groq ({vision_model} Vision)"
            }
        except Exception as vision_err:
            print(f"[GROQ VISION ERROR] {vision_err}. Falling back to text model.")

    # TEXT-ONLY PATH (or fallback if vision fails)
    model_candidates = [
        getattr(settings, "GROQ_TEXT_MODEL", "openai/gpt-oss-120b"),
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "qwen/qwen3.8-27b"
    ]
    seen = set()
    model_candidates = [m for m in model_candidates if m and not (m in seen or seen.add(m))]

    user_prompt = f"Channel message from ALPHA PREMIUM: {text or '[Image Broadcast]'}"
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user_prompt}
    ]

    last_err = None
    for model_name in model_candidates:
        try:
            completion = client.chat.completions.create(
                model=model_name,
                messages=messages,
                response_format={"type": "json_object"},
                temperature=0.1
            )
            raw_text = completion.choices[0].message.content
            parsed = json.loads(raw_text)
            elapsed = int((time.time() - start_time) * 1000)

            tp_list = parsed.get("tp_levels", [])
            if not isinstance(tp_list, list):
                tp_list = [tp_list] if tp_list else []

            return {
                "intent": parsed.get("intent", "CHATTER"),
                "symbol": parsed.get("symbol"),
                "action": parsed.get("action", "NONE"),
                "order_type": parsed.get("order_type", "MARKET"),
                "entry_price": str(parsed.get("entry_price")) if parsed.get("entry_price") is not None else None,
                "sl": str(parsed.get("sl")) if parsed.get("sl") is not None else None,
                "tp_levels": [str(x) for x in tp_list if x is not None],
                "risk_reward": parsed.get("risk_reward"),
                "confidence": int(parsed.get("confidence", 85)),
                "reasoning": parsed.get("reasoning", ""),
                "raw_response": parsed,
                "processing_time_ms": elapsed,
                "model_used": f"Groq ({model_name})"
            }
        except Exception as e:
            last_err = e
            continue

    if last_err:
        raise last_err

async def _call_gemini(text: str, image_path: Optional[str], api_key: str, start_time: float) -> Dict[str, Any]:
    import google.generativeai as genai
    from PIL import Image

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name=settings.GEMINI_MODEL,
        generation_config={"response_mime_type": "application/json", "temperature": 0.1},
        system_instruction=SYSTEM_PROMPT
    )

    contents = []
    if image_path and os.path.exists(image_path):
        img = Image.open(image_path)
        contents.append(img)
    contents.append(f"Channel message from ALPHA PREMIUM: {text or '[Image Signal Only]'}")

    response = model.generate_content(contents)
    raw_text = response.text
    parsed = json.loads(raw_text)
    elapsed = int((time.time() - start_time) * 1000)

    return {
        "intent": parsed.get("intent", "CHATTER"),
        "symbol": parsed.get("symbol"),
        "action": parsed.get("action", "NONE"),
        "order_type": parsed.get("order_type", "MARKET"),
        "entry_price": parsed.get("entry_price"),
        "sl": parsed.get("sl"),
        "tp_levels": parsed.get("tp_levels", []),
        "risk_reward": parsed.get("risk_reward"),
        "confidence": int(parsed.get("confidence", 90)),
        "reasoning": parsed.get("reasoning", ""),
        "raw_response": parsed,
        "processing_time_ms": elapsed,
        "model_used": f"Google Gemini ({settings.GEMINI_MODEL})"
    }
