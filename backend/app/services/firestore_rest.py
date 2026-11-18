import urllib.request
import urllib.error
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

API_KEY = getattr(settings, "FIREBASE_WEB_API_KEY", "AIzaSyCdc8YjhNXXS0dSdYs1iKgJvL44G_6MAM8")
PROJECT_ID = getattr(settings, "FIREBASE_PROJECT_ID", "arshith-connect-attendance")

_admin_token_cache = {"token": None, "exp": 0}
_user_token_cache: Dict[str, Dict[str, Any]] = {}


def get_admin_token() -> Optional[str]:
    """Retrieve and cache Firebase Auth ID token for admin@arshith.com."""
    now = datetime.now(timezone.utc).timestamp()
    if _admin_token_cache["token"] and now < _admin_token_cache["exp"]:
        return _admin_token_cache["token"]

    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}"
    payload = json.dumps({
        "email": "admin@arshith.com",
        "password": "Admin@123",
        "returnSecureToken": True,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _admin_token_cache["token"] = data["idToken"]
            _admin_token_cache["exp"] = now + int(data.get("expiresIn", 3600)) - 120
            return _admin_token_cache["token"]
    except Exception as e:
        logger.warning(f"[FirestoreREST] Failed to obtain admin token: {e}")
        return None


def store_user_firebase_token(email: str, uid: str, id_token: str, expires_in: int = 3600):
    """Cache the user's personal Firebase token obtained during login."""
    now = datetime.now(timezone.utc).timestamp()
    clean_email = email.strip().lower()
    _user_token_cache[clean_email] = {
        "uid": uid,
        "token": id_token,
        "exp": now + expires_in - 120,
    }
    _user_token_cache[uid] = _user_token_cache[clean_email]


def get_user_firebase_token(identifier: str) -> Optional[str]:
    """Get active personal token for an employee by email or UID."""
    clean_id = identifier.strip().lower()
    entry = _user_token_cache.get(clean_id) or _user_token_cache.get(identifier)
    if entry:
        now = datetime.now(timezone.utc).timestamp()
        if now < entry["exp"]:
            return entry["token"]
    return None


def parse_firestore_fields(fields: Dict[str, Any]) -> Dict[str, Any]:
    """Convert Firestore REST API field typed map to standard Python dictionary."""
    res = {}
    for k, v in fields.items():
        if "stringValue" in v:
            res[k] = v["stringValue"]
        elif "integerValue" in v:
            res[k] = int(v["integerValue"])
        elif "doubleValue" in v:
            res[k] = float(v["doubleValue"])
        elif "booleanValue" in v:
            res[k] = v["booleanValue"]
        elif "timestampValue" in v:
            res[k] = v["timestampValue"]
        elif "nullValue" in v:
            res[k] = None
        elif "mapValue" in v:
            res[k] = parse_firestore_fields(v["mapValue"].get("fields", {}))
        elif "arrayValue" in v:
            items = []
            for item in v["arrayValue"].get("values", []):
                if "stringValue" in item:
                    items.append(item["stringValue"])
                elif "integerValue" in item:
                    items.append(int(item["integerValue"]))
                elif "booleanValue" in item:
                    items.append(item["booleanValue"])
                else:
                    items.append(item)
            res[k] = items
        else:
            res[k] = str(v)
    return res


def to_firestore_value(val: Any) -> Dict[str, Any]:
    """Convert Python value to Firestore REST typed value."""
    if val is None:
        return {"nullValue": None}
    if isinstance(val, bool):
        return {"booleanValue": val}
    if isinstance(val, int):
        return {"integerValue": str(val)}
    if isinstance(val, float):
        return {"doubleValue": val}
    if isinstance(val, list):
        return {"arrayValue": {"values": [to_firestore_value(x) for x in val]}}
    if isinstance(val, dict):
        return {"mapValue": {"fields": {k: to_firestore_value(v) for k, v in val.items() if not k.startswith("_")}}}
    if isinstance(val, datetime):
        iso = val.isoformat()
        if not iso.endswith("Z") and "+" not in iso:
            iso += "Z"
        return {"timestampValue": iso}
    s = str(val)
    if ("T" in s and s.endswith("Z")) or ("T" in s and "+" in s and len(s) >= 20):
        return {"timestampValue": s if s.endswith("Z") else s.replace("+00:00", "Z")}
    return {"stringValue": s}


def fetch_live_subdocument(collection: str, doc_id: str, subcollection: str, subdoc_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve subcollection document directly from live Firestore REST API."""
    token = get_user_firebase_token(doc_id) or get_admin_token()
    if not token:
        return None

    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection}/{doc_id}/{subcollection}/{subdoc_id}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            parsed = parse_firestore_fields(data.get("fields", {}))
            parsed["id"] = subdoc_id
            parsed["_doc_path"] = f"{collection}/{doc_id}/{subcollection}/{subdoc_id}"
            return parsed
    except urllib.error.HTTPError as e:
        if e.code != 404:
            logger.debug(f"[FirestoreREST] Subdoc fetch error ({e.code}) for {collection}/{doc_id}/{subcollection}/{subdoc_id}")
        return None
    except Exception as e:
        logger.debug(f"[FirestoreREST] Subdoc network error: {e}")
        return None


def patch_live_subdocument(
    collection: str,
    doc_id: str,
    subcollection: str,
    subdoc_id: str,
    updates: Dict[str, Any],
    user_token: Optional[str] = None
) -> bool:
    """Send PATCH request to update fields on a Firestore subcollection document."""
    token = user_token or get_user_firebase_token(doc_id) or get_admin_token()
    if not token:
        return False

    field_paths = list(updates.keys())
    if not field_paths:
        return True

    query_params = "&".join([f"updateMask.fieldPaths={k}" for k in field_paths])
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection}/{doc_id}/{subcollection}/{subdoc_id}?{query_params}"

    fields = {k: to_firestore_value(v) for k, v in updates.items()}
    body = json.dumps({"fields": fields}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="PATCH"
    )

    try:
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            logger.info(f"[FirestoreREST] Successfully patched {collection}/{doc_id}/{subcollection}/{subdoc_id}")
            return True
    except Exception as e:
        logger.warning(f"[FirestoreREST] Patch failed on {collection}/{doc_id}/{subcollection}/{subdoc_id}: {e}")
        return False


def create_or_set_live_subdocument(
    collection: str,
    doc_id: str,
    subcollection: str,
    subdoc_id: str,
    data: Dict[str, Any],
    user_token: Optional[str] = None
) -> bool:
    """Create or set a subcollection document in Cloud Firestore."""
    token = user_token or get_user_firebase_token(doc_id) or get_admin_token()
    if not token:
        return False

    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection}/{doc_id}/{subcollection}/{subdoc_id}"
    fields = {k: to_firestore_value(v) for k, v in data.items() if not k.startswith("_")}
    body = json.dumps({"fields": fields}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req, timeout=1.5) as resp:
            logger.info(f"[FirestoreREST] Successfully set subdoc {collection}/{doc_id}/{subcollection}/{subdoc_id}")
            return True
    except Exception as e:
        logger.warning(f"[FirestoreREST] Set subdoc failed: {e}")
        return False


def save_live_document(collection: str, doc_id: str, data: Dict[str, Any]) -> bool:
    """Save a top-level document directly to Cloud Firestore REST API."""
    token = get_admin_token()
    if not token:
        return False
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection}/{doc_id}"
    fields = {k: to_firestore_value(v) for k, v in data.items() if not k.startswith("_")}
    body = json.dumps({"fields": fields}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="PATCH"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            logger.info(f"[FirestoreREST] Successfully synced {collection}/{doc_id} to Cloud Firestore")
            return True
    except Exception as e:
        logger.warning(f"[FirestoreREST] Live sync failed on {collection}/{doc_id}: {e}")
        return False


def delete_live_document(collection: str, doc_id: str) -> bool:
    """Delete a top-level document directly from Cloud Firestore REST API."""
    token = get_admin_token()
    if not token:
        return False
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection}/{doc_id}"
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}"},
        method="DELETE"
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            logger.info(f"[FirestoreREST] Successfully deleted {collection}/{doc_id} from Cloud Firestore")
            return True
    except Exception as e:
        logger.warning(f"[FirestoreREST] Live delete failed on {collection}/{doc_id}: {e}")
        return False

