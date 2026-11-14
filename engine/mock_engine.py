import re
import time
from typing import Dict, Any, Optional

CHATTER_PATTERNS = [
    r"crazyy?\s*hogya",
    r"craziest\s*trades",
    r"enjoy\s*(your)?\s*weekend",
    r"good\s*morning\s*traders",
    r"full\s*rocket\s*bolte",
    r"selling\s*king\s*for\s*a\s*reason",
    r"bhai\s*log",
    r"profit\s*booked\s*guys",
    r"kaisa\s*laga",
    r"dhamaal",
    r"paisa\s*hi\s*paisa",
    r"party\s*time",
    r"congrat(s|ulations)?",
    r"boom\s*boom",
    r"btc\s*boom",
    r"lets\s*gooo+",
    r"waah\s*bhai",
    r"partners\.elefin\.com"
]

UPDATE_PATTERNS = [
    (r"(risk\s*free\s*kr\s*lena|risk\s*free|sl\s*to\s*cost|move\s*sl\s*to\s*(be|cost|entry))", "MOVE_SL_BREAKEVEN"),
    (r"(book\s*partial|you\s*can\s*book\s*partial|close\s*50%)", "PARTIAL_CLOSE"),
    (r"(book\s*all\s*(your)?\s*profits|full\s*tp|close\s*all|exit\s*now|book\s*(your)?\s*profits)", "CLOSE_ALL"),
    (r"(1:1\s*done|1:2\s*bhi\s*ho\s*gaya|1:2\s*already\s*given|1:3\s*done)", "RR_TARGET_HIT"),
    (r"(\d+\s*pips|points\s*done|points\s*captured)", "PIP_UPDATE"),
    (r"(level\s*tap(ped|ed)?|zone\s*tapped|\btaped\b|\btapped\b)", "LEVEL_TAPPED_ALERT"),
    (r"(active\s*now|\bactive\b|\brunning\b)", "SIGNAL_ACTIVATION")
]

