import json
import secrets
import aiosqlite
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, List, Dict, Any
from config import settings
from auth import encrypt_credential, decrypt_credential, hash_password, verify_password

SENSITIVE_KEYS = {
    "XM_MT5_PASSWORD",
    "XM_MT5_LOGIN",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_API_HASH",
    "GROQ_API_KEY",
    "GEMINI_API_KEY"
}

@asynccontextmanager
async def get_db():
    async with aiosqlite.connect(settings.DB_PATH, timeout=10.0) as conn:
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA busy_timeout=5000")
        yield conn

async def init_db():
    """Initializes tables with schema and indices."""
    async with get_db() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                channel_id TEXT,
                channel_title TEXT,
                sender TEXT,
                text TEXT,
                media_type TEXT DEFAULT 'text',
                media_path TEXT,
                source TEXT DEFAULT 'simulator',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS interpretations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                message_id INTEGER,
                intent TEXT NOT NULL,
                symbol TEXT,
                action TEXT,
                order_type TEXT,
                entry_price TEXT,
                sl TEXT,
                tp_levels TEXT,
                risk_reward TEXT,
                confidence INTEGER DEFAULT 0,
                is_trade INTEGER DEFAULT 0,
                reasoning TEXT,
                raw_response TEXT,
                processing_time_ms INTEGER DEFAULT 0,
                model_used TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE CASCADE
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT DEFAULT 'INFO',
                category TEXT DEFAULT 'SYSTEM',
                message TEXT,
                details TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Multi-Tenant Users Table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                name TEXT,
                password_hash TEXT,
                auth_provider TEXT DEFAULT 'local',
                avatar_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Isolated User Encrypted Settings Table
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id TEXT NOT NULL,
                key TEXT NOT NULL,
                value TEXT NOT NULL,
                is_encrypted INTEGER DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, key)
            )
        """)

        # Trades Master Table (Tracks unique Trade ID and Lifecycle Outcomes)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id TEXT UNIQUE NOT NULL,
                symbol TEXT NOT NULL,
                action TEXT NOT NULL,
                order_type TEXT DEFAULT 'MARKET',
                entry_price TEXT,
                sl TEXT,
                tp_levels TEXT,
                risk_reward TEXT,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                outcome TEXT,
                is_active INTEGER DEFAULT 1,
                initial_message_id INTEGER,
                last_message_id INTEGER,
                pnl_notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Trade Events / Timeline Table (Tracks all events and outcome updates per trade)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS trade_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id TEXT NOT NULL,
                message_id INTEGER,
                event_type TEXT NOT NULL,
                previous_status TEXT,
                new_status TEXT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (trade_id) REFERENCES trades (trade_id) ON DELETE CASCADE
            )
        """)
        
        # Add trade_id to messages and interpretations if not present
        try:
            await conn.execute("ALTER TABLE messages ADD COLUMN trade_id TEXT")
        except Exception:
            pass

        try:
            await conn.execute("ALTER TABLE interpretations ADD COLUMN trade_id TEXT")
        except Exception:
            pass

        # Multi-Tenant User Isolation Columns
        try:
            await conn.execute("ALTER TABLE messages ADD COLUMN user_id TEXT DEFAULT 'default'")
        except Exception:
            pass

        try:
            await conn.execute("ALTER TABLE trades ADD COLUMN user_id TEXT DEFAULT 'default'")
        except Exception:
            pass

        try:
            await conn.execute("ALTER TABLE system_logs ADD COLUMN user_id TEXT DEFAULT 'default'")
        except Exception:
            pass

        # Columns for XM MT5 Execution Receipt & Channel Tracking
        for col_name, col_type in [
            ("xm_ticket", "INTEGER"),
            ("xm_execution_price", "REAL"),
            ("xm_response", "TEXT"),
            ("xm_lots", "REAL"),
            ("channel_id", "TEXT"),
            ("channel_title", "TEXT"),
        ]:
            try:
                await conn.execute(f"ALTER TABLE trades ADD COLUMN {col_name} {col_type}")
            except Exception:
                pass

        await conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_interpretations_intent ON interpretations(intent)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_logs_created ON system_logs(created_at DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_symbol_active ON trades(symbol, is_active)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)")
        await conn.execute("CREATE INDEX IF NOT EXISTS idx_trade_events_tid ON trade_events(trade_id)")
        
        await conn.commit()
        
    # Seed default settings from environment if not present
    default_keys = {
        "AI_PROVIDER": settings.AI_PROVIDER,
        "GROQ_API_KEY": settings.GROQ_API_KEY,
        "GROQ_TEXT_MODEL": settings.GROQ_TEXT_MODEL,
        "GROQ_VISION_MODEL": settings.GROQ_VISION_MODEL,
        "GEMINI_API_KEY": settings.GEMINI_API_KEY,
        "GEMINI_MODEL": settings.GEMINI_MODEL,
        "TELEGRAM_BOT_TOKEN": settings.TELEGRAM_BOT_TOKEN,
        "TELEGRAM_CHANNEL_ID": settings.TELEGRAM_CHANNEL_ID,
        "TELEGRAM_API_ID": str(settings.TELEGRAM_API_ID) if settings.TELEGRAM_API_ID else "",
        "TELEGRAM_API_HASH": settings.TELEGRAM_API_HASH,
        "TELEGRAM_PHONE": settings.TELEGRAM_PHONE,
        "XM_MT5_LOGIN": str(settings.XM_MT5_LOGIN),
        "XM_MT5_PASSWORD": settings.XM_MT5_PASSWORD,
        "XM_MT5_SERVER": settings.XM_MT5_SERVER,
        "XM_AUTO_EXECUTION": "true" if settings.XM_AUTO_EXECUTION else "false",
    }
    for k, v in default_keys.items():
        if v:
            await set_setting(k, v)

