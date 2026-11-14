import base64
import io
import os
from pathlib import Path
from typing import Optional, Tuple, Dict, Any
from PIL import Image
import cv2
import numpy as np

def process_and_encode_image(image_path: str, max_dimension: int = 1280) -> Tuple[str, str]:
    """
    Loads, optimizes, and encodes an image to base64 for Groq or Gemini vision models.
    """
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image not found at {image_path}")

    with Image.open(path) as img:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        w, h = img.size
        if max(w, h) > max_dimension:
            scale = max_dimension / max(w, h)
            new_w, new_h = int(w * scale), int(h * scale)
            img = img.resize((new_w, new_h), Image.Resampling.LANCZOS)

        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=85, optimize=True)
        encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
        return "image/jpeg", encoded

def analyze_chart_with_cv(image_path: str) -> Optional[Dict[str, Any]]:
    """
    Computer Vision analyzer for TradingView & MT4/MT5 charts.
    Detects TradingView Long/Short Position tools (green/red zones),
    determines trade direction, entry/SL/TP zones, and candle progress.
    """
    if not image_path or not os.path.exists(image_path):
        return None

    try:
        img = cv2.imread(image_path)
        if img is None:
            return None

        h, w, _ = img.shape
        b, g, r = cv2.split(img)

        # Detect TradingView green zone (Take Profit)
        green_dom = (g.astype(int) > r.astype(int) + 12) & (g.astype(int) > b.astype(int) + 8)
        # Detect TradingView red zone (Stop Loss)
        red_dom = (r.astype(int) > g.astype(int) + 15) & (r.astype(int) > b.astype(int) + 15)

        green_pixels = np.sum(green_dom)
        red_pixels = np.sum(red_dom)

        # If significant green and red rectangular zones exist, it's a TradingView Position Setup
        if green_pixels > 2000 and red_pixels > 1500:
            gy, gx = np.where(green_dom)
            ry, rx = np.where(red_dom)

            mean_gy = np.mean(gy)
            mean_ry = np.mean(ry)

            # In image coordinates, Y increases downwards:
            # If Green is at smaller Y (higher up on chart), it's a LONG (BUY) position!
            # If Red is at smaller Y (higher up on chart), it's a SHORT (SELL) position!
            is_long = bool(mean_gy < mean_ry)

            action = "BUY" if is_long else "SELL"
            dividing_y = int((np.max(gy) + np.min(ry)) / 2) if is_long else int((np.max(ry) + np.min(gy)) / 2)

            return {
                "detected": True,
                "tool": "TradingView Position Tool",
                "action": action,
                "is_long": is_long,
                "tp_zone": "Top Green Boundary" if is_long else "Bottom Green Boundary",
                "sl_zone": "Bottom Red Boundary" if is_long else "Top Red Boundary",
                "entry_zone": f"Dividing level at Y={dividing_y}",
                "green_pixels": int(green_pixels),
                "red_pixels": int(red_pixels)
            }
    except Exception as e:
        print(f"[CV ERROR] {e}")

    return None