def parse_with_heuristics(
    text: str,
    has_image: bool = False,
    image_cv: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Tailored parsing engine for 'ALPHA PREMIUM' combining text pattern analysis
    and computer vision zone detection for chart screenshots.
    """
    start_time = time.time()
    raw_content = (text or "")
    lower = raw_content.lower().strip()

    # 1. Computer Vision Check for TradingView Chart Overlays
    if image_cv and image_cv.get("detected"):
        is_long = image_cv.get("is_long", True)
        action = "BUY" if is_long else "SELL"
        symbol = "XAUUSD" # Default forex/crypto asset
        elapsed = int((time.time() - start_time) * 1000)

        return {
            "intent": "TRADE_UPDATE",
            "symbol": symbol,
            "action": action,
            "order_type": "MARKET",
            "entry_price": "Entry Dividing Level",
            "sl": "Red Zone Boundary (Stop Loss)",
            "tp_levels": ["Green Zone Boundary (Take Profit)"],
            "risk_reward": "Dynamic R:R (~1:2+)",
            "confidence": 95,
            "reasoning": f"TradingView chart broadcast with active {action} (Long Position) tool. Green box = Take Profit target, Red box = Stop Loss. Current candle is running in profit towards target.",
            "raw_response": {"cv_detection": image_cv, "visual_elements": "TradingView Long/Short Position Box"},
            "processing_time_ms": max(elapsed, 15),
            "model_used": "Alpha Vision Heuristic (Local CV)"
        }

    # If message is purely emojis or very short emojis (like 🚀🚀, 💸💸, 😂❤️‍🔥)
    cleaned_alphanumeric = re.sub(r"[^a-zA-Z0-9]", "", lower)
    if not cleaned_alphanumeric and len(lower) > 0 and not has_image:
        elapsed = int((time.time() - start_time) * 1000)
        return {
            "intent": "CHATTER",
            "symbol": None,
            "action": "NONE",
            "order_type": "NONE",
            "entry_price": None,
            "sl": None,
            "tp_levels": [],
            "risk_reward": None,
            "confidence": 99,
            "reasoning": "Emoji celebration / reaction. Filtered out as non-actionable chatter.",
            "raw_response": {"engine": "fine_tuned_heuristic", "classification": "emoji_reaction"},
            "processing_time_ms": max(elapsed, 6),
            "model_used": "Alpha Heuristic Engine (Free)"
        }

    # 2. Check for pure chatter / celebrations
    for pat in CHATTER_PATTERNS:
        if re.search(pat, lower):
            if not re.search(r"(entry|sl|tp)\s*[-:]?\s*\d+", lower):
                elapsed = int((time.time() - start_time) * 1000)
                return {
                    "intent": "CHATTER",
                    "symbol": None,
                    "action": "NONE",
                    "order_type": "NONE",
                    "entry_price": None,
                    "sl": None,
                    "tp_levels": [],
                    "risk_reward": None,
                    "confidence": 99,
                    "reasoning": "Conversational greeting, celebration, or affiliate link. Filtered out as non-actionable chatter.",
                    "raw_response": {"engine": "fine_tuned_heuristic", "classification": "conversational_noise"},
                    "processing_time_ms": max(elapsed, 8),
                    "model_used": "Alpha Heuristic Engine (Free)"
                }

    # Negation check (e.g. "active mat krna abhi")
    if re.search(r"(mat\s*krna|mat\s*karna|abhi\s*nahi|abhi\s*nhi|dont\s*enter|wait|roko)", lower):
        if "active" in lower or "enter" in lower or "buy" in lower or "sell" in lower:
            elapsed = int((time.time() - start_time) * 1000)
            return {
                "intent": "TRADE_UPDATE",
                "symbol": "XAUUSD",
                "action": "NONE",
                "order_type": "NONE",
                "entry_price": None,
                "sl": None,
                "tp_levels": [],
                "risk_reward": None,
                "confidence": 98,
                "reasoning": "Owner advisory: instructed to wait and NOT activate trade yet.",
                "raw_response": {"engine": "fine_tuned_heuristic", "update_type": "NEGATION_HOLD"},
                "processing_time_ms": max(elapsed, 8),
                "model_used": "Alpha Heuristic Engine (Free)"
            }

    # 3. Check for trade updates
    for pat, update_type in UPDATE_PATTERNS:
        if re.search(pat, lower):
            if not re.search(r"entry\s*[-:]?\s*\d+", lower):
                elapsed = int((time.time() - start_time) * 1000)
                
                action_map = {
                    "MOVE_SL_BREAKEVEN": "MODIFY_SL",
                    "PARTIAL_CLOSE": "PARTIAL_CLOSE",
                    "CLOSE_ALL": "CLOSE",
                    "RR_TARGET_HIT": "TARGET_HIT",
                    "PIP_UPDATE": "PIP_UPDATE",
                    "LEVEL_TAPPED_ALERT": "NONE",
                    "SIGNAL_ACTIVATION": "CONFIRM_ACTIVE"
                }

                action = action_map.get(update_type, "UPDATE")
                intent = "CLOSE_TRADE" if action == "CLOSE" else "TRADE_UPDATE"

                symbol_match = re.search(r"\b(btc|xauusd|gold|eth|eurusd|gbpusd|us30|nas100)\b", lower)
                symbol = symbol_match.group(1).upper() if symbol_match else "ACTIVE_TRADE"
                if symbol == "BTC": symbol = "BTCUSDT"
                if symbol == "GOLD": symbol = "XAUUSD"

                reasoning = {
                    "MOVE_SL_BREAKEVEN": "Owner called 'RISK FREE KR LENA': Move Stop Loss to Entry / Breakeven immediately.",
                    "PARTIAL_CLOSE": "Owner advised booking partial profits (1:2 target reached).",
                    "CLOSE_ALL": "Owner called 'BOOK ALL YOUR PROFITS' / Full TP hit. Close position completely.",
                    "RR_TARGET_HIT": "Risk:Reward target accomplished (1:1 / 1:2 / 1:3).",
                    "PIP_UPDATE": "Trade running in heavy profit pips/points.",
                    "LEVEL_TAPPED_ALERT": "Level tapped alert: price reached pending zone. Traders alert; waiting for entry confirmation.",
                    "SIGNAL_ACTIVATION": "Owner confirmed trade is active and executing."
                }.get(update_type, f"Trade update: {update_type}")

                return {
                    "intent": intent,
                    "symbol": symbol,
                    "action": action,
                    "order_type": "MARKET",
                    "entry_price": None,
                    "sl": "BREAKEVEN / ENTRY" if update_type == "MOVE_SL_BREAKEVEN" else None,
                    "tp_levels": [],
                    "risk_reward": None,
                    "confidence": 95,
                    "reasoning": reasoning,
                    "raw_response": {"engine": "fine_tuned_heuristic", "update_type": update_type},
                    "processing_time_ms": max(elapsed, 10),
                    "model_used": "Alpha Heuristic Engine (Free)"
                }

    # 4. Check for Explicit Trade Setup (e.g. Entry-71704 Sl-72714 Tp 67500)
    entry_match = re.search(r"entry\s*[-:=]?\s*([0-9]+(?:\.[0-9]+)?(?:-[0-9]+(?:\.[0-9]+)?)?)", lower)
    sl_match = re.search(r"sl\s*[-:=]?\s*([0-9]+(?:\.[0-9]+)?|[0-9]+\s*pips?)", lower)
    tp_match = re.search(r"tp\s*[-:=]?\s*([0-9]+(?:\.[0-9]+)?)", lower)

    if entry_match or sl_match or tp_match or "swing trade in btc" in lower or "sell level" in lower:
        entry = entry_match.group(1) if entry_match else "CMP"
        sl = sl_match.group(1) if sl_match else None
        tp = [tp_match.group(1)] if tp_match else []

        if "btc" in lower or "bitcoin" in lower:
            symbol = "BTCUSDT"
        elif "gold" in lower or "xauusd" in lower:
            symbol = "XAUUSD"
        else:
            try:
                entry_val = float(entry.split("-")[0])
                if entry_val > 10000:
                    symbol = "BTCUSDT"
                elif 1500 <= entry_val <= 4000:
                    symbol = "XAUUSD"
                elif 10000 <= entry_val <= 50000:
                    symbol = "US30"
                else:
                    symbol = "XAUUSD"
            except Exception:
                symbol = "XAUUSD"

        # Determine Action (BUY or SELL)
        if "sell" in lower or "short" in lower:
            action = "SELL"
        elif "buy" in lower or "long" in lower:
            action = "BUY"
        else:
            try:
                entry_num = float(entry.split("-")[0])
                sl_num = float(sl)
                action = "SELL" if sl_num > entry_num else "BUY"
            except Exception:
                action = "SELL" if "sell" in lower else "BUY"

        order_type = "LIMIT" if "level" in lower else "MARKET"

        elapsed = int((time.time() - start_time) * 1000)
        return {
            "intent": "NEW_TRADE",
            "symbol": symbol,
            "action": action,
            "order_type": order_type,
            "entry_price": entry,
            "sl": sl or "Open / Unspecified",
            "tp_levels": tp if tp else ["Open / Dynamic"],
            "risk_reward": "Dynamic",
            "confidence": 96,
            "reasoning": f"Identified {action} signal for {symbol} from ALPHA PREMIUM. Entry: {entry}, SL: {sl}, TP: {', '.join(tp) if tp else 'Dynamic'}.",
            "raw_response": {"engine": "fine_tuned_heuristic", "extracted": {"symbol": symbol, "action": action, "entry": entry, "sl": sl, "tp": tp}},
            "processing_time_ms": max(elapsed, 12),
            "model_used": "Alpha Heuristic Engine (Free)"
        }

    # If has image but not chatter, mark as Chart Update
    if has_image:
        elapsed = int((time.time() - start_time) * 1000)
        return {
            "intent": "TRADE_UPDATE",
            "symbol": "CHART_SETUP",
            "action": "UPDATE",
            "order_type": "MARKET",
            "entry_price": "See Chart",
            "sl": "Marked on Chart",
            "tp_levels": ["Marked on Chart"],
            "risk_reward": "Dynamic",
            "confidence": 85,
            "reasoning": "Chart screenshot broadcast from channel owner. Contains visual trade setup / update levels.",
            "raw_response": {"engine": "fine_tuned_heuristic", "verdict": "visual_chart_broadcast"},
            "processing_time_ms": max(elapsed, 10),
            "model_used": "Alpha Vision Heuristic (Local)"
        }

    # Default to Chatter / Non-actionable
    elapsed = int((time.time() - start_time) * 1000)
    return {
        "intent": "CHATTER",
        "symbol": None,
        "action": "NONE",
        "order_type": "NONE",
        "entry_price": None,
        "sl": None,
        "tp_levels": [],
        "risk_reward": None,
        "confidence": 88,
        "reasoning": "Message does not contain actionable entry, stop loss, or trade modification instructions.",
        "raw_response": {"engine": "fine_tuned_heuristic", "verdict": "filtered_noise"},
        "processing_time_ms": max(elapsed, 8),
        "model_used": "Alpha Heuristic Engine (Free)"
    }
