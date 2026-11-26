import asyncio
import re
import urllib.parse
from datetime import datetime
from typing import Optional, List, Dict, Any
from config import settings

def sanitize_mongo_uri(uri: str) -> str:
    """
    Ensures username and password in MongoDB connection strings are properly
    percent-encoded according to RFC 3986 (resolving urllib.parse.quote_plus errors).
    Also strips accidental enclosing angle brackets such as <password>.
    """
    if not uri:
        return ""
    clean = uri.strip().strip("'\"")
    # Matches: mongodb(+srv)://<user>:<password>@<host><path_or_query>
    match = re.match(r"^(mongodb(?:\+srv)?://)([^:]+):(.*)@([^@/]+)(.*)$", clean)
    if not match:
        return clean

    scheme, raw_user, raw_pwd, host, query = match.groups()

    # Strip accidental placeholder brackets like <my_password>
    if raw_pwd.startswith("<") and raw_pwd.endswith(">"):
        raw_pwd = raw_pwd[1:-1]
    if raw_user.startswith("<") and raw_user.endswith(">"):
        raw_user = raw_user[1:-1]

    safe_user = urllib.parse.quote_plus(urllib.parse.unquote_plus(raw_user))
    safe_pwd = urllib.parse.quote_plus(urllib.parse.unquote_plus(raw_pwd))

    return f"{scheme}{safe_user}:{safe_pwd}@{host}{query}"

