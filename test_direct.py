import json
from engine.mock_engine import parse_with_heuristics

with open("sample_signals/channel_dump.json", "r", encoding="utf-8") as f:
    msgs = json.load(f)

print(f"Loaded {len(msgs)} messages", flush=True)

for m in reversed(msgs):
    text = m.get("text", "")
    res = parse_with_heuristics(text)
    intent = res["intent"]
    action = res["action"]
    sym = res["symbol"] or ""
    print(f"#{m['id']}: [{intent}] {action} {sym} | Text: \"{text.replace(chr(10), ' ')[:50]}\"", flush=True)