async def log_event(level: str, category: str, message: str, details: Optional[str] = None):
    try:
        async with get_db() as conn:
            await conn.execute(
                "INSERT INTO system_logs (level, category, message, details) VALUES (?, ?, ?, ?)",
                (level, category, message, details)
            )
            await conn.commit()
    except Exception as e:
        print(f"[LOG ERROR] Failed to write system log: {e}")

async def save_message(
    channel_id: str,
    channel_title: str,
    sender: str,
    text: str,
    media_type: str = "text",
    media_path: Optional[str] = None,
    source: str = "simulator",
    trade_id: Optional[str] = None
) -> int:
    async with get_db() as conn:
        cursor = await conn.execute(
            """
            INSERT INTO messages (channel_id, channel_title, sender, text, media_type, media_path, source, trade_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (channel_id, channel_title, sender, text, media_type, media_path, source, trade_id)
        )
        await conn.commit()
        return cursor.lastrowid

async def update_message_trade_id(message_id: int, trade_id: str):
    async with get_db() as conn:
        await conn.execute("UPDATE messages SET trade_id = ? WHERE id = ?", (trade_id, message_id))
        await conn.execute("UPDATE interpretations SET trade_id = ? WHERE message_id = ?", (trade_id, message_id))
        await conn.commit()

async def save_interpretation(message_id: int, data: Dict[str, Any], trade_id: Optional[str] = None) -> int:
    tp_str = json.dumps(data.get("tp_levels", [])) if isinstance(data.get("tp_levels"), list) else str(data.get("tp_levels", "[]"))
    raw_str = json.dumps(data.get("raw_response", {})) if isinstance(data.get("raw_response"), dict) else str(data.get("raw_response", ""))
    
    is_trade = 1 if data.get("intent") in ["NEW_TRADE", "TRADE_UPDATE", "CLOSE_TRADE"] else 0
    actual_tid = trade_id or data.get("trade_id")

    async with get_db() as conn:
        cursor = await conn.execute(
            """
            INSERT INTO interpretations (
                message_id, intent, symbol, action, order_type,
                entry_price, sl, tp_levels, risk_reward, confidence,
                is_trade, reasoning, raw_response, processing_time_ms, model_used, trade_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                message_id,
                data.get("intent", "CHATTER"),
                data.get("symbol"),
                data.get("action"),
                data.get("order_type", "MARKET"),
                str(data.get("entry_price", "")) if data.get("entry_price") is not None else None,
                str(data.get("sl", "")) if data.get("sl") is not None else None,
                tp_str,
                data.get("risk_reward"),
                int(data.get("confidence", 0)),
                is_trade,
                data.get("reasoning", ""),
                raw_str,
                int(data.get("processing_time_ms", 0)),
                data.get("model_used", ""),
                actual_tid
            )
        )
        await conn.commit()
        return cursor.lastrowid

