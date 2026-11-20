import os
import sys
import json
import asyncio
from dotenv import load_dotenv
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError

load_dotenv()

_api_id_val = os.getenv("TELEGRAM_API_ID")
API_ID = int(_api_id_val) if _api_id_val else None
API_HASH = os.getenv("TELEGRAM_API_HASH", "").strip()
PHONE = os.getenv("TELEGRAM_PHONE", "").strip()
SESSION_NAME = "alpha_session"
AUTH_FILE = "auth_state.json"

async def request_code():
    if not PHONE:
        print("ERROR: TELEGRAM_PHONE is empty in .env")
        sys.exit(1)

    print(f"Connecting to Telegram for phone {PHONE}...")
    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.connect()

    if await client.is_user_authorized():
        print("ALREADY_AUTHORIZED")
        await client.disconnect()
        return

    print("Sending code request to Telegram...")
    res = await client.send_code_request(PHONE)
    with open(AUTH_FILE, "w") as f:
        json.dump({"phone": PHONE, "phone_code_hash": res.phone_code_hash}, f)

    print("CODE_SENT_SUCCESS")
    await client.disconnect()

async def verify_code(code: str, password: str = None):
    if not os.path.exists(AUTH_FILE):
        print("ERROR: No pending code request found. Run request_code first.")
        sys.exit(1)

    with open(AUTH_FILE, "r") as f:
        auth_data = json.load(f)

    phone = auth_data["phone"]
    phone_code_hash = auth_data["phone_code_hash"]

    client = TelegramClient(SESSION_NAME, API_ID, API_HASH)
    await client.connect()

    try:
        await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
        print("AUTH_SUCCESS")
        me = await client.get_me()
        print(f"Logged in as: {me.first_name} (@{me.username or 'No username'})")
        if os.path.exists(AUTH_FILE):
            os.remove(AUTH_FILE)
    except SessionPasswordNeededError:
        if password:
            await client.sign_in(password=password)
            print("AUTH_SUCCESS_2FA")
            me = await client.get_me()
            print(f"Logged in as: {me.first_name} (@{me.username or 'No username'})")
            if os.path.exists(AUTH_FILE):
                os.remove(AUTH_FILE)
        else:
            print("2FA_PASSWORD_REQUIRED")
    except Exception as e:
        print(f"AUTH_ERROR: {e}")
    finally:
        await client.disconnect()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python auth_telegram.py [request_code | verify_code <code> [password]]")
        sys.exit(1)

    action = sys.argv[1]
    if action == "request_code":
        asyncio.run(request_code())
    elif action == "verify_code":
        code = sys.argv[2] if len(sys.argv) > 2 else ""
        password = sys.argv[3] if len(sys.argv) > 3 else None
        asyncio.run(verify_code(code, password))
