import asyncio
from database import init_db, clear_all_data, save_message, save_interpretation
from engine.interpreter import analyze_message_with_ai
import json
from pathlib import Path

async def reseed():
    await init_db()
    await clear_all_data()

    dump_file = Path("sample_signals/channel_dump.json")
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

    print("Reseed complete!")

if __name__ == "__main__":
    asyncio.run(reseed())
