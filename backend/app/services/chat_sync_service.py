import concurrent.futures
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from app.core.firebase import get_firestore_client, get_storage_bucket, is_firebase_live
from app.services.firestore_rest import (
    get_admin_token,
    parse_firestore_fields,
    to_firestore_value,
)
from app.services.firestore_service import firestore_service

logger = logging.getLogger("uvicorn.error")

PROJECT_ID = "arshith-connect-attendance"
DEFAULT_ADMIN_UID = "ezvZfsphCqUpkgvu18ldvi7XW9D2"
ADMIN_ALIASES = {"admin", "adm-001", "administrator", "admin@arshith.com", "system_admin"}

_CACHE_TTL_SECONDS = 20.0
_STALE_REVALIDATE_SECONDS = 180.0
_MOBILE_CONV_TTL_SECONDS = 8.0
_COLLECTION_TTL_BY_NAME: Dict[str, float] = {
    "admins": 60.0,
    "employees": 60.0,
    "users": 60.0,
    "team_leaders": 60.0,
    "chat_users": 60.0,
    "chat_deleted_groups": 60.0,
}
_PRESENCE_TTL_SECONDS = 5.0
_FORBIDDEN_COOLDOWN_SECONDS = 60.0
_cache_lock = threading.Lock()
_collection_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_inflight_collections: Dict[str, threading.Event] = {}
_bg_refreshing_collections: Set[str] = set()
_directory_cache: Optional[Tuple[float, Dict[str, Any]]] = None
_presence_cache: Optional[Tuple[float, Dict[str, Dict[str, Any]]]] = None
_mobile_convs_cache: Dict[Tuple[str, bool], Tuple[float, List[Dict[str, Any]]]] = {}
_forbidden_until: Dict[str, float] = {}


def invalidate_chat_cache(*collections: str) -> None:
    """Clear cached collections and user directory after writes."""
    global _directory_cache, _presence_cache
    with _cache_lock:
        if not collections:
            _collection_cache.clear()
            _presence_cache = None
            _mobile_convs_cache.clear()
        else:
            for c in collections:
                _collection_cache.pop(c, None)
                if c == "chat_presence":
                    _presence_cache = None
                if c in ("teams", "chat_messages", "chat_deleted_groups", "chat_conversations", "conversations"):
                    _mobile_convs_cache.clear()
        _directory_cache = None


def _refresh_collection_worker(collection_name: str, existing_event: Optional[threading.Event] = None) -> List[Dict[str, Any]]:
    """Fetch a collection once, update cache, and wake any waiting threads."""
    try:
        docs = firestore_service.list_documents(collection_name) or []
        with _cache_lock:
            _collection_cache[collection_name] = (time.monotonic(), docs)
        return docs
    except Exception as e:
        logger.debug(f"[ChatSync] Collection refresh failed for '{collection_name}': {e}")
        with _cache_lock:
            cached = _collection_cache.get(collection_name)
            return cached[1] if cached else []
    finally:
        with _cache_lock:
            _bg_refreshing_collections.discard(collection_name)
            ev = _inflight_collections.pop(collection_name, None) if existing_event is None else existing_event
            if existing_event is not None:
                _inflight_collections.pop(collection_name, None)
            if ev is not None:
                ev.set()


def get_cached_collection(collection_name: str, force_refresh: bool = False) -> List[Dict[str, Any]]:
    """
    Read a collection from FirestoreService with:
    - Single-flight deduplication so concurrent callers share one Firestore query.
    - Stale-while-revalidate so cached reads return instantaneously and refresh in background.
    """
    ttl = _COLLECTION_TTL_BY_NAME.get(collection_name, _CACHE_TTL_SECONDS)
    now = time.monotonic()
    wait_event: Optional[threading.Event] = None
    own_event: Optional[threading.Event] = None

    with _cache_lock:
        entry = _collection_cache.get(collection_name)
        if not force_refresh and entry is not None:
            ts, data = entry
            age = now - ts
            if age < ttl:
                return data
            if age < _STALE_REVALIDATE_SECONDS:
                if collection_name not in _bg_refreshing_collections and collection_name not in _inflight_collections:
                    _bg_refreshing_collections.add(collection_name)
                    threading.Thread(
                        target=_refresh_collection_worker,
                        args=(collection_name, None),
                        daemon=True,
                    ).start()
                return data

        if collection_name in _inflight_collections:
            wait_event = _inflight_collections[collection_name]
        else:
            own_event = threading.Event()
            _inflight_collections[collection_name] = own_event

    if wait_event is not None:
        wait_event.wait(timeout=15.0)
        with _cache_lock:
            entry = _collection_cache.get(collection_name)
            if entry is not None:
                return entry[1]
        return []

    return _refresh_collection_worker(collection_name, existing_event=own_event)


def warm_chat_collections_parallel(collections: List[str]) -> None:
    """Concurrently pre-populate any collections not yet freshly cached."""
    now = time.monotonic()
    missing: List[str] = []
    with _cache_lock:
        for col in collections:
            entry = _collection_cache.get(col)
            ttl = _COLLECTION_TTL_BY_NAME.get(col, _CACHE_TTL_SECONDS)
            if entry is None or (now - entry[0]) >= _STALE_REVALIDATE_SECONDS:
                if col not in missing:
                    missing.append(col)
            elif (now - entry[0]) >= ttl and col not in _bg_refreshing_collections:
                _bg_refreshing_collections.add(col)
                threading.Thread(
                    target=_refresh_collection_worker,
                    args=(col, None),
                    daemon=True,
                ).start()
    if len(missing) <= 1:
        for col in missing:
            get_cached_collection(col)
        return
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(missing))) as pool:
        futures = [pool.submit(get_cached_collection, col) for col in missing]
        for fut in futures:
            try:
                fut.result(timeout=15.0)
            except Exception:
                pass


def _utc_now() -> Tuple[datetime, str]:
    now_dt = datetime.now(timezone.utc)
    return now_dt, now_dt.isoformat().replace("+00:00", "Z")


def _normalize_timestamp_str(val: Any, default_now: bool = False) -> str:
    if val is None or val == "":
        return datetime.now(timezone.utc).isoformat() if default_now else ""
    if isinstance(val, datetime):
        dt = val if val.tzinfo else val.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat()
    if hasattr(val, "isoformat"):
        try:
            return val.isoformat()
        except Exception:
            pass
    if isinstance(val, dict) and "timestampValue" in val:
        return str(val["timestampValue"])
    return str(val)


def _is_looks_like_uid(value: str) -> bool:
    v = (value or "").strip()
    return len(v) >= 20 and " " not in v and "@" not in v and not v.startswith(("AFI-", "ADM-", "EMP-", "TEA-", "TL-"))


# ==============================================================================
# 1. Cached Identity & Auth UID Directory
# ==============================================================================

def get_all_known_chat_users() -> List[Dict[str, Any]]:
    """Return all chat users registered in Firestore, with local JSON fallback."""
    users = get_cached_collection("chat_users")
    if not users:
        try:
            with open("backend/firestore_local_db.json", "r", encoding="utf-8") as f:
                users = json.load(f).get("chat_users", [])
        except Exception:
            pass
    return users


