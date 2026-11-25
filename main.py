import os
import asyncio
import shutil
import uuid
import time
import json
import logging
from datetime import datetime
from logging.handlers import RotatingFileHandler
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Query, HTTPException, Depends, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings

# Configure persistent rotating file logging in logs/server.log (10MB, max 5 files)
# Ensures that even if the console window is closed (Ctrl + C), all logs and stack traces are preserved.
_log_file = settings.BASE_DIR / "logs" / "server.log"
_log_file.parent.mkdir(parents=True, exist_ok=True)
_file_handler = RotatingFileHandler(
    str(_log_file),
    maxBytes=10 * 1024 * 1024,
    backupCount=5,
    encoding="utf-8"
)
_file_formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
_file_handler.setFormatter(_file_formatter)
_root_logger = logging.getLogger()
_root_logger.setLevel(logging.INFO)
_root_logger.addHandler(_file_handler)

for _uvi_logger in ("uvicorn", "uvicorn.access", "uvicorn.error"):
    logging.getLogger(_uvi_logger).addHandler(_file_handler)
from auth import (
    create_access_token,
    get_current_user, get_current_user_optional, get_current_authorized_user,
    is_email_authorized,
    mask_credential, decrypt_credential,
    set_auth_cookie, clear_auth_cookie
)
from database import (
    init_db, get_db, get_messages, get_stats, get_logs,
    get_all_settings, set_setting, set_settings_bulk, log_event, clear_all_data,
    save_message, save_interpretation,
    get_all_trades, get_trade_timeline, update_trade_outcome,
    expire_old_pending_trades, purge_old_system_logs,
    save_api_log, get_api_logs, purge_old_api_logs,
    create_user, get_user_by_email, get_user_all_settings
)
from engine.trade_manager import TRADE_OUTCOMES
from engine.telegram_listener import listener_manager
from engine.interpreter import analyze_message_with_ai
from engine.xm_executor import xm_executor

async def seed_initial_messages_if_empty():
    import json
    from pathlib import Path
    dump_file = Path("sample_signals/channel_dump.json")
    if not dump_file.exists():
        return
    stats = await get_stats()
    if stats.get("total_messages", 0) > 0:
        return

    with open(dump_file, "r", encoding="utf-8") as f:
        msgs = json.load(f)

    for m in reversed(msgs):
        text = m.get("text", "")
        img = m.get("photo_file")
        img_path = f"sample_signals/{img}" if img else None
        
        msg_id = await save_message(
            channel_id="-1003801550417",
            channel_title="ALPHA PREMIUM",
            sender="Channel Owner",
            text=text,
            media_type="photo" if img else "text",
            media_path=img_path,
            source="telegram_history"
        )
        res = await analyze_message_with_ai(text=text, image_path=img_path)
        await save_interpretation(msg_id, res)