class MongoLogger:
    def __init__(self):
        self.client = None
        self.db = None
        self.logs_collection = None
        self.api_logs_collection = None
        self.is_connected: bool = False
        self._init_lock = asyncio.Lock()

    async def initialize(self) -> bool:
        """Initializes connection to MongoDB Atlas and enforces the 7-day TTL index."""
        raw_uri = (settings.MONGODB_URI or "").strip()
        if not raw_uri:
            self.is_connected = False
            return False

        uri = sanitize_mongo_uri(raw_uri)

        async with self._init_lock:
            if self.is_connected and self.logs_collection is not None:
                return True

            try:
                from motor.motor_asyncio import AsyncIOMotorClient

                # Connect with 5-second server selection timeout to avoid hanging on network issues
                self.client = AsyncIOMotorClient(
                    uri,
                    serverSelectionTimeoutMS=5000,
                    connectTimeoutMS=5000,
                    appname="AlphaSignal-Engine"
                )

                # Ping database to confirm authenticated connectivity
                await self.client.admin.command("ping")

                db_name = settings.MONGODB_DB_NAME or "alphasignal_logs"
                self.db = self.client[db_name]
                self.logs_collection = self.db["system_logs"]
                self.api_logs_collection = self.db["api_logs"]

                # 7-Day Auto-Purge TTL Index Configuration
                # 7 days * 24 hours * 3600 seconds = 604,800 seconds
                ttl_days = getattr(settings, "MONGODB_LOG_TTL_DAYS", 7) or 7
                ttl_seconds = int(ttl_days * 86400)
                ttl_index_name = "ttl_7_days_log_index"

                existing_indexes = await self.logs_collection.index_information()

                if ttl_index_name in existing_indexes:
                    curr_expire = existing_indexes[ttl_index_name].get("expireAfterSeconds")
                    if curr_expire != ttl_seconds:
                        await self.logs_collection.drop_index(ttl_index_name)
                        await self.logs_collection.create_index(
                            "created_at",
                            expireAfterSeconds=ttl_seconds,
                            name=ttl_index_name
                        )
                else:
                    await self.logs_collection.create_index(
                        "created_at",
                        expireAfterSeconds=ttl_seconds,
                        name=ttl_index_name
                    )

                # Query optimization indexes for system_logs
                await self.logs_collection.create_index(
                    [("created_at", -1)],
                    name="idx_created_at_desc"
                )
                await self.logs_collection.create_index(
                    [("level", 1), ("created_at", -1)],
                    name="idx_level_created"
                )

                # 7-Day Auto-Purge TTL Index for api_logs (API Hits, Payloads, Statuses)
                api_ttl_name = "ttl_7_days_api_log_index"
                existing_api_indexes = await self.api_logs_collection.index_information()

                if api_ttl_name in existing_api_indexes:
                    curr_api_expire = existing_api_indexes[api_ttl_name].get("expireAfterSeconds")
                    if curr_api_expire != ttl_seconds:
                        await self.api_logs_collection.drop_index(api_ttl_name)
                        await self.api_logs_collection.create_index(
                            "created_at",
                            expireAfterSeconds=ttl_seconds,
                            name=api_ttl_name
                        )
                else:
                    await self.api_logs_collection.create_index(
                        "created_at",
                        expireAfterSeconds=ttl_seconds,
                        name=api_ttl_name
                    )

                await self.api_logs_collection.create_index(
                    [("created_at", -1)],
                    name="idx_api_created_desc"
                )
                await self.api_logs_collection.create_index(
                    [("path", 1), ("status_code", 1)],
                    name="idx_api_path_status"
                )

                self.is_connected = True
                print(f"[MONGO] Connected to MongoDB Atlas ('{db_name}'). 7-Day TTL index ({ttl_days} days) active for system_logs and api_logs.")
                return True

            except Exception as e:
                self.is_connected = False
                self.client = None
                self.db = None
                self.logs_collection = None
                print(f"[MONGO WARNING] Failed to connect to MongoDB Atlas: {e}")
                return False

    async def close(self):
        """Closes active MongoDB client connections."""
        if self.client:
            try:
                self.client.close()
            except Exception:
                pass
            self.client = None
            self.db = None
            self.logs_collection = None
            self.api_logs_collection = None
            self.is_connected = False

    async def log_event(
        self,
        level: str,
        category: str,
        message: str,
        details: Optional[str] = None,
        user_id: Optional[str] = "default"
    ):
        """
        Asynchronously writes a log entry into MongoDB Atlas.
        Contains UTC BSON Date 'created_at' which MongoDB's background thread
        uses to automatically hard-delete after 7 days.
        """
        if not self.is_connected or self.logs_collection is None:
            return

        try:
            now_utc = datetime.utcnow()
            doc = {
                "level": (level or "INFO").upper(),
                "category": (category or "SYSTEM").upper(),
                "message": str(message or ""),
                "details": str(details) if details else None,
                "user_id": user_id or "default",
                "created_at": now_utc,  # Native BSON Date for TTL Index expiration
                "created_at_iso": now_utc.strftime("%Y-%m-%d %H:%M:%S")
            }
            await self.logs_collection.insert_one(doc)
        except Exception as ex:
            # Never raise or block the core execution pipeline on logging failure
            print(f"[MONGO LOG ERROR] {ex}")

    async def get_logs(self, limit: int = 100, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves most recent logs from MongoDB Atlas."""
        if not self.is_connected or self.logs_collection is None:
            return []

        try:
            query = {}
            if user_id and user_id != "default":
                query["$or"] = [{"user_id": user_id}, {"user_id": "default"}]

            cursor = self.logs_collection.find(query).sort("created_at", -1).limit(limit)
            logs = []
            async for doc in cursor:
                created = doc.get("created_at")
                created_str = (
                    created.strftime("%Y-%m-%dT%H:%M:%SZ")
                    if isinstance(created, datetime)
                    else str(doc.get("created_at_iso") or "")
                )
                logs.append({
                    "id": str(doc.get("_id")),
                    "level": doc.get("level", "INFO"),
                    "category": doc.get("category", "SYSTEM"),
                    "message": doc.get("message", ""),
                    "details": doc.get("details"),
                    "user_id": doc.get("user_id", "default"),
                    "created_at": created_str,
                    "source": "mongodb"
                })
            return logs
        except Exception as ex:
            print(f"[MONGO GET_LOGS ERROR] {ex}")
            return []

    async def log_api_hit(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        client_ip: Optional[str] = None,
        query_params: Optional[Dict[str, Any]] = None,
        request_body: Optional[Any] = None,
        response_body: Optional[Any] = None,
        headers: Optional[Dict[str, str]] = None,
        user_id: Optional[str] = "default",
        error: Optional[str] = None
    ):
        """
        Stores full HTTP API request/response audit logs into MongoDB Atlas.
        Automatically purged after 7 days via native MongoDB TTL index.
        Sensitive fields (passwords, tokens, keys) are automatically masked.
        """
        if not self.is_connected or self.api_logs_collection is None:
            return

        try:
            now_utc = datetime.utcnow()

            def mask_data(val: Any) -> Any:
                sensitive = {"password", "token", "secret", "key", "auth", "credential", "xm_mt5_password", "api_key", "jwt_secret", "encryption_key"}
                if isinstance(val, dict):
                    masked = {}
                    for k, v in val.items():
                        if any(s in str(k).lower() for s in sensitive):
                            masked[k] = "***MASKED***"
                        elif isinstance(v, (dict, list)):
                            masked[k] = mask_data(v)
                        else:
                            masked[k] = v
                    return masked
                elif isinstance(val, list):
                    return [mask_data(item) for item in val]
                return val

            clean_req = mask_data(request_body) if request_body is not None else None
            clean_res = mask_data(response_body) if response_body is not None else None

            # Keep payloads reasonable to avoid ballooning storage
            if isinstance(clean_req, str) and len(clean_req) > 2000:
                clean_req = clean_req[:2000] + "... [truncated]"
            if isinstance(clean_res, str) and len(clean_res) > 2000:
                clean_res = clean_res[:2000] + "... [truncated]"

            doc = {
                "method": (method or "GET").upper(),
                "path": path or "/",
                "status_code": int(status_code),
                "duration_ms": round(float(duration_ms), 2),
                "client_ip": client_ip,
                "query_params": query_params or {},
                "request_body": clean_req,
                "response_body": clean_res,
                "user_id": user_id or "default",
                "error": str(error) if error else None,
                "created_at": now_utc,  # BSON Date for 7-Day TTL auto-purge
                "created_at_iso": now_utc.strftime("%Y-%m-%d %H:%M:%S")
            }
            await self.api_logs_collection.insert_one(doc)
        except Exception as ex:
            print(f"[MONGO API_LOG ERROR] {ex}")

    async def get_api_logs(
        self,
        limit: int = 100,
        path: Optional[str] = None,
        status_code: Optional[int] = None,
        method: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Retrieves recent API hit logs with full payloads and statuses from MongoDB Atlas."""
        if not self.is_connected or self.api_logs_collection is None:
            return []

        try:
            query: Dict[str, Any] = {}
            if path:
                query["path"] = {"$regex": re.escape(path), "$options": "i"}
            if status_code:
                query["status_code"] = int(status_code)
            if method:
                query["method"] = method.upper()

            cursor = self.api_logs_collection.find(query).sort("created_at", -1).limit(limit)
            results = []
            async for doc in cursor:
                created = doc.get("created_at")
                created_str = (
                    created.strftime("%Y-%m-%dT%H:%M:%SZ")
                    if isinstance(created, datetime)
                    else str(doc.get("created_at_iso") or "")
                )
                results.append({
                    "id": str(doc.get("_id")),
                    "method": doc.get("method"),
                    "path": doc.get("path"),
                    "status_code": doc.get("status_code"),
                    "duration_ms": doc.get("duration_ms"),
                    "client_ip": doc.get("client_ip"),
                    "query_params": doc.get("query_params"),
                    "request_body": doc.get("request_body"),
                    "response_body": doc.get("response_body"),
                    "error": doc.get("error"),
                    "created_at": created_str,
                    "source": "mongodb"
                })
            return results
        except Exception as ex:
            print(f"[MONGO GET_API_LOGS ERROR] {ex}")
            return []

mongo_logger = MongoLogger()