def _build_user_directory() -> Dict[str, Any]:
    """Build an in-memory lookup index mapping any identifier to {uid, employee_id, name, email, photo_url}."""
    global _directory_cache
    now = time.monotonic()
    with _cache_lock:
        if _directory_cache and (now - _directory_cache[0]) < _CACHE_TTL_SECONDS:
            return _directory_cache[1]

    warm_chat_collections_parallel(["admins", "chat_users", "employees", "users", "team_leaders"])
    admins = get_cached_collection("admins")
    chat_users = get_all_known_chat_users()
    employees = get_cached_collection("employees")
    users = get_cached_collection("users")
    team_leaders = get_cached_collection("team_leaders")

    admin_uid = DEFAULT_ADMIN_UID
    for adm in admins:
        uid = str(adm.get("uid") or adm.get("id") or "").strip()
        if uid:
            admin_uid = uid
            break

    by_key: Dict[str, Dict[str, Any]] = {}
    generic_names = {"", "staff member", "team member", "user", "team leader"}

    def _register(info: Dict[str, Any], keys: List[Any], overwrite: bool = False):
        for k in keys:
            if not k:
                continue
            kl = str(k).strip().lower()
            if kl and (overwrite or kl not in by_key):
                by_key[kl] = info

    def _merge_person(
        keys: List[Any],
        uid_cand: str = "",
        eid_cand: str = "",
        name_cand: str = "",
        email_cand: str = "",
        photo_cand: str = "",
        role_cand: str = "employee",
    ):
        clean_keys = [str(k).strip() for k in keys if k and str(k).strip()]
        existing_entry = None
        for k in clean_keys:
            hit = by_key.get(k.lower())
            if hit is not None:
                if hit.get("uid") == admin_uid or str(hit.get("employee_id", "")).upper() == "ADM-001":
                    return
                existing_entry = hit
                break

        uid_val = uid_cand.strip()
        eid_val = eid_cand.strip()
        email_val = email_cand.strip().lower()
        name_val = name_cand.strip()
        photo_val = photo_cand.strip()
        role_val = (role_cand or "employee").strip().lower()

        if existing_entry is None:
            info = {
                "uid": uid_val,
                "employee_id": eid_val or uid_val,
                "name": name_val or "Staff Member",
                "email": email_val,
                "photo_url": photo_val,
                "role": role_val,
            }
            _register(info, clean_keys + [info["uid"], info["employee_id"], info["email"], info["name"]], overwrite=True)
            return

        if _is_looks_like_uid(uid_val) and not _is_looks_like_uid(existing_entry.get("uid", "")):
            existing_entry["uid"] = uid_val
        elif uid_val and not existing_entry.get("uid"):
            existing_entry["uid"] = uid_val

        cur_eid = str(existing_entry.get("employee_id") or "")
        if eid_val and not _is_looks_like_uid(eid_val) and (not cur_eid or _is_looks_like_uid(cur_eid)):
            existing_entry["employee_id"] = eid_val
        elif eid_val and not cur_eid:
            existing_entry["employee_id"] = eid_val

        if email_val and not existing_entry.get("email"):
            existing_entry["email"] = email_val
        if name_val and name_val.lower() not in generic_names and str(existing_entry.get("name", "")).lower() in generic_names:
            existing_entry["name"] = name_val
        if photo_val and not existing_entry.get("photo_url"):
            existing_entry["photo_url"] = photo_val
        if role_val == "team_leader" and existing_entry.get("role") == "employee":
            existing_entry["role"] = "team_leader"

        _register(
            existing_entry,
            clean_keys + [existing_entry["uid"], existing_entry["employee_id"], existing_entry["email"], existing_entry["name"]],
            overwrite=False,
        )

    admin_info = {
        "uid": admin_uid,
        "employee_id": "ADM-001",
        "name": "Administrator",
        "email": "admin@arshith.com",
        "photo_url": "",
        "role": "admin",
    }
    _register(admin_info, list(ADMIN_ALIASES) + [admin_uid, DEFAULT_ADMIN_UID], overwrite=True)

    # Index employees first, then enrich missing fields across chat_users, users, team_leaders
    cu_by_email: Dict[str, Dict[str, Any]] = {}
    cu_by_uid: Dict[str, Dict[str, Any]] = {}
    for cu in chat_users:
        c_uid = str(cu.get("uid") or cu.get("id") or "").strip()
        c_email = str(cu.get("email") or "").strip().lower()
        if c_uid:
            cu_by_uid[c_uid.lower()] = cu
        if c_email:
            cu_by_email[c_email] = cu

    for emp in employees:
        e_doc_id = str(emp.get("id") or "").strip()
        e_code = str(emp.get("employee_id") or emp.get("employeeId") or "").strip()
        e_uid_raw = str(emp.get("uid") or emp.get("authUid") or emp.get("user_id") or "").strip()
        e_email = str(emp.get("email") or "").strip().lower()
        e_name = str(emp.get("full_name") or emp.get("name") or "").strip()
        cu = cu_by_uid.get(e_uid_raw.lower()) or cu_by_uid.get(e_doc_id.lower()) or cu_by_email.get(e_email)

        resolved_uid = (
            e_uid_raw if _is_looks_like_uid(e_uid_raw)
            else (e_doc_id if _is_looks_like_uid(e_doc_id)
                  else (str(cu.get("uid") or cu.get("id")).strip() if cu else (e_uid_raw or e_doc_id or e_code)))
        )
        photo = str(
            emp.get("profile_photo")
            or emp.get("profilePhoto")
            or emp.get("photoUrl")
            or emp.get("photo_url")
            or (cu.get("photoUrl") if cu else "")
            or ""
        )
        _merge_person(
            keys=[resolved_uid, e_doc_id, e_code, e_uid_raw, e_email, e_name],
            uid_cand=resolved_uid,
            eid_cand=e_code or (e_doc_id if not _is_looks_like_uid(e_doc_id) else "") or resolved_uid,
            name_cand=e_name or (cu.get("name") if cu else "") or "Staff Member",
            email_cand=e_email or (str(cu.get("email") or "") if cu else ""),
            photo_cand=photo,
            role_cand="employee",
        )

    for tl in team_leaders:
        tl_id = str(tl.get("id") or tl.get("leader_code") or "").strip()
        tl_uid = str(tl.get("uid") or tl.get("authUid") or "").strip()
        tl_email = str(tl.get("email") or "").strip().lower()
        tl_name = str(tl.get("full_name") or tl.get("name") or "").strip()
        _merge_person(
            keys=[tl_uid, tl_id, tl_email, tl_name],
            uid_cand=tl_uid or tl_id,
            eid_cand=str(tl.get("employee_id") or tl_id),
            name_cand=tl_name or "Team Leader",
            email_cand=tl_email,
            photo_cand=str(tl.get("profile_photo") or ""),
            role_cand="team_leader",
        )

    for u in users:
        u_uid = str(u.get("uid") or u.get("id") or "").strip()
        u_email = str(u.get("email") or "").strip().lower()
        u_name = str(u.get("full_name") or u.get("name") or "").strip()
        u_eid = str(u.get("employee_id") or u.get("employeeId") or "").strip()
        _merge_person(
            keys=[u_uid, u_email, u_name, u_eid],
            uid_cand=u_uid,
            eid_cand=u_eid or u_uid,
            name_cand=u_name or "User",
            email_cand=u_email,
            photo_cand=str(u.get("profile_photo") or ""),
            role_cand=str(u.get("role") or "employee").lower(),
        )

    for cu in chat_users:
        c_uid = str(cu.get("uid") or cu.get("id") or "").strip()
        c_email = str(cu.get("email") or "").strip().lower()
        c_name = str(cu.get("name") or "").strip()
        c_eid = str(cu.get("employeeId") or cu.get("employee_id") or "").strip()
        _merge_person(
            keys=[c_uid, c_email, c_name, c_eid],
            uid_cand=c_uid,
            eid_cand=c_eid or c_uid,
            name_cand=c_name or "Team Member",
            email_cand=c_email,
            photo_cand=str(cu.get("photoUrl") or cu.get("photo_url") or ""),
            role_cand="employee",
        )

    directory = {"admin_uid": admin_uid, "by_key": by_key}
    with _cache_lock:
        _directory_cache = (time.monotonic(), directory)
    return directory


def resolve_auth_uid(identifier: Any) -> Optional[str]:
    """Resolve any employee ID, email, name, or UID to their Firebase Auth UID."""
    if not identifier:
        return None
    raw = str(identifier).strip()
    if not raw:
        return None
    directory = _build_user_directory()
    entry = directory["by_key"].get(raw.lower())
    if entry and entry.get("uid"):
        return entry["uid"]
    return raw


def get_user_display_info(uid_or_email: Any) -> Dict[str, Any]:
    """Retrieve full name, employee_id, uid, and photo_url for any identifier in O(1)."""
    raw = str(uid_or_email or "").strip()
    directory = _build_user_directory()
    entry = directory["by_key"].get(raw.lower())
    if entry:
        return dict(entry)
    return {
        "uid": raw,
        "employee_id": raw,
        "name": raw.split("@")[0].title() if "@" in raw else (raw or "User"),
        "email": raw if "@" in raw else "",
        "photo_url": "",
        "role": "employee",
    }


def _resolve_member_details(
    member_identifiers: Optional[List[Any]],
    sender_auth_uid: Optional[str] = None,
    include_sender_in_members: bool = True,
) -> Tuple[List[str], Dict[str, str], Dict[str, str]]:
    """Return unique Auth UIDs, {uid: name} map, and {uid: business_id} map."""
    member_uids: List[str] = []
    member_names: Dict[str, str] = {}
    member_business_ids: Dict[str, str] = {}

    candidates = list(member_identifiers or [])
    if sender_auth_uid and include_sender_in_members:
        candidates.append(sender_auth_uid)

    for item in candidates:
        uid = resolve_auth_uid(item)
        if not uid or not _is_looks_like_uid(uid):
            continue
        if uid not in member_uids:
            member_uids.append(uid)
        info = get_user_display_info(uid)
        member_names[uid] = info["name"]
        member_business_ids[uid] = info["employee_id"]

    return member_uids, member_names, member_business_ids


# ==============================================================================
# 2. Live Cloud Firestore Transport (Admin SDK with REST API Fallback)
# ==============================================================================

def _sdk_client():
    if is_firebase_live():
        return get_firestore_client()
    return None


def _rest_headers() -> Optional[Dict[str, str]]:
    token = get_admin_token()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _is_forbidden_cached(key: str) -> bool:
    until = _forbidden_until.get(key, 0.0)
    return time.monotonic() < until


def _mark_forbidden(key: str) -> None:
    _forbidden_until[key] = time.monotonic() + _FORBIDDEN_COOLDOWN_SECONDS


def rest_get_document(doc_path: str) -> Optional[Dict[str, Any]]:
    """Fetch a single Firestore document by relative path using SDK or REST."""
    fs = _sdk_client()
    if fs is not None:
        try:
            snap = fs.document(doc_path).get()
            if snap.exists:
                d = snap.to_dict() or {}
                d["id"] = snap.id
                return d
            return None
        except Exception as e:
            logger.debug(f"[ChatSync] SDK get failed for {doc_path}: {e}")

    root_col = doc_path.split("/")[0]
    if _is_forbidden_cached(root_col):
        return None

    headers = _rest_headers()
    if not headers:
        return None
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{doc_path}"
    req = urllib.request.Request(url, headers={"Authorization": headers["Authorization"]})
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            parsed = parse_firestore_fields(data.get("fields", {}))
            parsed["id"] = data["name"].split("/")[-1]
            return parsed
    except urllib.error.HTTPError as e:
        if e.code == 403:
            _mark_forbidden(root_col)
        elif e.code != 404:
            logger.debug(f"[ChatSync] REST get error ({e.code}) on {doc_path}")
        return None
    except Exception as e:
        logger.debug(f"[ChatSync] REST get failed on {doc_path}: {e}")
        return None


def rest_patch_document(doc_path: str, data: Dict[str, Any], merge_fields: Optional[List[str]] = None) -> bool:
    """Create or merge-update a Firestore document via SDK or REST API."""
    fs = _sdk_client()
    if fs is not None:
        try:
            doc_ref = fs.document(doc_path)
            if merge_fields:
                try:
                    update_data = {k: data[k] for k in merge_fields if k in data}
                    if update_data:
                        doc_ref.update(update_data)
                        return True
                except Exception:
                    pass
            doc_ref.set(data, merge=True)
            return True
        except Exception as e:
            logger.debug(f"[ChatSync] SDK upsert failed on {doc_path}: {e}")

    root_col = doc_path.split("/")[0]
    if _is_forbidden_cached(f"write:{root_col}"):
        return False

    headers = _rest_headers()
    if not headers:
        return False

    base_url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{doc_path}"
    if merge_fields:
        qs = "&".join(f"updateMask.fieldPaths={urllib.parse.quote(fp, safe='')}" for fp in merge_fields)
        url = f"{base_url}?{qs}"
    else:
        url = base_url

    fields = {k: to_firestore_value(v) for k, v in data.items() if not k.startswith("_")}
    body = json.dumps({"fields": fields}).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="PATCH")
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            return resp.status in (200, 201)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            _mark_forbidden(f"write:{root_col}")
        logger.warning(f"[ChatSync] REST patch failed ({e.code}) on '{doc_path}'")
        return False
    except Exception as e:
        logger.warning(f"[ChatSync] REST patch failed on '{doc_path}': {e}")
        return False


def rest_delete_document(doc_path: str) -> bool:
    """Delete a Firestore document via SDK or REST API."""
    fs = _sdk_client()
    if fs is not None:
        try:
            fs.document(doc_path).delete()
            return True
        except Exception as e:
            logger.debug(f"[ChatSync] SDK delete failed on {doc_path}: {e}")

    root_col = doc_path.split("/")[0]
    if _is_forbidden_cached(f"write:{root_col}"):
        return False

    headers = _rest_headers()
    if not headers:
        return False

    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{doc_path}"
    req = urllib.request.Request(url, headers={"Authorization": headers["Authorization"]}, method="DELETE")
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            return resp.status in (200, 204)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return True
        if e.code == 403:
            _mark_forbidden(f"write:{root_col}")
        logger.debug(f"[ChatSync] REST delete failed ({e.code}) on '{doc_path}'")
        return False
    except Exception as e:
        logger.debug(f"[ChatSync] REST delete failed on '{doc_path}': {e}")
        return False