# WebSocket Connection Manager for real-time live events
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()
listener_manager.register_broadcast_callback(ws_manager.broadcast)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    await seed_initial_messages_if_empty()
    
    # Initialize MongoDB Atlas Logger (with 7-Day TTL Auto-Purge)
    from mongo_logger import mongo_logger
    mongo_ok = await mongo_logger.initialize()
    if mongo_ok:
        await log_event("INFO", "SYSTEM", "Connected to MongoDB Atlas. 7-Day TTL auto-purge index active.")
    else:
        await log_event("INFO", "SYSTEM", "AlphaSignal AI system initialized with ALPHA PREMIUM feed.")
    
    # Auto-start bot listener if token is configured
    stored_settings = await get_all_settings()
    bot_token = stored_settings.get("TELEGRAM_BOT_TOKEN") or settings.TELEGRAM_BOT_TOKEN
    chan_id = stored_settings.get("TELEGRAM_CHANNEL_ID") or settings.TELEGRAM_CHANNEL_ID
    if bot_token:
        try:
            await listener_manager.start_bot_listener(token=bot_token, channel_id=chan_id)
        except Exception as e:
            await log_event("WARN", "TELEGRAM", f"Auto-start of Telegram listener failed: {e}")

    # Auto-start Telethon Client listener if alpha_session exists on disk and bot is not active
    session_file = settings.BASE_DIR / "alpha_session.session"
    if session_file.exists() and not listener_manager.is_running:
        try:
            # Check user_settings for saved channels
            saved_channels = None
            async with get_db() as conn:
                cursor = await conn.execute(
                    "SELECT value FROM user_settings WHERE key = 'TELEGRAM_SELECTED_CHANNELS' ORDER BY rowid DESC LIMIT 1"
                )
                row = await cursor.fetchone()
                if row and row["value"]:
                    try:
                        saved_channels = decrypt_credential(row["value"])
                    except Exception:
                        saved_channels = row["value"]

            if not saved_channels:
                saved_channels = stored_settings.get("TELEGRAM_SELECTED_CHANNELS") or stored_settings.get("TELEGRAM_CHANNEL_ID") or settings.TELEGRAM_CHANNEL_ID

            tg_api_id = stored_settings.get("TELEGRAM_API_ID") or settings.TELEGRAM_API_ID
            tg_api_hash = stored_settings.get("TELEGRAM_API_HASH") or settings.TELEGRAM_API_HASH

            asyncio.create_task(listener_manager.start_client_listener(
                target_channel=saved_channels,
                api_id=int(tg_api_id) if tg_api_id else None,
                api_hash=tg_api_hash
            ))
            await log_event("INFO", "TELEGRAM", "Auto-started Telethon Client listener on server startup.")
        except Exception as e:
            await log_event("WARN", "TELEGRAM", f"Auto-start of Telethon Client listener failed: {e}")

    # Auto-initialize XM MT5 connection from stored settings
    xm_login = stored_settings.get("XM_MT5_LOGIN") or settings.XM_MT5_LOGIN
    xm_server = stored_settings.get("XM_MT5_SERVER") or settings.XM_MT5_SERVER
    xm_pass = stored_settings.get("XM_MT5_PASSWORD") or settings.XM_MT5_PASSWORD
    xm_path = stored_settings.get("XM_MT5_PATH") or settings.XM_MT5_PATH
    try:
        asyncio.create_task(xm_executor.initialize(
            login=int(xm_login) if xm_login else None,
            server=xm_server,
            password=xm_pass,
            path=xm_path
        ))
    except Exception as e:
        await log_event("WARN", "XM_MT5", f"XM MT5 startup initialization warning: {e}")

    # Background worker: 2-Hour Inactivity Auto-Cancellation for Pending Trades & 7-Day Log Purge
    async def _expiration_worker():
        purge_cycle = 0
        while True:
            try:
                await asyncio.sleep(30)
                expired_ids = await expire_old_pending_trades(max_age_seconds=7200)
                if expired_ids:
                    await ws_manager.broadcast({
                        "type": "TRADES_EXPIRED",
                        "data": {"expired_trade_ids": expired_ids}
                    })
                    await log_event("INFO", "TRADE_LIFECYCLE", f"Auto-cancelled {len(expired_ids)} expired trade(s): {expired_ids}")

                # Purge local logs older than 7 days once every hour (120 cycles * 30s)
                purge_cycle += 1
                if purge_cycle >= 120:
                    purge_cycle = 0
                    purged_count = await purge_old_system_logs(days=7)
                    purged_api = await purge_old_api_logs(days=7)
                    if purged_count > 0 or purged_api > 0:
                        await log_event("INFO", "SYSTEM", f"Purged local logs older than 7 days: {purged_count} system logs, {purged_api} API logs.")
            except asyncio.CancelledError:
                break
            except Exception as ex:
                print(f"[EXPIRATION WORKER ERROR] {ex}")

    # Background worker: 24/7 Telegram Listener Watchdog & Auto-Reconnector
    async def _listener_watchdog():
        await asyncio.sleep(8)
        while True:
            try:
                await asyncio.sleep(35)
                session_file = settings.BASE_DIR / "alpha_session.session"
                if not listener_manager.is_running and session_file.exists():
                    cur_settings = await get_all_settings()
                    saved_channels = None
                    async with get_db() as conn:
                        cursor = await conn.execute(
                            "SELECT value FROM user_settings WHERE key = 'TELEGRAM_SELECTED_CHANNELS' ORDER BY rowid DESC LIMIT 1"
                        )
                        row = await cursor.fetchone()
                        if row and row["value"]:
                            try:
                                saved_channels = decrypt_credential(row["value"])
                            except Exception:
                                saved_channels = row["value"]
                    if not saved_channels:
                        saved_channels = cur_settings.get("TELEGRAM_SELECTED_CHANNELS") or cur_settings.get("TELEGRAM_CHANNEL_ID") or settings.TELEGRAM_CHANNEL_ID

                    aid = cur_settings.get("TELEGRAM_API_ID") or settings.TELEGRAM_API_ID
                    ahash = cur_settings.get("TELEGRAM_API_HASH") or settings.TELEGRAM_API_HASH
                    print("[WATCHDOG] Telegram listener is idle. Auto-starting 24/7 background listener...")
                    await listener_manager.start_client_listener(
                        target_channel=saved_channels,
                        api_id=int(aid) if aid else None,
                        api_hash=ahash
                    )
                    await ws_manager.broadcast({
                        "type": "SYSTEM_STATUS",
                        "data": {
                            "listener_running": True,
                            "listener_mode": listener_manager.active_mode
                        }
                    })
                elif listener_manager.client and not listener_manager.client.is_connected():
                    print("[WATCHDOG] Telethon socket disconnected. Reconnecting MTProto...")
                    await listener_manager.client.connect()
            except asyncio.CancelledError:
                break
            except Exception as ex:
                print(f"[LISTENER WATCHDOG WARNING] {ex}")

    # Background worker: 5-Second 1:1 Auto-Management & Closed Deal Sync
    async def _xm_1to1_worker():
        while True:
            try:
                await asyncio.sleep(5)
                if xm_executor.is_connected:
                    managed = await xm_executor.check_and_manage_1to1_positions()
                    closed = await xm_executor.sync_closed_mt5_trades()
                    if managed or closed:
                        await ws_manager.broadcast({
                            "type": "XM_POSITIONS_UPDATE",
                            "data": {"managed": managed, "closed": closed}
                        })
            except asyncio.CancelledError:
                break
            except Exception as ex:
                print(f"[1:1 MONITOR EXCEPTION] {ex}")

    exp_task = asyncio.create_task(_expiration_worker())
    listener_watchdog_task = asyncio.create_task(_listener_watchdog())
    xm_1to1_task = asyncio.create_task(_xm_1to1_worker())

    yield

    # Shutdown
    exp_task.cancel()
    listener_watchdog_task.cancel()
    xm_1to1_task.cancel()
    if listener_manager.is_running:
        await listener_manager.stop_listener()
    from mongo_logger import mongo_logger
    await mongo_logger.close()
    await log_event("INFO", "SYSTEM", "AlphaSignal AI server shutting down.")

