import asyncio
import collections
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional, Callable, Any, Dict, List, Tuple
from config import settings
from database import (
    save_message,
    save_interpretation,
    log_event,
    get_channel_recent_messages,
    get_channel_pending_trades,
    get_channel_active_trades
)
from engine.interpreter import analyze_message_with_ai

class TelegramListenerManager:
    def __init__(self):
        self.is_running: bool = False
        self.active_mode: str = "none" # "bot", "client"
        self.bot_app = None
        self.client = None
        self._task: Optional[asyncio.Task] = None
        self._poll_task: Optional[asyncio.Task] = None
        self.broadcast_callback: Optional[Callable] = None
        # Coalescing buffer to merge rapid text + photo messages sent at approx same time
        self._pending_buffers: dict = {}
        self._buffer_lock = asyncio.Lock()
        # Deduplication & per-channel chronological ordering for push + poll paths
        self._seen_msg_keys: collections.OrderedDict = collections.OrderedDict()
        self._channel_last_msg_id: Dict[str, int] = {}
        self._channel_locks: Dict[str, asyncio.Lock] = {}
        self._monitored_channels: List[Tuple[str, str, Any]] = []

    def _mark_msg_seen(self, chat_id: str, msg_id: Optional[int]) -> bool:
        """Returns True if this (chat_id, msg_id) is new and marks it seen; False if already seen."""
        if msg_id is None:
            return True
        key = (str(chat_id), int(msg_id))
        if key in self._seen_msg_keys:
            return False
        self._seen_msg_keys[key] = True
        while len(self._seen_msg_keys) > 5000:
            self._seen_msg_keys.popitem(last=False)
        cur_last = self._channel_last_msg_id.get(str(chat_id), 0)
        if int(msg_id) > cur_last:
            self._channel_last_msg_id[str(chat_id)] = int(msg_id)
        return True

    def _get_channel_lock(self, chat_id: str) -> asyncio.Lock:
        cid = str(chat_id)
        if cid not in self._channel_locks:
            self._channel_locks[cid] = asyncio.Lock()
        return self._channel_locks[cid]

    def register_broadcast_callback(self, cb: Callable):
        self.broadcast_callback = cb

    async def broadcast(self, data: dict):
        if self.broadcast_callback:
            try:
                await self.broadcast_callback(data)
            except Exception as e:
                print(f"[WS BROADCAST ERROR] {e}")

    @staticmethod
    def _has_trade_params(text: str) -> bool:
        if not text:
            return False
        return bool(re.search(
            r'(?:entry|sl\b|stop\s*loss|tp\b|target|\d+(?:\.\d+)?\s*[-–/]\s*\d+|\b\d{3,6}(?:\.\d+)?\b|\b\d\.\d{3,5}\b)',
            text,
            re.IGNORECASE
        ))

    @staticmethod
    def _is_promo_or_chatter_only(text: str) -> bool:
        if not text:
            return False
        up = text.upper()
        promo_markers = ("FUNDEDNOW", "FUNDED NOW", "COUPAN", "COUPON", "YOUTUBE.COM", "YOUTU.BE", "LIVE ON YOUTUBE")
        return any(m in up for m in promo_markers) and not bool(re.search(r'(?:ENTRY|SL\b|TP\b)', up))

    async def queue_incoming_telegram_message(
        self,
        channel_id: str,
        channel_title: str,
        sender: str,
        text: str,
        media_type: str = "text",
        media_path: Optional[str] = None,
        source: str = "telegram_userbot",
        tg_msg_id: Optional[int] = None,
        tg_date: Optional[datetime] = None,
        reply_to_msg_id: Optional[int] = None
    ):
        """
        Coalesces rapid successive messages (e.g. text sent at 13:00:22 followed by params at 13:00:52)
        into a single unified message while NEVER merging distinct messages separated by >90s,
        unrelated replies, promotional ads, or two separate photos.
        """
        flush_first = None

        async with self._buffer_lock:
            existing = self._pending_buffers.get(channel_id)

            if existing:
                # Check if incoming message belongs to a DIFFERENT message/time window
                should_separate = False
                ex_date = existing.get("tg_date")
                if ex_date and tg_date:
                    try:
                        if abs((tg_date - ex_date).total_seconds()) > 90:
                            should_separate = True
                    except Exception:
                        pass

                ex_ids = existing.get("tg_msg_ids") or []
                if reply_to_msg_id and ex_ids and reply_to_msg_id not in ex_ids:
                    should_separate = True

                # Do not merge a promo/ad with a trade setup or vice versa
                if self._is_promo_or_chatter_only(text) != self._is_promo_or_chatter_only(existing.get("text") or ""):
                    if (text or "").strip() and (existing.get("text") or "").strip():
                        should_separate = True

                # Never silently overwrite or discard a second photo
                if existing.get("media_path") and media_path:
                    should_separate = True

                if should_separate:
                    if existing.get("timer_task") and not existing["timer_task"].done():
                        existing["timer_task"].cancel()
                    flush_first = self._pending_buffers.pop(channel_id)
                    existing = None

            if existing:
                # Cancel the existing delayed flush timer
                if existing.get("timer_task") and not existing["timer_task"].done():
                    existing["timer_task"].cancel()

                # Merge text
                current_text = existing.get("text") or ""
                new_text = (text or "").strip()
                if new_text:
                    merged_text = f"{current_text}\n{new_text}".strip() if current_text else new_text
                else:
                    merged_text = current_text

                # Merge media (at most one has media here)
                merged_media_path = existing.get("media_path") or media_path
                merged_media_type = existing.get("media_type") if existing.get("media_path") else media_type
                if tg_msg_id is not None:
                    existing.setdefault("tg_msg_ids", []).append(tg_msg_id)
                if tg_date:
                    existing["tg_date"] = tg_date

                has_params = self._has_trade_params(merged_text)
                is_active_lead = any(k in merged_text.upper() for k in ["ACTIVE TRADE", "ACTIVE SELLING", "ACTIVE NOW", "ACTIVE"])

                # If we have both text and photo, but text is just "Active trade" without numbers yet,
                # give a brief 3.5s window for parameter text (e.g. Entry-XXXX Sl-XXXX) to arrive
                if merged_text and merged_media_path and is_active_lead and not has_params:
                    existing["text"] = merged_text
                    existing["media_path"] = merged_media_path
                    existing["media_type"] = merged_media_type
                    existing["timer_task"] = asyncio.create_task(
                        self._flush_buffer_after_delay(channel_id, delay=3.5)
                    )
                    return

                # If we have both text and photo (or parameters arrived):
                if merged_text and merged_media_path:
                    del self._pending_buffers[channel_id]
                    asyncio.create_task(self.process_incoming_message(
                        channel_id=channel_id,
                        channel_title=channel_title or existing.get("channel_title"),
                        sender=sender or existing.get("sender"),
                        text=merged_text,
                        media_type=merged_media_type,
                        media_path=merged_media_path,
                        source=source
                    ))
                    return

                # If still only text or only media, refresh buffer and schedule flush in 3.0s
                existing["text"] = merged_text
                existing["media_path"] = merged_media_path
                existing["media_type"] = merged_media_type
                existing["timer_task"] = asyncio.create_task(
                    self._flush_buffer_after_delay(channel_id, delay=3.0)
                )
                return

        # Flush separated previous message outside buffer lock in strict chronological order
        if flush_first:
            await self.process_incoming_message(
                channel_id=flush_first["channel_id"],
                channel_title=flush_first["channel_title"],
                sender=flush_first["sender"],
                text=flush_first["text"],
                media_type=flush_first["media_type"],
                media_path=flush_first["media_path"],
                source=flush_first["source"]
            )

        async with self._buffer_lock:
            # If the message ALREADY has both meaningful text with parameters and photo
            has_params = self._has_trade_params(text or "")
            is_active_lead = any(k in (text or "").upper() for k in ["ACTIVE TRADE", "ACTIVE SELLING", "ACTIVE NOW", "ACTIVE"])

            if (text and text.strip()) and media_path and (has_params or not is_active_lead):
                asyncio.create_task(self.process_incoming_message(
                    channel_id=channel_id,
                    channel_title=channel_title,
                    sender=sender,
                    text=text,
                    media_type=media_type,
                    media_path=media_path,
                    source=source
                ))
                return

            buf_item = {
                "channel_id": channel_id,
                "channel_title": channel_title,
                "sender": sender,
                "text": text or "",
                "media_type": media_type,
                "media_path": media_path,
                "source": source,
                "tg_msg_ids": [tg_msg_id] if tg_msg_id is not None else [],
                "tg_date": tg_date
            }
            buf_item["timer_task"] = asyncio.create_task(
                self._flush_buffer_after_delay(channel_id, delay=3.0)
            )
            self._pending_buffers[channel_id] = buf_item

    async def _flush_buffer_after_delay(self, channel_id: str, delay: float):
        try:
            await asyncio.sleep(delay)
            async with self._buffer_lock:
                item = self._pending_buffers.pop(channel_id, None)
            if item:
                await self.process_incoming_message(
                    channel_id=item["channel_id"],
                    channel_title=item["channel_title"],
                    sender=item["sender"],
                    text=item["text"],
                    media_type=item["media_type"],
                    media_path=item["media_path"],
                    source=item["source"]
                )
        except asyncio.CancelledError:
            pass
        except Exception as e:
            print(f"[BUFFER FLUSH ERROR] {e}")

    async def flush_all_buffers(self):
        """Flushes any remaining pending messages immediately."""
        async with self._buffer_lock:
            items = list(self._pending_buffers.values())
            self._pending_buffers.clear()

        for item in items:
            if item.get("timer_task") and not item["timer_task"].done():
                item["timer_task"].cancel()
            try:
                await self.process_incoming_message(
                    channel_id=item["channel_id"],
                    channel_title=item["channel_title"],
                    sender=item["sender"],
                    text=item["text"],
                    media_type=item["media_type"],
                    media_path=item["media_path"],
                    source=item["source"]
                )
            except Exception as e:
                print(f"[FLUSH ALL ERROR] {e}")

    async def process_incoming_message(
        self,
        channel_id: str,
        channel_title: str,
        sender: str,
        text: str,
        media_type: str = "text",
        media_path: Optional[str] = None,
        source: str = "telegram_bot"
    ) -> dict:
        """
        Unified pipeline: DB save -> AI analyze -> DB save -> WebSocket broadcast.
        """
        await log_event("INFO", "TELEGRAM", f"Received message from {channel_title or channel_id}: {text[:60] if text else '[Media]'}")
        
        # Normalize media_path for web & DB (relative path without drive letter)
        if media_path:
            p = media_path.replace("\\", "/")
            if "uploads/" in p:
                media_path = p[p.index("uploads/"):]
            elif "sample_signals/" in p:
                media_path = p[p.index("sample_signals/"):]

        # 1. Save raw message
        msg_id = await save_message(
            channel_id=channel_id,
            channel_title=channel_title or "ALPHA PREMIUM",
            sender=sender or "Channel Owner",
            text=text or "",
            media_type=media_type,
            media_path=media_path,
            source=source
        )

        # 2. Fetch past 10 messages of this group, pending setups, and open MT5 trades
        history_messages = await get_channel_recent_messages(
            channel_id=channel_id,
            channel_title=channel_title,
            limit=10,
            exclude_message_id=msg_id
        )
        pending_trades = await get_channel_pending_trades(channel_id=channel_id, channel_title=channel_title)
        active_trades = await get_channel_active_trades(channel_id=channel_id, channel_title=channel_title)

        # 3. Analyze with AI engine (resolve local disk path and pass 10-message conversational context)
        image_disk_path = str(settings.BASE_DIR / media_path) if (media_path and not os.path.isabs(media_path)) else media_path
        try:
            interpretation = await analyze_message_with_ai(
                text=text or "",
                image_path=image_disk_path,
                channel_title=channel_title,
                channel_id=channel_id,
                history_messages=history_messages,
                pending_trades=pending_trades,
                active_trades=active_trades
            )
        except Exception as e:
            await log_event("ERROR", "AI_ENGINE", f"AI analysis failed: {str(e)}")
            interpretation = {
                "intent": "OTHERS",
                "symbol": None,
                "action": "NONE",
                "order_type": "NONE",
                "entry_price": None,
                "sl": None,
                "tp_levels": [],
                "risk_reward": None,
                "confidence": 0,
                "reasoning": f"Analysis failed: {str(e)}",
                "raw_response": {"error": str(e)},
                "processing_time_ms": 0,
                "model_used": "Error"
            }

        # 4. Trade Lifecycle & Execution Manager (AI 3-Way Intent Routing & XM Execution)
        trade_result = {}
        try:
            from engine.trade_manager import correlate_and_process_trade
            trade_result = await correlate_and_process_trade(
                message_id=msg_id,
                interpretation=interpretation,
                raw_text=text or "",
                channel_id=channel_id,
                channel_title=channel_title,
                has_image=bool(media_path)
            )
        except Exception as te:
            print(f"[TRADE MANAGER ERROR] {te}")

        # 5. Save interpretation
        interp_id = await save_interpretation(msg_id, interpretation, trade_id=trade_result.get("trade_id"))
        
        # 6. Construct payload for web broadcast
        payload = {
            "type": "NEW_SIGNAL" if interpretation.get("intent") in ["NEW_TRADE", "TRADE_UPDATE"] else "NEW_MESSAGE",
            "data": {
                "message_id": msg_id,
                "interpretation_id": interp_id,
                "trade_id": trade_result.get("trade_id"),
                "trade_action": trade_result.get("action"),
                "ticket": trade_result.get("ticket"),
                "lots": trade_result.get("lots"),
                "xm_response": trade_result.get("xm_response"),
                "channel_id": channel_id,
                "channel_title": channel_title or "ALPHA PREMIUM",
                "sender": sender or "Owner",
                "text": text or "",
                "media_type": media_type,
                "media_path": media_path,
                "source": source,
                "intent": interpretation.get("intent"),
                "symbol": interpretation.get("symbol"),
                "action": interpretation.get("action"),
                "order_type": interpretation.get("order_type"),
                "entry_price": interpretation.get("entry_price"),
                "sl": interpretation.get("sl"),
                "tp_levels": interpretation.get("tp_levels", []),
                "confidence": interpretation.get("confidence", 0),
                "is_trade": interpretation.get("is_trade", 0),
                "reasoning": interpretation.get("reasoning", ""),
                "processing_time_ms": interpretation.get("processing_time_ms", 0),
                "model_used": interpretation.get("model_used", "AI"),
                "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            }
        }

        # 7. Broadcast to connected WebSocket clients
        await self.broadcast(payload)

        # Log intent decision
        intent_type = interpretation.get("intent")
        if intent_type in ("CHATTER", "OTHERS"):
            await log_event("INFO", "FILTER", f"Chatter/noise filtered: '{text[:40]}...'", details=interpretation.get("reasoning"))
        else:
            await log_event("SIGNAL", "SIGNAL", f"Signal identified: {interpretation.get('action')} {interpretation.get('symbol')} at {interpretation.get('entry_price')}", details=str(interpretation))

        return payload["data"]

    async def fetch_user_dialogs(self, api_id: Optional[int] = None, api_hash: Optional[str] = None, session_name: str = "alpha_session"):
        """Fetches joined Telegram channels and groups so the user can select multiple sources."""
        from telethon import TelegramClient

        # Reuse active Telethon client if connected to avoid SQLite session file locking
        if self.client and self.client.is_connected() and await self.client.is_user_authorized():
            dialogs_list = []
            async for dialog in self.client.iter_dialogs(limit=100):
                if dialog.is_channel or dialog.is_group:
                    dialogs_list.append({
                        "id": str(dialog.id),
                        "title": dialog.name or "Untitled Chat",
                        "type": "channel" if dialog.is_channel else "group",
                        "username": getattr(dialog.entity, "username", None) or "",
                        "unread_count": getattr(dialog, "unread_count", 0)
                    })
            return dialogs_list

        aid_val = api_id or os.getenv("TELEGRAM_API_ID")
        aid = int(aid_val) if aid_val else None
        ahash = str(api_hash or os.getenv("TELEGRAM_API_HASH") or "").strip()
        if not aid or not ahash:
            return []

        session_path = str(settings.BASE_DIR / session_name)
        client = TelegramClient(session_path, aid, ahash)
        await client.connect()

        if not await client.is_user_authorized():
            await client.disconnect()
            return []

        dialogs_list = []
        try:
            async for dialog in client.iter_dialogs(limit=100):
                if dialog.is_channel or dialog.is_group:
                    dialogs_list.append({
                        "id": str(dialog.id),
                        "title": dialog.name or "Untitled Chat",
                        "type": "channel" if dialog.is_channel else "group",
                        "username": getattr(dialog.entity, "username", None) or "",
                        "unread_count": getattr(dialog, "unread_count", 0)
                    })
        finally:
            if not self.is_running or self.client != client:
                await client.disconnect()

        return dialogs_list

    async def start_client_listener(self, target_channel: Optional[Any] = None, api_id: Optional[int] = None, api_hash: Optional[str] = None):
        """
        Starts listening to Telegram channel live using the authenticated Telethon session.
        Can target multiple channels, a single channel name/ID, or ALPHA PREMIUM.
        """
        if self.is_running:
            await self.stop_listener()

        from telethon import TelegramClient, events
        from telethon.tl.types import MessageMediaPhoto, MessageMediaDocument

        aid_val = api_id or os.getenv("TELEGRAM_API_ID")
        aid = int(aid_val) if aid_val else None
        ahash = str(api_hash or os.getenv("TELEGRAM_API_HASH") or "").strip()
        if not aid or not ahash:
            raise RuntimeError("TELEGRAM_API_ID and TELEGRAM_API_HASH must be configured in Settings or .env")

        session_file = str(settings.BASE_DIR / "alpha_session")
        client = TelegramClient(session_file, aid, ahash)
        await client.connect()

        if not await client.is_user_authorized():
            await client.disconnect()
            raise RuntimeError("Telegram account not authorized. Please authenticate first.")

        # Match multiple channel entities
        matched_entities = []
        matched_titles = []
        
        target_set = set()
        if target_channel:
            if isinstance(target_channel, str):
                target_set = {s.strip().lower().lstrip("@") for s in target_channel.split(",") if s.strip()}
            elif isinstance(target_channel, list):
                target_set = {str(s).strip().lower().lstrip("@") for s in target_channel if str(s).strip()}

        async for dialog in client.iter_dialogs():
            dname = (dialog.name or "").lower()
            did = str(dialog.id).lower()
            did_raw = did[4:] if did.startswith("-100") else did.lstrip("-")
            duser = (getattr(dialog.entity, "username", "") or "").lower()

            if target_set:
                if (
                    did in target_set
                    or did_raw in target_set
                    or dname in target_set
                    or (duser and duser in target_set)
                ):
                    matched_entities.append(dialog.entity)
                    matched_titles.append(dialog.name)
            else:
                # Default search: look for test channel or alpha premium
                if "test" in dname or ("alpha" in dname and "premium" in dname):
                    matched_entities.append(dialog.entity)
                    matched_titles.append(dialog.name)
                    break

        if target_set and not matched_entities:
            for item in target_set:
                try:
                    ent_key = int(item) if re.fullmatch(r"-?\d+", item) else item
                    ent = await client.get_entity(ent_key)
                    if ent:
                        matched_entities.append(ent)
                        matched_titles.append(getattr(ent, "title", None) or str(item))
                except Exception:
                    pass

        if target_set and not matched_entities:
            await client.disconnect()
            raise RuntimeError(f"Configured Telegram channel(s) not found: {target_channel}. Refusing to listen to all DMs/chats.")

        chat_filter = matched_entities if matched_entities else None
        active_title = ", ".join(matched_titles) if matched_titles else (target_channel or "All Joined Chats")

        async def _dispatch_tg_message(msg, chat_id_str: str, chat_title_str: str, sender_str: str):
            lock = self._get_channel_lock(chat_id_str)
            async with lock:
                if not self._mark_msg_seen(chat_id_str, getattr(msg, "id", None)):
                    return

                text = msg.text or ""
                media_type = "text"
                media_path = None

                is_image_doc = (
                    isinstance(msg.media, MessageMediaDocument)
                    and getattr(msg.media.document, "mime_type", "").startswith("image/")
                )
                if msg.media and (isinstance(msg.media, MessageMediaPhoto) or is_image_doc):
                    media_type = "photo"
                    filename = f"live_{uuid.uuid4().hex[:8]}.jpg"
                    dest_path = settings.UPLOADS_DIR / filename
                    await client.download_media(msg, file=str(dest_path))
                    media_path = f"uploads/{filename}"

                reply_id = msg.reply_to_msg_id if getattr(msg, "reply_to", None) else None
                await self.queue_incoming_telegram_message(
                    channel_id=chat_id_str,
                    channel_title=chat_title_str,
                    sender=sender_str,
                    text=text,
                    media_type=media_type,
                    media_path=media_path,
                    source="telegram_userbot",
                    tg_msg_id=getattr(msg, "id", None),
                    tg_date=getattr(msg, "date", None),
                    reply_to_msg_id=reply_id
                )

        @client.on(events.NewMessage(chats=chat_filter))
        async def on_new_msg(event):
            msg = event.message
            chat = await event.get_chat()
            chat_title = getattr(chat, "title", "Test Channel") or "Test Channel"
            sender = await event.get_sender()
            sender_name = getattr(sender, "first_name", None) or getattr(chat, "title", None) or "Channel Owner"
            await _dispatch_tg_message(msg, str(chat.id), chat_title, sender_name)

        # Register updates state with Telegram and seed latest message IDs for real-time fallback polling
        try:
            from telethon.tl import functions as tl_functions
            await client(tl_functions.updates.GetStateRequest())
        except Exception:
            pass

        self._monitored_channels = []
        for ent in matched_entities:
            cid = str(getattr(ent, "id", ""))
            ctitle = getattr(ent, "title", None) or cid
            self._monitored_channels.append((cid, ctitle, ent))
            try:
                latest = await client.get_messages(ent, limit=1)
                if latest:
                    self._channel_last_msg_id[cid] = int(latest[0].id)
            except Exception:
                pass

        async def _poll_monitored_channels():
            """
            Polls monitored channels every 3 seconds so broadcast channels whose MTProto push updates
            are throttled/delayed up to 15 minutes by Telegram servers are captured in near real-time (<3s).
            """
            from telethon.errors import FloodWaitError
            while self.is_running and self.client == client:
                try:
                    await asyncio.sleep(3.0)
                    if not client.is_connected():
                        continue
                    for cid, ctitle, ent in list(self._monitored_channels):
                        last_id = self._channel_last_msg_id.get(cid, 0)
                        try:
                            if last_id <= 0:
                                seed = await client.get_messages(ent, limit=1)
                                if seed:
                                    self._channel_last_msg_id[cid] = int(seed[0].id)
                                continue
                            new_msgs = await client.get_messages(ent, min_id=last_id, limit=20)
                            if new_msgs:
                                # Process in strict chronological ascending ID order
                                for m in reversed(list(new_msgs)):
                                    sender_label = getattr(m, "post_author", None) or ctitle
                                    await _dispatch_tg_message(m, cid, ctitle, sender_label)
                        except FloodWaitError as fw:
                            await asyncio.sleep(min(fw.seconds + 1, 60))
                        except Exception as pe:
                            print(f"[TG CHANNEL POLL WARNING] {ctitle}: {pe}")
                except asyncio.CancelledError:
                    break
                except Exception as ex:
                    print(f"[TG POLL LOOP ERROR] {ex}")
                    await asyncio.sleep(5.0)

        self.client = client
        self.is_running = True
        self.active_mode = "userbot"
        settings.LISTENER_RUNNING = True
        settings.LISTENER_TYPE = "userbot"
        if self._monitored_channels:
            self._poll_task = asyncio.create_task(_poll_monitored_channels())
        await log_event("INFO", "TELEGRAM", f"Telethon Live Listener started for: '{active_title}' (Real-time push + 3s channel sync).")

    async def start_bot_listener(self, token: str, channel_id: Optional[str] = None):
        """Starts telegram bot polling in the background."""
        if self.is_running:
            await self.stop_listener()

        from telegram import Update
        from telegram.ext import ApplicationBuilder, MessageHandler, filters, ContextTypes

        async def handle_tg_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
            if not update.effective_message:
                return

            msg = update.effective_message
            chat_id = str(update.effective_chat.id) if update.effective_chat else ""
            chat_title = update.effective_chat.title if update.effective_chat and update.effective_chat.title else "Telegram Chat"
            sender_name = msg.from_user.full_name if msg.from_user else "Channel Owner"

            text = msg.text or msg.caption or ""
            media_type = "text"
            media_path = None

            if msg.photo:
                media_type = "photo"
                photo_file = await msg.photo[-1].get_file()
                filename = f"tg_{uuid.uuid4().hex[:8]}.jpg"
                dest_path = settings.UPLOADS_DIR / filename
                await photo_file.download_to_drive(custom_path=str(dest_path))
                media_path = f"uploads/{filename}"

            await self.queue_incoming_telegram_message(
                channel_id=chat_id,
                channel_title=chat_title,
                sender=sender_name,
                text=text,
                media_type=media_type,
                media_path=media_path,
                source="telegram_bot"
            )

        app = ApplicationBuilder().token(token).build()
        app.add_handler(MessageHandler(filters.ALL, handle_tg_message))

        await app.initialize()
        await app.start()
        await app.updater.start_polling(drop_pending_updates=True)

        self.bot_app = app
        self.is_running = True
        self.active_mode = "bot"
        settings.LISTENER_RUNNING = True
        settings.LISTENER_TYPE = "bot"
        await log_event("INFO", "TELEGRAM", "Telegram Bot Listener started successfully via Long Polling.")

    async def stop_listener(self):
        """Stops active bot or userbot listener."""
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
            self._poll_task = None

        await self.flush_all_buffers()

        if self.bot_app:
            try:
                if self.bot_app.updater and self.bot_app.updater.running:
                    await self.bot_app.updater.stop()
                if self.bot_app.running:
                    await self.bot_app.stop()
                await self.bot_app.shutdown()
            except Exception as e:
                print(f"[BOT SHUTDOWN ERROR] {e}")
            self.bot_app = None

        if self.client:
            try:
                await self.client.disconnect()
            except Exception as e:
                print(f"[CLIENT SHUTDOWN ERROR] {e}")
            self.client = None

        self.is_running = False
        self.active_mode = "none"
        settings.LISTENER_RUNNING = False
        settings.LISTENER_TYPE = "none"
        await log_event("INFO", "TELEGRAM", "Telegram Listener stopped.")

listener_manager = TelegramListenerManager()
