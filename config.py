import os
import secrets
from pathlib import Path
from dotenv import load_dotenv
from cryptography.fernet import Fernet

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

class Settings:
    # Server
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", 8000))
    BASE_DIR: Path = BASE_DIR
    UPLOADS_DIR: Path = BASE_DIR / "uploads"
    DB_PATH: Path = BASE_DIR / "signals.db"

    # AI Configuration
    AI_PROVIDER: str = os.getenv("AI_PROVIDER", "groq") # groq, gemini, fallback
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_TEXT_MODEL: str = os.getenv("GROQ_TEXT_MODEL", "openai/gpt-oss-120b")
    GROQ_VISION_MODEL: str = os.getenv("GROQ_VISION_MODEL", "qwen/qwen3.8-27b")
    
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = os.getenv("TELEGRAM_BOT_TOKEN", "")
    TELEGRAM_CHANNEL_ID: str = os.getenv("TELEGRAM_CHANNEL_ID", "")
    
    # Telegram Client (Telethon / MTProto)
    TELEGRAM_API_ID: str = os.getenv("TELEGRAM_API_ID", "")
    TELEGRAM_API_HASH: str = os.getenv("TELEGRAM_API_HASH", "")
    TELEGRAM_PHONE: str = os.getenv("TELEGRAM_PHONE", "")

    # XM MT5 Broker Configuration
    XM_MT5_LOGIN: int = int(os.getenv("XM_MT5_LOGIN", "0") or "0")
    XM_MT5_PASSWORD: str = os.getenv("XM_MT5_PASSWORD", "")
    XM_MT5_SERVER: str = os.getenv("XM_MT5_SERVER", "XMGlobal-MT5")
    XM_MT5_PATH: str = os.getenv("XM_MT5_PATH", "")
    XM_AUTO_EXECUTION: bool = os.getenv("XM_AUTO_EXECUTION", "true").lower() in ["true", "1", "yes"]

    # Security, Encryption & Multi-Tenant Auth
    JWT_SECRET: str = os.getenv("JWT_SECRET") or secrets.token_hex(32)
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY") or Fernet.generate_key().decode()
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")

    # MongoDB Atlas Logging Configuration (Auto-purged via TTL Index)
    MONGODB_URI: str = os.getenv("MONGODB_URI", "")
    MONGODB_DB_NAME: str = os.getenv("MONGODB_DB_NAME", "alphasignal_logs")
    MONGODB_LOG_TTL_DAYS: int = int(os.getenv("MONGODB_LOG_TTL_DAYS", "7"))

    # System Status flags
    LISTENER_RUNNING: bool = False
    LISTENER_TYPE: str = "none" # "bot", "client", "simulator"

settings = Settings()
settings.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
(settings.BASE_DIR / "logs").mkdir(parents=True, exist_ok=True)