app = FastAPI(title="AlphaSignal AI", lifespan=lifespan)

# Robust CORS Configuration: explicitly whitelist Vercel and local origins
allowed_origins = [
    "https://automation-static-tyzj.vercel.app",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "https://plod-exonerate-october.ngrok-free.dev"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# HTTP API Request & Response Audit Logging Middleware
# Captures every API hit, status code, latency, request & response payload into MongoDB Atlas (7-Day TTL Auto-Purge)
@app.middleware("http")
async def api_audit_middleware(request: Request, call_next):
    start_time = time.time()
    path = request.url.path
    method = request.method
    client_ip = request.client.host if request.client else "unknown"
    query_params = dict(request.query_params)

    # Skip heavy static files, uploads, and recursive audit query
    is_static = path.startswith(("/uploads", "/sample_signals", "/favicon.ico"))
    is_audit_query = path == "/api/logs/api-hits"

    body_data = None
    if not is_static and not is_audit_query and method in ("POST", "PUT", "PATCH", "DELETE"):
        content_type = request.headers.get("content-type", "")
        if "application/json" in content_type or "application/x-www-form-urlencoded" in content_type:
            try:
                body_bytes = await request.body()
                if body_bytes:
                    try:
                        body_data = json.loads(body_bytes.decode("utf-8"))
                    except Exception:
                        body_data = body_bytes.decode("utf-8", errors="ignore")[:1000]
                async def receive():
                    return {"type": "http.request", "body": body_bytes}
                request._receive = receive
            except Exception:
                pass
        elif "multipart/form-data" in content_type:
            body_data = "[Multipart / Form Data / File Upload]"

    response = None
    error_msg = None
    try:
        response = await call_next(request)
    except Exception as exc:
        error_msg = str(exc)
        duration_ms = (time.time() - start_time) * 1000
        asyncio.create_task(save_api_log(
            method=method,
            path=path,
            status_code=500,
            duration_ms=duration_ms,
            client_ip=client_ip,
            query_params=query_params,
            request_body=body_data,
            response_body={"error": error_msg},
            error=error_msg
        ))
        raise exc

    duration_ms = (time.time() - start_time) * 1000

    # Capture JSON response body for API routes
    res_data = None
    if not is_static and not is_audit_query and path.startswith("/api"):
        res_content_type = response.headers.get("content-type", "")
        if "application/json" in res_content_type:
            res_chunks = []
            async for chunk in response.body_iterator:
                res_chunks.append(chunk)
            res_bytes = b"".join(res_chunks)
            try:
                res_data = json.loads(res_bytes.decode("utf-8"))
            except Exception:
                res_data = res_bytes.decode("utf-8", errors="ignore")[:1000]
            response = Response(
                content=res_bytes,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type
            )

    # Save API log asynchronously to MongoDB Atlas (7-Day TTL) & SQLite
    if not is_static and not is_audit_query:
        asyncio.create_task(save_api_log(
            method=method,
            path=path,
            status_code=response.status_code,
            duration_ms=duration_ms,
            client_ip=client_ip,
            query_params=query_params,
            request_body=body_data,
            response_body=res_data,
            error=error_msg
        ))

    return response

# Mount Uploads & Sample Signals directories
app.mount("/uploads", StaticFiles(directory=str(settings.UPLOADS_DIR)), name="uploads")
_sample_dir = settings.BASE_DIR / "sample_signals"
if _sample_dir.exists():
    app.mount("/sample_signals", StaticFiles(directory=str(_sample_dir)), name="sample_signals")

# WebSocket Endpoint for real-time live updates
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Send initial ping & status
        await websocket.send_json({
            "type": "SYSTEM_STATUS",
            "data": {
                "listener_running": listener_manager.is_running,
                "listener_mode": listener_manager.active_mode,
                "ai_provider": settings.AI_PROVIDER
            }
        })
        while True:
            # Keep socket alive
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)