async def get_messages(
    limit: int = 50,
    offset: int = 0,
    intent_filter: Optional[str] = None,
    search: Optional[str] = None
) -> List[Dict[str, Any]]:
    query = """
        SELECT 
            m.id as message_id,
            m.channel_id,
            m.channel_title,
            m.sender,
            m.text,
            m.media_type,
            m.media_path,
            m.source,
            m.trade_id,
            m.created_at,
            i.id as interpretation_id,
            i.intent,
            i.symbol,
            i.action,
            i.order_type,
            i.entry_price,
            i.sl,
            i.tp_levels,
            i.risk_reward,
            i.confidence,
            i.is_trade,
            i.reasoning,
            i.raw_response,
            i.processing_time_ms,
            i.model_used,
            t.status as trade_status,
            t.outcome as trade_outcome
        FROM messages m
        LEFT JOIN interpretations i ON m.id = i.message_id
        LEFT JOIN trades t ON m.trade_id = t.trade_id
        WHERE 1=1
    """
    params = []
    if intent_filter and intent_filter != "ALL":
        if intent_filter == "TRADES":
            query += " AND i.is_trade = 1"
        elif intent_filter == "CHATTER":
            query += " AND i.intent = 'CHATTER'"
        else:
            query += " AND i.intent = ?"
            params.append(intent_filter)

    if search:
        query += " AND (m.text LIKE ? OR i.symbol LIKE ? OR i.reasoning LIKE ? OR m.trade_id LIKE ?)"
        like_term = f"%{search}%"
        params.extend([like_term, like_term, like_term, like_term])

    query += " ORDER BY m.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    async with get_db() as conn:
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if d.get("tp_levels"):
                try:
                    d["tp_levels"] = json.loads(d["tp_levels"])
                except Exception:
                    d["tp_levels"] = [d["tp_levels"]]
            else:
                d["tp_levels"] = []
            results.append(d)
        return results
        like_term = f"%{search}%"
        params.extend([like_term, like_term, like_term])

    query += " ORDER BY m.id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    async with get_db() as conn:
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if d.get("tp_levels"):
                try:
                    d["tp_levels"] = json.loads(d["tp_levels"])
                except Exception:
                    d["tp_levels"] = [d["tp_levels"]]
            else:
                d["tp_levels"] = []
            results.append(d)
        return results

async def get_stats() -> Dict[str, Any]:
    async with get_db() as conn:
        cursor = await conn.execute("SELECT COUNT(*) FROM messages")
        total_messages = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM interpretations WHERE is_trade = 1")
        total_trades = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM interpretations WHERE intent = 'CHATTER'")
        total_chatter = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT AVG(processing_time_ms) FROM interpretations WHERE processing_time_ms > 0")
        avg_latency_row = await cursor.fetchone()
        avg_latency = round(avg_latency_row[0] or 0)

        cursor = await conn.execute("SELECT AVG(confidence) FROM interpretations WHERE is_trade = 1")
        avg_conf_row = await cursor.fetchone()
        avg_confidence = round(avg_conf_row[0] or 0)

        # Trade Outcome Counts
        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE is_active = 1")
        active_trades_count = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'PARTIAL_1_TO_1'")
        partial_1to1_count = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'BREAK_EVEN'")
        breakeven_count = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'TP_HIT'")
        tphit_count = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'SL_HIT'")
        slhit_count = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'MISSED_NOT_TAPPED'")
        not_tapped_count = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'EARLY_EXECUTION'")
        early_exec_count = (await cursor.fetchone())[0]

        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE status = 'LEVEL_TAPPED'")
        level_tapped_count = (await cursor.fetchone())[0]

        # Recent breakdown
        cursor = await conn.execute("""
            SELECT symbol, count(*) as count 
            FROM interpretations 
            WHERE symbol IS NOT NULL AND symbol != ''
            GROUP BY symbol 
            ORDER BY count DESC 
            LIMIT 5
        """)
        top_symbols = [dict(r) for r in await cursor.fetchall()]

        return {
            "total_messages": total_messages,
            "total_trades": total_trades,
            "total_chatter": total_chatter,
            "noise_filter_ratio": round((total_chatter / total_messages * 100), 1) if total_messages > 0 else 0,
            "avg_latency_ms": avg_latency,
            "avg_confidence": avg_confidence,
            "top_symbols": top_symbols,
            "trade_outcomes": {
                "active": active_trades_count,
                "partial_1to1": partial_1to1_count,
                "breakeven": breakeven_count,
                "tp_hit": tphit_count,
                "sl_hit": slhit_count,
                "missed_not_tapped": not_tapped_count,
                "early_execution": early_exec_count,
                "level_tapped": level_tapped_count
            }
        }

