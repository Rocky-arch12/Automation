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
    Loads, optimizes, and encodes an image to base64 for Groq multimodal vision model (qwen/qwen3.8-27b).
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
    Fast Computer Vision pre-analyzer for TradingView charts.
    Detects TradingView Long/Short Position tools (green/red zones) to assist Groq Vision.
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

        if green_pixels > 1200 and red_pixels > 1000:
            gy, gx = np.where(green_dom)
            ry, rx = np.where(red_dom)

            mean_gy = np.mean(gy)
            mean_ry = np.mean(ry)

            # In image coordinates, Y increases downwards:
            # If Green is at smaller Y (higher up on chart), it's a LONG (BUY) position!
            # If Red is at smaller Y (higher up on chart), it's a SHORT (SELL) position!
            is_long = bool(mean_gy < mean_ry)
            action = "BUY" if is_long else "SELL"

            return {
                "detected": True,
                "tool": "TradingView Position Tool",
                "action": action,
                "is_long": is_long,
                "symbol": "XAUUSD",
                "green_pixels": int(green_pixels),
                "red_pixels": int(red_pixels)
            }
    except Exception as e:
        print(f"[CV ERROR] {e}")

    return None