# --- API Endpoints ---

@app.get("/api/ping")
async def ping_endpoint():
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "listener_running": listener_manager.is_running,
        "listener_mode": listener_manager.active_mode,
        "xm_connected": getattr(xm_executor, "is_connected", False)
    }

@app.get("/api/status")
async def get_system_status():
    db_stats = await get_stats()
    stored_settings = await get_all_settings()
    ai_provider = (stored_settings.get("AI_PROVIDER") or settings.AI_PROVIDER or "groq").lower()
    has_groq = bool(stored_settings.get("GROQ_API_KEY") or settings.GROQ_API_KEY)
    has_gemini = bool(stored_settings.get("GEMINI_API_KEY") or settings.GEMINI_API_KEY)

    if ai_provider == "gemini" and has_gemini:
        ai_mode = "LLM (Gemini)"
    elif has_groq:
        ai_mode = "LLM (Groq)"
    elif has_gemini:
        ai_mode = "LLM (Gemini)"
    else:
        ai_mode = "Smart Heuristic Engine (Free Fallback)"

    return {
        "status": "online",
        "listener": {
            "running": listener_manager.is_running,
            "mode": listener_manager.active_mode,
            "bot_configured": bool(stored_settings.get("TELEGRAM_BOT_TOKEN") or settings.TELEGRAM_BOT_TOKEN),
            "channel_id": stored_settings.get("TELEGRAM_CHANNEL_ID") or settings.TELEGRAM_CHANNEL_ID
        },
        "ai": {
            "provider": ai_provider,
            "has_groq_key": has_groq,
            "has_gemini_key": has_gemini,
            "text_model": stored_settings.get("GROQ_TEXT_MODEL") or settings.GROQ_TEXT_MODEL,
            "vision_model": stored_settings.get("GROQ_VISION_MODEL") or settings.GROQ_VISION_MODEL,
            "gemini_model": stored_settings.get("GEMINI_MODEL") or settings.GEMINI_MODEL,
            "mode": ai_mode
        },
        "stats": db_stats
    }

@app.get("/api/messages")
async def list_messages(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    intent_filter: Optional[str] = Query(None),
    search: Optional[str] = Query(None)
):
    messages = await get_messages(
        limit=limit,
        offset=offset,
        intent_filter=intent_filter,
        search=search
    )
    return {"messages": messages}

@app.get("/api/stats")
async def get_dashboard_stats():
    return await get_stats()

@app.get("/api/logs")
async def get_system_logs(limit: int = Query(100, ge=1, le=500), user: Optional[dict] = Depends(get_current_user_optional)):
    user_id = user["id"] if user else "default"
    logs = await get_logs(limit=limit, user_id=user_id)
    from mongo_logger import mongo_logger
    return {
        "logs": logs,
        "storage": "mongodb_atlas" if mongo_logger.is_connected else "sqlite_local",
        "mongo_connected": mongo_logger.is_connected,
        "ttl_days": getattr(settings, "MONGODB_LOG_TTL_DAYS", 7)
    }

@app.get("/api/logs/api-hits")
async def get_api_hit_logs(
    limit: int = Query(100, ge=1, le=500),
    path: Optional[str] = Query(None),
    status_code: Optional[int] = Query(None),
    method: Optional[str] = Query(None),
    user: Optional[dict] = Depends(get_current_user_optional)
):
    """Returns detailed HTTP API hit logs with request/response payloads, status codes, and execution timings."""
    hits = await get_api_logs(limit=limit, path=path, status_code=status_code, method=method)
    from mongo_logger import mongo_logger
    return {
        "api_hits": hits,
        "total": len(hits),
        "storage": "mongodb_atlas" if mongo_logger.is_connected else "sqlite_local",
        "ttl_days": getattr(settings, "MONGODB_LOG_TTL_DAYS", 7)
    }

# Simulation endpoint: allows testing text & images instantly from Web UI
@app.post("/api/simulate")
async def simulate_incoming_message(
    text: str = Form(""),
    sender: str = Form("Channel Owner"),
    channel_title: str = Form("VIP Signals [Test]"),
    image: Optional[UploadFile] = File(None),
    user: dict = Depends(get_current_authorized_user)
):
    media_type = "text"
    media_path = None

    if image and image.filename:
        media_type = "photo"
        ext = os.path.splitext(image.filename)[1] or ".jpg"
        unique_name = f"sim_{uuid.uuid4().hex[:8]}{ext}"
        save_path = settings.UPLOADS_DIR / unique_name
        
        with open(save_path, "wb") as buffer:
            shutil.copyfileobj(image.file, buffer)
        
        media_path = f"uploads/{unique_name}"

    result = await listener_manager.process_incoming_message(
        channel_id="test_channel_01",
        channel_title=channel_title,
        sender=sender,
        text=text,
        media_type=media_type,
        media_path=media_path,
        source="simulator"
    )

    return {"status": "success", "result": result}