def rest_fetch_subcollection(collection_path: str, page_size: int = 100) -> List[Dict[str, Any]]:
    """Fetch documents from a Firestore subcollection via SDK or REST API."""
    fs = _sdk_client()
    if fs is not None:
        try:
            docs = []
            for snap in fs.collection(collection_path).limit(page_size).stream():
                d = snap.to_dict() or {}
                d["id"] = snap.id
                docs.append(d)
            return docs
        except Exception as e:
            logger.debug(f"[ChatSync] SDK subcollection fetch failed for {collection_path}: {e}")

    root_col = collection_path.split("/")[0]
    if _is_forbidden_cached(root_col):
        return []

    headers = _rest_headers()
    if not headers:
        return []

    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection_path}?pageSize={page_size}"
    req = urllib.request.Request(url, headers={"Authorization": headers["Authorization"]})
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            docs = []
            for d in data.get("documents", []):
                fields = parse_firestore_fields(d.get("fields", {}))
                fields["id"] = d["name"].split("/")[-1]
                docs.append(fields)
            return docs
    except urllib.error.HTTPError as e:
        if e.code == 403:
            _mark_forbidden(root_col)
        return []
    except Exception as e:
        logger.debug(f"[ChatSync] REST fetch failed on '{collection_path}': {e}")
        return []


