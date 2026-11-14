import asyncio
import json
from database import init_db, save_message, save_interpretation, get_messages, get_stats
from engine.interpreter import analyze_message_with_ai

async def run_tests():
    print("--- 1. Testing Database Initialization ---")
    await init_db()
    print("Database initialized successfully.")

    test_messages = [
        ("Channel Owner", "BUY GOLD NOW 2642.50 SL 2636.00 TP1 2648.00 TP2 2656.00"),
        ("Channel Owner", "ye crazyy hogya guyss enjoy your weekend"),
        ("Channel Owner", "Move SL to cost guys, gold running +45 pips"),
        ("Channel Owner", "BTC SHORT NOW 91200 SL 91800 TP 90100"),
        ("Channel Owner", "Close 50% profit here guys, hold remaining for TP2"),
        ("Channel Owner", "Good morning guys today US CPI data high volatility expected")
    ]

    print("\n--- 2. Testing AI Intent Interpretation ---")
    for sender, text in test_messages:
        print(f"\n[INPUT]: \"{text}\"")
        res = await analyze_message_with_ai(text=text)
        print(f"  -> INTENT: {res.get('intent')} | ACTION: {res.get('action')} | SYMBOL: {res.get('symbol')}")
        print(f"  -> ENTRY: {res.get('entry_price')} | SL: {res.get('sl')} | TP: {res.get('tp_levels')}")
        print(f"  -> CONFIDENCE: {res.get('confidence')}% | REASONING: {res.get('reasoning')}")

        # Save to DB to test persistence
        msg_id = await save_message(
            channel_id="-100998877",
            channel_title="VIP Gold Signals",
            sender=sender,
            text=text,
            source="test_script"
        )
        await save_interpretation(msg_id, res)

    print("\n--- 3. Testing Statistics & Querying ---")
    stats = await get_stats()
    print(f"Stats summary: {json.dumps(stats, indent=2)}")

    messages = await get_messages(limit=10)
    print(f"Total retrieved messages from DB: {len(messages)}")
    print("\nAll tests completed successfully!")

if __name__ == "__main__":
    asyncio.run(run_tests())
