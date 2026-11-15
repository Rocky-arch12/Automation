import os
import asyncio
import shutil
import uuid
from typing import Optional, List
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, Query, HTTPException, Depends, Header, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from config import settings
from auth import (
    create_access_token, decode_access_token,
    get_current_user, get_current_user_optional, get_current_authorized_user,
    is_email_authorized, ALLOWED_GOOGLE_EMAILS,
    mask_credential, hash_password, verify_password,
    encrypt_credential, decrypt_credential,
    set_auth_cookie, clear_auth_cookie
)
from database import (
    init_db, get_messages, get_stats, get_logs,
    get_all_settings, set_setting, set_settings_bulk, log_event, clear_all_data,
    save_message, save_interpretation,
    get_all_trades, get_trade_timeline, get_trade_by_id, update_trade_outcome,
    expire_old_pending_trades,
    create_user, get_user_by_email, get_user_by_id, get_user_all_settings,
    get_user_setting, set_user_setting, SENSITIVE_KEYS
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

    # Background worker: 2-Hour Inactivity Auto-Cancellation for Pending Trades
    async def _expiration_worker():
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
            except asyncio.CancelledError:
                break
            except Exception as ex:
                print(f"[EXPIRATION WORKER ERROR] {ex}")

    exp_task = asyncio.create_task(_expiration_worker())

    yield

    # Shutdown
    exp_task.cancel()
    if listener_manager.is_running:
        await listener_manager.stop_listener()
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

# Mount Uploads & Sample Signals directories
app.mount("/uploads", StaticFiles(directory=str(settings.UPLOADS_DIR)), name="uploads")
if os.path.exists("sample_signals"):
    app.mount("/sample_signals", StaticFiles(directory="sample_signals"), name="sample_signals")

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

@app.get("/api/status")
async def get_system_status():
    db_stats = await get_stats()
    stored_settings = await get_all_settings()
    has_groq = bool(stored_settings.get("GROQ_API_KEY") or settings.GROQ_API_KEY)
    has_gemini = bool(stored_settings.get("GEMINI_API_KEY") or settings.GEMINI_API_KEY)

    return {
        "status": "online",
        "listener": {
            "running": listener_manager.is_running,
            "mode": listener_manager.active_mode,
            "bot_configured": bool(stored_settings.get("TELEGRAM_BOT_TOKEN") or settings.TELEGRAM_BOT_TOKEN),
            "channel_id": stored_settings.get("TELEGRAM_CHANNEL_ID") or settings.TELEGRAM_CHANNEL_ID
        },
        "ai": {
            "provider": stored_settings.get("AI_PROVIDER") or settings.AI_PROVIDER,
            "has_groq_key": has_groq,
            "has_gemini_key": has_gemini,
            "text_model": stored_settings.get("GROQ_TEXT_MODEL") or settings.GROQ_TEXT_MODEL,
            "vision_model": stored_settings.get("GROQ_VISION_MODEL") or settings.GROQ_VISION_MODEL,
            "mode": "LLM (Groq)" if has_groq else ("LLM (Gemini)" if has_gemini else "Smart Heuristic Engine (Free Fallback)")
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
    return {"logs": logs}

# Simulation endpoint: allows testing text & images instantly from Web UI
@app.post("/api/simulate")
async def simulate_incoming_message(
    text: str = Form(""),
    sender: str = Form("Channel Owner"),
    channel_title: str = Form("VIP Signals [Test]"),
    image: Optional[UploadFile] = File(None)
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
async def update_trade_status_endpoint(trade_id: str, payload: TradeStatusUpdate):
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
    email: Optional[str] = None
    name: Optional[str] = None
    avatar_url: Optional[str] = None

@app.post("/api/auth/register")
async def register_user(payload: RegisterRequest, response: Response):
    email = payload.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Invalid email address.")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")
    
    if not is_email_authorized(email):
        raise HTTPException(
            status_code=403,
            detail=f"Access Denied: Email '{email}' is not on the authorized whitelist. Only whitelisted administrators (riddhesh.firake@gmail.com, acc94926@gmail.com) are permitted."
        )

    existing = await get_user_by_email(email)
    if existing:
        raise HTTPException(status_code=400, detail="Email is already registered. Please sign in.")
    
    user = await create_user(email=email, password=payload.password, name=payload.name, auth_provider="local")
    token = create_access_token(user["id"], user["email"], user["name"])
    set_auth_cookie(response, token)
    await log_event("INFO", "AUTH", f"New whitelisted user registered: {email}")
    return {
        "status": "success",
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "provider": user["auth_provider"]
        }
    }

@app.post("/api/auth/login")
async def login_user(payload: LoginRequest, response: Response):
    email = payload.email.lower().strip()
    if not is_email_authorized(email):
        raise HTTPException(
            status_code=403,
            detail=f"Access Denied: Email '{email}' is not on the authorized whitelist. Only riddhesh.firake@gmail.com and acc94926@gmail.com may access this system."
        )

    user = await get_user_by_email(email)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    
    if not verify_password(payload.password, user.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    
    token = create_access_token(user["id"], user["email"], user["name"], auth_provider=user.get("auth_provider", "local"))
    set_auth_cookie(response, token)
    await log_event("INFO", "AUTH", f"User signed in: {email}")
    return {
        "status": "success",
        "token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "provider": user.get("auth_provider", "local")
        }
    }

@app.post("/api/auth/google")
async def google_oauth_login(payload: GoogleAuthRequest, response: Response):
    email = (payload.email or "").lower().strip()
    name = payload.name or ""
    avatar = payload.avatar_url or ""

    if payload.credential:
        try:
            import urllib.request
            tokeninfo_url = f"https://oauth2.googleapis.com/tokeninfo?id_token={payload.credential}"
            with urllib.request.urlopen(tokeninfo_url, timeout=5) as resp:
                gdata = json.loads(resp.read().decode("utf-8"))
                email = gdata.get("email", "").lower().strip()
                name = gdata.get("name", name)
                avatar = gdata.get("picture", avatar)
        except Exception:
            try:
                import jwt as pyjwt
                claims = pyjwt.decode(payload.credential, options={"verify_signature": False})
                email = claims.get("email", "").lower().strip()
                name = claims.get("name", name)
                avatar = claims.get("picture", avatar)
            except Exception:
                pass

    if not email:
        raise HTTPException(status_code=400, detail="Missing Google email from OAuth payload.")

    # STRICT SECURITY CHECK: Only allow whitelisted administrator emails
    if not is_email_authorized(email):
        await log_event("WARNING", "AUTH_DENIED", f"Unauthorized Google OAuth attempt blocked: {email}")
        raise HTTPException(
            status_code=403,
            detail=f"Access Denied: Google account '{email}' is not authorized. Access is strictly restricted to riddhesh.firake@gmail.com and acc94926@gmail.com."
        )

    user = await get_user_by_email(email)
    if not user:
        user = await create_user(email=email, password=None, name=name or email.split("@")[0], auth_provider="google", avatar_url=avatar)
        await log_event("INFO", "AUTH", f"New whitelisted Google OAuth user authenticated: {email}")

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
        detail="Public demo guest access is disabled for live trading security. Only authorized Google accounts (riddhesh.firake@gmail.com, acc94926@gmail.com) may enter."
    )

@app.post("/api/auth/logout")
async def logout_user(response: Response):
    clear_auth_cookie(response)
    return {"status": "logged_out"}

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
        if user_id == "default":
            for field, val in data.items():
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
async def toggle_xm_auto_execution(enabled: bool = Query(...)):
    xm_executor.auto_execution_enabled = enabled
    await set_setting("XM_AUTO_EXECUTION", "true" if enabled else "false")
    await log_event("INFO", "XM_MT5", f"XM Auto-Execution toggled to: {'ON' if enabled else 'OFF'}")
    return {"status": "success", "auto_execution": enabled}

# Serve Frontend static directory
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/style.css")
async def serve_style():
    return FileResponse("static/style.css")

@app.get("/app.js")
async def serve_app_js():
    return FileResponse("static/app.js")

@app.get("/")
async def serve_index():
    return FileResponse("static/index.html")