def _query_collection(collection_name: str, member_uid: Optional[str] = None, page_size: int = 100) -> List[Dict[str, Any]]:
    """List documents from a root collection, optionally filtered by memberIds array_contains."""
    fs = _sdk_client()
    if fs is not None:
        try:
            ref = fs.collection(collection_name)
            query = ref.where("memberIds", "array_contains", member_uid) if member_uid else ref.limit(page_size)
            docs = []
            for snap in query.stream():
                d = snap.to_dict() or {}
                d["id"] = snap.id
                docs.append(d)
            return docs
        except Exception as e:
            logger.debug(f"[ChatSync] SDK query failed for {collection_name}: {e}")

    if _is_forbidden_cached(collection_name):
        return []

    headers = _rest_headers()
    if not headers:
        return []

    if member_uid:
        url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents:runQuery"
        q_body = json.dumps({
            "structuredQuery": {
                "from": [{"collectionId": collection_name}],
                "where": {
                    "fieldFilter": {
                        "field": {"fieldPath": "memberIds"},
                        "op": "ARRAY_CONTAINS",
                        "value": {"stringValue": member_uid},
                    }
                },
                "limit": page_size,
            }
        }).encode("utf-8")
        req = urllib.request.Request(url, data=q_body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                rows = json.loads(resp.read().decode("utf-8"))
                docs = []
                for row in rows:
                    doc = row.get("document")
                    if doc:
                        fields = parse_firestore_fields(doc.get("fields", {}))
                        fields["id"] = doc["name"].split("/")[-1]
                        docs.append(fields)
                return docs
        except urllib.error.HTTPError as e:
            if e.code == 403:
                _mark_forbidden(collection_name)
            return []
        except Exception as e:
            logger.debug(f"[ChatSync] REST runQuery failed on '{collection_name}': {e}")
            return []

    return rest_fetch_subcollection(collection_name, page_size=page_size)


# ==============================================================================
# 3. Conversation ID & Attachment Helpers
# ==============================================================================

def _infer_message_type(attachments: Optional[List[Dict[str, Any]]]) -> Tuple[str, str]:
    if not attachments:
        return "text", ""
    first = attachments[0]
    url = str(first.get("url") or first.get("file_url") or "").strip()
    clean_url = urllib.parse.unquote(url.split("?")[0]).lower()
    fname = str(first.get("filename") or "").strip().lower()
    ctype = str(first.get("content_type") or "").strip().lower()
    if (
        first.get("is_image")
        or ctype.startswith("image/")
        or clean_url.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))
        or fname.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))
    ):
        return "image", url
    if (
        first.get("is_audio")
        or ctype.startswith("audio/")
        or clean_url.endswith((".webm", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus"))
        or fname.endswith((".webm", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus"))
    ):
        return "audio", url
    return "document", url


def upload_chat_attachment_to_storage(
    file_bytes: bytes,
    filename: str,
    content_type: str,
    sender_identifier: Any = None,
) -> Optional[str]:
    """
    Upload chat image, document, or voice note bytes to Firebase Cloud Storage under
    `chatAttachments/web/{sender_uid}/{uuid}_{safe_name}` and return a persistent download URL.
    """
    if not is_firebase_live():
        return None
    bucket = get_storage_bucket()
    if not bucket:
        return None

    sender_uid = resolve_auth_uid(sender_identifier) or "web"
    safe_base = "".join(c if c.isalnum() or c in "._-" else "_" for c in (filename or "attachment"))[:120]
    storage_name = f"{uuid.uuid4().hex[:12]}_{safe_base}"
    storage_path = f"chatAttachments/web/{sender_uid}/{storage_name}"

    try:
        dl_token = str(uuid.uuid4())
        blob = bucket.blob(storage_path)
        blob.metadata = {"firebaseStorageDownloadTokens": dl_token}
        blob.upload_from_string(file_bytes, content_type=content_type or "application/octet-stream")
        encoded_path = urllib.parse.quote(storage_path, safe="")
        return f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{encoded_path}?alt=media&token={dl_token}"
    except Exception as e:
        logger.warning(f"[ChatSync] Firebase Storage chat attachment upload failed: {e}")
        return None


def _build_unread_and_read_maps(
    existing_doc: Optional[Dict[str, Any]],
    member_uids: List[str],
    sender_uid: str,
    now_ts: Any,
) -> Tuple[Dict[str, int], Dict[str, Any]]:
    existing_unread = dict((existing_doc or {}).get("unreadCounts") or {})
    existing_read = dict((existing_doc or {}).get("lastReadAt") or {})

    unread_counts: Dict[str, int] = {}
    last_read_at: Dict[str, Any] = {}
    for uid in member_uids:
        if uid == sender_uid:
            unread_counts[uid] = 0
            last_read_at[uid] = now_ts
        else:
            prev = existing_unread.get(uid, 0)
            unread_counts[uid] = (int(prev) if isinstance(prev, (int, float)) else 0) + 1
            last_read_at[uid] = existing_read.get(uid) or now_ts
    return unread_counts, last_read_at


def _candidate_conversation_ids(
    conversation_id: str,
    chat_type: str,
    target_id: Optional[str],
    member_uids: List[str],
) -> List[str]:
    """Return mobile Firestore conversation IDs matching this conversation without creating duplicates."""
    candidates: List[str] = []
    if chat_type == "team":
        if conversation_id:
            candidates.append(conversation_id)
            if conversation_id.startswith("team_"):
                stripped = conversation_id[5:]
                if stripped and (rest_get_document(f"chat_conversations/{stripped}") or rest_get_document(f"conversations/{stripped}")):
                    candidates.append(stripped)
        if target_id and target_id not in candidates and (
            rest_get_document(f"chat_conversations/{target_id}") or rest_get_document(f"conversations/{target_id}")
        ):
            candidates.append(target_id)
        return candidates or ([conversation_id] if conversation_id else [])

    if len(member_uids) >= 2:
        pair = sorted(member_uids[:2])
        canonical_direct = f"direct_{pair[0]}_{pair[1]}"
        candidates.append(canonical_direct)
        legacy_pair = f"{pair[0]}_{pair[1]}"
        if rest_get_document(f"chat_conversations/{legacy_pair}"):
            candidates.append(legacy_pair)
    elif conversation_id:
        candidates.append(conversation_id)
    return candidates


# ==============================================================================
# 4. Two-Way Message & Team Sync (Website -> Mobile App)
# ==============================================================================

def sync_team_to_mobile_app(
    team_id: str,
    team_data: Dict[str, Any],
    include_creator_in_members: bool = True,
    unhide_inbox: bool = True,
) -> bool:
    """
    Sync a team/group between Website (`teams` members) and Android APK (`memberIds`,
    `memberNames`, `chat_conversations`, `conversations`, `chat_user_inbox`).
    Never auto-adds Administrator unless Administrator created the group or was explicitly included.
    """
    now_dt, now_iso = _utc_now()
    ts_val = now_dt if _sdk_client() is not None else now_iso

    raw_members = (
        list(team_data.get("memberIds") or [])
        + list(team_data.get("members") or [])
        + list(team_data.get("memberNames") or [])
    )
    creator_ref = team_data.get("createdBy") or team_data.get("created_by") or team_data.get("leader")
    resolved_creator = resolve_auth_uid(creator_ref) if creator_ref else None
    creator_uid = resolved_creator if (resolved_creator and _is_looks_like_uid(resolved_creator)) else None

    member_uids, member_names, member_business_ids = _resolve_member_details(
        raw_members,
        creator_uid,
        include_sender_in_members=include_creator_in_members,
    )

    resolved_member_names: List[str] = []
    for uid in member_uids:
        n = member_names.get(uid) or uid
        if n not in resolved_member_names:
            resolved_member_names.append(n)

    team_name = str(
        team_data.get("name")
        or team_data.get("teamName")
        or team_data.get("team_name")
        or team_data.get("groupName")
        or "Team"
    ).strip()
    conv_id = str(team_data.get("conversation_id") or "").strip() or f"team_{team_id}"
    if _expand_group_keys(team_id, conv_id).intersection(_get_deleted_group_keys()):
        return False
    if team_data.get("sync_to_chat") is False or str(team_data.get("team_scope") or "").strip().lower() == "project_hr":
        return False
    is_active = bool(team_data.get("active", True))
    group_admins = list(dict.fromkeys(
        [u for u in ([creator_uid] if creator_uid else []) + list(team_data.get("groupAdmins") or []) + list(team_data.get("adminIds") or []) if u and u in member_uids]
    )) or (member_uids[:1] if member_uids else [])
    effective_creator = creator_uid or (member_uids[0] if member_uids else "")

    team_updates = {
        "team_id": str(team_id),
        "conversation_id": conv_id,
        "name": team_name,
        "teamName": team_name,
        "team_name": team_name,
        "createdBy": effective_creator,
        "groupAdmins": group_admins,
        "members": resolved_member_names,
        "memberNames": resolved_member_names,
        "memberIds": member_uids,
        "memberBusinessIds": [member_business_ids[u] for u in member_uids],
        "active": is_active,
        "updated_at": now_iso,
    }
    rest_patch_document(f"teams/{team_id}", team_updates, merge_fields=list(team_updates.keys()))
    invalidate_chat_cache("teams")

    if len(member_uids) >= 1 and is_active:
        existing_chat = rest_get_document(f"chat_conversations/{conv_id}")
        unread_init = {u: int((existing_chat or {}).get("unreadCounts", {}).get(u, 0) or 0) for u in member_uids}
        read_init = {u: (existing_chat or {}).get("lastReadAt", {}).get(u) or ts_val for u in member_uids}
        if not existing_chat:
            chat_conv_doc = {
                "id": conv_id,
                "conversationId": conv_id,
                "teamId": str(team_id),
                "teamName": team_name,
                "type": "group",
                "groupName": team_name,
                "groupImage": "",
                "groupPhotoUrl": "",
                "name": team_name,
                "title": team_name,
                "description": str(team_data.get("description") or "").strip(),
                "createdBy": effective_creator,
                "groupAdmins": group_admins,
                "adminIds": group_admins,
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "lastMessage": "",
                "lastMessageType": "text",
                "lastSenderId": "",
                "unreadCounts": unread_init,
                "lastReadAt": read_init,
                "createdAt": ts_val,
                "lastMessageAt": ts_val,
                "lastMessageTime": ts_val,
                "updatedAt": ts_val,
            }
            rest_patch_document(f"chat_conversations/{conv_id}", chat_conv_doc)
        else:
            patch_chat = {
                "teamId": str(team_id),
                "teamName": team_name,
                "groupName": team_name,
                "name": team_name,
                "title": team_name,
                "groupAdmins": [u for u in (existing_chat.get("groupAdmins") or []) if u in member_uids] or group_admins,
                "adminIds": [u for u in (existing_chat.get("adminIds") or []) if u in member_uids] or group_admins,
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "unreadCounts": unread_init,
                "lastReadAt": read_init,
                "updatedAt": ts_val,
            }
            if not existing_chat.get("lastMessageAt"):
                patch_chat["lastMessageAt"] = ts_val
                patch_chat["lastMessageTime"] = ts_val
            elif not existing_chat.get("lastMessageTime"):
                patch_chat["lastMessageTime"] = existing_chat.get("lastMessageAt")
            if not existing_chat.get("createdAt"):
                patch_chat["createdAt"] = ts_val
            if existing_chat.get("lastMessage") is None:
                patch_chat["lastMessage"] = ""
            if not existing_chat.get("lastMessageType"):
                patch_chat["lastMessageType"] = "text"
            if existing_chat.get("lastSenderId") is None:
                patch_chat["lastSenderId"] = ""
            if existing_chat.get("groupImage") is None:
                patch_chat["groupImage"] = str(existing_chat.get("groupPhotoUrl") or "")
            if not existing_chat.get("groupPhotoUrl"):
                patch_chat["groupPhotoUrl"] = str(existing_chat.get("groupImage") or "")
            rest_patch_document(f"chat_conversations/{conv_id}", patch_chat, merge_fields=list(patch_chat.keys()))

        existing_legacy = rest_get_document(f"conversations/{conv_id}")
        legacy_unread = {u: int((existing_legacy or {}).get("unreadCounts", {}).get(u, 0) or 0) for u in member_uids}
        if not existing_legacy:
            legacy_conv_doc = {
                "id": conv_id,
                "type": "group",
                "name": team_name,
                "groupName": team_name,
                "teamId": str(team_id),
                "teamName": team_name,
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "createdBy": effective_creator,
                "createdAt": ts_val,
                "lastMessage": "",
                "lastMessageTime": ts_val,
                "lastSenderId": "",
                "unreadCounts": legacy_unread,
            }
            rest_patch_document(f"conversations/{conv_id}", legacy_conv_doc)
        else:
            patch_legacy = {
                "id": conv_id,
                "name": team_name,
                "groupName": team_name,
                "teamId": str(team_id),
                "teamName": team_name,
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "unreadCounts": legacy_unread,
            }
            if not existing_legacy.get("lastMessageTime"):
                patch_legacy["lastMessageTime"] = ts_val
            rest_patch_document(f"conversations/{conv_id}", patch_legacy, merge_fields=list(patch_legacy.keys()))

        if unhide_inbox:
            for m_uid in member_uids:
                inbox_patch = {"deletedForMe": False, "updatedAt": ts_val}
                rest_patch_document(
                    f"chat_user_inbox/{m_uid}/items/{conv_id}",
                    inbox_patch,
                    merge_fields=list(inbox_patch.keys()),
                )

    return True


_last_bidirectional_sync_ts: float = 0.0
_recently_deleted_group_keys: Set[str] = set()


def _expand_group_keys(*ids: Optional[str]) -> Set[str]:
    """Expand group/team IDs into normalized lookup forms (`id`, `team_id`, stripped)."""
    keys: Set[str] = set()
    for raw in ids:
        s = str(raw or "").strip()
        if not s:
            continue
        low = s.lower()
        keys.add(low)
        if low.startswith("team_") and len(low) > 5:
            keys.add(low[5:])
        elif not low.startswith("direct_") and not low.startswith("dm_"):
            keys.add(f"team_{low}")
    return keys


def get_deleted_group_keys() -> Set[str]:
    """Return normalized IDs of permanently deleted groups so bidirectional sync never resurrects them."""
    keys = set(_recently_deleted_group_keys)
    try:
        tombstones = get_cached_collection("chat_deleted_groups")
        for t in tombstones:
            keys.update(_expand_group_keys(t.get("id"), t.get("conversation_id"), t.get("team_id")))
    except Exception:
        pass
    return keys


def _get_deleted_group_keys() -> Set[str]:
    return get_deleted_group_keys()


def is_group_deleted(*ids: Optional[str]) -> bool:
    """Return True if any provided team/conversation identifier has a delete tombstone."""
    expanded = _expand_group_keys(*ids)
    if not expanded:
        return False
    return bool(expanded.intersection(_get_deleted_group_keys()))


def _delete_subcollection_docs(parent_doc_path: str, subcollection: str = "messages") -> int:
    """Delete all documents inside a Firestore subcollection using SDK batching or REST."""
    deleted = 0
    sub_path = f"{parent_doc_path}/{subcollection}"
    fs = _sdk_client()
    if fs is not None:
        try:
            for _ in range(25):
                snaps = list(fs.collection(sub_path).limit(200).stream())
                if not snaps:
                    break
                batch = fs.batch()
                for s in snaps:
                    batch.delete(s.reference)
                    deleted += 1
                batch.commit()
            return deleted
        except Exception as e:
            logger.debug(f"[ChatSync] SDK batch subcollection delete fallback for {sub_path}: {e}")

    for _ in range(25):
        docs = rest_fetch_subcollection(sub_path, page_size=200)
        if not docs:
            break
        progressed = False
        for d in docs:
            did = str(d.get("id") or "").strip()
            if did and rest_delete_document(f"{sub_path}/{did}"):
                deleted += 1
                progressed = True
        if not progressed:
            break
    return deleted


def _delete_storage_prefix(prefix: str) -> int:
    """Delete all Firebase Storage objects under a folder prefix."""
    if not is_firebase_live():
        return 0
    bucket = get_storage_bucket()
    if not bucket or not prefix:
        return 0
    removed = 0
    try:
        for blob in bucket.list_blobs(prefix=prefix):
            blob.delete()
            removed += 1
    except Exception as e:
        logger.debug(f"[ChatSync] Storage prefix cleanup partial on '{prefix}': {e}")
    return removed


def delete_team_and_sync_mobile(
    team_id: str,
    conv_id: str,
    deleted_by: str = "",
) -> Dict[str, Any]:
    """
    Permanently delete a team/group across Website (`teams`, `chat_messages`),
    Mobile APK (`chat_conversations`, `conversations`, `chat_user_inbox`, `chatnew_messages`),
    Firebase Storage (`chatAttachments/{cid}/`), and record a tombstone in `chat_deleted_groups`.
    """
    _, now_iso = _utc_now()
    cids: List[str] = []
    for cand in [
        conv_id,
        (conv_id[5:] if conv_id and conv_id.startswith("team_") else None),
        (f"team_{team_id}" if team_id else None),
        team_id,
    ]:
        c_str = str(cand or "").strip()
        if c_str and c_str not in cids:
            cids.append(c_str)

    expanded_keys = _expand_group_keys(team_id, conv_id, *cids)
    _recently_deleted_group_keys.update(expanded_keys)

    canonical_cid = str(conv_id or (f"team_{team_id}" if team_id else "")).strip()
    if canonical_cid:
        tombstone = {
            "id": canonical_cid,
            "conversation_id": canonical_cid,
            "team_id": str(team_id or "").strip(),
            "deleted": True,
            "deleted_by": str(deleted_by or "").strip(),
            "deleted_at": now_iso,
        }
        rest_patch_document(f"chat_deleted_groups/{canonical_cid}", tombstone)

    member_uids: Set[str] = set()
    for cid in cids:
        for col in ("chat_conversations", "conversations"):
            doc = rest_get_document(f"{col}/{cid}")
            if doc:
                for uid in (doc.get("memberIds") or []):
                    if uid:
                        member_uids.add(str(uid).strip())
            _delete_subcollection_docs(f"{col}/{cid}", "messages")
            rest_delete_document(f"{col}/{cid}")
        _delete_storage_prefix(f"chatAttachments/{cid}/")

    # Delete matching `teams` documents across cache and Firestore
    team_ids_to_delete: Set[str] = set()
    clean_tid = str(team_id or "").strip()
    if clean_tid:
        team_ids_to_delete.add(clean_tid)
    try:
        for t in get_cached_collection("teams", force_refresh=True):
            tid_val = str(t.get("id") or t.get("_firestore_id") or "").strip()
            t_cid_val = str(t.get("conversation_id") or "").strip()
            if tid_val and _expand_group_keys(tid_val, t.get("team_id"), t_cid_val).intersection(expanded_keys):
                team_ids_to_delete.add(tid_val)
                for uid in (t.get("memberIds") or []):
                    if uid:
                        member_uids.add(str(uid).strip())
    except Exception:
        pass

    for tid_val in team_ids_to_delete:
        try:
            firestore_service.delete_document("teams", tid_val)
        except Exception:
            pass
        rest_delete_document(f"teams/{tid_val}")

    # Clean per-user inbox items
    for uid in member_uids:
        for cid in cids:
            rest_delete_document(f"chat_user_inbox/{uid}/items/{cid}")

    # Delete website chat_messages belonging to this group
    deleted_msgs = 0
    try:
        all_msgs = get_cached_collection("chat_messages", force_refresh=True)
        for m in all_msgs:
            if m.get("chat_type", "direct") != "team":
                continue
            m_keys = _expand_group_keys(m.get("conversation_id"), m.get("team_id"), m.get("target_id"))
            if m_keys.intersection(expanded_keys):
                mid = str(m.get("id") or m.get("_firestore_id") or "").strip()
                if mid:
                    firestore_service.delete_document("chat_messages", mid)
                    deleted_msgs += 1
    except Exception as e:
        logger.debug(f"[ChatSync] Website message cleanup partial: {e}")

    # Delete legacy chatnew_messages referencing deleted group conversationIds
    fs = _sdk_client()
    if fs is not None:
        try:
            for cid in cids:
                snaps = list(fs.collection("chatnew_messages").where("conversationId", "==", cid).limit(200).stream())
                if snaps:
                    batch = fs.batch()
                    for s in snaps:
                        batch.delete(s.reference)
                    batch.commit()
        except Exception as e:
            logger.debug(f"[ChatSync] chatnew_messages cleanup skipped: {e}")

    invalidate_chat_cache("teams", "chat_messages", "chat_deleted_groups")
    return {
        "cids": cids,
        "team_ids": sorted(team_ids_to_delete),
        "deleted_messages": deleted_msgs,
    }


_bg_sync_lock = threading.Lock()
_bg_sync_running = False


def ensure_bidirectional_teams_synced(max_age_seconds: int = 20) -> int:
    """Rate-limited wrapper for `sync_all_teams_bidirectional()` to keep web and mobile groups aligned."""
    global _last_bidirectional_sync_ts
    now = time.monotonic()
    if now - _last_bidirectional_sync_ts < max_age_seconds:
        return 0
    _last_bidirectional_sync_ts = now
    return sync_all_teams_bidirectional(force=False)


def trigger_background_bidirectional_sync(max_age_seconds: int = 30) -> None:
    """Kick off bidirectional sync in a background daemon thread so HTTP read requests never block."""
    global _last_bidirectional_sync_ts, _bg_sync_running
    now = time.monotonic()
    with _bg_sync_lock:
        if _bg_sync_running or (now - _last_bidirectional_sync_ts < max_age_seconds):
            return
        _bg_sync_running = True
        _last_bidirectional_sync_ts = now

    def _run():
        global _bg_sync_running
        try:
            sync_all_teams_bidirectional(force=False)
        except Exception as e:
            logger.debug(f"[ChatSync] Background bidirectional sync error: {e}")
        finally:
            with _bg_sync_lock:
                _bg_sync_running = False

    threading.Thread(target=_run, daemon=True).start()


def sync_all_teams_bidirectional(force: bool = False) -> int:
    """
    Bidirectionally sync groups between Website (`teams`) and Mobile APK (`chat_conversations`, `conversations`):
    1) Website `teams` -> ensures `name`/`teamName`/`team_name`, `memberIds`, `memberNames`, `chat_conversations`, `conversations`.
    2) App-created `chat_conversations` (`type=='group'`) -> fills missing `name`/`teamName`/`title` (fixing 'Group Chat' header),
       mirrors into `conversations`, and registers missing groups in `teams` so Website & TeamsActivity see all groups.
    Respects `chat_deleted_groups` tombstones so deleted groups are cleaned up and never resurrected.
    """
    deleted_keys = _get_deleted_group_keys()
    teams = get_cached_collection("teams", force_refresh=True)
    synced = 0
    known_team_by_id: Dict[str, Dict[str, Any]] = {}
    known_team_by_cid: Dict[str, Dict[str, Any]] = {}

    for t in teams:
        tid = str(t.get("id") or t.get("_firestore_id") or "").strip()
        if not tid:
            continue
        t_cid = str(t.get("conversation_id") or f"team_{tid}").strip()
        if _expand_group_keys(tid, t.get("team_id"), t_cid).intersection(deleted_keys):
            # Remove stale team peer if tombstoned on mobile/Cloud Functions
            try:
                firestore_service.delete_document("teams", tid)
                rest_delete_document(f"teams/{tid}")
                invalidate_chat_cache("teams")
            except Exception:
                pass
            continue
        known_team_by_id[tid.lower()] = t
        known_team_by_cid[t_cid.lower()] = t
        known_team_by_cid[f"team_{tid}".lower()] = t
        if t.get("active") is False or t.get("sync_to_chat") is False or str(t.get("team_scope") or "").strip().lower() == "project_hr":
            continue
        has_uids = bool(t.get("memberIds"))
        has_members = bool(t.get("members")) and bool(t.get("memberNames"))
        has_cid = bool(t.get("conversation_id"))
        has_names = bool(t.get("name")) and bool(t.get("teamName")) and bool(t.get("team_name"))
        if force or not (has_uids and has_members and has_cid and has_names):
            sync_team_to_mobile_app(tid, t, include_creator_in_members=False, unhide_inbox=False)
            synced += 1

    # Sync mobile-created groups (`chat_conversations` type=='group') into `name`/`conversations`/`teams`
    try:
        now_dt, now_iso = _utc_now()
        ts_val = now_dt if _sdk_client() is not None else now_iso
        mobile_convs = _query_collection("chat_conversations", member_uid=None, page_size=200)
        for d in mobile_convs:
            c_type = str(d.get("type") or "").strip().lower()
            if c_type not in ("group", "team", "teams"):
                continue
            cid = str(d.get("id") or d.get("conversationId") or "").strip()
            if not cid:
                continue
            raw_tid = str(d.get("teamId") or d.get("team_id") or "").strip()
            if _expand_group_keys(cid, raw_tid).intersection(deleted_keys):
                rest_delete_document(f"chat_conversations/{cid}")
                rest_delete_document(f"conversations/{cid}")
                continue
            g_name = str(d.get("groupName") or d.get("name") or d.get("teamName") or d.get("title") or "").strip()
            if not g_name:
                continue

            clean_cid = cid[5:] if cid.startswith("team_") else cid
            matched_team = (
                known_team_by_cid.get(cid.lower())
                or (known_team_by_id.get(raw_tid.lower()) if raw_tid else None)
                or known_team_by_id.get(clean_cid.lower())
            )
            if matched_team and matched_team.get("active") is False:
                continue

            member_uids, member_names, member_business_ids = _resolve_member_details(
                d.get("memberIds") or [],
                d.get("createdBy"),
                include_sender_in_members=False,
            )
            if not member_uids:
                continue

            resolved_names = [member_names.get(u) or u for u in member_uids]
            target_tid = str(matched_team.get("id")) if matched_team else (raw_tid or clean_cid)

            need_chat_patch = (
                d.get("name") != g_name
                or d.get("groupName") != g_name
                or d.get("teamName") != g_name
                or d.get("title") != g_name
                or str(d.get("teamId") or "") != target_tid
            )
            if need_chat_patch:
                c_patch = {
                    "name": g_name,
                    "groupName": g_name,
                    "teamName": g_name,
                    "title": g_name,
                    "teamId": target_tid,
                }
                rest_patch_document(f"chat_conversations/{cid}", c_patch, merge_fields=list(c_patch.keys()))
                synced += 1

            leg = rest_get_document(f"conversations/{cid}")
            if not leg or leg.get("name") != g_name or leg.get("groupName") != g_name or leg.get("teamName") != g_name:
                leg_payload = {
                    "id": cid,
                    "type": "group",
                    "name": g_name,
                    "groupName": g_name,
                    "teamId": target_tid,
                    "teamName": g_name,
                    "memberIds": member_uids,
                    "memberNames": member_names,
                    "memberBusinessIds": member_business_ids,
                    "createdBy": str(d.get("createdBy") or member_uids[0]),
                    "createdAt": d.get("createdAt") or ts_val,
                    "lastMessage": str(d.get("lastMessage") or ""),
                    "lastMessageTime": d.get("lastMessageAt") or d.get("lastMessageTime") or ts_val,
                    "lastSenderId": str(d.get("lastSenderId") or ""),
                    "unreadCounts": d.get("unreadCounts") or {u: 0 for u in member_uids},
                }
                if not leg:
                    rest_patch_document(f"conversations/{cid}", leg_payload)
                else:
                    rest_patch_document(
                        f"conversations/{cid}",
                        {"name": g_name, "groupName": g_name, "teamName": g_name, "teamId": target_tid},
                        merge_fields=["name", "groupName", "teamName", "teamId"],
                    )
                synced += 1

            if not matched_team:
                creator_uid = str(d.get("createdBy") or member_uids[0]).strip()
                creator_info = get_user_display_info(creator_uid) if creator_uid else {"name": "Group Admin"}
                created_iso = _normalize_timestamp_str(d.get("createdAt"), default_now=True)
                team_doc = {
                    "id": target_tid,
                    "team_id": target_tid,
                    "conversation_id": cid,
                    "name": g_name,
                    "teamName": g_name,
                    "team_name": g_name,
                    "department": "Custom Group",
                    "description": str(d.get("description") or "").strip(),
                    "leader": creator_info.get("name") or "Group Admin",
                    "createdBy": creator_uid,
                    "created_by": creator_info.get("employee_id") or creator_uid,
                    "groupAdmins": d.get("adminIds") or d.get("groupAdmins") or ([creator_uid] if creator_uid else []),
                    "members": resolved_names,
                    "memberNames": resolved_names,
                    "memberIds": member_uids,
                    "memberBusinessIds": [member_business_ids[u] for u in member_uids],
                    "is_custom_group": True,
                    "active": True,
                    "created_at": created_iso,
                    "updated_at": now_iso,
                }
                rest_patch_document(f"teams/{target_tid}", team_doc)
                known_team_by_id[target_tid.lower()] = team_doc
                known_team_by_cid[cid.lower()] = team_doc
                synced += 1
    except Exception as e:
        logger.debug(f"[ChatSync] Bidirectional mobile group backfill partial: {e}")

    if synced:
        invalidate_chat_cache("teams")
    return synced


def sync_message_to_mobile_app(
    msg_id: str,
    conversation_id: str,
    chat_type: str,
    sender_identifier: Any,
    content: str,
    attachments: Optional[List[Dict[str, Any]]] = None,
    target_id: Optional[str] = None,
    team_name: Optional[str] = None,
    member_identifiers: Optional[List[Any]] = None,
    include_sender_in_members: bool = True,
) -> bool:
    """
    Sync a website message into every Firestore collection used by the running Android APK:
    - chat_conversations/{cid} & /messages/{msg_id} (ChatInboxActivity + FCM Cloud Function)
    - conversations/{cid} & /messages/{msg_id} (TeamsActivity + ChatRepository)
    - chatnew_messages/{msg_id} & chat_user_inbox/{uid}/items/{cid}
    """
    now_dt, now_iso = _utc_now()
    ts_val = now_dt if _sdk_client() is not None else now_iso
    directory = _build_user_directory()
    admin_uid = directory["admin_uid"]

    sender_auth_uid = resolve_auth_uid(sender_identifier) or admin_uid
    sender_info = get_user_display_info(sender_auth_uid)
    sender_name = sender_info["name"]
    sender_role = "admin" if sender_auth_uid == admin_uid else "employee"

    member_uids, member_names, member_business_ids = _resolve_member_details(
        member_identifiers,
        sender_auth_uid,
        include_sender_in_members=include_sender_in_members,
    )
    if target_id and chat_type == "direct":
        target_uid = resolve_auth_uid(target_id)
        if target_uid and _is_looks_like_uid(target_uid) and target_uid not in member_uids:
            member_uids.append(target_uid)
            t_info = get_user_display_info(target_uid)
            member_names[target_uid] = t_info["name"]
            member_business_ids[target_uid] = t_info["employee_id"]

    is_team = chat_type == "team"
    conv_name = team_name or ("Team Conversation" if is_team else sender_name)
    msg_type, first_attachment_url = _infer_message_type(attachments)
    first_att = (attachments or [None])[0] if attachments else None
    att_filename = str((first_att or {}).get("filename") or "").strip()
    att_filesize = (first_att or {}).get("file_size")
    att_mime = str((first_att or {}).get("content_type") or "").strip()
    att_duration_ms = int((first_att or {}).get("duration_ms") or (first_att or {}).get("duration") or 0)
    if msg_type == "audio" and att_duration_ms <= 0:
        att_duration_ms = 1000

    clean_text = (content or "").strip()
    if msg_type == "document":
        if not clean_text or clean_text.startswith("Shared: "):
            preview_text = att_filename or "Document"
        else:
            preview_text = clean_text
    elif msg_type == "image":
        if not clean_text or clean_text.startswith("Shared: "):
            preview_text = "Photo"
        else:
            preview_text = clean_text
    elif msg_type == "audio":
        preview_text = clean_text or "Voice message"
    else:
        preview_text = clean_text

    target_conv_ids = _candidate_conversation_ids(conversation_id, chat_type, target_id, member_uids)

    for target_cid in target_conv_ids:
        existing_chat = rest_get_document(f"chat_conversations/{target_cid}")
        if existing_chat and isinstance(existing_chat.get("memberIds"), list) and not (is_team and member_identifiers):
            for ex_uid in existing_chat["memberIds"]:
                if ex_uid and ex_uid not in member_uids:
                    member_uids.append(ex_uid)
                    ex_info = get_user_display_info(ex_uid)
                    member_names[ex_uid] = ex_info["name"]
                    member_business_ids[ex_uid] = ex_info["employee_id"]

        unread_counts, last_read_at = _build_unread_and_read_maps(existing_chat, member_uids, sender_auth_uid, ts_val)

        if existing_chat:
            conv_patch = {
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "lastMessage": preview_text,
                "lastMessageType": msg_type,
                "lastMessageSenderId": sender_auth_uid,
                "lastMessageSenderName": sender_name,
                "lastSenderId": sender_auth_uid,
                "lastMessageAt": ts_val,
                "lastMessageTime": ts_val,
                "updatedAt": ts_val,
                "unreadCounts": unread_counts,
                "lastReadAt": last_read_at,
            }
            if is_team:
                if target_id:
                    conv_patch["teamId"] = str(target_id)
                if team_name and str(team_name).strip():
                    clean_tn = str(team_name).strip()
                    conv_patch["teamName"] = clean_tn
                    conv_patch["groupName"] = clean_tn
                    conv_patch["name"] = clean_tn
                    conv_patch["title"] = clean_tn
                else:
                    resolved_gn = str(
                        existing_chat.get("groupName")
                        or existing_chat.get("name")
                        or existing_chat.get("teamName")
                        or conv_name
                    ).strip()
                    if resolved_gn:
                        conv_patch["teamName"] = resolved_gn
                        conv_patch["groupName"] = resolved_gn
                        conv_patch["name"] = resolved_gn
                        conv_patch["title"] = resolved_gn
            rest_patch_document(f"chat_conversations/{target_cid}", conv_patch, merge_fields=list(conv_patch.keys()))
        else:
            conv_payload = {
                "id": target_cid,
                "conversationId": target_cid,
                "createdBy": sender_auth_uid,
                "type": "group" if is_team else "direct",
                "groupName": conv_name if is_team else "",
                "groupImage": "",
                "groupPhotoUrl": "",
                "name": conv_name,
                "title": conv_name,
                "teamId": str(target_id) if (is_team and target_id) else "",
                "teamName": conv_name if is_team else "",
                "groupAdmins": [sender_auth_uid] if is_team else [],
                "adminIds": [sender_auth_uid] if is_team else [],
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "lastMessage": preview_text,
                "lastMessageType": msg_type,
                "lastMessageSenderId": sender_auth_uid,
                "lastMessageSenderName": sender_name,
                "lastSenderId": sender_auth_uid,
                "lastMessageAt": ts_val,
                "lastMessageTime": ts_val,
                "updatedAt": ts_val,
                "createdAt": ts_val,
                "unreadCounts": unread_counts,
                "lastReadAt": last_read_at,
            }
            rest_patch_document(f"chat_conversations/{target_cid}", conv_payload)

        submsg_payload = {
            "id": msg_id,
            "messageId": msg_id,
            "conversationId": target_cid,
            "chatType": "group" if is_team else "direct",
            "senderId": sender_auth_uid,
            "senderAuthUid": sender_auth_uid,
            "senderName": sender_name,
            "senderRole": sender_role,
            "content": preview_text,
            "text": preview_text,
            "messageType": msg_type,
            "mediaUrl": first_attachment_url,
            "fileName": att_filename,
            "fileSize": att_filesize or 0,
            "mimeType": att_mime,
            "attachments": attachments or [],
            "timestamp": ts_val,
            "readBy": [sender_auth_uid],
            "deliveredTo": [],
            "participantIds": member_uids,
            "edited": False,
            "deleted": False,
            "forwarded": False,
        }
        if msg_type == "audio":
            submsg_payload["duration"] = att_duration_ms
        rest_patch_document(f"chat_conversations/{target_cid}/messages/{msg_id}", submsg_payload)

        existing_legacy = rest_get_document(f"conversations/{target_cid}")
        legacy_unread, _ = _build_unread_and_read_maps(existing_legacy, member_uids, sender_auth_uid, ts_val)
        if existing_legacy:
            legacy_patch = {
                "id": target_cid,
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "lastMessage": preview_text,
                "lastMessageTime": ts_val,
                "lastSenderId": sender_auth_uid,
                "unreadCounts": legacy_unread,
            }
            if is_team:
                if target_id:
                    legacy_patch["teamId"] = str(target_id)
                resolved_gn = str(
                    (team_name or "").strip()
                    or existing_legacy.get("name")
                    or existing_legacy.get("groupName")
                    or existing_legacy.get("teamName")
                    or conv_name
                ).strip()
                if resolved_gn:
                    legacy_patch["name"] = resolved_gn
                    legacy_patch["groupName"] = resolved_gn
                    legacy_patch["teamName"] = resolved_gn
            rest_patch_document(f"conversations/{target_cid}", legacy_patch, merge_fields=list(legacy_patch.keys()))
        else:
            legacy_conv = {
                "id": target_cid,
                "type": "group" if is_team else "direct",
                "name": conv_name if is_team else "",
                "groupName": conv_name if is_team else "",
                "teamId": str(target_id) if (is_team and target_id) else "",
                "teamName": conv_name if is_team else "",
                "memberIds": member_uids,
                "memberNames": member_names,
                "memberBusinessIds": member_business_ids,
                "createdBy": sender_auth_uid,
                "createdAt": ts_val,
                "lastMessage": preview_text,
                "lastMessageTime": ts_val,
                "lastSenderId": sender_auth_uid,
                "unreadCounts": legacy_unread,
            }
            rest_patch_document(f"conversations/{target_cid}", legacy_conv)

        legacy_msg = {
            "conversationId": target_cid,
            "chatType": "group" if is_team else "direct",
            "senderId": sender_auth_uid,
            "senderAuthUid": sender_auth_uid,
            "senderName": sender_name,
            "senderRole": sender_role,
            "content": preview_text,
            "messageType": msg_type,
            "mediaUrl": first_attachment_url,
            "fileName": att_filename,
            "fileSize": att_filesize or 0,
            "mimeType": att_mime,
            "attachments": attachments or [],
            "timestamp": ts_val,
            "readBy": [sender_auth_uid],
            "deliveredTo": [],
            "participantIds": member_uids,
        }
        if msg_type == "audio":
            legacy_msg["duration"] = att_duration_ms
        rest_patch_document(f"conversations/{target_cid}/messages/{msg_id}", legacy_msg)

        chatnew_id = f"{msg_id}_{target_cid}" if target_cid != conversation_id else msg_id
        chatnew_payload = {
            "id": chatnew_id,
            "messageId": chatnew_id,
            "conversationId": target_cid,
            "senderId": sender_auth_uid,
            "senderName": sender_name,
            "type": msg_type,
            "text": preview_text,
            "mediaUrl": first_attachment_url,
            "fileName": att_filename,
            "createdAt": ts_val,
            "readBy": [sender_auth_uid],
            "edited": False,
            "deleted": False,
        }
        if msg_type == "audio":
            chatnew_payload["duration"] = att_duration_ms
        rest_patch_document(f"chatnew_messages/{chatnew_id}", chatnew_payload)

        for m_uid in member_uids:
            inbox_patch = {"deletedForMe": False, "updatedAt": ts_val}
            rest_patch_document(
                f"chat_user_inbox/{m_uid}/items/{target_cid}",
                inbox_patch,
                merge_fields=list(inbox_patch.keys()),
            )

    logger.info(f"[ChatSync] Synced msg {msg_id} across {target_conv_ids} for members {member_uids}")
    return True


# ==============================================================================
# 5. Live Mobile Read & Conversation Fetch (Mobile App -> Website)
# ==============================================================================

def fetch_live_mobile_conversations(user_auth_uid: Optional[str], is_admin: bool = False) -> List[Dict[str, Any]]:
    """Fetch active conversations from `chat_conversations` and `conversations` concurrently with short caching."""
    uid_filter = None if is_admin else user_auth_uid
    if not is_admin and not uid_filter:
        return []

    cache_key = (str(uid_filter or "*"), bool(is_admin))
    now = time.monotonic()
    with _cache_lock:
        entry = _mobile_convs_cache.get(cache_key)
        if entry is not None and (now - entry[0]) < _MOBILE_CONV_TTL_SECONDS:
            return list(entry[1])

    deleted_keys = _get_deleted_group_keys()
    col_docs: Dict[str, List[Dict[str, Any]]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        future_map = {
            pool.submit(_query_collection, col_name, uid_filter, 100): col_name
            for col_name in ("chat_conversations", "conversations")
        }
        for fut in concurrent.futures.as_completed(future_map):
            col_name = future_map[fut]
            try:
                col_docs[col_name] = fut.result() or []
            except Exception:
                col_docs[col_name] = []

    results: Dict[str, Dict[str, Any]] = {}
    for col_name in ("chat_conversations", "conversations"):
        for d in col_docs.get(col_name, []):
            cid = str(d.get("id") or d.get("conversationId") or "").strip()
            if not cid:
                continue
            raw_tid = str(d.get("teamId") or d.get("team_id") or "").strip()
            if _expand_group_keys(cid, raw_tid).intersection(deleted_keys):
                continue
            member_ids = [str(m).strip() for m in (d.get("memberIds") or []) if m]
            if user_auth_uid and not is_admin and user_auth_uid not in member_ids:
                continue
            c_type_raw = str(d.get("type") or d.get("chat_type") or d.get("chatType") or "direct").strip().lower()
            is_group = c_type_raw in ("group", "team", "teams")
            last_at = _normalize_timestamp_str(
                d.get("lastMessageAt") or d.get("lastMessageTime") or d.get("updatedAt") or d.get("createdAt") or ""
            )
            existing = results.get(cid)
            if existing and str(existing.get("last_message_at", "")) >= last_at:
                continue
            results[cid] = {
                "conversation_id": cid,
                "source_collection": col_name,
                "type": "team" if is_group else "direct",
                "team_id": raw_tid,
                "title": d.get("groupName") or d.get("teamName") or d.get("name") or d.get("title") or ("Group" if is_group else "Direct Chat"),
                "created_by": str(d.get("createdBy") or "").strip(),
                "member_ids": member_ids,
                "member_names": d.get("memberNames") or {},
                "last_message": d.get("lastMessage") or d.get("lastMessageText") or "",
                "last_sender_id": d.get("lastSenderId") or d.get("lastMessageSenderId") or "",
                "last_message_at": last_at,
                "unread_counts": d.get("unreadCounts") or {},
            }

    out = list(results.values())
    with _cache_lock:
        _mobile_convs_cache[cache_key] = (time.monotonic(), out)
    return list(out)


def fetch_live_mobile_messages(
    conversation_id: str,
    participant_uids: Optional[List[str]] = None,
    extra_cids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Fetch messages from both `chat_conversations` and `conversations` mobile collections in parallel."""
    cids_to_check: List[str] = []
    seen_cids: Set[str] = set()

    def _add_cid(c: str):
        c_clean = (c or "").strip()
        if c_clean and c_clean not in seen_cids:
            seen_cids.add(c_clean)
            cids_to_check.append(c_clean)

    if not conversation_id.startswith("dm_"):
        _add_cid(conversation_id)
        if conversation_id.startswith("team_"):
            _add_cid(conversation_id[5:])
        elif not conversation_id.startswith("direct_"):
            _add_cid(f"team_{conversation_id}")
        for ec in (extra_cids or []):
            _add_cid(ec)

    if participant_uids and len(participant_uids) >= 2:
        u1, u2 = sorted(participant_uids[:2])
        _add_cid(f"direct_{u1}_{u2}")
        _add_cid(f"{u1}_{u2}")

    # Pre-warm directory once before normalizing sender info
    _build_user_directory()

    fetch_targets: List[Tuple[str, str]] = []
    for root_col in ("chat_conversations", "conversations"):
        if _sdk_client() is None and _is_forbidden_cached(root_col):
            continue
        for cid in cids_to_check:
            fetch_targets.append((root_col, cid))

    fetched_batches: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    if fetch_targets:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(8, len(fetch_targets))) as pool:
            fut_map = {
                pool.submit(rest_fetch_subcollection, f"{rc}/{cid}/messages"): (rc, cid)
                for rc, cid in fetch_targets
            }
            for fut in concurrent.futures.as_completed(fut_map):
                key = fut_map[fut]
                try:
                    fetched_batches[key] = fut.result() or []
                except Exception:
                    fetched_batches[key] = []

    all_normalized: List[Dict[str, Any]] = []
    seen_ids: Set[str] = set()

    for root_col, cid in fetch_targets:
        sub_docs = fetched_batches.get((root_col, cid), [])
        for d in sub_docs:
            if True:
                mid = str(d.get("id") or d.get("messageId") or "").strip()
                if not mid or mid in seen_ids or d.get("deleted") is True:
                    continue
                seen_ids.add(mid)

                sender_id = str(d.get("senderAuthUid") or d.get("senderId") or d.get("sender_id") or "").strip()
                sender_info = get_user_display_info(sender_id)
                sender_name = d.get("senderName") or sender_info["name"]

                attachments = d.get("attachments") or []
                media_url = str(d.get("mediaUrl") or "").strip()
                msg_type = str(d.get("messageType") or d.get("type") or "text").strip().lower()
                raw_duration = int(d.get("duration") or 0)
                if not attachments and media_url:
                    clean_path = urllib.parse.unquote(media_url.split("?")[0])
                    url_basename = clean_path.rsplit("/", 1)[-1] if "/" in clean_path else ""
                    if msg_type == "audio":
                        secs = round(raw_duration / 1000) if raw_duration >= 700 else raw_duration
                        derived_name = f"Voice Message ({secs // 60}:{secs % 60:02d})" if secs > 0 else "Voice Message"
                    elif msg_type == "document":
                        derived_name = d.get("fileName") or d.get("content") or url_basename or "Document"
                    else:
                        derived_name = d.get("fileName") or url_basename or "Photo"

                    clean_lower = clean_path.lower()
                    fname_lower = str(derived_name).lower()
                    is_img = (
                        msg_type == "image"
                        or clean_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))
                        or fname_lower.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp"))
                    )
                    is_aud = (
                        msg_type == "audio"
                        or clean_lower.endswith((".webm", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus"))
                        or fname_lower.endswith((".webm", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus"))
                    )
                    attachments = [{
                        "url": media_url,
                        "filename": str(derived_name),
                        "file_size": d.get("fileSize") or d.get("file_size") or None,
                        "content_type": d.get("mimeType") or d.get("contentType") or (
                            "image/jpeg" if is_img else ("audio/mp4" if is_aud else "application/octet-stream")
                        ),
                        "is_image": is_img,
                        "is_audio": is_aud,
                        "duration_ms": raw_duration if is_aud else None,
                    }]
                elif attachments:
                    normalized_atts = []
                    for att in attachments:
                        if not isinstance(att, dict):
                            continue
                        a_url = str(att.get("url") or att.get("file_url") or "").strip()
                        a_name = str(att.get("filename") or "Attachment").strip()
                        a_clean = urllib.parse.unquote(a_url.split("?")[0]).lower()
                        a_ctype = str(att.get("content_type") or "").lower()
                        is_img = bool(att.get("is_image") or a_ctype.startswith("image/") or a_clean.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")))
                        is_aud = bool(att.get("is_audio") or a_ctype.startswith("audio/") or a_clean.endswith((".webm", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus")))
                        normalized_atts.append({
                            **att,
                            "url": a_url,
                            "filename": a_name,
                            "is_image": is_img,
                            "is_audio": is_aud,
                        })
                    attachments = normalized_atts

                ts_iso = _normalize_timestamp_str(d.get("timestamp") or d.get("createdAt"), default_now=True)
                upd_iso = _normalize_timestamp_str(d.get("updatedAt") or d.get("timestamp") or d.get("createdAt"), default_now=True)

                all_normalized.append({
                    "id": mid,
                    "conversation_id": conversation_id,
                    "sender_id": sender_info["employee_id"] or sender_id,
                    "sender_auth_uid": sender_id,
                    "sender_name": sender_name,
                    "sender_photo": sender_info["photo_url"] or None,
                    "sender_avatar": sender_name[0].upper() if sender_name else "U",
                    "content": d.get("content") or d.get("text") or "",
                    "attachments": attachments,
                    "read_by": d.get("readBy") or [sender_id],
                    "is_edited": bool(d.get("edited") or d.get("is_edited")),
                    "created_at": ts_iso,
                    "updated_at": upd_iso,
                })

    return all_normalized


def mark_mobile_conversation_read(conversation_ids: List[str], user_auth_uid: Optional[str]) -> None:
    """Clear unread count for `user_auth_uid` on matching mobile conversation docs."""
    if not user_auth_uid:
        return
    now_dt, now_iso = _utc_now()
    ts_val = now_dt if _sdk_client() is not None else now_iso

    for root_col in ("chat_conversations", "conversations"):
        if _sdk_client() is None and _is_forbidden_cached(root_col):
            continue
        for cid in conversation_ids:
            doc = rest_get_document(f"{root_col}/{cid}")
            if not doc:
                continue
            unread = dict(doc.get("unreadCounts") or {})
            unread[user_auth_uid] = 0
            patch = {"unreadCounts": unread}
            if root_col == "chat_conversations":
                last_read = dict(doc.get("lastReadAt") or {})
                last_read[user_auth_uid] = ts_val
                patch["lastReadAt"] = last_read
            rest_patch_document(f"{root_col}/{cid}", patch, merge_fields=list(patch.keys()))


# ==============================================================================
# 6. WhatsApp-like Online / Offline / Last Seen Presence (`chat_presence`)
# ==============================================================================

def _parse_utc_dt(iso_str: str) -> Optional[datetime]:
    """Parse normalized timestamp strings cleanly for chronological comparisons."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _pick_latest_timestamp(*values: Any) -> str:
    """Return the chronologically newest timestamp string among given values."""
    best_str = ""
    best_dt: Optional[datetime] = None
    for val in values:
        norm = _normalize_timestamp_str(val)
        if not norm:
            continue
        dt = _parse_utc_dt(norm)
        if dt is not None:
            if best_dt is None or dt > best_dt:
                best_dt = dt
                best_str = norm
        elif not best_str or norm > best_str:
            best_str = norm
    return best_str


def get_presence_map(force_refresh: bool = False) -> Dict[str, Dict[str, Any]]:
    """
    Read `chat_presence` from Firestore (5s cache) and return `{uid: {online, last_seen, typing, typing_conversation_id}}`.
    Also aliases keys in lowercase for fast lookup.
    """
    global _presence_cache
    now = time.monotonic()
    with _cache_lock:
        if not force_refresh and _presence_cache is not None:
            ts, cached_map = _presence_cache
            if now - ts < _PRESENCE_TTL_SECONDS:
                return cached_map

    docs = rest_fetch_subcollection("chat_presence", page_size=200)
    now_utc = datetime.now(timezone.utc)
    pmap: Dict[str, Dict[str, Any]] = {}
    for d in docs:
        uid = str(d.get("uid") or d.get("id") or "").strip()
        if not uid:
            continue
        is_online = bool(d.get("online", False))
        raw_last_seen = _normalize_timestamp_str(d.get("lastSeen"))
        updated_at = _normalize_timestamp_str(d.get("updatedAt"))
        # Prevent crashed/abandoned web sessions from staying stuck Online after heartbeats stop
        if is_online and str(d.get("source") or "").strip().lower() == "web":
            upd_dt = _parse_utc_dt(updated_at)
            if upd_dt is not None and (now_utc - upd_dt).total_seconds() > 90:
                is_online = False
        last_seen = raw_last_seen if is_online else _pick_latest_timestamp(raw_last_seen, updated_at)
        entry = {
            "uid": uid,
            "online": is_online,
            "last_seen": last_seen,
            "updated_at": updated_at,
            "typing": bool(d.get("typing", False)) if is_online else False,
            "typing_conversation_id": str(d.get("typingConversationId") or "") if is_online else "",
        }
        pmap[uid] = entry
        pmap[uid.lower()] = entry

    with _cache_lock:
        _presence_cache = (time.monotonic(), pmap)
    return pmap


def update_user_presence(
    user_identifier: Any,
    online: bool,
    typing: Optional[bool] = None,
    typing_conversation_id: str = "",
) -> Optional[Dict[str, Any]]:
    """Sync website user's live online/offline/lastSeen/typing state to Firestore `chat_presence/{uid}`."""
    global _presence_cache
    auth_uid = resolve_auth_uid(user_identifier)
    if not auth_uid or not _is_looks_like_uid(auth_uid):
        return None

    with _cache_lock:
        _presence_cache = None

    now_dt, now_iso = _utc_now()
    ts_val = now_dt if _sdk_client() is not None else now_iso

    payload: Dict[str, Any] = {
        "uid": auth_uid,
        "online": bool(online),
        "updatedAt": ts_val,
        "source": "web",
    }
    if not online:
        payload["lastSeen"] = ts_val
        payload["typing"] = False
        payload["typingConversationId"] = ""
    elif typing is not None:
        payload["typing"] = bool(typing)
        payload["typingConversationId"] = typing_conversation_id if typing else ""

    ok = rest_patch_document(f"chat_presence/{auth_uid}", payload, merge_fields=list(payload.keys()))
    if ok:
        with _cache_lock:
            _presence_cache = None
    return {
        "uid": auth_uid,
        "online": bool(online),
        "last_seen": now_iso if not online else "",
        "updated_at": now_iso,
    }


def ensure_direct_conversation_in_mobile_app(
    user_a_identifier: Any,
    user_b_identifier: Any,
) -> Optional[str]:
    """
    Ensure a direct conversation document exists in `chat_conversations`, `conversations`,
    and `chat_user_inbox` so new direct chats initiated on Website appear immediately on App.
    """
    uid_a = resolve_auth_uid(user_a_identifier)
    uid_b = resolve_auth_uid(user_b_identifier)
    if not uid_a or not uid_b or not _is_looks_like_uid(uid_a) or not _is_looks_like_uid(uid_b):
        return None

    pair = sorted([uid_a, uid_b]) if uid_a != uid_b else [uid_a, uid_b]
    conv_id = f"direct_{pair[0]}_{pair[1]}"
    legacy_pair = f"{pair[0]}_{pair[1]}"
    target_cid = legacy_pair if rest_get_document(f"chat_conversations/{legacy_pair}") else conv_id

    now_dt, now_iso = _utc_now()
    ts_val = now_dt if _sdk_client() is not None else now_iso
    member_uids, member_names, member_business_ids = _resolve_member_details(pair, None, include_sender_in_members=False)

    existing_chat = rest_get_document(f"chat_conversations/{target_cid}")
    if not existing_chat:
        unread_init = {u: 0 for u in member_uids}
        read_init = {u: ts_val for u in member_uids}
        chat_doc = {
            "id": target_cid,
            "conversationId": target_cid,
            "createdBy": uid_a,
            "type": "direct",
            "groupName": "",
            "groupImage": "",
            "groupPhotoUrl": "",
            "name": "",
            "title": "",
            "teamId": "",
            "teamName": "",
            "groupAdmins": [],
            "adminIds": [],
            "memberIds": member_uids,
            "memberNames": member_names,
            "memberBusinessIds": member_business_ids,
            "lastMessage": "",
            "lastMessageType": "text",
            "lastMessageSenderId": "",
            "lastMessageSenderName": "",
            "lastSenderId": "",
            "lastMessageAt": ts_val,
            "lastMessageTime": ts_val,
            "updatedAt": ts_val,
            "createdAt": ts_val,
            "unreadCounts": unread_init,
            "lastReadAt": read_init,
        }
        rest_patch_document(f"chat_conversations/{target_cid}", chat_doc)

    existing_legacy = rest_get_document(f"conversations/{target_cid}")
    if not existing_legacy:
        legacy_doc = {
            "id": target_cid,
            "type": "direct",
            "name": "",
            "teamId": "",
            "teamName": "",
            "memberIds": member_uids,
            "memberNames": member_names,
            "memberBusinessIds": member_business_ids,
            "createdBy": uid_a,
            "createdAt": ts_val,
            "lastMessage": "",
            "lastMessageTime": ts_val,
            "lastSenderId": "",
            "unreadCounts": {u: 0 for u in member_uids},
        }
        rest_patch_document(f"conversations/{target_cid}", legacy_doc)

    for m_uid in member_uids:
        inbox_patch = {"deletedForMe": False, "updatedAt": ts_val}
        rest_patch_document(
            f"chat_user_inbox/{m_uid}/items/{target_cid}",
            inbox_patch,
            merge_fields=list(inbox_patch.keys()),
        )

    return target_cid


def sync_group_metadata_to_mobile_app(
    conversation_id: str,
    team_id: Optional[str],
    name: Optional[str] = None,
    description: Optional[str] = None,
) -> bool:
    """Sync group rename and description updates across `teams`, `chat_conversations`, and `conversations`."""
    now_dt, now_iso = _utc_now()
    ts_val = now_dt if _sdk_client() is not None else now_iso

    clean_name = name.strip() if isinstance(name, str) and name.strip() else None
    clean_desc = description.strip() if isinstance(description, str) else None

    if team_id:
        team_patch: Dict[str, Any] = {"updated_at": now_iso}
        if clean_name is not None:
            team_patch["teamName"] = clean_name
            team_patch["team_name"] = clean_name
            team_patch["name"] = clean_name
        if clean_desc is not None:
            team_patch["description"] = clean_desc
        rest_patch_document(f"teams/{team_id}", team_patch, merge_fields=list(team_patch.keys()))
        invalidate_chat_cache("teams")

    cids = _candidate_conversation_ids(conversation_id, "team", team_id, [])
    for cid in cids:
        existing_chat = rest_get_document(f"chat_conversations/{cid}")
        if existing_chat:
            chat_patch: Dict[str, Any] = {"updatedAt": ts_val}
            if clean_name is not None:
                chat_patch["groupName"] = clean_name
                chat_patch["teamName"] = clean_name
                chat_patch["name"] = clean_name
                chat_patch["title"] = clean_name
            if clean_desc is not None:
                chat_patch["description"] = clean_desc
            rest_patch_document(f"chat_conversations/{cid}", chat_patch, merge_fields=list(chat_patch.keys()))

        existing_legacy = rest_get_document(f"conversations/{cid}")
        if existing_legacy:
            legacy_patch: Dict[str, Any] = {}
            if clean_name is not None:
                legacy_patch["name"] = clean_name
                legacy_patch["groupName"] = clean_name
                legacy_patch["teamName"] = clean_name
            if clean_desc is not None:
                legacy_patch["description"] = clean_desc
            if legacy_patch:
                rest_patch_document(f"conversations/{cid}", legacy_patch, merge_fields=list(legacy_patch.keys()))

    return True


def _sync_message_mutation_to_mobile_app(
    msg_id: str,
    conversation_id: str,
    payload_builder,
    last_message_preview: Optional[str] = None,
) -> bool:
    """Apply an edit or delete update across mobile message collections (`chat_conversations`, `conversations`, `chatnew_messages`)."""
    now_dt, now_iso = _utc_now()
    ts_val = now_dt if _sdk_client() is not None else now_iso
    cids = [conversation_id] if conversation_id else []
    if conversation_id.startswith("team_"):
        stripped = conversation_id[5:]
        if stripped and (rest_get_document(f"chat_conversations/{stripped}") or rest_get_document(f"conversations/{stripped}")):
            cids.append(stripped)

    for target_cid in cids:
        if rest_get_document(f"chat_conversations/{target_cid}/messages/{msg_id}"):
            sub_patch = payload_builder("sub", ts_val)
            rest_patch_document(
                f"chat_conversations/{target_cid}/messages/{msg_id}",
                sub_patch,
                merge_fields=list(sub_patch.keys()),
            )
        if rest_get_document(f"conversations/{target_cid}/messages/{msg_id}"):
            leg_patch = payload_builder("legacy", ts_val)
            rest_patch_document(
                f"conversations/{target_cid}/messages/{msg_id}",
                leg_patch,
                merge_fields=list(leg_patch.keys()),
            )
        chatnew_id = f"{msg_id}_{target_cid}" if target_cid != conversation_id else msg_id
        for cn_id in dict.fromkeys([chatnew_id, msg_id]):
            if rest_get_document(f"chatnew_messages/{cn_id}"):
                cn_patch = payload_builder("chatnew", ts_val)
                rest_patch_document(
                    f"chatnew_messages/{cn_id}",
                    cn_patch,
                    merge_fields=list(cn_patch.keys()),
                )

        if last_message_preview is not None:
            conv_doc = rest_get_document(f"chat_conversations/{target_cid}")
            if conv_doc:
                conv_patch = {"lastMessage": last_message_preview, "updatedAt": ts_val}
                rest_patch_document(
                    f"chat_conversations/{target_cid}",
                    conv_patch,
                    merge_fields=list(conv_patch.keys()),
                )
            leg_doc = rest_get_document(f"conversations/{target_cid}")
            if leg_doc:
                leg_conv_patch = {"lastMessage": last_message_preview}
                rest_patch_document(
                    f"conversations/{target_cid}",
                    leg_conv_patch,
                    merge_fields=list(leg_conv_patch.keys()),
                )
    return True


def sync_message_edit_to_mobile_app(
    msg_id: str,
    conversation_id: str,
    new_content: str,
) -> bool:
    """Sync edited message content to mobile Firestore collections."""
    clean = (new_content or "").strip()

    def _build(kind: str, ts_val: Any) -> Dict[str, Any]:
        if kind == "chatnew":
            return {"text": clean, "edited": True, "editedAt": ts_val}
        return {"content": clean, "text": clean, "edited": True, "editedAt": ts_val}

    return _sync_message_mutation_to_mobile_app(msg_id, conversation_id, _build, last_message_preview=clean)


def sync_message_delete_to_mobile_app(
    msg_id: str,
    conversation_id: str,
) -> bool:
    """Sync message soft-delete to mobile Firestore collections."""
    deleted_text = "This message was deleted"

    def _build(kind: str, ts_val: Any) -> Dict[str, Any]:
        if kind == "chatnew":
            return {"text": deleted_text, "deleted": True, "deletedAt": ts_val}
        return {"content": deleted_text, "text": deleted_text, "deleted": True, "deletedAt": ts_val}

    return _sync_message_mutation_to_mobile_app(msg_id, conversation_id, _build, last_message_preview=deleted_text)
