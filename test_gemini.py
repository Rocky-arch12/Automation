import os
import time
from google import genai
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
print("Initializing client...", flush=True)
client = genai.Client(api_key=api_key)

print("Sending request to gemini-3.8-flash...", flush=True)
start = time.time()
try:
    res = client.models.generate_content(
        model='gemini-3.8-flash',
        contents='Say: Connected successfully!'
    )
    print(f"Success in {time.time()-start:.2f}s: {res.text}", flush=True)
except Exception as e:
    print(f"Error: {e}", flush=True)
