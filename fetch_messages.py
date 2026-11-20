import os
import json
import asyncio
from pathlib import Path
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.tl.types import MessageMediaPhoto

load_dotenv()

_api_id_val = os.getenv("TELEGRAM_API_ID")
API_ID = int(_api_id_val) if _api_id_val else None
API_HASH = os.getenv("TELEGRAM_API_HASH", "").strip()
PHONE = os.getenv("TELEGRAM_PHONE", "")
SESSION_NAME = "alpha_session"

OUTPUT_DIR = Path("sample_signals")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

async def main():
    print(f"Connecting to Telegram with API_ID: {API_ID}...")
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    
    # Start client (will prompt for phone and code if not yet logged in)
    if PHONE:
        await client.start(phone=PHONE)
    else:
        await client.start()

    print("\n[SUCCESS] Connected to Telegram account!")
    me = await client.get_me()
    print(f"Logged in as: {me.first_name} (@{me.username or 'No username'})")

    print("\nSearching for channel 'ALPHA PREMIUM' in your dialogs...")
    target_dialog = None
    async for dialog in client.iter_dialogs():
        title = dialog.name or ""
        if "alpha" in title.lower() and "premium" in title.lower():
            target_dialog = dialog
            break
        elif "alpha" in title.lower() and not target_dialog:
            target_dialog = dialog

    if not target_dialog:
        print("[!] Could not auto-detect 'ALPHA PREMIUM'. Available dialogs:")
        dialog_list = []
        async for dialog in client.iter_dialogs(limit=25):
            print(f" - {dialog.name} (ID: {dialog.id})")
        print("\nPlease specify the exact channel title or ID.")
        return

    print(f"\n[FOUND CHANNEL]: '{target_dialog.name}' (ID: {target_dialog.id})")
    print("Fetching the last 40 messages to analyze signal patterns & intent...\n")

    dump_data = []
    count = 0
    async for message in client.iter_messages(target_dialog.entity, limit=40):
        count += 1
        msg_text = message.text or ""
        has_photo = bool(message.media and isinstance(message.media, MessageMediaPhoto))
        photo_filename = None

        if has_photo:
            photo_filename = f"msg_{message.id}.jpg"
            dest = OUTPUT_DIR / photo_filename
            print(f"Downloading image from message #{message.id} -> {dest}")
            await client.download_media(message, file=str(dest))

        dump_data.append({
            "id": message.id,
            "date": str(message.date),
            "text": msg_text,
            "has_photo": has_photo,
            "photo_file": str(photo_filename) if photo_filename else None,
            "reply_to_msg_id": message.reply_to_msg_id if message.reply_to else None
        })

    # Save to JSON
    json_path = OUTPUT_DIR / "channel_dump.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(dump_data, f, indent=2, ensure_ascii=False)

    # Save to Markdown for easy viewing
    md_path = OUTPUT_DIR / "channel_dump.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(f"# Channel Message Dump: {target_dialog.name}\n\n")
        for m in reversed(dump_data):
            f.write(f"### Message #{m['id']} — {m['date']}\n")
            if m["reply_to_msg_id"]:
                f.write(f"> *Replying to Message #{m['reply_to_msg_id']}*\n\n")
            if m["has_photo"]:
                f.write(f"**[Image Attached: {m['photo_file']}]**\n\n")
            f.write(f"```text\n{m['text']}\n```\n\n---\n\n")

    print(f"\n[SUCCESS] Dumped {count} messages to:")
    print(f"  -> {json_path}")
    print(f"  -> {md_path}")
    print(f"  -> Downloaded images saved in: {OUTPUT_DIR.resolve()}")

if __name__ == "__main__":
    asyncio.run(main())