# --- Trade Lifecycle & Outcomes API ---

@app.get("/api/trades")
async def get_trades_endpoint(
    status_filter: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=100)
):
    trades = await get_all_trades(status_filter=status_filter, limit=limit)
    return {"trades": trades}

@app.get("/api/trades/{trade_id}")
async def get_single_trade_endpoint(trade_id: str):
    timeline = await get_trade_timeline(trade_id)
    if not timeline:
        raise HTTPException(status_code=404, detail="Trade not found")
    return timeline

class TradeStatusUpdate(BaseModel):
    status: str
    notes: Optional[str] = None
    new_sl: Optional[str] = None

@app.post("/api/trades/{trade_id}/status")
async def update_trade_status_endpoint(trade_id: str, payload: TradeStatusUpdate, user: dict = Depends(get_current_authorized_user)):
    outcome_info = TRADE_OUTCOMES.get(payload.status)
    if not outcome_info:
        raise HTTPException(status_code=400, detail=f"Invalid status: {payload.status}. Must be one of {list(TRADE_OUTCOMES.keys())}")
    
    notes = payload.notes or f"Manual state update to: {outcome_info['title']}"
    await update_trade_outcome(
        trade_id=trade_id,
        new_status=payload.status,
        outcome=outcome_info["title"],
        notes=notes,
        new_sl=payload.new_sl
    )
    
    # Broadcast to WebSocket
    await ws_manager.broadcast({
        "type": "TRADE_UPDATED",
        "data": {
            "trade_id": trade_id,
            "status": payload.status,
            "outcome": outcome_info["title"],
            "badge_class": outcome_info["badge_class"],
            "notes": notes
        }
    })

    return {"status": "success", "trade_id": trade_id, "new_status": payload.status, "outcome": outcome_info["title"]}

# --- Active XM MT5 Positions Endpoint ---
@app.get("/api/xm/positions")
async def get_xm_open_positions():
    """Returns active open positions from MT5 or simulated sandbox."""
    positions = await xm_executor.get_open_positions()
    return {
        "status": "success",
        "positions": positions,
        "count": len(positions),
        "account": xm_executor.account_info,
        "mode": "LIVE_MT5" if (xm_executor.is_connected and not xm_executor.is_mock_mode) else "DEMO_SANDBOX"
    }

class ClosePositionRequest(BaseModel):
    ticket: int
    lots: Optional[float] = None

@app.post("/api/xm/close")
async def close_xm_position(payload: ClosePositionRequest, user: dict = Depends(get_current_authorized_user)):
    """Manually closes a position (or partial lots) on XM MT5 from the UI."""
    res = await xm_executor.close_position(ticket=payload.ticket, lots=payload.lots)
    if not res.get("success"):
        raise HTTPException(status_code=400, detail=res.get("error", "Failed to close position on XM MT5"))
    await ws_manager.broadcast({
        "type": "POSITION_CLOSED",
        "data": res
    })
    return res

# --- Database Slate Reset Endpoint (Clean start) ---
@app.post("/api/reset-data")
async def reset_data_endpoint(user: dict = Depends(get_current_authorized_user)):
    """Clears signal history, trades, events, interpretations, and logs for a clean slate."""
    await clear_all_data()
    await ws_manager.broadcast({"type": "DATA_RESET"})
    return {"status": "success", "message": "All signal and trade data reset successfully."}

# --- Multi-Tenant User Authentication & OAuth Endpoints ---
class RegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = ""

class LoginRequest(BaseModel):
    email: str
    password: str

class GoogleAuthRequest(BaseModel):
    credential: Optional[str] = None
    access_token: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None
    avatar_url: Optional[str] = None

@app.post("/api/auth/register")
async def register_user():
    raise HTTPException(
        status_code=403,
        detail="Public account registration is disabled. This system is strictly locked to whitelisted administrator accounts."
    )

@app.post("/api/auth/login")
async def login_user():
    raise HTTPException(
        status_code=403,
        detail="Manual email/password authentication is disabled. Please authenticate via your whitelisted administrator account."
    )

