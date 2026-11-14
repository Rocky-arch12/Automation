import json
import asyncio
from pathlib import Path
from engine.interpreter import analyze_message_with_ai

async def run_accuracy_test():
    dump_file = Path("sample_signals/channel_dump.json")
    if not dump_file.exists():
        print("channel_dump.json not found!")
        return

    with open(dump_file, "r", encoding="utf-8") as f:
        messages = json.load(f)

    print(f"\n========================================================")
    print(f"BENCHMARKING ACCURACY ON {len(messages)} REAL MESSAGES FROM ALPHA PREMIUM")
    print(f"========================================================\n")

    trades_count = 0
    updates_count = 0
    chatter_count = 0

    for m in reversed(messages):
        text = m.get("text", "")
        img = m.get("photo_file")
        img_path = f"sample_signals/{img}" if img else None
        msg_id = m.get("id")

        res = await analyze_message_with_ai(text=text, image_path=img_path)
        intent = res.get("intent")
        action = res.get("action")
        symbol = res.get("symbol")
        reasoning = res.get("reasoning")
        conf = res.get("confidence")

        if intent in ["NEW_TRADE"]:
            trades_count += 1
            icon = "⚡ [TRADE]"
        elif intent in ["TRADE_UPDATE", "CLOSE_TRADE"]:
            updates_count += 1
            icon = "🔄 [UPDATE]"
        else:
            chatter_count += 1
            icon = "💬 [CHATTER/NOISE]"

        clean_text = text.replace('\n', ' ') if text else '[Image]'
        print(f"#{msg_id} {icon} ({conf}%) | {action} {symbol or ''}")
        print(f"   Raw Text: \"{clean_text[:60]}\"")
        print(f"   AI Intent: {reasoning}")
        if res.get("entry_price") or res.get("sl") or res.get("tp_levels"):
            print(f"   Params -> Entry: {res.get('entry_price')} | SL: {res.get('sl')} | TP: {res.get('tp_levels')}")
        print("-" * 55)

    print("\n================== ACCURACY SUMMARY ==================")
    print(f"Total Real Messages Evaluated: {len(messages)}")
    print(f"Actionable Trades Identified: {trades_count}")
    print(f"Trade Updates (SL/TP/Exit):   {updates_count}")
    print(f"Chatter Filtered Out:         {chatter_count} ({round(chatter_count/len(messages)*100, 1)}% noise rejection)")
    print("======================================================\n")

if __name__ == "__main__":
    asyncio.run(run_accuracy_test())
