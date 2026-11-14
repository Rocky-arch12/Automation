import json
from engine.vision_processor import analyze_chart_with_cv
from engine.mock_engine import parse_with_heuristics

cv_res = analyze_chart_with_cv("sample_signals/msg_2318.jpg")
print("CV result:", cv_res, flush=True)

res = parse_with_heuristics(text="", has_image=True, image_cv=cv_res)
print("Parsed result:\n", json.dumps(res, indent=2), flush=True)