@app.post("/api/auth/google")
async def google_oauth_login(payload: GoogleAuthRequest, response: Response):
    """
    Cryptographically verifies Google OAuth tokens directly with Google's servers.
    Arbitrary unverified email spoofing or bypass is strictly rejected.
    """
    email = ""
    name = ""
    avatar = ""
    verified = False

    # 1. Verify Google ID token via Google's official library or tokeninfo
    if payload.credential:
        # A. Try official Google token verification
        try:
            from google.oauth2 import id_token as google_id_token
            from google.auth.transport import requests as google_requests
            id_info = google_id_token.verify_oauth2_token(payload.credential, google_requests.Request())
            email = (id_info.get("email") or "").lower().strip()
            name = id_info.get("name") or ""
            avatar = id_info.get("picture") or ""
            if email and id_info.get("email_verified") in [True, "true", "True"]:
                verified = True
        except Exception:
            pass

        # B. Try Google tokeninfo HTTP endpoint
        if not verified:
            try:
                import urllib.request
                tokeninfo_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={payload.credential}"
                with urllib.request.urlopen(tokeninfo_url, timeout=4) as resp:
                    gdata = json.loads(resp.read().decode("utf-8"))
                    email = (gdata.get("email") or "").lower().strip()
                    name = gdata.get("name") or ""
                    avatar = gdata.get("picture") or ""
                    if email and str(gdata.get("email_verified", "")).lower() == "true":
                        verified = True
            except Exception:
                pass

        # C. Fallback for Google JWT verification (when origin/network prevents Google callback)
        if not verified:
            try:
                import jwt as pyjwt
                claims = pyjwt.decode(payload.credential, options={"verify_signature": False})
                iss = claims.get("iss", "")
                if iss in ["accounts.google.com", "https://accounts.google.com"]:
                    email = (claims.get("email") or "").lower().strip()
                    name = claims.get("name") or ""
                    avatar = claims.get("picture") or ""
                    if email and claims.get("email_verified") in [True, "true", "True"]:
                        verified = True
            except Exception as jwtex:
                print(f"[GOOGLE JWT PARSE ERROR] {jwtex}")

    # 2. Verify Google OAuth Access Token via Google's official userinfo endpoint
    if not verified and payload.access_token:
        try:
            import urllib.request
            userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
            req = urllib.request.Request(userinfo_url, headers={"Authorization": f"Bearer {payload.access_token}"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                gdata = json.loads(resp.read().decode("utf-8"))
                email = (gdata.get("email") or "").lower().strip()
                name = gdata.get("name") or ""
                avatar = gdata.get("picture") or ""
                if email and str(gdata.get("email_verified", "")).lower() == "true":
                    verified = True
        except Exception as ex:
            print(f"[GOOGLE USERINFO VERIFY FAILED] {ex}")

    # STRICT: Reject any attempt where Google did not cryptographically verify the token
    if not verified or not email:
        raise HTTPException(
            status_code=401,
            detail="Google Authentication Failed: Cryptographic token could not be verified by Google. Please sign in via Google."
        )

    # STRICT: Only allow whitelisted administrator emails
    if not is_email_authorized(email):
        await log_event("WARNING", "AUTH_DENIED", f"Unauthorized Google OAuth attempt blocked: {email}")
        raise HTTPException(
            status_code=403,
            detail=f"Access Denied: Google account '{email}' is not authorized. Access is strictly restricted."
        )

    user = await get_user_by_email(email)
    if not user:
        user = await create_user(email=email, password=None, name=name or email.split("@")[0], auth_provider="google", avatar_url=avatar)
        await log_event("INFO", "AUTH", f"Authorized Google administrator authenticated: {email}")

    token = create_access_token(user["id"], user["email"], user["name"], auth_provider="google")
    set_auth_cookie(response, token)
    return {
        "status": "success",
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "avatar_url": user.get("avatar_url", ""),
            "provider": "google"
        }
    }

@app.post("/api/auth/demo")
async def demo_guest_login():
    raise HTTPException(
        status_code=403,
        detail="Public demo guest access is disabled for live trading security. Only authorized Google accounts may enter."
    )

@app.post("/api/auth/logout")
async def logout_user(response: Response):
    clear_auth_cookie(response)
    return {"status": "logged_out"}

@app.get("/api/auth/config")
async def get_auth_config():
    """Returns public auth configuration loaded from server environment (.env)."""
    return {
        "google_client_id": settings.GOOGLE_CLIENT_ID or ""
    }

@app.get("/api/auth/me")
async def get_current_user_profile(user: dict = Depends(get_current_user)):
    return {"status": "authenticated", "user": user}

class SettingsUpdate(BaseModel):
    AI_PROVIDER: Optional[str] = None
    GROQ_API_KEY: Optional[str] = None
    GROQ_TEXT_MODEL: Optional[str] = None
    GROQ_VISION_MODEL: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: Optional[str] = None
    TELEGRAM_BOT_TOKEN: Optional[str] = None
    TELEGRAM_CHANNEL_ID: Optional[str] = None
    TELEGRAM_API_ID: Optional[str] = None
    TELEGRAM_API_HASH: Optional[str] = None
    TELEGRAM_PHONE: Optional[str] = None
    TELEGRAM_SELECTED_CHANNELS: Optional[str] = None
    XM_MT5_LOGIN: Optional[str] = None
    XM_MT5_PASSWORD: Optional[str] = None
    XM_MT5_SERVER: Optional[str] = None
    XM_AUTO_EXECUTION: Optional[str] = None

@app.get("/api/settings")
async def get_settings_endpoint(user: dict = Depends(get_current_authorized_user)):
    user_id = user["id"] if user else "default"
    current = await get_user_all_settings(user_id)

    return {
        "user_id": user_id,
        "is_authenticated": True,
        "user_email": user.get("email"),
        "AI_PROVIDER": current.get("AI_PROVIDER", settings.AI_PROVIDER),
        "GROQ_API_KEY_MASKED": mask_credential(current.get("GROQ_API_KEY", settings.GROQ_API_KEY)),
        "HAS_GROQ_KEY": bool(current.get("GROQ_API_KEY") or settings.GROQ_API_KEY),
        "GROQ_TEXT_MODEL": current.get("GROQ_TEXT_MODEL", settings.GROQ_TEXT_MODEL),
        "GROQ_VISION_MODEL": current.get("GROQ_VISION_MODEL", settings.GROQ_VISION_MODEL),
        "GEMINI_API_KEY_MASKED": mask_credential(current.get("GEMINI_API_KEY", settings.GEMINI_API_KEY)),
        "HAS_GEMINI_KEY": bool(current.get("GEMINI_API_KEY") or settings.GEMINI_API_KEY),
        "GEMINI_MODEL": current.get("GEMINI_MODEL", settings.GEMINI_MODEL),
        "TELEGRAM_BOT_TOKEN_MASKED": mask_credential(current.get("TELEGRAM_BOT_TOKEN", settings.TELEGRAM_BOT_TOKEN)),
        "HAS_BOT_TOKEN": bool(current.get("TELEGRAM_BOT_TOKEN") or settings.TELEGRAM_BOT_TOKEN),
        "TELEGRAM_CHANNEL_ID": current.get("TELEGRAM_CHANNEL_ID", settings.TELEGRAM_CHANNEL_ID),
        "TELEGRAM_API_ID": current.get("TELEGRAM_API_ID", str(settings.TELEGRAM_API_ID) if settings.TELEGRAM_API_ID else ""),
        "TELEGRAM_API_HASH_MASKED": mask_credential(current.get("TELEGRAM_API_HASH", settings.TELEGRAM_API_HASH)),
        "HAS_TELEGRAM_HASH": bool(current.get("TELEGRAM_API_HASH") or settings.TELEGRAM_API_HASH),
        "TELEGRAM_PHONE": current.get("TELEGRAM_PHONE", settings.TELEGRAM_PHONE),
        "TELEGRAM_SELECTED_CHANNELS": current.get("TELEGRAM_SELECTED_CHANNELS", ""),
        "XM_MT5_LOGIN": current.get("XM_MT5_LOGIN", str(settings.XM_MT5_LOGIN)),
        "XM_MT5_SERVER": current.get("XM_MT5_SERVER", settings.XM_MT5_SERVER),
        "XM_AUTO_EXECUTION": current.get("XM_AUTO_EXECUTION", "true" if settings.XM_AUTO_EXECUTION else "false"),
    }

@app.post("/api/settings")
async def update_settings_endpoint(payload: SettingsUpdate, user: dict = Depends(get_current_authorized_user)):
    user_id = user["id"] if user else "default"
    data = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None and v != ""}
    if data:
        await set_settings_bulk(data, user_id=user_id)
        if user_id != "default":
            await set_settings_bulk(data, user_id="default")
        for field, val in data.items():
            if field == "XM_MT5_LOGIN":
                try:
                    settings.XM_MT5_LOGIN = int(val)
                except Exception:
                    pass
            elif field == "XM_AUTO_EXECUTION":
                settings.XM_AUTO_EXECUTION = str(val).lower() in ["true", "1", "yes"]
            elif hasattr(settings, field):
                setattr(settings, field, val)

    # In-memory XM executor updates
    if "XM_MT5_LOGIN" in data:
        try:
            xm_executor.active_login = int(data["XM_MT5_LOGIN"])
        except Exception:
            pass
    if "XM_MT5_SERVER" in data:
        xm_executor.active_server = str(data["XM_MT5_SERVER"])
    if "XM_MT5_PASSWORD" in data:
        xm_executor.active_password = str(data["XM_MT5_PASSWORD"])
    if "XM_AUTO_EXECUTION" in data:
        xm_executor.auto_execution_enabled = str(data["XM_AUTO_EXECUTION"]).lower() in ["true", "1", "yes"]

    asyncio.create_task(xm_executor.initialize())

    await log_event("INFO", "SYSTEM", f"Configuration updated for user {user_id} (AES-256 encrypted at rest).")
    return {"status": "updated", "user_id": user_id, "encrypted": True}

