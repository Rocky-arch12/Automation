import os
import hmac
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
from fastapi import Header, HTTPException, Request, Response
import jwt
from cryptography.fernet import Fernet
from config import settings

# Initialize Fernet symmetric encryption suite
try:
    _fernet = Fernet(settings.ENCRYPTION_KEY.encode())
except Exception:
    # Fallback to deterministic key if ENCRYPTION_KEY is invalid length
    _padded_key = hashlib.sha256(settings.ENCRYPTION_KEY.encode()).digest()
    import base64
    _fernet = Fernet(base64.urlsafe_b64encode(_padded_key))

def hash_password(password: str) -> str:
    """Hashes a password with salt using PBKDF2-HMAC-SHA256 (100,000 iterations)."""
    salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100_000
    ).hex()
    return f"{salt}${pw_hash}"

def verify_password(password: str, stored_hash: str) -> bool:
    """Safely verifies a password against stored salt$hash with constant time comparison."""
    if not stored_hash or "$" not in stored_hash:
        return False
    try:
        salt, expected_hash = stored_hash.split("$", 1)
        computed_hash = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            100_000
        ).hex()
        return hmac.compare_digest(computed_hash, expected_hash)
    except Exception:
        return False

def encrypt_credential(plaintext: str) -> str:
    """AES-128-CBC + HMAC-SHA256 encrypts a sensitive credential at rest."""
    if not plaintext:
        return ""
    try:
        encrypted_bytes = _fernet.encrypt(plaintext.encode("utf-8"))
        return encrypted_bytes.decode("utf-8")
    except Exception as e:
        print(f"[ENCRYPT ERROR] Failed to encrypt credential: {e}")
        return plaintext

def decrypt_credential(ciphertext: str) -> str:
    """Decrypts an encrypted credential. Falls back to plaintext for legacy values."""
    if not ciphertext:
        return ""
    try:
        decrypted_bytes = _fernet.decrypt(ciphertext.encode("utf-8"))
        return decrypted_bytes.decode("utf-8")
    except Exception:
        # Returns as-is if was stored unencrypted
        return ciphertext

def mask_credential(value: str) -> str:
    """Masks a credential for display so raw secrets are never shown on the UI."""
    if not value:
        return ""
    clean = str(value).strip()
    if len(clean) <= 6:
        return "••••••"
    return f"{clean[:3]}••••{clean[-4:]}"

def create_access_token(user_id: str, email: str, name: str = "", auth_provider: str = "local", expires_days: int = 30) -> str:
    """Creates a signed JWT access token for user session persistence."""
    expire = datetime.utcnow() + timedelta(days=expires_days)
    payload = {
        "sub": str(user_id),
        "email": email,
        "name": name or email.split("@")[0],
        "provider": auth_provider,
        "exp": expire,
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")

def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes and validates a JWT access token."""
    if not token:
        return None
    try:
        clean_token = token.replace("Bearer ", "").strip()
        payload = jwt.decode(clean_token, settings.JWT_SECRET, algorithms=["HS256"])
        return payload
    except Exception:
        return None

def set_auth_cookie(response: Response, token: str):
    """Sets secure HttpOnly session cookie for authentication with cross-origin support."""
    try:
        response.set_cookie(
            key="access_token",
            value=token,
            httponly=True,
            max_age=30 * 24 * 3600,
            expires=30 * 24 * 3600,
            samesite="none",
            secure=True,
            path="/"
        )
    except Exception as e:
        print(f"[AUTH COOKIE ERROR] {e}")

def clear_auth_cookie(response: Response):
    """Clears the HttpOnly session cookie on logout."""
    try:
        response.delete_cookie(
            key="access_token",
            path="/",
            samesite="none",
            secure=True
        )
    except Exception as e:
        print(f"[AUTH COOKIE CLEAR ERROR] {e}")

ALLOWED_GOOGLE_EMAILS = {
    "riddhesh.firake@gmail.com",
    "acc94926@gmail.com"
}

def is_email_authorized(email: str) -> bool:
    """Checks whether an email is in the authorized admin whitelist."""
    if not email:
        return False
    return email.lower().strip() in ALLOWED_GOOGLE_EMAILS

async def get_current_user_optional(request: Request, authorization: Optional[str] = Header(None)) -> Optional[Dict[str, Any]]:
    """Dependency: returns the authenticated user from HttpOnly Cookie, Bearer header, or Ngrok Edge OAuth."""
    # 1. Check if request authenticated via Ngrok Google OAuth at the edge
    if request:
        ngrok_email = request.headers.get("ngrok-auth-user-email")
        if ngrok_email:
            clean_email = ngrok_email.lower().strip()
            if is_email_authorized(clean_email):
                return {
                    "id": f"user_{hashlib.md5(clean_email.encode()).hexdigest()[:8]}",
                    "email": clean_email,
                    "name": request.headers.get("ngrok-auth-user-name", clean_email.split("@")[0]),
                    "provider": "google-edge"
                }

    # 2. Check HttpOnly cookie or Authorization Bearer header
    token = request.cookies.get("access_token") if request else None
    if not token and authorization:
        token = authorization
    if not token:
        return None
    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        return None
    return {
        "id": payload["sub"],
        "email": payload.get("email", ""),
        "name": payload.get("name", ""),
        "provider": payload.get("provider", "local")
    }

async def get_current_user(request: Request, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Dependency: enforces authenticated session or raises HTTP 401."""
    user = await get_current_user_optional(request, authorization)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please sign in via Google OAuth.",
            headers={"WWW-Authenticate": "Bearer"}
        )
    return user

async def get_current_authorized_user(request: Request, authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Dependency: enforces authenticated session AND whitelisted admin email or raises HTTP 403."""
    user = await get_current_user(request, authorization)
    user_email = (user.get("email") or "").lower().strip()
    if not is_email_authorized(user_email):
        raise HTTPException(
            status_code=403,
            detail=f"Access Denied: Account '{user_email}' is not authorized. Only whitelisted administrators (riddhesh.firake@gmail.com, acc94926@gmail.com) may access this trading vault."
        )
    return user