# --- Trade Master Database Operations ---

def get_symbol_short_code(symbol: Optional[str]) -> str:
    if not symbol:
        return "GEN"
    s = symbol.upper().replace("USDT", "").replace("/USD", "").replace("USD", "").replace("/", "").strip()
    return s[:4] if s else "GEN"

async def generate_trade_id(symbol: Optional[str]) -> str:
    """Generates unique human-readable Trade ID like TRD-XAU-01, TRD-BTC-02."""
    code = get_symbol_short_code(symbol)
    async with get_db() as conn:
        cursor = await conn.execute("SELECT COUNT(*) FROM trades WHERE trade_id LIKE ?", (f"TRD-{code}-%",))
        count = (await cursor.fetchone())[0]
        return f"TRD-{code}-{count + 1:02d}"

async def create_trade(data: Dict[str, Any]) -> str:
    """Inserts a new trade into trades master table and logs its CREATED event."""
    symbol = data.get("symbol") or "XAUUSD"
    trade_id = data.get("trade_id") or await generate_trade_id(symbol)
    action = data.get("action") or "BUY"
    order_type = data.get("order_type") or "MARKET"
    entry_price = str(data.get("entry_price")) if data.get("entry_price") is not None else None
    sl = str(data.get("sl")) if data.get("sl") is not None else None
    
    tp_levels = data.get("tp_levels", [])
    tp_str = json.dumps(tp_levels) if isinstance(tp_levels, list) else str(tp_levels)

    status = data.get("status", "PENDING")
    outcome = data.get("outcome", "Pending Setup (Awaiting Owner Confirmation)")
    is_active = 0 if status in ["CANCELLED", "SL_HIT", "TP_HIT"] else 1
    init_msg_id = data.get("initial_message_id")
    channel_id = data.get("channel_id")
    channel_title = data.get("channel_title")
    xm_ticket = data.get("xm_ticket")
    xm_execution_price = data.get("xm_execution_price")
    xm_response = data.get("xm_response")
    xm_lots = data.get("xm_lots")

    async with get_db() as conn:
        await conn.execute("""
            INSERT INTO trades (
                trade_id, symbol, action, order_type, entry_price, sl, tp_levels,
                risk_reward, status, outcome, is_active, initial_message_id, last_message_id, pnl_notes,
                channel_id, channel_title, xm_ticket, xm_execution_price, xm_response, xm_lots
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            trade_id, symbol, action, order_type, entry_price, sl, tp_str,
            data.get("risk_reward"), status, outcome, is_active, init_msg_id, init_msg_id,
            data.get("pnl_notes", outcome),
            channel_id, channel_title, xm_ticket, xm_execution_price, xm_response, xm_lots
        ))

        # Insert initial trade event
        await conn.execute("""
            INSERT INTO trade_events (
                trade_id, message_id, event_type, previous_status, new_status, notes
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (
            trade_id, init_msg_id, "CREATED", None, status,
            f"Trade setup identified: {action} {symbol} at {entry_price or 'CMP'}. Status: {outcome}"
        ))

        await conn.commit()
    return trade_id

async def update_trade_outcome(
    trade_id: str,
    new_status: str,
    outcome: str,
    notes: str,
    message_id: Optional[int] = None,
    new_sl: Optional[str] = None,
    xm_ticket: Optional[int] = None,
    xm_execution_price: Optional[float] = None,
    xm_response: Optional[str] = None,
    xm_lots: Optional[float] = None
):
    """Updates a trade's lifecycle outcome and appends to the trade_events audit trail."""
    is_terminal = new_status in ["CANCELLED", "SL_HIT", "TP_HIT"]
    is_active = 0 if is_terminal else 1

    async with get_db() as conn:
        # Get previous status
        cursor = await conn.execute("SELECT status, sl, xm_ticket, xm_lots FROM trades WHERE trade_id = ?", (trade_id,))
        row = await cursor.fetchone()
        prev_status = row["status"] if row else None
        current_sl = row["sl"] if row else None
        cur_ticket = row["xm_ticket"] if row else None
        cur_lots = row["xm_lots"] if row else None

        sl_to_save = new_sl if new_sl is not None else current_sl
        ticket_to_save = xm_ticket if xm_ticket is not None else cur_ticket
        lots_to_save = xm_lots if xm_lots is not None else cur_lots

        await conn.execute("""
            UPDATE trades 
            SET status = ?, outcome = ?, pnl_notes = ?, is_active = ?,
                last_message_id = COALESCE(?, last_message_id),
                sl = ?, xm_ticket = ?, xm_execution_price = COALESCE(?, xm_execution_price),
                xm_response = COALESCE(?, xm_response), xm_lots = ?, updated_at = CURRENT_TIMESTAMP
            WHERE trade_id = ?
        """, (new_status, outcome, notes, is_active, message_id, sl_to_save, ticket_to_save, xm_execution_price, xm_response, lots_to_save, trade_id))

        await conn.execute("""
            INSERT INTO trade_events (
                trade_id, message_id, event_type, previous_status, new_status, notes
            ) VALUES (?, ?, ?, ?, ?, ?)
        """, (trade_id, message_id, new_status, prev_status, new_status, notes))

        if message_id:
            await conn.execute("UPDATE messages SET trade_id = ? WHERE id = ?", (trade_id, message_id))
            await conn.execute("UPDATE interpretations SET trade_id = ? WHERE message_id = ?", (trade_id, message_id))

        await conn.commit()

async def get_channel_recent_messages(
    channel_id: Optional[str] = None,
    channel_title: Optional[str] = None,
    limit: int = 10,
    exclude_message_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    """
    Returns the last `limit` messages from this channel in chronological order (oldest first)
    along with their interpretations and media paths for AI context.
    """
    query = """
        SELECT 
            m.id as message_id,
            m.channel_id,
            m.channel_title,
            m.sender,
            m.text,
            m.media_type,
            m.media_path,
            m.trade_id,
            m.created_at,
            i.intent,
            i.symbol,
            i.action,
            i.order_type,
            i.entry_price,
            i.sl,
            i.tp_levels,
            i.reasoning
        FROM messages m
        LEFT JOIN interpretations i ON m.id = i.message_id
        WHERE 1=1
    """
    params = []
    if exclude_message_id:
        query += " AND m.id != ?"
        params.append(exclude_message_id)

    if channel_id and channel_id != "unknown":
        query += " AND (m.channel_id = ? OR m.channel_title = ?)"
        params.extend([channel_id, channel_title or ""])
    elif channel_title:
        query += " AND m.channel_title = ?"
        params.append(channel_title)

    query += " ORDER BY m.id DESC LIMIT ?"
    params.append(limit)

    async with get_db() as conn:
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        # Reverse to chronological order (oldest to newest)
        results = [dict(r) for r in reversed(rows)]
        for d in results:
            if d.get("tp_levels"):
                try:
                    d["tp_levels"] = json.loads(d["tp_levels"])
                except Exception:
                    d["tp_levels"] = [d["tp_levels"]]
            else:
                d["tp_levels"] = []
        return results

async def get_channel_pending_trades(
    channel_id: Optional[str] = None,
    channel_title: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns currently pending trade setups in this channel awaiting activation."""
    query = """
        SELECT * FROM trades 
        WHERE status = 'PENDING' AND is_active = 1
    """
    params = []
    if channel_id and channel_id != "unknown":
        query += " AND (channel_id = ? OR channel_id IS NULL OR channel_id = '' OR channel_title = ?)"
        params.extend([channel_id, channel_title or ""])
    query += " ORDER BY id DESC"

    async with get_db() as conn:
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        results = [dict(r) for r in rows]
        for d in results:
            if d.get("tp_levels"):
                try:
                    d["tp_levels"] = json.loads(d["tp_levels"])
                except Exception:
                    d["tp_levels"] = [d["tp_levels"]]
        return results

async def get_channel_active_trades(
    channel_id: Optional[str] = None,
    channel_title: Optional[str] = None
) -> List[Dict[str, Any]]:
    """Returns currently active/running executed trades in MT5."""
    query = """
        SELECT * FROM trades 
        WHERE status = 'EXECUTED' AND is_active = 1
    """
    params = []
    if channel_id and channel_id != "unknown":
        query += " AND (channel_id = ? OR channel_id IS NULL OR channel_id = '' OR channel_title = ?)"
        params.extend([channel_id, channel_title or ""])
    query += " ORDER BY id DESC"

    async with get_db() as conn:
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        results = [dict(r) for r in rows]
        for d in results:
            if d.get("tp_levels"):
                try:
                    d["tp_levels"] = json.loads(d["tp_levels"])
                except Exception:
                    d["tp_levels"] = [d["tp_levels"]]
        return results

async def expire_old_pending_trades(max_age_seconds: int = 7200) -> List[str]:
    """
    Cancels pending trades that have had no update within max_age_seconds (default 2 hours).
    Returns list of expired trade IDs.
    """
    async with get_db() as conn:
        cursor = await conn.execute("""
            SELECT trade_id, symbol, created_at FROM trades
            WHERE status = 'PENDING' AND is_active = 1
            AND (strftime('%s', 'now') - strftime('%s', created_at)) > ?
        """, (max_age_seconds,))
        rows = await cursor.fetchall()
        expired_ids = []
        for r in rows:
            tid = r["trade_id"]
            expired_ids.append(tid)
            await conn.execute("""
                UPDATE trades
                SET status = 'CANCELLED', outcome = 'Auto-Cancelled (No update within 2 hours)',
                    is_active = 0, updated_at = CURRENT_TIMESTAMP
                WHERE trade_id = ?
            """, (tid,))
            await conn.execute("""
                INSERT INTO trade_events (trade_id, event_type, previous_status, new_status, notes)
                VALUES (?, 'EXPIRED', 'PENDING', 'CANCELLED', 'Setup expired: No activation received within 2 hours.')
            """, (tid,))
        if expired_ids:
            await conn.commit()
        return expired_ids

        if message_id:
            await conn.execute("UPDATE messages SET trade_id = ? WHERE id = ?", (trade_id, message_id))
            await conn.execute("UPDATE interpretations SET trade_id = ? WHERE message_id = ?", (trade_id, message_id))

        await conn.commit()

async def get_active_trades_for_symbol(symbol: Optional[str]) -> List[Dict[str, Any]]:
    """Returns active or pending trades for a given symbol."""
    if not symbol:
        return []
    s_norm = symbol.upper().replace("USDT", "").replace("/USD", "").replace("USD", "").replace("/", "").strip()
    async with get_db() as conn:
        cursor = await conn.execute("""
            SELECT * FROM trades 
            WHERE is_active = 1 AND (symbol LIKE ? OR symbol LIKE ?)
            ORDER BY id DESC
        """, (f"%{s_norm}%", f"%{symbol}%"))
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if d.get("tp_levels"):
                try:
                    d["tp_levels"] = json.loads(d["tp_levels"])
                except Exception:
                    d["tp_levels"] = [d["tp_levels"]]
            else:
                d["tp_levels"] = []
            results.append(d)
        return results

async def get_trade_by_id(trade_id: str) -> Optional[Dict[str, Any]]:
    async with get_db() as conn:
        cursor = await conn.execute("SELECT * FROM trades WHERE trade_id = ?", (trade_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        if d.get("tp_levels"):
            try:
                d["tp_levels"] = json.loads(d["tp_levels"])
            except Exception:
                d["tp_levels"] = [d["tp_levels"]]
        else:
            d["tp_levels"] = []
        return d

async def get_preceding_message_trade_id(current_message_id: int, symbol: Optional[str] = None) -> Optional[str]:
    """
    Finds the trade_id from the immediate preceding/above message in the timeline.
    Prioritizes the latest preceding message matching the symbol; falls back to the
    immediate preceding message with any valid trade_id.
    """
    async with get_db() as conn:
        if symbol:
            s_norm = symbol.upper().replace("USDT", "").replace("/USD", "").replace("USD", "").replace("/", "").strip()
            cursor = await conn.execute("""
                SELECT m.trade_id FROM messages m
                LEFT JOIN trades t ON t.trade_id = m.trade_id
                WHERE m.id < ?
                  AND m.trade_id IS NOT NULL AND m.trade_id != ''
                  AND (m.text LIKE ? OR t.symbol LIKE ? OR t.symbol LIKE ?)
                ORDER BY m.id DESC LIMIT 1
            """, (current_message_id, f"%{s_norm}%", f"%{s_norm}%", f"%{symbol}%"))
            row = await cursor.fetchone()
            if row and row["trade_id"]:
                return row["trade_id"]

        # Immediate preceding message with any valid trade_id
        cursor = await conn.execute("""
            SELECT trade_id FROM messages
            WHERE id < ?
              AND trade_id IS NOT NULL AND trade_id != ''
            ORDER BY id DESC LIMIT 1
        """, (current_message_id,))
        row = await cursor.fetchone()
        if row and row["trade_id"]:
            return row["trade_id"]
        return None

async def get_all_trades(status_filter: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    query = """
        SELECT t.*, 
               (SELECT COUNT(*) FROM trade_events WHERE trade_id = t.trade_id) as event_count,
               m.text as initial_text,
               m.media_path as chart_image
        FROM trades t
        LEFT JOIN messages m ON t.initial_message_id = m.id
        WHERE 1=1
    """
    params = []
    if status_filter and status_filter != "ALL":
        if status_filter == "ACTIVE_ONLY":
            query += " AND t.is_active = 1"
        elif status_filter == "CLOSED_ONLY":
            query += " AND t.is_active = 0"
        else:
            query += " AND t.status = ?"
            params.append(status_filter)

    query += " ORDER BY t.is_active DESC, t.updated_at DESC LIMIT ?"
    params.append(limit)

    async with get_db() as conn:
        cursor = await conn.execute(query, params)
        rows = await cursor.fetchall()
        results = []
        for r in rows:
            d = dict(r)
            if d.get("tp_levels"):
                try:
                    d["tp_levels"] = json.loads(d["tp_levels"])
                except Exception:
                    d["tp_levels"] = [d["tp_levels"]]
            else:
                d["tp_levels"] = []
            results.append(d)
        return results

async def get_trade_timeline(trade_id: str) -> Dict[str, Any]:
    """Returns trade details, its lifecycle events, and all linked Telegram messages."""
    trade = await get_trade_by_id(trade_id)
    if not trade:
        return {}
    
    async with get_db() as conn:
        cursor = await conn.execute("""
            SELECT e.*, m.text, m.media_path, m.created_at as message_time
            FROM trade_events e
            LEFT JOIN messages m ON e.message_id = m.id
            WHERE e.trade_id = ?
            ORDER BY e.id ASC
        """, (trade_id,))
        events = [dict(r) for r in await cursor.fetchall()]

        cursor = await conn.execute("""
            SELECT m.*, i.intent, i.action, i.entry_price, i.sl, i.tp_levels, i.reasoning, i.model_used
            FROM messages m
            LEFT JOIN interpretations i ON m.id = i.message_id
            WHERE m.trade_id = ?
            ORDER BY m.id ASC
        """, (trade_id,))
        messages = [dict(r) for r in await cursor.fetchall()]

        trade["events"] = events
        trade["messages"] = messages
        return trade

async def get_logs(limit: int = 100, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
    async with get_db() as conn:
        if user_id and user_id != "default":
            cursor = await conn.execute("SELECT * FROM system_logs WHERE user_id = ? OR user_id = 'default' ORDER BY id DESC LIMIT ?", (user_id, limit))
        else:
            cursor = await conn.execute("SELECT * FROM system_logs ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in await cursor.fetchall()]

# Multi-Tenant User Management
async def create_user(email: str, password: Optional[str] = None, name: str = "", auth_provider: str = "local", avatar_url: Optional[str] = None) -> Dict[str, Any]:
    user_id = "usr_" + secrets.token_hex(8)
    pw_hash = hash_password(password) if password else None
    display_name = name or email.split("@")[0]
    clean_email = email.lower().strip()
    async with get_db() as conn:
        await conn.execute(
            """
            INSERT INTO users (id, email, name, password_hash, auth_provider, avatar_url)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, clean_email, display_name, pw_hash, auth_provider, avatar_url)
        )
        await conn.commit()
    return {
        "id": user_id,
        "email": clean_email,
        "name": display_name,
        "auth_provider": auth_provider,
        "avatar_url": avatar_url
    }

async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    async with get_db() as conn:
        cursor = await conn.execute("SELECT * FROM users WHERE email = ?", (email.lower().strip(),))
        row = await cursor.fetchone()
        return dict(row) if row else None

async def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    async with get_db() as conn:
        cursor = await conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None

# Isolated Encrypted User Settings
async def get_user_setting(user_id: str, key: str, default: Optional[str] = None) -> Optional[str]:
    async with get_db() as conn:
        if user_id and user_id != "default":
            cursor = await conn.execute("SELECT value, is_encrypted FROM user_settings WHERE user_id = ? AND key = ?", (user_id, key))
            row = await cursor.fetchone()
            if row:
                val = row["value"]
                if row["is_encrypted"] or key in SENSITIVE_KEYS:
                    return decrypt_credential(val)
                return val

        cursor = await conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,))
        row = await cursor.fetchone()
        if row:
            val = row["value"]
            if key in SENSITIVE_KEYS:
                return decrypt_credential(val)
            return val
        return default