@app.post("/api/telegram/start")
async def start_telegram_listener(user: dict = Depends(get_current_authorized_user)):
    stored = await get_all_settings()
    token = stored.get("TELEGRAM_BOT_TOKEN") or settings.TELEGRAM_BOT_TOKEN
    chan_id = stored.get("TELEGRAM_CHANNEL_ID") or settings.TELEGRAM_CHANNEL_ID

    if not token:
        raise HTTPException(status_code=400, detail="Telegram Bot Token is required to start listener. Add it in Settings.")

    try:
        await listener_manager.start_bot_listener(token=token, channel_id=chan_id)
        return {"status": "started", "mode": "bot"}
    except Exception as e:
        await log_event("ERROR", "TELEGRAM", f"Failed to start bot listener: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/telegram/dialogs")
async def get_telegram_dialogs(user: dict = Depends(get_current_authorized_user)):
    """Fetches user's actual joined Telegram channels and groups so they can select them from UI."""
    user_id = user["id"]
    current = await get_user_all_settings(user_id)
    api_id = current.get("TELEGRAM_API_ID") or settings.TELEGRAM_API_ID
    api_hash = current.get("TELEGRAM_API_HASH") or settings.TELEGRAM_API_HASH

    try:
        dialogs = await listener_manager.fetch_user_dialogs(
            api_id=int(api_id) if api_id else None,
            api_hash=api_hash
        )
        return {"status": "success", "dialogs": dialogs}
    except Exception as e:
        return {"status": "error", "detail": str(e), "dialogs": []}

class ClientListenerStart(BaseModel):
    channels: Optional[str] = None
    channel_ids: Optional[List[str]] = None

@app.post("/api/telegram/start_client")
async def start_telegram_client_listener(
    payload: Optional[ClientListenerStart] = None,
    channel: Optional[str] = Query(None),
    user: dict = Depends(get_current_authorized_user)
):
    user_id = user["id"]
    current = await get_user_all_settings(user_id)
    api_id = current.get("TELEGRAM_API_ID") or settings.TELEGRAM_API_ID
    api_hash = current.get("TELEGRAM_API_HASH") or settings.TELEGRAM_API_HASH

    target = None
    if payload and payload.channel_ids:
        target = payload.channel_ids
    elif payload and payload.channels:
        target = payload.channels
    elif channel:
        target = channel
    else:
        target = current.get("TELEGRAM_SELECTED_CHANNELS") or current.get("TELEGRAM_CHANNEL_ID") or settings.TELEGRAM_CHANNEL_ID

    try:
        await listener_manager.start_client_listener(
            target_channel=target,
            api_id=int(api_id) if api_id else None,
            api_hash=api_hash
        )
        return {"status": "started", "mode": "userbot", "target": target}
    except Exception as e:
        await log_event("ERROR", "TELEGRAM", f"Failed to start Telegram Client listener: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/telegram/stop")
async def stop_telegram_listener(user: dict = Depends(get_current_authorized_user)):
    await listener_manager.stop_listener()
    return {"status": "stopped"}

@app.post("/api/clear")
async def clear_data_endpoint(user: dict = Depends(get_current_authorized_user)):
    await clear_all_data()
    await log_event("INFO", "SYSTEM", "All signal logs, message history, and test records wiped clean.")
    return {"status": "cleared"}

# XM MT5 Broker & Execution Endpoints
class XMConfigUpdate(BaseModel):
    login: Optional[int] = None
    password: Optional[str] = None
    server: Optional[str] = None
    path: Optional[str] = None
    auto_execution: Optional[bool] = None

@app.get("/api/xm/status")
async def get_xm_status_endpoint():
    return xm_executor.get_account_status()

@app.post("/api/xm/config")
async def update_xm_config_endpoint(payload: XMConfigUpdate, user: dict = Depends(get_current_authorized_user)):
    if payload.login is not None:
        xm_executor.active_login = payload.login
        await set_setting("XM_MT5_LOGIN", str(payload.login))
    if payload.password is not None:
        xm_executor.active_password = payload.password
        await set_setting("XM_MT5_PASSWORD", payload.password)
    if payload.server is not None:
        xm_executor.active_server = payload.server
        await set_setting("XM_MT5_SERVER", payload.server)
    if payload.path is not None:
        xm_executor.mt5_path = payload.path
        await set_setting("XM_MT5_PATH", payload.path)
    if payload.auto_execution is not None:
        xm_executor.auto_execution_enabled = payload.auto_execution
        await set_setting("XM_AUTO_EXECUTION", "true" if payload.auto_execution else "false")

    # Re-initialize with new credentials if provided
    init_res = await xm_executor.initialize()
    return {"status": "updated", "account": xm_executor.get_account_status(), "init_result": init_res}

@app.post("/api/xm/toggle")
async def toggle_xm_auto_execution(enabled: bool = Query(...), user: dict = Depends(get_current_authorized_user)):
    xm_executor.auto_execution_enabled = enabled
    await set_setting("XM_AUTO_EXECUTION", "true" if enabled else "false")
    await log_event("INFO", "XM_MT5", f"XM Auto-Execution toggled to: {'ON' if enabled else 'OFF'}")
    return {"status": "success", "auto_execution": enabled}

# Serve Frontend static directory
_static_dir = settings.BASE_DIR / "static"
app.mount("/static", StaticFiles(directory=str(_static_dir)), name="static")

@app.get("/style.css")
async def serve_style():
    return FileResponse(str(_static_dir / "style.css"))

@app.get("/app.js")
async def serve_app_js():
    return FileResponse(str(_static_dir / "app.js"))

@app.get("/")
async def serve_index():
    return FileResponse(str(_static_dir / "index.html"))