async def set_user_setting(user_id: str, key: str, value: Any):
    is_sens = key in SENSITIVE_KEYS
    val_to_store = encrypt_credential(str(value)) if is_sens else str(value)
    async with get_db() as conn:
        await conn.execute(
            """
            INSERT INTO user_settings (user_id, key, value, is_encrypted, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, key) DO UPDATE SET 
                value = excluded.value, 
                is_encrypted = excluded.is_encrypted,
                updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, key, val_to_store, 1 if is_sens else 0)
        )
        if user_id == "default":
            await conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at) 
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP
                """,
                (key, val_to_store)
            )
        await conn.commit()

async def get_user_all_settings(user_id: str) -> Dict[str, str]:
    async with get_db() as conn:
        cursor = await conn.execute("SELECT key, value FROM app_settings")
        res = {r["key"]: (decrypt_credential(r["value"]) if r["key"] in SENSITIVE_KEYS else r["value"]) for r in await cursor.fetchall()}
        if user_id and user_id != "default":
            cursor = await conn.execute("SELECT key, value, is_encrypted FROM user_settings WHERE user_id = ?", (user_id,))
            for r in await cursor.fetchall():
                k = r["key"]
                v = r["value"]
                res[k] = decrypt_credential(v) if (r["is_encrypted"] or k in SENSITIVE_KEYS) else v
        return res

async def get_setting(key: str, default: Optional[str] = None, user_id: str = "default") -> Optional[str]:
    return await get_user_setting(user_id, key, default)

async def set_setting(key: str, value: str, user_id: str = "default"):
    await set_user_setting(user_id, key, value)

async def set_settings_bulk(settings_dict: Dict[str, Any], user_id: str = "default"):
    for key, value in settings_dict.items():
        if value is not None:
            await set_user_setting(user_id, key, value)

async def get_all_settings(user_id: str = "default") -> Dict[str, str]:
    return await get_user_all_settings(user_id)

async def clear_all_data():
    """Wipes signal history, trades, events, interpretations, and logs for a clean slate."""
    async with get_db() as conn:
        try:
            await conn.execute("DELETE FROM trade_events")
        except Exception:
            pass
        try:
            await conn.execute("DELETE FROM trades")
        except Exception:
            pass
        try:
            await conn.execute("DELETE FROM interpretations")
        except Exception:
            pass
        try:
            await conn.execute("DELETE FROM messages")
        except Exception:
            pass
        try:
            await conn.execute("DELETE FROM system_logs")
        except Exception:
            pass
        try:
            await conn.execute("DELETE FROM mt5_executions")
        except Exception:
            pass
        await conn.commit()
