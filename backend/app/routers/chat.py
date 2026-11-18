import asyncio
import concurrent.futures
import json
import logging
import os
import threading
import time
import uuid
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any, Set, Tuple
from fastapi import APIRouter, Depends, HTTPException, status, Query, WebSocket, WebSocketDisconnect, UploadFile, File
from pydantic import BaseModel

from app.services.firestore_service import firestore_service, FirestoreService
from app.services.chat_sync_service import (
    _is_looks_like_uid,
    _pick_latest_timestamp,
    ensure_direct_conversation_in_mobile_app,
    get_cached_collection,
    get_presence_map,
    invalidate_chat_cache,
    resolve_auth_uid,
    get_user_display_info,
    fetch_live_mobile_conversations,
    fetch_live_mobile_messages,
    mark_mobile_conversation_read,
    sync_group_metadata_to_mobile_app,
    sync_message_delete_to_mobile_app,
    sync_message_edit_to_mobile_app,
    sync_message_to_mobile_app,
    sync_team_to_mobile_app,
    update_user_presence,
    upload_chat_attachment_to_storage,
    rest_fetch_subcollection,
    rest_get_document,
    rest_patch_document,
    delete_team_and_sync_mobile,
    is_group_deleted,
    _expand_group_keys,
    get_deleted_group_keys,
    warm_chat_collections_parallel,
    trigger_background_bidirectional_sync,
    _build_user_directory,
)
from app.dependencies.auth import get_current_user
from app.core.security import decode_access_token
from app.core.firebase import verify_firebase_token, is_firebase_live

logger = logging.getLogger("uvicorn.error")

router = APIRouter(prefix="/chat", tags=["Teams Chat"])

_last_legacy_migration_at = 0.0
_LEGACY_MIGRATION_COOLDOWN_SECONDS = 300.0

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "chat_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
ALLOWED_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp",
    ".pdf", ".docx", ".doc", ".xlsx", ".xls", ".ppt", ".pptx", ".txt", ".csv", ".zip",
    ".webm", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".mp4"
}
MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB

SAMPLE_CHAT_EXCLUSIONS: Set[str] = {
    "admin_approval_391517",
    "admin_approval_391517@arshithgroup.com",
    "dinesh",
    "dinesh@leadarshith.com",
    "eight_pwd_291517",
    "eight_pwd_291517@arshithgroup.com",
    "emp_20261028180945",
    "emp_20261028180945@arshithgroup.com",
    "employee user",
    "employee@arshith.com",
    "afi-001",
    "inactive_worker",
    "inactive_worker@arshithgroup.com",
    "test_user_inactive",
    "gopi",
    "gopi@arshithgroup.com",
    "late employee test",
    "late_emp_test@arshithgroup.com",
    "test_emp_late_checkin_uid_202",
    "marco",
    "marco@arshithgroup.com",
    "mounika",
    "mounika@arshithgroup.com",
    "marco.mounika",
    "new.employee999",
    "new.employee999@arshithgroup.com",
    "ontime employee test",
    "ontime_emp_test@arshithgroup.com",
    "test_emp_ontime_checkin_uid_203",
    "pallavi",
    "pallavi@arshithgroup.com",
    "pending_4ba01f",
    "pending_4ba01f@arshithgroup.com",
    "pending_id_4ba01f",
    "pending_worker",
    "pending_worker@arshithgroup.com",
    "test_user_pending",
    "phani",
    "phani@leadarshtih.com",
    "5230",
    "priya",
    "priya@arshithgroup.com",
    "rajesh",
    "rajesh@leadarshith.com",
    "rajesh@arshithgroup.com",
    "7856",
    "8521",
    "rejected_b79005",
    "rejected_b79005@arshithgroup.com",
    "rej_id_b79005",
    "rejected_worker",
    "rejected_worker@arshithgroup.com",
    "test_user_rejected",
    "rithu",
    "rithu@arshithgroup.com",
    "rithuj",
    "rithuj@arshithgroup.com",
    "rithuk",
    "rithuk@arshithgroup.com",
    "sameer",
    "sameer@arshithgroup.com",
    "sync_approve_6faaal",
    "sync_approve_6faaa1",
    "sync_approve_6faaa1@arshithgroup.com",
    "vinay",
    "vinay@arshithgroup.com",
    "yedulla",
    "yedulla@arshithgroup.com",
    "test_user_approved",
    "tgs1jzpxw7ykthh2zgwpvfac9d62",
    "knamvwbdvvefe6s5qwctlamnegp2",
    "mqafzqg2guf5nmva665fcmc9dqt1",
    "bpevhx8otqyjpx1i18rqcal82px1",
    "h9266iulmwfbq5chkt4ghbhrls62",
    "qj9raezro4dsx8fkq5531rca9ba2",
    "t73w1a4vkfhe7zmzwsympqp8wg3",
    "u5nynac1qevcld1lide15ulqx92",
    "ufqnxubkd7awo99padkjeqdf1dv2",
    "y9qqjbrtgnbly2alsmjro2mua1m1",
    "crcwyrz5l8ouzpwub1zdr4co8lz1",
    "d8ut6jxxowgbaqpeiewtia6uuw92",
    "fphz8s8etuetxkml5wejgcvtgrq2",
    "tz4jdzyevgqm6ms6rgmthih8e6p2",
    "yckctsudlkspfmnyxdmwkjbuowv2",
}


def is_sample_chat_excluded(val: Optional[Any]) -> bool:
    if not val:
        return False
    s = str(val).strip().lower()
    if s in SAMPLE_CHAT_EXCLUSIONS:
        return True
    if s.startswith("test_emp_") or s.startswith("direct_test_emp_"):
        return True
    if any(k in s for k in ("tgs1jzpx", "knamvwbd", "mqafzqg2", "admin_approval", "eight_pwd", "emp_20261028")):
        return True
    return False


def _resolve_presence_tuple(
    identifiers: List[Any],
    presence_map: Dict[str, Any],
) -> Tuple[bool, str, bool, str]:
    """Combine live WebSocket online status and Firestore `chat_presence` (online, last_seen, typing)."""
    ws_online = any(manager.is_user_online(i) for i in identifiers if i)
    matched_entries: List[Dict[str, Any]] = []
    seen_entry_ids: Set[int] = set()
    mem_last_seen_vals: List[str] = []

    def _collect(key: Any):
        if not key:
            return
        s = str(key).strip()
        if not s:
            return
        mem_ls = manager.get_last_seen(s)
        if mem_ls:
            mem_last_seen_vals.append(mem_ls)
        for cand in (presence_map.get(s), presence_map.get(s.lower())):
            if cand and id(cand) not in seen_entry_ids:
                seen_entry_ids.add(id(cand))
                matched_entries.append(cand)

    for ident in identifiers:
        if not ident:
            continue
        _collect(ident)
        uid = resolve_auth_uid(ident)
        if uid:
            _collect(uid)

    fs_online = any(bool(e.get("online")) for e in matched_entries)
    last_seen = _pick_latest_timestamp(*(e.get("last_seen") for e in matched_entries), *mem_last_seen_vals)
    typing_entry = next((e for e in matched_entries if e.get("typing")), None)
    is_typing = bool(typing_entry)
    typing_cid = str(typing_entry.get("typing_conversation_id") or "") if typing_entry else ""
    return (ws_online or fs_online), last_seen, is_typing, typing_cid


# ==============================================================================
# WebSocket Real-Time Connection Manager
# ==============================================================================
class ConnectionManager:
    """Manages active WebSocket connections for instant real-time dispatch."""

    def __init__(self):
        # Maps user key (str) -> Set of active WebSocket instances
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        # Set of currently active user keys (for presence)
        self.online_users: Set[str] = set()
        # In-memory last_seen per user key for instant updates without Firestore race
        self.last_seen_by_key: Dict[str, str] = {}

    def _normalize_key(self, key: Any) -> str:
        return str(key).strip().lower() if key else ""

    def record_last_seen(self, user_keys: List[str], iso_ts: str):
        if not iso_ts:
            return
        for k in user_keys:
            norm = self._normalize_key(k)
            if norm:
                self.last_seen_by_key[norm] = _pick_latest_timestamp(self.last_seen_by_key.get(norm, ""), iso_ts)

    def get_last_seen(self, user_key: Any) -> str:
        norm = self._normalize_key(user_key)
        return self.last_seen_by_key.get(norm, "") if norm else ""

    async def connect(self, websocket: WebSocket, user_keys: List[str]):
        await websocket.accept()
        for k in user_keys:
            norm = self._normalize_key(k)
            if not norm:
                continue
            if norm not in self.active_connections:
                self.active_connections[norm] = set()
            self.active_connections[norm].add(websocket)
            self.online_users.add(norm)

    def disconnect(self, websocket: WebSocket, user_keys: List[str]):
        for k in user_keys:
            norm = self._normalize_key(k)
            if not norm:
                continue
            if norm in self.active_connections:
                self.active_connections[norm].discard(websocket)
                if not self.active_connections[norm]:
                    del self.active_connections[norm]
                    self.online_users.discard(norm)

    def is_user_online(self, user_key: Any) -> bool:
        norm = self._normalize_key(user_key)
        return norm in self.online_users and len(self.active_connections.get(norm, set())) > 0

    async def broadcast_to_keys(self, user_keys: List[str], event: dict):
        sent_sockets: Set[WebSocket] = set()
        for k in user_keys:
            norm = self._normalize_key(k)
            if norm in self.active_connections:
                for ws in list(self.active_connections[norm]):
                    if ws not in sent_sockets:
                        try:
                            await ws.send_text(json.dumps(event))
                            sent_sockets.add(ws)
                        except Exception as e:
                            logger.debug(f"Failed to send to socket: {e}")

    async def broadcast_all(self, event: dict):
        sent_sockets: Set[WebSocket] = set()
        for sockets in self.active_connections.values():
            for ws in list(sockets):
                if ws not in sent_sockets:
                    try:
                        await ws.send_text(json.dumps(event))
                        sent_sockets.add(ws)
                    except Exception:
                        pass


manager = ConnectionManager()


# ==============================================================================
# Helper functions to extract user identities
# ==============================================================================
def get_user_identifiers(user: Any) -> Dict[str, str]:
    """Extract primary ID, employee ID, email, role, and display name."""
    role = str(getattr(user, "role", "employee")).strip().lower()
    email = str(getattr(user, "email", "")).strip().lower()
    emp_id = str(getattr(user, "employee_id", None) or getattr(user, "employeeId", None) or "").strip()
    uid = str(getattr(user, "id", None) or getattr(user, "uid", None) or "").strip()
    name = (
        getattr(user, "full_name", None)
        or getattr(user, "fullName", None)
        or getattr(user, "name", None)
        or (email.split("@")[0].title() if email else "User")
    )

    primary_id = emp_id if emp_id else (uid if uid else email)
    if role == "admin" and not emp_id:
        primary_id = "ADM-001"

    return {
        "primary_id": primary_id,
        "employee_id": emp_id,
        "uid": uid,
        "email": email,
        "role": role,
        "name": name,
    }


def get_all_user_keys(identifiers: Dict[str, str]) -> List[str]:
    """Return all unique keys that represent this user in messaging."""
    keys = []
    for k in ["primary_id", "employee_id", "uid", "email", "name"]:
        val = identifiers.get(k)
        if val and str(val).strip():
            keys.append(str(val).strip().lower())
    if identifiers.get("role") == "admin":
        keys.extend(["admin", "adm-001", "administrator"])
    return list(set(keys))


def user_matches_target(identifiers: Dict[str, str], target: Any) -> bool:
    """Check if target string matches any of the user's keys."""
    if not target:
        return False
    target_norm = str(target).strip().lower()
    return target_norm in get_all_user_keys(identifiers)


def resolve_canonical_user_id(identifier: Any) -> str:
    """
    Resolves any user identifier (employee_id, email, doc ID, or admin alias)
    to a stable, uppercase canonical identifier in O(1) using the cached user directory:
    - Administrator -> 'ADM-001'
    - Employee -> official employee_id (e.g. 'AFI-9990', 'AFI-9999') or clean uppercase ID.
    """
    if not identifier:
        return ""
    clean = str(identifier).strip()
    norm = clean.lower()

    if norm in ["admin", "adm-001", "administrator", "admin@arshith.com", "system_admin", "ezvzfsphcqupkgvu18ldvi7xw9d2"]:
        return "ADM-001"

    try:
        directory = _build_user_directory()
        entry = directory.get("by_key", {}).get(norm)
        if entry:
            eid = str(entry.get("employee_id") or "").strip()
            if eid and not _is_looks_like_uid(eid):
                return eid.upper()
            if eid:
                return eid.upper()
    except Exception as e:
        logger.debug(f"Error resolving canonical user id for {identifier}: {e}")

    return clean.upper()


def resolve_employee_profile(identifier: Any) -> Optional[Dict[str, Any]]:
    """
    Looks up employee profile data (actual full name, profile photo, department, designation)
    from Firestore collections or database using any identifier
    (employee ID, user ID, email, or raw name).
    """
    if not identifier:
        return None

    clean = str(identifier).strip()
    norm = clean.lower()

    if norm in ["admin", "adm-001", "administrator", "admin@arshith.com", "system_admin", "ezvzfsphcqupkgvu18ldvi7xw9d2"]:
        return {
            "name": "Administrator",
            "employee_id": "ADM-001",
            "role": "admin",
            "profile_photo": None,
            "department": "Administration",
            "designation": "Executive Administration",
        }

    try:
        for collection_name, default_role, default_desig, default_dept in (
            ("employees", "employee", "Staff Member", "Operations"),
            ("team_leaders", "team_leader", "Team Leader", "Leadership"),
            ("users", "employee", "Staff Member", "Operations"),
            ("chat_users", "employee", "Team Member", "Operations"),
        ):
            docs = get_cached_collection(collection_name)
            for emp in docs:
                e_id = str(emp.get("employee_id") or emp.get("employeeId") or emp.get("leader_code") or "").strip().lower()
                e_doc_id = str(emp.get("id") or "").strip().lower()
                e_email = str(emp.get("email") or "").strip().lower()
                e_name = str(emp.get("full_name") or emp.get("name") or "").strip().lower()
                u_id = str(emp.get("user_id") or emp.get("uid") or emp.get("authUid") or "").strip().lower()

                if norm in [e_id, e_doc_id, e_email, e_name, u_id]:
                    real_name = emp.get("full_name") or emp.get("name") or clean
                    photo = emp.get("profile_photo") or emp.get("profilePhoto") or emp.get("photoUrl") or emp.get("photo_url")
                    return {
                        "name": real_name,
                        "employee_id": emp.get("employee_id") or emp.get("employeeId") or emp.get("leader_code") or emp.get("id") or e_id.upper(),
                        "role": str(emp.get("role") or default_role).lower(),
                        "profile_photo": photo,
                        "photo_url": photo,
                        "department": emp.get("department") or default_dept,
                        "designation": emp.get("designation") or default_desig,
                    }
    except Exception as e:
        logger.debug(f"Error looking up employee profile for {identifier}: {e}")

    # Fallback to PostgreSQL / SQLite database if present
    try:
        from app.db.session import SessionLocal
        from app.models.employee import Employee
        from sqlalchemy import or_
        with SessionLocal() as session:
            db_emp = session.query(Employee).filter(
                or_(
                    Employee.employee_id == clean,
                    Employee.email == norm,
                    Employee.full_name.ilike(clean)
                )
            ).first()
            if db_emp:
                return {
                    "name": db_emp.full_name,
                    "employee_id": db_emp.employee_id,
                    "role": "employee",
                    "profile_photo": db_emp.profile_photo,
                    "photo_url": db_emp.profile_photo,
                    "department": db_emp.department,
                    "designation": db_emp.designation,
                }
    except Exception:
        pass

    return None


def notify_profile_updated(user_id: str, emp_id: Optional[str] = None, photo_url: Optional[str] = None, name: Optional[str] = None):
    """Broadcasts user profile updates (including name and photo changes) over WebSocket to all clients."""
    payload = {
        "type": "user_profile_updated",
        "user_id": user_id,
        "employee_id": emp_id or user_id,
        "name": name,
        "profile_photo": photo_url,
        "photo_url": photo_url,
    }
    try:
        import asyncio
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.create_task(manager.broadcast_all(payload))
        else:
            loop.run_until_complete(manager.broadcast_all(payload))
    except Exception as e:
        logger.debug(f"Could not broadcast user_profile_updated: {e}")


def build_direct_conversation_id(user_a: Any, user_b: Any) -> str:
    """
    Constructs a deterministic, collision-proof conversation ID for two private participants.
    Alphabetically sorts the canonical IDs so that build_direct_conversation_id(A, B) == build_direct_conversation_id(B, A).
    """
    c1 = resolve_canonical_user_id(user_a)
    c2 = resolve_canonical_user_id(user_b)
    pair = sorted([c1, c2])
    return f"dm_{pair[0]}_{pair[1]}"


def get_message_conversation_id(msg: Dict[str, Any]) -> str:
    """
    Returns the persistent conversation ID for a message, computing it if not yet assigned.
    """
    cid = msg.get("conversation_id")
    if cid and str(cid).strip():
        return str(cid).strip()

    c_type = msg.get("chat_type", "direct")
    if c_type == "team":
        t_id = str(msg.get("team_id") or msg.get("target_id", "")).strip()
        return f"team_{t_id}"
    else:
        s_id = msg.get("sender_id", "")
        r_id = msg.get("receiver_id") or msg.get("target_id", "")
        return build_direct_conversation_id(s_id, r_id)


def _run_legacy_chat_migration() -> None:
    try:
        all_msgs = get_cached_collection("chat_messages")
        updated_any = False
        for msg in all_msgs:
            mid = str(msg.get("id") or "")
            if not mid:
                continue

            needs_update = False
            updates = {}

            c_type = msg.get("chat_type", "direct")
            if not msg.get("conversation_id"):
                cid = get_message_conversation_id(msg)
                updates["conversation_id"] = cid
                needs_update = True
            else:
                cid = str(msg.get("conversation_id")).strip()

            if not msg.get("participant_ids"):
                if c_type == "team":
                    t_id = str(msg.get("team_id") or msg.get("target_id", "")).strip()
                    updates["participant_ids"] = [t_id]
                else:
                    s_id = resolve_canonical_user_id(msg.get("sender_id", ""))
                    r_id = resolve_canonical_user_id(msg.get("receiver_id") or msg.get("target_id", ""))
                    updates["participant_ids"] = sorted([s_id, r_id])
                needs_update = True

            if needs_update:
                firestore_service.update_document("chat_messages", mid, updates)
                updated_any = True
        if updated_any:
            invalidate_chat_cache("chat_messages")
    except Exception as e:
        logger.warning(f"Error during legacy chat message migration: {e}")


def migrate_legacy_chat_messages():
    """
    Migrates any existing messages lacking explicit conversation_id or participant_ids
    in a background daemon thread so chat loading endpoints never block on startup.
    """
    global _last_legacy_migration_at
    now_mono = time.monotonic()
    if now_mono - _last_legacy_migration_at < _LEGACY_MIGRATION_COOLDOWN_SECONDS:
        return
    _last_legacy_migration_at = now_mono
    threading.Thread(target=_run_legacy_chat_migration, daemon=True).start()


# ==============================================================================
# Pydantic Schemas
# ==============================================================================
class MessageCreate(BaseModel):
    chat_type: str  # "direct" or "team"
    target_id: str  # recipient employee_id/email OR team_id
    conversation_id: Optional[str] = None
    content: str
    attachments: Optional[List[Dict[str, Any]]] = []
    reply_to: Optional[Dict[str, Any]] = None


class ReactionToggle(BaseModel):
    emoji: str


class MarkReadRequest(BaseModel):
    chat_type: str
    target_id: str
    conversation_id: Optional[str] = None


class MessageUpdate(BaseModel):
    content: str


class DirectConversationCreate(BaseModel):
    target_id: str


class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    member_ids: Optional[List[str]] = []


class GroupUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class MemberAction(BaseModel):
    user_id: str


class ConversationSettingsUpdate(BaseModel):
    conversation_id: str
    chat_type: Optional[str] = None
    target_id: Optional[str] = None
    pinned: Optional[bool] = None
    muted: Optional[bool] = None


class ClearConversationRequest(BaseModel):
    conversation_id: str
    chat_type: Optional[str] = None
    target_id: Optional[str] = None


class DeleteForMeRequest(BaseModel):
    conversation_id: str
    chat_type: Optional[str] = None
    target_id: Optional[str] = None


# ==============================================================================
# REST Endpoints
# ==============================================================================

@router.get("/contacts", response_model=List[Dict[str, Any]])
def get_contacts(current_user=Depends(get_current_user)):
    """
    List all available contacts for 1:1 direct chat and group creation, including
    all employees, team leaders, HR/staff users, mobile chat users, and admins.
    """
    my_ids = get_user_identifiers(current_user)
    my_keys = set(get_all_user_keys(my_ids))
    my_auth_uid = (resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or "").lower()
    if my_auth_uid:
        my_keys.add(my_auth_uid)

    contacts = []
    seen_keys: Set[str] = set()
    presence_map = get_presence_map()

    def _register_contact(
        c_id: str,
        emp_id: str,
        c_uid: str,
        name: str,
        email: str,
        role: str,
        department: str,
        designation: str,
        photo: Optional[str],
    ):
        identifiers = [k.lower() for k in (c_id, emp_id, c_uid, email) if k and str(k).strip()]
        if not identifiers:
            return
        if any(k in my_keys for k in identifiers):
            return
        if any(k in seen_keys for k in identifiers):
            return
        for k in identifiers:
            seen_keys.add(k)

        display_name = (name or (email.split("@")[0].title() if email else "Staff Member")).strip()
        disp_lower = display_name.lower()
        name_lower = (name or "").strip().lower()
        email_prefix = (email.split("@")[0] if email else "").strip().lower()
        id_lower = str(c_id or "").strip().lower()
        if (
            is_sample_chat_excluded(name)
            or is_sample_chat_excluded(display_name)
            or is_sample_chat_excluded(email_prefix)
            or is_sample_chat_excluded(c_id)
            or is_sample_chat_excluded(emp_id)
            or is_sample_chat_excluded(c_uid)
            or any(is_sample_chat_excluded(k) for k in identifiers)
        ):
            return

        is_online, last_seen, is_typing, typing_cid = _resolve_presence_tuple(
            [c_id, emp_id, c_uid, email], presence_map
        )
        contacts.append({
            "id": c_id,
            "employee_id": emp_id or c_id,
            "uid": c_uid,
            "name": display_name,
            "email": email,
            "role": role,
            "department": department,
            "designation": designation,
            "avatar": display_name[0].upper() if display_name else "E",
            "profile_photo": photo,
            "photo_url": photo,
            "is_online": is_online,
            "last_seen": last_seen,
            "is_typing": is_typing,
            "typing_conversation_id": typing_cid,
        })

    # 1. Administrator contact(s)
    admins = get_cached_collection("admins")
    admin_doc = admins[0] if admins else {}
    admin_uid = str(admin_doc.get("uid") or admin_doc.get("id") or "ezvZfsphCqUpkgvu18ldvi7XW9D2").strip()
    admin_email = str(admin_doc.get("email") or "admin@arshith.com").strip().lower()
    admin_photo = admin_doc.get("profile_photo") or admin_doc.get("photoUrl") or admin_doc.get("photo_url")
    if not my_keys.intersection({"adm-001", "admin@arshith.com", admin_uid.lower(), admin_email}):
        _register_contact(
            c_id="ADM-001",
            emp_id="ADM-001",
            c_uid=admin_uid,
            name="Administrator",
            email=admin_email,
            role="admin",
            department="Administration",
            designation="Executive Administration",
            photo=admin_photo,
        )
    for adm in admins[1:]:
        a_uid = str(adm.get("uid") or adm.get("id") or "").strip()
        a_email = str(adm.get("email") or "").strip().lower()
        a_name = adm.get("name") or adm.get("full_name") or "Administrator"
        _register_contact(
            c_id=a_uid or a_email,
            emp_id=str(adm.get("employee_id") or a_uid),
            c_uid=a_uid,
            name=a_name,
            email=a_email,
            role="admin",
            department="Administration",
            designation="Executive Administration",
            photo=adm.get("profile_photo") or adm.get("photoUrl") or adm.get("photo_url"),
        )

    # 2. Registered Employees
    for emp in get_cached_collection("employees"):
        doc_id = str(emp.get("id") or "").strip()
        e_id = str(emp.get("employee_id") or emp.get("employeeId") or doc_id).strip()
        e_email = str(emp.get("email") or "").strip().lower()
        e_name = emp.get("full_name") or emp.get("name") or ""
        e_uid = str(emp.get("uid") or emp.get("authUid") or emp.get("user_id") or "").strip()
        if not e_uid:
            e_uid = resolve_auth_uid(e_email or e_id or doc_id) or doc_id
        photo = emp.get("profile_photo") or emp.get("profilePhoto") or emp.get("photoUrl") or emp.get("photo_url")
        _register_contact(
            c_id=e_id or doc_id or e_email,
            emp_id=e_id or doc_id,
            c_uid=e_uid,
            name=e_name,
            email=e_email,
            role="employee",
            department=emp.get("department") or "Operations",
            designation=emp.get("designation") or "Staff Member",
            photo=photo,
        )

    # 3. Team Leaders
    for tl in get_cached_collection("team_leaders"):
        doc_id = str(tl.get("id") or "").strip()
        tl_id = str(tl.get("employee_id") or tl.get("leader_code") or doc_id).strip()
        tl_email = str(tl.get("email") or "").strip().lower()
        tl_uid = str(tl.get("uid") or tl.get("authUid") or resolve_auth_uid(tl_email or doc_id) or doc_id).strip()
        _register_contact(
            c_id=tl_id or doc_id or tl_email,
            emp_id=tl_id or doc_id,
            c_uid=tl_uid,
            name=tl.get("full_name") or tl.get("name") or "Team Leader",
            email=tl_email,
            role="team_leader",
            department=tl.get("department") or "Leadership",
            designation=tl.get("designation") or "Team Leader",
            photo=tl.get("profile_photo") or tl.get("photoUrl") or tl.get("photo_url"),
        )

    # 4. Platform Users (HR / Project HR Leads / Staff accounts)
    for usr in get_cached_collection("users"):
        doc_id = str(usr.get("id") or "").strip()
        u_email = str(usr.get("email") or "").strip().lower()
        u_id = str(usr.get("employee_id") or usr.get("employeeId") or doc_id).strip()
        u_uid = str(usr.get("uid") or usr.get("authUid") or resolve_auth_uid(u_email or doc_id) or doc_id).strip()
        u_role = str(usr.get("role") or "employee").strip().lower()
        if u_role == "admin":
            continue
        _register_contact(
            c_id=u_id or doc_id or u_email,
            emp_id=u_id or doc_id,
            c_uid=u_uid,
            name=usr.get("full_name") or usr.get("name") or "",
            email=u_email,
            role=u_role,
            department=usr.get("department") or "Operations",
            designation=usr.get("designation") or u_role.replace("_", " ").title(),
            photo=usr.get("profile_photo") or usr.get("photoUrl") or usr.get("photo_url"),
        )

    # 5. Any remaining mobile `chat_users` not present above
    for cu in get_cached_collection("chat_users"):
        cu_uid = str(cu.get("uid") or cu.get("id") or "").strip()
        cu_email = str(cu.get("email") or "").strip().lower()
        cu_eid = str(cu.get("employeeId") or cu.get("employee_id") or cu_uid).strip()
        if cu_email == admin_email or cu_uid == admin_uid:
            continue
        _register_contact(
            c_id=cu_eid or cu_uid or cu_email,
            emp_id=cu_eid or cu_uid,
            c_uid=cu_uid,
            name=cu.get("name") or "",
            email=cu_email,
            role=str(cu.get("role") or "employee").strip().lower(),
            department=cu.get("department") or "Operations",
            designation=cu.get("designation") or "Team Member",
            photo=cu.get("photoUrl") or cu.get("photo_url"),
        )

    contacts.sort(key=lambda c: (c["role"] != "admin", c["name"].lower()))
    return contacts


@router.get("/presence", response_model=Dict[str, Dict[str, Any]])
def get_chat_presence(current_user=Depends(get_current_user)):
    """Fast live presence snapshot (online, last_seen, typing) keyed by user ID/UID."""
    contacts = get_contacts(current_user)
    presence_by_key: Dict[str, Dict[str, Any]] = {}
    for c in contacts:
        payload = {
            "is_online": bool(c.get("is_online")),
            "last_seen": str(c.get("last_seen") or ""),
            "is_typing": bool(c.get("is_typing")),
            "typing_conversation_id": str(c.get("typing_conversation_id") or ""),
        }
        for key in (c.get("id"), c.get("employee_id"), c.get("uid"), c.get("email")):
            if key:
                presence_by_key[str(key).strip().lower()] = payload
    return presence_by_key


def _is_protected_general_group(name: str) -> bool:
    """Protect the core company-wide general channel from accidental deletion."""
    low = str(name or "").strip().lower()
    return "general" in low or "all company" in low


def _can_user_delete_group(
    source: Dict[str, Any],
    name: str,
    my_ids: Dict[str, str],
    my_keys: Set[str],
    my_auth_uid: str = "",
) -> bool:
    """Return True only if the user is the group creator, leader, or group admin for a non-general group."""
    if _is_protected_general_group(name):
        return False
    auth_low = str(my_auth_uid or "").strip().lower()
    candidate_refs = [
        source.get("createdBy"),
        source.get("created_by"),
        source.get("leader_id"),
        source.get("leader"),
    ]
    admin_list = list(source.get("groupAdmins") or []) + list(source.get("adminIds") or [])
    candidate_refs.extend(admin_list)
    for ref in candidate_refs:
        r_str = str(ref or "").strip().lower()
        if not r_str:
            continue
        if r_str in my_keys or (auth_low and r_str == auth_low):
            return True
    return False


def _user_can_access_team_doc(
    team_doc: Dict[str, Any],
    my_keys: set,
    my_name: str,
    my_emp_id: str,
    my_email: str,
    my_auth_uid: str,
    is_privileged: bool = False,
    resolved_members: Optional[List[str]] = None,
) -> bool:
    """Return True only if the user is an explicit member/creator/admin of the group or it is company-wide General."""
    t_name = str(
        team_doc.get("name")
        or team_doc.get("teamName")
        or team_doc.get("groupName")
        or team_doc.get("title")
        or "Team"
    )
    if "general" in t_name.lower() or "all company" in t_name.lower():
        return True

    exact_refs = {k for k in my_keys if k}
    for extra in (my_name, my_emp_id, my_email, my_auth_uid):
        if extra and str(extra).strip():
            exact_refs.add(str(extra).strip().lower())

    members = resolved_members if resolved_members is not None else (
        team_doc.get("members") if isinstance(team_doc.get("members"), list) else []
    )
    for m in members:
        m_str = str(m).strip().lower()
        if m_str and m_str in exact_refs:
            return True

    for id_field in ("memberIds", "groupAdmins", "adminIds"):
        id_list = team_doc.get(id_field, [])
        if isinstance(id_list, list):
            for mid in id_list:
                mid_low = str(mid).strip().lower()
                if mid_low and mid_low in exact_refs:
                    return True

    leader_refs = [
        team_doc.get("leader"),
        team_doc.get("leader_id"),
        team_doc.get("leaderEmail"),
        team_doc.get("created_by"),
        team_doc.get("createdBy"),
    ]
    for ref in leader_refs:
        ref_s = str(ref or "").strip().lower()
        if ref_s and ref_s in exact_refs:
            return True
    return False


def _collect_team_member_keys(team_doc: Optional[Dict[str, Any]]) -> List[str]:
    """Collect normalized WebSocket lookup keys for all members/creators/admins of a group."""
    if not team_doc:
        return []
    raw_refs: List[str] = []
    for field in ("members", "memberIds", "groupAdmins", "adminIds"):
        vals = team_doc.get(field)
        if isinstance(vals, list):
            raw_refs.extend(str(v).strip() for v in vals if v)
    for field in ("leader", "leader_id", "leaderEmail", "created_by", "createdBy"):
        val = team_doc.get(field)
        if val:
            raw_refs.append(str(val).strip())

    keys: Set[str] = set()
    for ref in raw_refs:
        low = ref.lower()
        if low:
            keys.add(low)
        canon = resolve_canonical_user_id(ref)
        if canon:
            keys.add(canon.lower())
        uid = resolve_auth_uid(ref)
        if uid:
            keys.add(uid.lower())
    return list(keys)


async def _broadcast_team_event(team_doc: Optional[Dict[str, Any]], team_name: str, event: Dict[str, Any]) -> None:
    """Broadcast general channel events globally, and custom/private group events strictly to members."""
    name_l = (team_name or "").lower()
    if "general" in name_l or "all company" in name_l:
        await manager.broadcast_all(event)
        return
    keys = _collect_team_member_keys(team_doc)
    if keys:
        await manager.broadcast_to_keys(keys, event)


def _is_chat_team(t: Optional[Dict[str, Any]]) -> bool:
    """Return False for Project HR Team Management teams that must not appear/sync in Teams Chat."""
    if not isinstance(t, dict) or t.get("active") is False:
        return False
    if t.get("sync_to_chat") is False:
        return False
    if str(t.get("team_scope") or "").strip().lower() == "project_hr":
        return False
    if str(t.get("created_by") or "").strip().upper() == "HR-PRJ-001" and not t.get("is_custom_group"):
        return False
    return True


@router.get("/teams", response_model=List[Dict[str, Any]])
def get_teams_for_chat(current_user=Depends(get_current_user)):
    """
    List all teams accessible to the user for team channels.
    Admins/HR have access to all teams; employees and team leaders have access
    to teams they belong to or lead plus company-wide general channels.
    """
    warm_chat_collections_parallel(["teams", "chat_deleted_groups", "employees", "team_leaders", "users", "chat_users"])

    my_ids = get_user_identifiers(current_user)
    my_keys = set(get_all_user_keys(my_ids))
    is_admin = my_ids["role"] == "admin"
    is_privileged = my_ids["role"] in ["admin", "hr", "project_hr_lead"]
    my_name = my_ids["name"].strip().lower()
    my_emp_id = my_ids["employee_id"].strip().lower()
    my_email = my_ids["email"].strip().lower()

    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_email) or ""
    if my_auth_uid:
        my_keys.add(my_auth_uid.lower())

    deleted_keys = get_deleted_group_keys()
    all_teams = get_cached_collection("teams")
    accessible_teams = []

    for t in all_teams:
        if not _is_chat_team(t):
            continue
        t_id = str(t.get("id") or "").strip()
        if not t_id:
            continue
        t_name = t.get("name") or t.get("teamName") or "Team"
        t_conv_id = str(t.get("conversation_id") or "").strip() or f"team_{t_id}"
        if deleted_keys and _expand_group_keys(t_id, t.get("team_id"), t_conv_id).intersection(deleted_keys):
            continue
        members = t.get("members", [])
        if not isinstance(members, list):
            members = []
        else:
            members = list(members)
        member_ids = t.get("memberIds", [])
        if not isinstance(member_ids, list):
            member_ids = []

        # If members list is empty, resolve display names in O(1) from memberIds
        if not members and member_ids:
            for mid in member_ids:
                u_info = get_user_display_info(mid)
                members.append(u_info["name"])

        if _user_can_access_team_doc(t, my_keys, my_name, my_emp_id, my_email, my_auth_uid, is_privileged, members):
            accessible_teams.append({
                "id": t_id,
                "conversation_id": t_conv_id,
                "name": t_name,
                "department": t.get("department", "Company"),
                "description": t.get("description", ""),
                "leader": t.get("leader", "Administrator"),
                "members": members,
                "member_ids": member_ids,
                "member_count": max(len(members), len(member_ids)),
                "is_admin": is_admin,
                "is_custom_group": bool(t.get("is_custom_group", False)),
                "created_by": t.get("created_by") or t.get("createdBy") or "",
                "created_by_uid": t.get("createdBy") or "",
                "can_delete": _can_user_delete_group(t, t_name, my_ids, my_keys, my_auth_uid),
                "created_at": t.get("created_at") or t.get("createdAt") or "",
            })

    # Include mobile-only group conversations (`chat_conversations`/`conversations`) not in `teams`
    try:
        known_team_keys = set()
        for at in accessible_teams:
            known_team_keys.add(str(at["id"]).lower())
            known_team_keys.add(str(at["conversation_id"]).lower())
            known_team_keys.add(f"team_{at['id']}".lower())
        for mc in fetch_live_mobile_conversations(my_auth_uid or None, is_admin=False):
            if mc.get("type") != "team":
                continue
            mc_cid = str(mc.get("conversation_id") or "").strip()
            mc_tid = str(mc.get("team_id") or "").strip()
            if deleted_keys and _expand_group_keys(mc_cid, mc_tid).intersection(deleted_keys):
                continue
            clean_cid = mc_cid[5:] if mc_cid.startswith("team_") else mc_cid
            if any(k.lower() in known_team_keys for k in (mc_cid, clean_cid, mc_tid) if k):
                continue
            m_uids = [str(u).strip() for u in (mc.get("member_ids") or []) if u]
            m_names = [get_user_display_info(u)["name"] for u in m_uids]
            creator_name = get_user_display_info(mc.get("created_by") or "")["name"] if mc.get("created_by") else "Group Admin"
            mc_title = mc.get("title") or "Group Chat"
            accessible_teams.append({
                "id": mc_cid,
                "conversation_id": mc_cid,
                "name": mc_title,
                "department": "Mobile Group",
                "description": "",
                "leader": creator_name,
                "members": m_names,
                "member_ids": m_uids,
                "member_count": len(m_uids),
                "is_admin": is_admin,
                "is_custom_group": True,
                "created_by": mc.get("created_by") or "",
                "created_by_uid": mc.get("created_by") or "",
                "can_delete": _can_user_delete_group(
                    {"createdBy": mc.get("created_by") or "", "groupAdmins": mc.get("group_admins") or []},
                    mc_title,
                    my_ids,
                    my_keys,
                    my_auth_uid,
                ),
                "created_at": mc.get("last_message_at") or "",
            })
            known_team_keys.add(mc_cid.lower())
    except Exception as e:
        logger.debug(f"[ChatSync] Failed to merge mobile-only groups in get_teams_for_chat: {e}")

    accessible_teams.sort(key=lambda x: (not ("general" in x["name"].lower()), x["name"].lower()))
    return accessible_teams


def _parse_utc_dt(val: Any) -> Optional[datetime]:
    """Parse datetime, Firestore Timestamp, or ISO string into timezone-aware UTC datetime."""
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    if hasattr(val, "to_datetime"):
        try:
            dt = val.to_datetime()
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except Exception:
            pass
    if isinstance(val, dict) and "timestampValue" in val:
        val = val["timestampValue"]
    try:
        s = str(val).strip()
        if not s:
            return None
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    except Exception:
        return None


def _resolve_user_uid_key(my_ids: Dict[str, Any], fallback: str = "") -> str:
    """Resolve the current user's Firebase Auth UID (fallback to canonical ID)."""
    for src in (my_ids.get("uid"), my_ids.get("primary_id"), my_ids.get("email")):
        if src:
            resolved = resolve_auth_uid(src)
            if resolved and _is_looks_like_uid(resolved):
                return resolved
    return (
        my_ids.get("uid")
        or resolve_auth_uid(my_ids.get("primary_id"))
        or resolve_auth_uid(my_ids.get("email"))
        or fallback
        or ""
    )


def _resolve_user_conv_targets(
    my_ids: Dict[str, Any],
    my_canonical: str,
    conversation_id: str,
    chat_type: Optional[str] = None,
    target_id: Optional[str] = None,
) -> Tuple[str, List[str], List[str]]:
    """Resolve (uid_key, read_candidates, write_doc_ids) across website and mobile conversation IDs."""
    my_auth_uid = _resolve_user_uid_key(my_ids, my_canonical)
    uid_key = my_auth_uid or my_canonical or my_ids.get("email") or ""
    if not uid_key:
        raise HTTPException(status_code=400, detail="Unable to resolve user identity for conversation settings.")
    cid = str(conversation_id or "").strip()
    tid = str(target_id or "").strip()
    is_direct = (chat_type == "direct") or cid.startswith(("dm_", "direct_"))

    candidates: List[str] = []
    if cid:
        candidates.append(cid)

    write_ids: List[str] = []

    if is_direct:
        other_uid = resolve_auth_uid(tid) if tid else None
        other_canon = resolve_canonical_user_id(tid) if tid else ""
        if not other_uid and cid.startswith(("dm_", "direct_")):
            parts = cid.split("_", 2)
            if len(parts) >= 3:
                for p in parts[1:3]:
                    p_canon = resolve_canonical_user_id(p)
                    p_uid = resolve_auth_uid(p)
                    if p_canon != my_canonical and p_uid != my_auth_uid:
                        other_uid = other_uid or p_uid
                        other_canon = other_canon or p_canon
        if my_auth_uid and other_uid:
            du = sorted([my_auth_uid, other_uid])
            for m_id in (f"direct_{du[0]}_{du[1]}", f"{du[0]}_{du[1]}"):
                if m_id not in candidates:
                    candidates.append(m_id)
            if rest_get_document(f"chat_conversations/{du[0]}_{du[1]}"):
                write_ids.append(f"{du[0]}_{du[1]}")
            else:
                write_ids.append(f"direct_{du[0]}_{du[1]}")
        if other_canon:
            dm_cid = build_direct_conversation_id(my_canonical, other_canon)
            if dm_cid not in candidates:
                candidates.append(dm_cid)
        if cid and cid not in write_ids:
            write_ids.append(cid)
    else:
        norm_tid = tid.replace("team_", "") if tid else cid.replace("team_", "")
        matched_team = None
        for t in get_cached_collection("teams"):
            if not _is_chat_team(t):
                continue
            t_id = str(t.get("id") or "").strip()
            t_cid = str(t.get("conversation_id") or "").strip()
            if (norm_tid and t_id.lower() == norm_tid.lower()) or (cid and t_cid.lower() == cid.lower()):
                matched_team = t
                break
        if matched_team:
            mt_id = str(matched_team.get("id") or "").strip()
            mt_cid = str(matched_team.get("conversation_id") or "").strip()
            for val in (mt_cid, f"team_{mt_id}", mt_id):
                if val and val not in candidates:
                    candidates.append(val)
            primary_team_cid = mt_cid or f"team_{mt_id}"
            write_ids.append(primary_team_cid)
        else:
            if norm_tid:
                for val in (f"team_{norm_tid}", norm_tid):
                    if val not in candidates:
                        candidates.append(val)
            if cid:
                write_ids.append(cid)

    dedup_write = list(dict.fromkeys([w for w in write_ids if w]))
    dedup_read = list(dict.fromkeys([c for c in candidates if c]))
    return uid_key, dedup_read, (dedup_write or dedup_read)


_user_state_lock = threading.Lock()
_user_state_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, Dict[str, Any]], Dict[str, datetime]]] = {}
_USER_STATE_TTL_SECONDS = 10.0


def _invalidate_user_state_cache(uid_key: str = "") -> None:
    with _user_state_lock:
        if not uid_key:
            _user_state_cache.clear()
        else:
            lk = uid_key.strip().lower()
            for ck in [k for k in _user_state_cache if lk in (k[0].lower(), k[1].lower())]:
                _user_state_cache.pop(ck, None)


def _load_user_chat_state(uid_key: str, fallback_canon: str = "") -> Tuple[Dict[str, Dict[str, Any]], Dict[str, datetime]]:
    """Fetch per-user pin/mute settings (`chat_user_inbox`) and clear timestamps (`chat_user_cleared`) concurrently with a 10s cache."""
    norm_pair = (str(uid_key or "").strip(), str(fallback_canon or "").strip())
    now = time.monotonic()
    with _user_state_lock:
        cached = _user_state_cache.get(norm_pair)
        if cached is not None and (now - cached[0]) < _USER_STATE_TTL_SECONDS:
            return dict(cached[1]), dict(cached[2])

    inbox_map: Dict[str, Dict[str, Any]] = {}
    cleared_map: Dict[str, datetime] = {}

    keys_to_check = [k for k in dict.fromkeys([uid_key, fallback_canon]) if k]
    if is_firebase_live():
        tasks = []
        for k in keys_to_check:
            tasks.append(("inbox", f"chat_user_inbox/{k}/items"))
            tasks.append(("cleared", f"chat_user_cleared/{k}/conversations"))
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(4, max(1, len(tasks)))) as pool:
            fut_map = {pool.submit(rest_fetch_subcollection, path, 200): kind for kind, path in tasks}
            for fut in concurrent.futures.as_completed(fut_map):
                kind = fut_map[fut]
                try:
                    items = fut.result() or []
                except Exception:
                    items = []
                for item in items:
                    doc_id = str(item.get("id") or "").strip().lower()
                    if not doc_id:
                        continue
                    if kind == "inbox":
                        if doc_id not in inbox_map:
                            inbox_map[doc_id] = item
                    else:
                        dt = _parse_utc_dt(item.get("clearedAt"))
                        if dt and (doc_id not in cleared_map or dt > cleared_map[doc_id]):
                            cleared_map[doc_id] = dt
    else:
        norm_keys = {k.lower() for k in keys_to_check}
        for row in firestore_service.list_documents("chat_user_inbox"):
            if str(row.get("user_id") or "").lower() in norm_keys:
                cid_k = str(row.get("conversation_id") or "").strip().lower()
                if cid_k:
                    inbox_map[cid_k] = row
        for row in firestore_service.list_documents("chat_user_cleared"):
            if str(row.get("user_id") or "").lower() in norm_keys:
                cid_k = str(row.get("conversation_id") or "").strip().lower()
                dt = _parse_utc_dt(row.get("clearedAt"))
                if cid_k and dt and (cid_k not in cleared_map or dt > cleared_map[cid_k]):
                    cleared_map[cid_k] = dt

    with _user_state_lock:
        _user_state_cache[norm_pair] = (time.monotonic(), dict(inbox_map), dict(cleared_map))
    return inbox_map, cleared_map


def _apply_user_conv_state(
    conv: Dict[str, Any],
    candidates: List[str],
    inbox_map: Dict[str, Dict[str, Any]],
    cleared_map: Dict[str, datetime],
) -> None:
    """Apply saved pinned/muted flags, deletedForMe hiding, and clearedAt masking to a conversation dict in place."""
    norm_cands = [str(c).strip().lower() for c in candidates if c]
    matched_inbox = next((inbox_map[k] for k in norm_cands if k in inbox_map), None)
    if matched_inbox is not None:
        if "pinned" in matched_inbox and matched_inbox["pinned"] is not None:
            conv["is_pinned"] = bool(matched_inbox["pinned"])
        conv["is_muted"] = bool(matched_inbox.get("muted", False))
        if bool(matched_inbox.get("deletedForMe") or matched_inbox.get("deleted_for_me")):
            conv["deleted_for_me"] = True
    else:
        conv.setdefault("is_muted", False)

    cleared_dts = [cleared_map[k] for k in norm_cands if k in cleared_map]
    if cleared_dts:
        latest_clear = max(cleared_dts)
        conv["cleared_at"] = latest_clear.isoformat()
        last_dt = _parse_utc_dt(conv.get("last_message_at"))
        if last_dt is None or last_dt <= latest_clear:
            conv["last_message"] = "No messages yet" if conv.get("type") == "team" else "Start a conversation"
            conv["last_message_sender"] = ""
            conv["unread_count"] = 0


def _upsert_local_user_doc(collection: str, rec_id: str, payload: Dict[str, Any]) -> None:
    if firestore_service.get_document(collection, rec_id):
        firestore_service.update_document(collection, rec_id, payload)
    else:
        firestore_service.create_document(collection, {"id": rec_id, **payload})


def _persist_user_inbox_pref(uid_key: str, write_ids: List[str], updates: Dict[str, Any]) -> None:
    """Persist pinned/muted preferences to Firestore (`chat_user_inbox/{uid}/items/{cid}`) or local fallback."""
    if is_firebase_live():
        merge_keys = list(updates.keys())
        for cid in write_ids:
            rest_patch_document(f"chat_user_inbox/{uid_key}/items/{cid}", updates, merge_fields=merge_keys)
    else:
        for cid in write_ids:
            rec_id = f"{uid_key}__{cid}"
            payload = {
                "user_id": uid_key,
                "conversation_id": cid,
                **{k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in updates.items()},
            }
            _upsert_local_user_doc("chat_user_inbox", rec_id, payload)
    _invalidate_user_state_cache(uid_key)


def _persist_user_cleared_at(uid_key: str, write_ids: List[str], now_dt: datetime) -> None:
    """Persist per-user clear timestamp (`chat_user_cleared/{uid}/conversations/{cid}`) compatible with Android."""
    if is_firebase_live():
        for cid in write_ids:
            rest_patch_document(
                f"chat_user_cleared/{uid_key}/conversations/{cid}",
                {"clearedAt": now_dt},
                merge_fields=["clearedAt"],
            )
    else:
        iso = now_dt.isoformat()
        for cid in write_ids:
            rec_id = f"{uid_key}__{cid}"
            _upsert_local_user_doc("chat_user_cleared", rec_id, {
                "user_id": uid_key,
                "conversation_id": cid,
                "clearedAt": iso,
            })
    _invalidate_user_state_cache(uid_key)


@router.get("/conversations", response_model=List[Dict[str, Any]])
def get_conversations(current_user=Depends(get_current_user)):
    """
    Returns an aggregated list of conversations (Direct chats and Team channels)
    for the current user, complete with latest message preview, unread counts, and timestamps.
    Every private conversation has a unique canonical conversation_id (e.g. dm_ADM-001_AFI-9990).
    """
    warm_chat_collections_parallel([
        "chat_messages",
        "teams",
        "admins",
        "employees",
        "users",
        "team_leaders",
        "chat_users",
        "chat_deleted_groups",
    ])
    migrate_legacy_chat_messages()
    trigger_background_bidirectional_sync(max_age_seconds=30)

    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    my_keys = set(get_all_user_keys(my_ids))
    is_admin = my_ids["role"] == "admin"
    my_uid_resolved = _resolve_user_uid_key(my_ids, my_canonical)
    uid_key = my_uid_resolved or my_canonical

    _state_pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    user_state_future = _state_pool.submit(_load_user_chat_state, uid_key, my_canonical)
    _state_pool.shutdown(wait=False)

    # 1. Fetch all chat messages
    messages = list(get_cached_collection("chat_messages"))
    messages.sort(key=lambda m: str(m.get("created_at", "")), reverse=True)

    # 2. Fetch accessible teams
    accessible_teams = get_teams_for_chat(current_user)
    conversations_dict: Dict[str, Dict[str, Any]] = {}
    team_key_to_cid: Dict[str, str] = {}
    team_name_to_cid: Dict[str, str] = {}

    # Seed all accessible teams as conversation channels using exact mobile-linked conversation_id when present
    for t in accessible_teams:
        cid = str(t.get("conversation_id") or f"team_{t['id']}").strip()
        conversations_dict[cid] = {
            "conversation_id": cid,
            "type": "team",
            "target_id": str(t["id"]),
            "title": t["name"],
            "subtitle": f"{t.get('department', 'Company')} • {t.get('member_count', 0)} members",
            "avatar": "#",
            "profile_photo": None,
            "photo_url": None,
            "leader": t.get("leader"),
            "created_by": t.get("created_by") or "",
            "created_by_uid": t.get("created_by_uid") or "",
            "can_delete": bool(t.get("can_delete", False)),
            "last_message": "No messages yet",
            "last_message_sender": "",
            "last_message_at": t.get("created_at") or "",
            "unread_count": 0,
            "is_pinned": "general" in t["name"].lower(),
            "is_online": False,
        }
        team_key_to_cid[cid.lower()] = cid
        team_key_to_cid[str(t["id"]).lower()] = cid
        team_key_to_cid[f"team_{t['id']}".lower()] = cid
        if cid.startswith("team_"):
            team_key_to_cid[cid[5:].lower()] = cid
        team_name_to_cid[str(t["name"]).strip().lower()] = cid

    # Track direct conversations keyed strictly by canonical conversation_id
    direct_conversations: Dict[str, Dict[str, Any]] = {}

    for msg in messages:
        c_type = msg.get("chat_type", "direct")
        sender_id = str(msg.get("sender_id", "")).strip().lower()
        read_by = msg.get("read_by", [])
        if not isinstance(read_by, list):
            read_by = []
        read_by_norm = {str(r).strip().lower() for r in read_by}
        is_unread = not bool(my_keys.intersection(read_by_norm))

        if c_type == "team":
            msg_cid_val = str(msg.get("conversation_id") or "").strip().lower()
            t_id_val = str(msg.get("team_id") or msg.get("target_id", "")).strip().lower()
            t_name_val = str(msg.get("team_name", "")).strip().lower()
            matched_cid = (
                team_key_to_cid.get(msg_cid_val)
                or team_key_to_cid.get(t_id_val)
                or (team_name_to_cid.get(t_name_val) if not msg_cid_val and not t_id_val else None)
            )

            if matched_cid and matched_cid in conversations_dict:
                conv = conversations_dict[matched_cid]
                if conv["last_message"] == "No messages yet":
                    conv["last_message"] = msg.get("content", "") or ("Shared an attachment" if msg.get("attachments") else "")
                    conv["last_message_sender"] = msg.get("sender_name", "")
                    conv["last_message_at"] = msg.get("created_at", "")
                if is_unread and sender_id not in my_keys:
                    conv["unread_count"] += 1

        elif c_type == "direct":
            # Canonical direct chat participant resolution
            s_canon = resolve_canonical_user_id(msg.get("sender_id", ""))
            r_canon = resolve_canonical_user_id(msg.get("receiver_id") or msg.get("target_id", ""))
            participants = {s_canon, r_canon}

            # Only process if current user is an authorized participant
            user_in_chat = (my_canonical in participants) or (s_canon.lower() in my_keys) or (r_canon.lower() in my_keys)
            if not user_in_chat:
                continue

            other_canon = r_canon if (my_canonical == s_canon or s_canon.lower() in my_keys) else s_canon
            if (
                is_sample_chat_excluded(other_canon)
                or is_sample_chat_excluded(msg.get("sender_id"))
                or is_sample_chat_excluded(msg.get("receiver_id"))
                or is_sample_chat_excluded(msg.get("target_id"))
                or is_sample_chat_excluded(s_canon)
                or is_sample_chat_excluded(r_canon)
            ):
                continue
            cid = build_direct_conversation_id(my_canonical, other_canon)
            if is_sample_chat_excluded(cid):
                continue

            if cid not in direct_conversations:
                sender_is_me = (my_canonical == s_canon or s_canon.lower() in my_keys)
                emp_profile = resolve_employee_profile(other_canon)
                display_title = (emp_profile.get("name") if emp_profile else None) or (msg.get("sender_name") if not sender_is_me else msg.get("receiver_name")) or other_canon
                if is_sample_chat_excluded(display_title):
                    continue
                photo = emp_profile.get("profile_photo") if emp_profile else None

                direct_conversations[cid] = {
                    "conversation_id": cid,
                    "type": "direct",
                    "target_id": other_canon,
                    "title": display_title,
                    "subtitle": (f"{emp_profile.get('designation', 'Staff')} • {emp_profile.get('department', 'Company')}" if emp_profile else "Direct Chat"),
                    "avatar": display_title[0].upper() if display_title else "U",
                    "profile_photo": photo,
                    "photo_url": photo,
                    "last_message": msg.get("content", "") or ("Shared an attachment" if msg.get("attachments") else ""),
                    "last_message_sender": msg.get("sender_name", ""),
                    "last_message_at": msg.get("created_at", ""),
                    "unread_count": 0,
                    "is_pinned": False,
                    "is_online": manager.is_user_online(other_canon),
                }

            if is_unread and sender_id not in my_keys:
                direct_conversations[cid]["unread_count"] += 1

    # Merge live conversations the current user participates in from Cloud Firestore mobile collections
    try:
        my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"])
        mobile_convs = fetch_live_mobile_conversations(my_auth_uid, is_admin=False)
        for mc in mobile_convs:
            mc_cid = str(mc.get("conversation_id") or "")
            mc_type = mc.get("type", "direct")
            mc_last_at = str(mc.get("last_message_at") or "")
            mc_last_msg = mc.get("last_message") or ""
            mc_unread = int((mc.get("unread_counts") or {}).get(my_auth_uid or "", 0) or 0)
            mc_sender = mc.get("last_sender_id") or ""
            sender_display = get_user_display_info(mc_sender)["name"] if mc_sender else ""

            if mc_type == "team":
                clean_tid = mc_cid[5:] if mc_cid.startswith("team_") else mc_cid
                mc_team_id = str(mc.get("team_id") or "").strip().lower()
                matched_cid = (
                    team_key_to_cid.get(mc_cid.lower())
                    or team_key_to_cid.get(clean_tid.lower())
                    or (team_key_to_cid.get(mc_team_id) if mc_team_id else None)
                )
                if matched_cid and matched_cid in conversations_dict:
                    conv = conversations_dict[matched_cid]
                    if mc_last_msg and (conv["last_message"] == "No messages yet" or mc_last_at > str(conv.get("last_message_at") or "")):
                        conv["last_message"] = mc_last_msg
                        conv["last_message_sender"] = sender_display
                        conv["last_message_at"] = mc_last_at
                    elif not conv.get("last_message_at") and mc_last_at:
                        conv["last_message_at"] = mc_last_at
                    conv["unread_count"] = max(int(conv.get("unread_count", 0)), mc_unread)
                else:
                    # Mobile-created group conversation not in `teams`
                    mc_title = mc.get("title") or "Group Chat"
                    if is_group_deleted(mc_cid, mc_team_id):
                        continue
                    conversations_dict[mc_cid] = {
                        "conversation_id": mc_cid,
                        "type": "team",
                        "target_id": mc_cid,
                        "title": mc_title,
                        "subtitle": f"Group • {len(mc.get('member_ids') or [])} members",
                        "avatar": "#",
                        "profile_photo": None,
                        "photo_url": None,
                        "leader": "Group",
                        "created_by": mc.get("created_by") or "",
                        "created_by_uid": mc.get("created_by") or "",
                        "can_delete": _can_user_delete_group(
                            {"createdBy": mc.get("created_by") or ""},
                            mc_title,
                            my_ids,
                            my_keys,
                            my_auth_uid or "",
                        ),
                        "last_message": mc_last_msg or "No messages yet",
                        "last_message_sender": sender_display,
                        "last_message_at": mc_last_at,
                        "unread_count": mc_unread,
                        "is_pinned": False,
                        "is_online": False,
                    }
            else:
                m_uids = [str(u).strip() for u in (mc.get("member_ids") or []) if u]
                m_canons = {resolve_canonical_user_id(u) for u in m_uids}
                is_participant = (
                    (my_auth_uid and my_auth_uid in m_uids)
                    or (my_canonical in m_canons)
                    or any(u.lower() in my_keys for u in m_uids)
                )
                if not is_participant:
                    continue
                other_uid = next(
                    (
                        u for u in m_uids
                        if u != my_auth_uid
                        and resolve_canonical_user_id(u) != my_canonical
                        and u.lower() not in my_keys
                    ),
                    None,
                )
                if not other_uid:
                    continue
                other_canon = resolve_canonical_user_id(other_uid)
                if other_canon == my_canonical:
                    continue
                if (
                    is_sample_chat_excluded(other_uid)
                    or is_sample_chat_excluded(other_canon)
                    or is_sample_chat_excluded(mc_cid)
                    or any(is_sample_chat_excluded(u) for u in m_uids)
                ):
                    continue
                d_cid = build_direct_conversation_id(my_canonical, other_canon)
                if is_sample_chat_excluded(d_cid):
                    continue
                if d_cid in direct_conversations:
                    d_conv = direct_conversations[d_cid]
                    if mc_last_msg and mc_last_at > str(d_conv.get("last_message_at") or ""):
                        d_conv["last_message"] = mc_last_msg
                        d_conv["last_message_sender"] = sender_display
                        d_conv["last_message_at"] = mc_last_at
                    d_conv["unread_count"] = max(int(d_conv.get("unread_count", 0)), mc_unread)
                else:
                    emp_profile = resolve_employee_profile(other_canon) or resolve_employee_profile(other_uid)
                    u_info = get_user_display_info(other_uid)
                    if not emp_profile and not u_info.get("name"):
                        # Never display raw unresolvable test UIDs as conversations
                        continue
                    display_title = (emp_profile.get("name") if emp_profile else None) or u_info.get("name") or other_canon
                    if is_sample_chat_excluded(display_title):
                        continue
                    photo = (emp_profile.get("profile_photo") if emp_profile else None) or (u_info.get("photo_url") or None)
                    direct_conversations[d_cid] = {
                        "conversation_id": d_cid,
                        "type": "direct",
                        "target_id": other_canon,
                        "title": display_title,
                        "subtitle": (f"{emp_profile.get('designation', 'Staff')} • {emp_profile.get('department', 'Company')}" if emp_profile else "Direct Chat"),
                        "avatar": display_title[0].upper() if display_title else "U",
                        "profile_photo": photo,
                        "photo_url": photo,
                        "last_message": mc_last_msg or "Start a conversation",
                        "last_message_sender": sender_display,
                        "last_message_at": mc_last_at,
                        "unread_count": mc_unread,
                        "is_pinned": False,
                        "is_online": manager.is_user_online(other_canon),
                    }
    except Exception as e:
        logger.debug(f"[ChatSync] Failed to merge live mobile conversations: {e}")

    # Enrich direct conversations with real contact details and live presence
    all_contacts = get_contacts(current_user)
    presence_map = get_presence_map()
    contact_lookup: Dict[str, Dict[str, Any]] = {}
    for c in all_contacts:
        for k in [c.get("id"), c.get("employee_id"), c.get("uid"), c.get("email"), c.get("name")]:
            if k:
                contact_lookup[str(k).strip().lower()] = c

    for cid, d_conv in direct_conversations.items():
        t_id = str(d_conv["target_id"]).strip().lower()
        c_info = contact_lookup.get(t_id) or resolve_employee_profile(d_conv["target_id"])
        if c_info:
            d_conv["title"] = c_info["name"]
            d_conv["subtitle"] = f"{c_info.get('designation', 'Staff')} • {c_info.get('department', 'Company')}"
            d_conv["avatar"] = c_info["name"][0].upper() if c_info.get("name") else "U"
            photo = c_info.get("profile_photo") or c_info.get("photo_url")
            d_conv["profile_photo"] = photo
            d_conv["photo_url"] = photo
            d_conv["uid"] = c_info.get("uid") or resolve_auth_uid(d_conv["target_id"]) or ""
            d_conv["is_online"] = bool(c_info.get("is_online"))
            d_conv["last_seen"] = str(c_info.get("last_seen") or "")
            d_conv["is_typing"] = bool(c_info.get("is_typing"))
            d_conv["typing_conversation_id"] = str(c_info.get("typing_conversation_id") or "")
        else:
            is_on, last_s, is_typ, typ_cid = _resolve_presence_tuple([d_conv["target_id"]], presence_map)
            d_conv["is_online"] = is_on
            d_conv["last_seen"] = last_s
            d_conv["is_typing"] = is_typ
            d_conv["typing_conversation_id"] = typ_cid

    # Combine teams and direct conversations and apply per-user inbox prefs (pin, mute, clear)
    try:
        inbox_map, cleared_map = user_state_future.result()
    except Exception as e:
        logger.debug(f"[ChatSync] Failed to load user chat state: {e}")
        inbox_map, cleared_map = {}, {}

    results = list(conversations_dict.values()) + list(direct_conversations.values())
    for conv in results:
        cands = [str(conv.get("conversation_id") or "").strip()]
        t_id = str(conv.get("target_id") or "").strip()
        if conv.get("type") == "team":
            if t_id:
                cands.extend([f"team_{t_id}", t_id])
        else:
            other_uid = conv.get("uid") or (resolve_auth_uid(t_id) if t_id else "")
            if my_uid_resolved and other_uid:
                du = sorted([my_uid_resolved, other_uid])
                cands.extend([f"direct_{du[0]}_{du[1]}", f"{du[0]}_{du[1]}"])
        _apply_user_conv_state(conv, cands, inbox_map, cleared_map)

    # Exclude any conversations deleted for this user, sample test users, deleted dummy records, or raw test UIDs
    results = [
        conv for conv in results
        if not conv.get("deleted_for_me")
        and not is_sample_chat_excluded(conv.get("conversation_id"))
        and not is_sample_chat_excluded(conv.get("target_id"))
        and not is_sample_chat_excluded(conv.get("title"))
        and not is_sample_chat_excluded(conv.get("uid"))
    ]

    # Sort: Pinned first, then newest message first
    min_dt = datetime.min.replace(tzinfo=timezone.utc)
    results.sort(
        key=lambda c: (
            bool(c.get("is_pinned", False)),
            _parse_utc_dt(c.get("last_message_at")) or min_dt,
        ),
        reverse=True,
    )

    return results


@router.get("/messages", response_model=List[Dict[str, Any]])
def get_messages(
    chat_type: Optional[str] = Query(None, description="'direct' or 'team'"),
    target_id: Optional[str] = Query(None, description="Recipient ID or Team ID"),
    conversation_id: Optional[str] = Query(None, description="Direct unique conversation ID"),
    limit: int = Query(60, ge=1, le=200),
    current_user=Depends(get_current_user),
):
    """
    Retrieve message history for direct chat or team channel with strict conversation separation.
    Validates user authorization and filters exclusively by the targeted conversation ID.
    """
    warm_chat_collections_parallel([
        "chat_messages",
        "teams",
        "admins",
        "employees",
        "users",
        "team_leaders",
        "chat_users",
        "chat_deleted_groups",
    ])
    migrate_legacy_chat_messages()

    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    my_keys = set(get_all_user_keys(my_ids))
    is_privileged = my_ids["role"] in ["admin", "hr", "project_hr_lead"]
    my_name = my_ids["name"].strip().lower()
    my_emp_id = my_ids["employee_id"].strip().lower()
    my_email = my_ids["email"].strip().lower()
    uid_key = _resolve_user_uid_key(my_ids, my_canonical)

    # 1. Resolve target conversation ID
    expected_cid = ""
    if conversation_id and str(conversation_id).strip():
        expected_cid = str(conversation_id).strip()
    elif chat_type == "team" and target_id:
        expected_cid = f"team_{str(target_id).strip()}"
    elif chat_type == "direct" and target_id:
        target_canonical = resolve_canonical_user_id(target_id)
        expected_cid = build_direct_conversation_id(my_canonical, target_canonical)
    elif target_id:
        # Auto-detect if target_id corresponds to a team
        all_teams = get_cached_collection("teams")
        matching_team = next((t for t in all_teams if _is_chat_team(t) and str(t.get("id")).lower() == str(target_id).strip().lower()), None)
        if matching_team:
            expected_cid = f"team_{str(matching_team.get('id')).strip()}"
        else:
            target_canonical = resolve_canonical_user_id(target_id)
            expected_cid = build_direct_conversation_id(my_canonical, target_canonical)
    else:
        raise HTTPException(status_code=400, detail="Either conversation_id or target_id must be provided.")

    # 2. Authorization validation
    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_email) or ""
    if my_auth_uid:
        my_keys.add(my_auth_uid.lower())
    direct_participant_uids: List[str] = []
    valid_team_cids: set = {expected_cid.lower()}
    valid_team_ids: set = {expected_cid.replace("team_", "").lower()}
    mobile_team_cids: List[str] = [expected_cid]

    if expected_cid.startswith("dm_") or expected_cid.startswith("direct_"):
        parts = expected_cid.split("_", 2)
        if len(parts) >= 3:
            p1, p2 = parts[1], parts[2]
            is_authorized = (
                my_canonical in [p1, p2]
                or p1.lower() in my_keys
                or p2.lower() in my_keys
                or (my_auth_uid and my_auth_uid in [p1, p2])
            )
            if not is_authorized:
                raise HTTPException(
                    status_code=403,
                    detail="Access denied: You are not an authorized participant in this private conversation."
                )
            u1 = resolve_auth_uid(p1)
            u2 = resolve_auth_uid(p2)
            if u1 and u2:
                direct_participant_uids = [u1, u2]
    else:
        # Fast O(N) check directly against cached `teams` instead of scanning mobile `chat_conversations`
        norm_lookup = (expected_cid[5:] if expected_cid.lower().startswith("team_") else expected_cid).lower()
        deleted_keys = get_deleted_group_keys()
        is_member = False
        matched_team_doc: Optional[Dict[str, Any]] = None

        for t in get_cached_collection("teams"):
            if not _is_chat_team(t):
                continue
            t_id_raw = str(t.get("id") or "").strip()
            t_team_id_raw = str(t.get("team_id") or "").strip()
            t_cid_raw = str(t.get("conversation_id") or "").strip() or f"team_{t_id_raw}"
            t_id_l = t_id_raw.lower()
            t_team_id_l = t_team_id_raw.lower()
            t_cid_l = t_cid_raw.lower()
            if (
                (t_id_l and norm_lookup == t_id_l)
                or (t_team_id_l and norm_lookup == t_team_id_l)
                or expected_cid.lower() == t_cid_l
            ):
                if deleted_keys and _expand_group_keys(t_id_raw, t_team_id_raw, t_cid_raw).intersection(deleted_keys):
                    continue
                matched_team_doc = t
                mobile_team_cids.extend([t_id_raw, f"team_{t_id_raw}", t_cid_raw])
                if t_team_id_raw:
                    mobile_team_cids.extend([t_team_id_raw, f"team_{t_team_id_raw}"])
                    valid_team_ids.add(t_team_id_l)
                    valid_team_cids.add(f"team_{t_team_id_l}")
                valid_team_ids.add(t_id_l)
                valid_team_cids.add(f"team_{t_id_l}")
                valid_team_cids.add(t_cid_l)
                valid_team_ids.add((t_cid_l[5:] if t_cid_l.startswith("team_") else t_cid_l))
                is_member = _user_can_access_team_doc(
                    t, my_keys, my_name, my_emp_id, my_email, my_auth_uid, is_privileged
                )
                break

        if not matched_team_doc or not is_member:
            mob_conv = None
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as doc_pool:
                f_cc = doc_pool.submit(rest_get_document, f"chat_conversations/{expected_cid}")
                f_c = doc_pool.submit(rest_get_document, f"conversations/{expected_cid}")
                mob_conv = f_cc.result() or f_c.result()
            if mob_conv and not (deleted_keys and _expand_group_keys(expected_cid, mob_conv.get("team_id")).intersection(deleted_keys)):
                if _user_can_access_team_doc(
                    mob_conv, my_keys, my_name, my_emp_id, my_email, my_auth_uid, False
                ):
                    is_member = True
        if not is_member:
            raise HTTPException(
                status_code=403,
                detail="Access denied: You are not an authorized member of this team channel."
            )

    # 3. Fetch mobile messages + user clear state concurrently while filtering cached web messages
    is_direct_cid = expected_cid.startswith(("dm_", "direct_"))
    extra_exact_cids = [] if is_direct_cid else list(dict.fromkeys(c for c in mobile_team_cids if c))

    def _safe_mobile_msgs() -> List[Dict[str, Any]]:
        try:
            return fetch_live_mobile_messages(
                expected_cid,
                participant_uids=direct_participant_uids,
                extra_cids=extra_exact_cids,
            )
        except Exception as e:
            logger.debug(f"[ChatSync] Failed to pull live mobile messages: {e}")
            return []

    def _safe_user_state():
        try:
            return _load_user_chat_state(uid_key, my_canonical)
        except Exception as e:
            logger.debug(f"[ChatSync] Failed to load user chat state: {e}")
            return {}, {}

    io_pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    mobile_msgs_future = io_pool.submit(_safe_mobile_msgs)
    user_state_future = io_pool.submit(_safe_user_state)
    io_pool.shutdown(wait=False)

    all_msgs = get_cached_collection("chat_messages")
    filtered: List[Dict[str, Any]] = []
    messages_to_mark_read: List[str] = []

    for msg in all_msgs:
        msg_cid = get_message_conversation_id(msg)
        msg_cid_l = msg_cid.lower()
        norm_msg = msg_cid_l.replace("team_", "")
        msg_target = str(msg.get("target_id") or msg.get("team_id") or "").strip().replace("team_", "").lower()

        matched = False
        if is_direct_cid:
            if msg.get("chat_type") != "team" and (msg_cid == expected_cid or norm_msg == expected_cid.lower()):
                matched = True
        else:
            if msg_cid_l in valid_team_cids or norm_msg in valid_team_ids:
                matched = True
            elif msg.get("chat_type") == "team" and msg_target and msg_target in valid_team_ids:
                matched = True

        if matched:
            filtered.append(msg)
            # Mark unread messages
            read_by = msg.get("read_by", [])
            if not isinstance(read_by, list):
                read_by = []
            if not my_keys.intersection({str(r).lower() for r in read_by}):
                messages_to_mark_read.append(str(msg.get("id")))

    # 3b. Merge live messages from Cloud Firestore mobile collections (`chat_conversations` & `conversations`)
    mobile_msgs = mobile_msgs_future.result()
    existing_ids = {str(m.get("id")) for m in filtered}
    for mm in mobile_msgs:
        if str(mm.get("id")) not in existing_ids:
            filtered.append(mm)
            existing_ids.add(str(mm.get("id")))

    # Clear mobile unread counter in background so GET /messages responds immediately
    if my_auth_uid:
        cids_to_mark = list(dict.fromkeys([expected_cid] + extra_exact_cids))
        if expected_cid.startswith("team_"):
            cids_to_mark.append(expected_cid[5:])
        if len(direct_participant_uids) >= 2:
            du = sorted(direct_participant_uids[:2])
            cids_to_mark.extend([f"direct_{du[0]}_{du[1]}", f"{du[0]}_{du[1]}"])
        threading.Thread(
            target=mark_mobile_conversation_read,
            args=(cids_to_mark, my_auth_uid),
            daemon=True,
        ).start()

    # 4. Mark as read in storage in background
    if messages_to_mark_read:
        def _bg_mark_web_read(msg_ids: List[str], canon: str):
            for mid in msg_ids:
                doc = firestore_service.get_document("chat_messages", mid)
                if doc:
                    r_list = doc.get("read_by", [])
                    if not isinstance(r_list, list):
                        r_list = []
                    if canon not in r_list:
                        r_list.append(canon)
                        firestore_service.update_document("chat_messages", mid, {"read_by": r_list})
            invalidate_chat_cache("chat_messages")

        threading.Thread(
            target=_bg_mark_web_read,
            args=(list(messages_to_mark_read), my_canonical),
            daemon=True,
        ).start()

    # Filter out messages hidden by user's per-conversation clear timestamp
    clear_cands = [expected_cid]
    if is_direct_cid and len(direct_participant_uids) >= 2:
        du = sorted(direct_participant_uids[:2])
        clear_cands.extend([f"direct_{du[0]}_{du[1]}", f"{du[0]}_{du[1]}"])
    elif not is_direct_cid:
        clear_cands.extend(extra_exact_cids)
    try:
        _, cleared_map = user_state_future.result()
        cleared_dts = [cleared_map[c.strip().lower()] for c in clear_cands if c and c.strip().lower() in cleared_map]
        if cleared_dts:
            latest_clear = max(cleared_dts)
            min_dt = datetime.min.replace(tzinfo=timezone.utc)
            filtered = [
                m for m in filtered
                if (_parse_utc_dt(m.get("created_at") or m.get("timestamp")) or min_dt) > latest_clear
            ]
    except Exception as e:
        logger.debug(f"[ChatSync] Failed to apply clearedAt filter: {e}")

    # Sort chronologically (oldest to newest)
    filtered.sort(key=lambda m: str(m.get("created_at", "")))
    try:
        lim = int(limit)
    except Exception:
        lim = int(getattr(limit, "default", 60)) if hasattr(limit, "default") else 60
    return filtered[-lim:]


@router.post("/messages", status_code=status.HTTP_201_CREATED, response_model=Dict[str, Any])
async def send_message(
    payload: MessageCreate,
    current_user=Depends(get_current_user),
):
    """
    Send a message in a 1:1 direct chat or a Team channel.
    Assigns strict conversation_id and participant_ids, persists to database,
    and immediately pushes via WebSocket ONLY to authorized recipients.
    """
    content = payload.content.strip()
    if not content and not payload.attachments:
        raise HTTPException(status_code=400, detail="Message content or attachment is required.")

    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_target = payload.target_id.strip()

    team_name = ""
    canonical_target_id = clean_target
    recipient_name = ""
    recipient_keys: List[str] = []
    participant_ids: List[str] = []

    if payload.chat_type == "team":
        team = None
        mob_group = None
        all_teams = get_cached_collection("teams")
        req_cid_l = str(payload.conversation_id or "").strip().lower()
        target_l = clean_target.lower()
        for t in all_teams:
            if not _is_chat_team(t):
                continue
            t_id_l = str(t.get("id") or "").strip().lower()
            t_cid_l = str(t.get("conversation_id") or "").strip().lower()
            if target_l in (t_id_l, t_cid_l) or (req_cid_l and req_cid_l in (t_cid_l, f"team_{t_id_l}")):
                team = t
                break
        if not team:
            for t in all_teams:
                if not _is_chat_team(t):
                    continue
                t_name_l = str(t.get("name") or t.get("teamName", "")).strip().lower()
                if t_name_l and target_l == t_name_l:
                    team = t
                    break
        my_keys = set(get_all_user_keys(my_ids))
        my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or ""
        if my_auth_uid:
            my_keys.add(my_auth_uid.lower())

        if team:
            if not _user_can_access_team_doc(
                team,
                my_keys,
                my_ids["name"].strip().lower(),
                my_ids["employee_id"].strip().lower(),
                my_ids["email"].strip().lower(),
                my_auth_uid,
                False,
            ):
                raise HTTPException(status_code=403, detail="Access denied: You are not a member of this group.")
            canonical_target_id = str(team.get("id"))
            team_name = team.get("name") or team.get("teamName") or "Team Channel"
            members = list(team.get("members") or []) + list(team.get("memberIds") or [])
            for m in members:
                m_canon = resolve_canonical_user_id(m)
                recipient_keys.append(m_canon.lower())
                if m_canon not in participant_ids:
                    participant_ids.append(m_canon)
            cid = str(team.get("conversation_id") or "").strip() or f"team_{canonical_target_id}"
        else:
            lookup_cid = (payload.conversation_id or clean_target).strip()
            mob_group = rest_get_document(f"chat_conversations/{lookup_cid}") or rest_get_document(f"conversations/{lookup_cid}")
            if mob_group:
                if not _user_can_access_team_doc(
                    mob_group,
                    my_keys,
                    my_ids["name"].strip().lower(),
                    my_ids["employee_id"].strip().lower(),
                    my_ids["email"].strip().lower(),
                    my_auth_uid,
                    False,
                ):
                    raise HTTPException(status_code=403, detail="Access denied: You are not a member of this group.")
                cid = lookup_cid
                canonical_target_id = lookup_cid
                team_name = mob_group.get("groupName") or mob_group.get("name") or "Group Chat"
                for m_uid in (mob_group.get("memberIds") or []):
                    m_canon = resolve_canonical_user_id(m_uid)
                    recipient_keys.append(str(m_uid).lower())
                    recipient_keys.append(m_canon.lower())
                    if m_canon not in participant_ids:
                        participant_ids.append(m_canon)
            else:
                cid = lookup_cid if lookup_cid.startswith("team_") else f"team_{canonical_target_id}"
        if not participant_ids:
            participant_ids = [canonical_target_id]
        receiver_id = canonical_target_id

    else:
        # Direct message
        target_canonical = resolve_canonical_user_id(clean_target)
        canonical_target_id = target_canonical
        receiver_id = target_canonical
        cid = build_direct_conversation_id(my_canonical, target_canonical)
        participant_ids = sorted([my_canonical, target_canonical])

        if target_canonical == "ADM-001":
            recipient_name = "Administrator"
            recipient_keys = ["adm-001", "admin", "administrator", "admin@arshith.com"]
        else:
            recipient_keys = [target_canonical.lower()]
            emp = None
            target_l = target_canonical.lower()
            for candidate_emp in get_cached_collection("employees"):
                c_id = str(candidate_emp.get("id") or "").strip().lower()
                c_eid = str(candidate_emp.get("employee_id") or candidate_emp.get("employeeId") or "").strip().lower()
                if target_l in (c_id, c_eid):
                    emp = candidate_emp
                    break
            if emp:
                recipient_name = emp.get("full_name") or emp.get("name") or target_canonical
                if emp.get("employee_id"):
                    recipient_keys.append(str(emp["employee_id"]).lower())
                if emp.get("email"):
                    recipient_keys.append(str(emp["email"]).lower())
            else:
                prof = resolve_employee_profile(target_canonical) or resolve_employee_profile(clean_target)
                if prof:
                    recipient_name = prof.get("name") or target_canonical
                u_info = get_user_display_info(clean_target)
                if u_info.get("email"):
                    recipient_keys.append(str(u_info["email"]).lower())

    my_profile = resolve_employee_profile(my_canonical) or {}
    sender_photo = my_profile.get("photo") or my_profile.get("photo_url") or None
    sender_display_name = my_profile.get("name") or my_ids["name"]

    msg_data = {
        "conversation_id": cid,
        "participant_ids": participant_ids,
        "chat_type": payload.chat_type,
        "target_id": canonical_target_id,
        "team_id": canonical_target_id if payload.chat_type == "team" else None,
        "team_name": team_name,
        "sender_id": my_canonical,
        "sender_name": sender_display_name,
        "sender_role": my_ids["role"],
        "sender_avatar": sender_display_name[0].upper() if sender_display_name else "U",
        "sender_photo": sender_photo,
        "receiver_id": receiver_id,
        "receiver_name": recipient_name or team_name,
        "content": content,
        "attachments": payload.attachments or [],
        "reply_to": payload.reply_to,
        "reactions": {},
        "is_pinned": False,
        "read_by": [my_canonical],
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    doc_id = firestore_service.create_document("chat_messages", msg_data)
    msg_data["id"] = doc_id
    invalidate_chat_cache("chat_messages")

    # Two-Way Sync: Dispatch into Cloud Firestore Mobile App Collections
    try:
        all_member_targets = list(participant_ids)
        if payload.chat_type == "team" and team:
            t_mids = team.get("memberIds") or []
            t_members = team.get("members") or []
            all_member_targets = list(set(all_member_targets + t_mids + t_members))
        elif payload.chat_type == "team" and mob_group:
            all_member_targets = list(set(all_member_targets + list(mob_group.get("memberIds") or [])))
        elif payload.chat_type != "team":
            all_member_targets = list(set(all_member_targets + [my_ids["primary_id"], my_ids["email"], clean_target, canonical_target_id]))
        sync_message_to_mobile_app(
            msg_id=doc_id,
            conversation_id=cid,
            chat_type=payload.chat_type,
            sender_identifier=my_ids["primary_id"],
            content=content,
            attachments=payload.attachments,
            target_id=canonical_target_id,
            team_name=team_name,
            member_identifiers=all_member_targets,
        )
    except Exception as sync_err:
        logger.warning(f"Failed to sync message {doc_id} to mobile app: {sync_err}")

    # Restore conversation inbox visibility for participants on new message
    if payload.chat_type != "team":
        try:
            restore_updates = {"deletedForMe": False, "deleted_for_me": False, "updatedAt": datetime.now(timezone.utc)}
            uid_key, _, write_ids = _resolve_user_conv_targets(my_ids, my_canonical, cid, "direct", canonical_target_id)
            _persist_user_inbox_pref(uid_key, write_ids, restore_updates)
            if my_auth_uid and my_auth_uid != uid_key:
                _persist_user_inbox_pref(my_auth_uid, write_ids, restore_updates)
            r_auth_uid = resolve_auth_uid(canonical_target_id) or canonical_target_id
            if r_auth_uid:
                _persist_user_inbox_pref(r_auth_uid, write_ids, restore_updates)
            _invalidate_user_state_cache(uid_key)
            if my_auth_uid:
                _invalidate_user_state_cache(my_auth_uid)
        except Exception as e:
            logger.debug(f"[ChatSync] Failed to reset deletedForMe on message send: {e}")

    # Broadcast real-time event via WebSocket strictly to conversation participants
    event_payload = {
        "type": "new_message",
        "conversation_id": cid,
        "message": msg_data,
    }
    if payload.chat_type == "team":
        await _broadcast_team_event(team or mob_group, team_name, event_payload)
    else:
        # Direct message: send to target and sender ONLY
        all_targets = list(set(recipient_keys + get_all_user_keys(my_ids)))
        await manager.broadcast_to_keys(all_targets, event_payload)

    return msg_data


@router.post("/messages/{message_id}/reactions", response_model=Dict[str, Any])
async def toggle_reaction(
    message_id: str,
    payload: ReactionToggle,
    current_user=Depends(get_current_user),
):
    """Toggle an emoji reaction (👍, ❤️, 👏, 🎉, 🚀) on a message."""
    my_ids = get_user_identifiers(current_user)
    user_key = my_ids["primary_id"]

    doc = firestore_service.get_document("chat_messages", message_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")

    reactions = doc.get("reactions", {})
    if not isinstance(reactions, dict):
        reactions = {}

    emoji = payload.emoji.strip()
    if not emoji:
        raise HTTPException(status_code=400, detail="Emoji character is required")

    user_list = reactions.get(emoji, [])
    if not isinstance(user_list, list):
        user_list = []

    if user_key in user_list:
        user_list.remove(user_key)
        if not user_list:
            del reactions[emoji]
        else:
            reactions[emoji] = user_list
    else:
        user_list.append(user_key)
        reactions[emoji] = user_list

    firestore_service.update_document("chat_messages", message_id, {"reactions": reactions})
    invalidate_chat_cache("chat_messages")

    # Broadcast update
    event = {
        "type": "reaction_updated",
        "message_id": message_id,
        "reactions": reactions,
    }
    await manager.broadcast_all(event)

    return {"success": True, "reactions": reactions}


@router.post("/messages/{message_id}/pin", response_model=Dict[str, Any])
async def toggle_pin(
    message_id: str,
    current_user=Depends(get_current_user),
):
    """Toggle pinned status on a message."""
    doc = firestore_service.get_document("chat_messages", message_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")

    current_pinned = bool(doc.get("is_pinned", False))
    new_pinned = not current_pinned

    firestore_service.update_document("chat_messages", message_id, {"is_pinned": new_pinned})
    invalidate_chat_cache("chat_messages")

    event = {
        "type": "pin_updated",
        "message_id": message_id,
        "is_pinned": new_pinned,
    }
    await manager.broadcast_all(event)

    return {"success": True, "is_pinned": new_pinned}


@router.delete("/messages/{message_id}", response_model=Dict[str, Any])
async def delete_message(
    message_id: str,
    current_user=Depends(get_current_user),
):
    """Delete a message (allowed by message author or administrator)."""
    my_ids = get_user_identifiers(current_user)
    my_keys = set(get_all_user_keys(my_ids))

    doc = firestore_service.get_document("chat_messages", message_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")

    sender_id = str(doc.get("sender_id", "")).strip().lower()
    is_admin = my_ids["role"] == "admin"

    if sender_id not in my_keys and not is_admin:
        raise HTTPException(status_code=403, detail="You can only delete your own messages.")

    conv_id = str(doc.get("conversation_id") or "").strip()
    firestore_service.delete_document("chat_messages", message_id)
    invalidate_chat_cache("chat_messages")
    try:
        if conv_id:
            sync_message_delete_to_mobile_app(message_id, conv_id)
    except Exception:
        pass

    event = {
        "type": "message_deleted",
        "message_id": message_id,
        "conversation_id": conv_id,
    }
    await manager.broadcast_all(event)

    return {"success": True, "message": "Message deleted successfully."}


@router.post("/read", response_model=Dict[str, Any])
def mark_conversation_read(
    payload: MarkReadRequest,
    current_user=Depends(get_current_user),
):
    """Mark all unread messages in a conversation as read for the current user."""
    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    my_keys = set(get_all_user_keys(my_ids))

    if payload.conversation_id and str(payload.conversation_id).strip():
        target_cid = str(payload.conversation_id).strip()
    elif payload.chat_type == "team":
        target_cid = f"team_{payload.target_id.strip()}"
    else:
        target_canonical = resolve_canonical_user_id(payload.target_id)
        target_cid = build_direct_conversation_id(my_canonical, target_canonical)

    messages = get_cached_collection("chat_messages")
    updated_count = 0

    for msg in messages:
        msg_cid = get_message_conversation_id(msg)
        if msg_cid == target_cid:
            read_by = msg.get("read_by", [])
            if not isinstance(read_by, list):
                read_by = []
            if not my_keys.intersection({str(r).lower() for r in read_by}):
                read_by.append(my_canonical)
                firestore_service.update_document("chat_messages", str(msg.get("id")), {"read_by": read_by})
                updated_count += 1
    if updated_count:
        invalidate_chat_cache("chat_messages")

    try:
        my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"])
        cids_to_mark = [target_cid]
        if target_cid.startswith("team_"):
            cids_to_mark.append(target_cid[5:])
        elif target_cid.startswith("dm_"):
            parts = target_cid.split("_", 2)
            if len(parts) >= 3:
                u1 = resolve_auth_uid(parts[1])
                u2 = resolve_auth_uid(parts[2])
                if u1 and u2:
                    du = sorted([u1, u2])
                    cids_to_mark.extend([f"direct_{du[0]}_{du[1]}", f"{du[0]}_{du[1]}"])
        mark_mobile_conversation_read(cids_to_mark, my_auth_uid)
    except Exception:
        pass

    return {"success": True, "marked_count": updated_count}


@router.post("/conversations/settings", response_model=Dict[str, Any])
def update_conversation_settings(
    payload: ConversationSettingsUpdate,
    current_user=Depends(get_current_user),
):
    """Update per-user conversation preferences (pinned, muted) synced with mobile app."""
    if payload.pinned is None and payload.muted is None:
        raise HTTPException(status_code=400, detail="Provide pinned or muted setting to update.")
    if not payload.conversation_id or not str(payload.conversation_id).strip():
        raise HTTPException(status_code=400, detail="conversation_id is required.")

    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    uid_key, read_cands, write_ids = _resolve_user_conv_targets(
        my_ids, my_canonical, payload.conversation_id, payload.chat_type, payload.target_id
    )

    now_dt = datetime.now(timezone.utc)
    updates: Dict[str, Any] = {"updatedAt": now_dt}
    if payload.pinned is not None:
        updates["pinned"] = bool(payload.pinned)
    if payload.muted is not None:
        updates["muted"] = bool(payload.muted)

    _persist_user_inbox_pref(uid_key, write_ids, updates)

    inbox_map, _ = _load_user_chat_state(uid_key, my_canonical)
    norm_cands = [c.lower() for c in read_cands]
    saved = next((inbox_map[k] for k in norm_cands if k in inbox_map), {})

    return {
        "success": True,
        "conversation_id": payload.conversation_id,
        "is_pinned": bool(payload.pinned) if payload.pinned is not None else bool(saved.get("pinned", False)),
        "is_muted": bool(payload.muted) if payload.muted is not None else bool(saved.get("muted", False)),
    }


@router.post("/conversations/clear", response_model=Dict[str, Any])
def clear_conversation_history(
    payload: ClearConversationRequest,
    current_user=Depends(get_current_user),
):
    """Clear conversation message history for the current user only (`chat_user_cleared`)."""
    if not payload.conversation_id or not str(payload.conversation_id).strip():
        raise HTTPException(status_code=400, detail="conversation_id is required.")

    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"])
    uid_key, read_cands, write_ids = _resolve_user_conv_targets(
        my_ids, my_canonical, payload.conversation_id, payload.chat_type, payload.target_id
    )

    now_dt = datetime.now(timezone.utc)
    _persist_user_cleared_at(uid_key, write_ids, now_dt)

    try:
        mark_mobile_conversation_read(read_cands, my_auth_uid)
    except Exception:
        pass

    return {
        "success": True,
        "conversation_id": payload.conversation_id,
        "cleared_at": now_dt.isoformat(),
    }


@router.post("/conversations/delete-for-me", response_model=Dict[str, Any])
def delete_conversation_for_me(
    payload: DeleteForMeRequest,
    current_user=Depends(get_current_user),
):
    """
    WhatsApp-Style 'Delete for Me':
    Deletes the selected conversation from the current user's inbox only.
    Writes deletedForMe=True to chat_user_inbox/{uid}/items/{cid}
    so both website and mobile app filter it out immediately,
    while leaving all messages and the other participant's inbox completely untouched.
    """
    if not payload.conversation_id or not str(payload.conversation_id).strip():
        raise HTTPException(status_code=400, detail="conversation_id is required.")

    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or my_ids.get("uid") or ""
    uid_key, read_cands, write_ids = _resolve_user_conv_targets(
        my_ids, my_canonical, payload.conversation_id, payload.chat_type, payload.target_id
    )

    now_dt = datetime.now(timezone.utc)
    updates = {
        "deletedForMe": True,
        "deleted_for_me": True,
        "updatedAt": now_dt,
    }

    # Persist to resolved uid_key
    _persist_user_inbox_pref(uid_key, write_ids, updates)

    # If my_auth_uid is distinct, also persist under my_auth_uid for direct Android app synchronization
    if my_auth_uid and my_auth_uid != uid_key:
        _persist_user_inbox_pref(my_auth_uid, write_ids, updates)

    # Invalidate cache
    _invalidate_user_state_cache(uid_key)
    if my_auth_uid:
        _invalidate_user_state_cache(my_auth_uid)
    if my_canonical:
        _invalidate_user_state_cache(my_canonical)

    return {
        "success": True,
        "conversation_id": payload.conversation_id,
        "message": "Conversation deleted from your inbox.",
    }


@router.get("/unread-count", response_model=Dict[str, int])
def get_unread_count(current_user=Depends(get_current_user)):
    """Fast check for total unread chat messages for application navbar badges."""
    my_ids = get_user_identifiers(current_user)
    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    my_keys = set(get_all_user_keys(my_ids))

    accessible_teams = get_teams_for_chat(current_user)
    accessible_team_cids = {f"team_{t['id']}" for t in accessible_teams}

    messages = get_cached_collection("chat_messages")
    unread = 0

    for msg in messages:
        sender_id = str(msg.get("sender_id", "")).strip().lower()
        if sender_id in my_keys or sender_id == my_canonical.lower():
            continue

        read_by = msg.get("read_by", [])
        if not isinstance(read_by, list):
            read_by = []
        read_by_norm = {str(r).strip().lower() for r in read_by}

        if bool(my_keys.intersection(read_by_norm)):
            continue

        c_type = msg.get("chat_type", "direct")
        if c_type == "direct":
            r_canon = resolve_canonical_user_id(msg.get("receiver_id") or msg.get("target_id", ""))
            if r_canon == my_canonical or r_canon.lower() in my_keys:
                unread += 1
        elif c_type == "team":
            msg_cid = get_message_conversation_id(msg)
            if msg_cid in accessible_team_cids:
                unread += 1

    return {"total_unread": unread}


@router.patch("/messages/{message_id}", response_model=Dict[str, Any])
async def update_message(
    message_id: str,
    payload: MessageUpdate,
    current_user=Depends(get_current_user),
):
    """Edit an existing message. Only message author or administrator can edit."""
    my_ids = get_user_identifiers(current_user)
    my_keys = set(get_all_user_keys(my_ids))
    doc = firestore_service.get_document("chat_messages", message_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Message not found")

    sender_id = str(doc.get("sender_id", "")).strip().lower()
    is_admin = my_ids["role"] == "admin"
    if sender_id not in my_keys and not is_admin:
        raise HTTPException(status_code=403, detail="You can only edit your own messages.")

    new_content = payload.content.strip()
    if not new_content:
        raise HTTPException(status_code=400, detail="Message content cannot be empty.")

    now_iso = datetime.now(timezone.utc).isoformat()
    updates = {
        "content": new_content,
        "is_edited": True,
        "updated_at": now_iso,
    }
    firestore_service.update_document("chat_messages", message_id, updates)
    doc.update(updates)
    invalidate_chat_cache("chat_messages")
    conv_id = str(doc.get("conversation_id") or "").strip()
    try:
        if conv_id:
            sync_message_edit_to_mobile_app(message_id, conv_id, new_content)
    except Exception:
        pass

    event = {
        "type": "message_edited",
        "message_id": message_id,
        "conversation_id": conv_id,
        "content": new_content,
        "is_edited": True,
        "updated_at": now_iso,
    }
    await manager.broadcast_all(event)
    return {"success": True, "message": doc}


@router.post("/attachments/upload", response_model=Dict[str, Any])
async def upload_chat_attachment(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    """Upload images, documents, and voice notes to Firebase Storage (with local static fallback)."""
    filename = file.filename or "attachment"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"File extension '{ext}' is not permitted. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File size exceeds maximum allowed limit of 15MB.")

    is_image = ext in [".png", ".jpg", ".jpeg", ".gif", ".webp"]
    is_audio = ext in [".webm", ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus"]
    resolved_ctype = file.content_type or (
        "image/" + ("jpeg" if ext == ".jpg" else ext[1:])
        if is_image
        else ("audio/mp4" if ext == ".m4a" else ("audio/" + ext[1:] if is_audio else "application/octet-stream"))
    )

    my_ids = get_user_identifiers(current_user)
    cloud_url = upload_chat_attachment_to_storage(
        file_bytes=contents,
        filename=filename,
        content_type=resolved_ctype,
        sender_identifier=my_ids["primary_id"] or my_ids["email"],
    )

    if cloud_url:
        file_url = cloud_url
    else:
        safe_name = f"{uuid.uuid4().hex[:12]}_{filename.replace(' ', '_')}"
        target_path = os.path.join(UPLOAD_DIR, safe_name)
        with open(target_path, "wb") as f:
            f.write(contents)
        file_url = f"/static/chat_uploads/{safe_name}"

    return {
        "url": file_url,
        "filename": filename,
        "file_size": len(contents),
        "content_type": resolved_ctype,
        "is_image": is_image,
        "is_audio": is_audio,
        "storage": "firebase_storage" if cloud_url else "local",
    }


@router.post("/conversations/group", response_model=Dict[str, Any])
async def create_group_channel(
    payload: GroupCreate,
    current_user=Depends(get_current_user),
):
    """Create a new team group chat channel and sync to Cloud Firestore & Mobile APK."""
    my_ids = get_user_identifiers(current_user)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Group name is required.")

    creator_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or my_ids["uid"] or my_ids["primary_id"]
    raw_member_refs = list(dict.fromkeys(
        [creator_uid or my_ids["primary_id"]] + [str(m).strip() for m in (payload.member_ids or []) if str(m).strip()]
    ))
    member_uids: List[str] = []
    member_names: List[str] = []
    for ref in raw_member_refs:
        u_info = get_user_display_info(ref)
        u_uid = resolve_auth_uid(ref)
        if u_uid and len(u_uid) >= 20 and "@" not in u_uid and u_uid not in member_uids:
            member_uids.append(u_uid)
        display = (u_info.get("name") or ref).strip()
        if display and display not in member_names:
            member_names.append(display)

    now_iso = datetime.now(timezone.utc).isoformat()

    group_data = {
        "name": name,
        "teamName": name,
        "team_name": name,
        "description": payload.description.strip() if payload.description else "",
        "department": "Custom Group",
        "leader": my_ids["name"],
        "created_by": my_ids["primary_id"],
        "createdBy": creator_uid,
        "groupAdmins": [creator_uid] if creator_uid else [],
        "created_at": now_iso,
        "updated_at": now_iso,
        "members": member_names or raw_member_refs,
        "memberNames": member_names or raw_member_refs,
        "memberIds": member_uids,
        "active": True,
        "is_custom_group": True,
    }
    doc_id_group = firestore_service.create_document("teams", group_data)
    team_id = doc_id_group
    group_data["id"] = team_id
    group_data["team_id"] = team_id
    group_data["conversation_id"] = f"team_{team_id}"
    group_data["created_by_uid"] = creator_uid
    group_data["can_delete"] = not _is_protected_general_group(name)
    group_data["member_count"] = max(len(group_data["members"]), len(member_uids))

    # Post initial system message
    sys_msg = {
        "conversation_id": f"team_{team_id}",
        "participant_ids": [str(team_id)],
        "chat_type": "team",
        "target_id": str(team_id),
        "team_id": str(team_id),
        "team_name": name,
        "sender_id": "SYSTEM",
        "sender_name": "System",
        "sender_role": "system",
        "sender_avatar": "⚙️",
        "receiver_id": str(team_id),
        "receiver_name": name,
        "content": f"Group '{name}' was created by {my_ids['name']}.",
        "attachments": [],
        "reply_to": None,
        "reactions": {},
        "is_pinned": False,
        "read_by": [my_ids["primary_id"]],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    s_id = firestore_service.create_document("chat_messages", sys_msg)
    sys_msg["id"] = s_id
    invalidate_chat_cache("teams", "chat_messages")

    try:
        sync_team_to_mobile_app(str(team_id), group_data)
        sync_message_to_mobile_app(
            msg_id=str(s_id),
            conversation_id=f"team_{team_id}",
            chat_type="team",
            sender_identifier=creator_uid or my_ids["primary_id"],
            content=sys_msg["content"],
            target_id=str(team_id),
            team_name=name,
            member_identifiers=member_uids or raw_member_refs,
        )
    except Exception as e:
        logger.debug(f"[ChatSync] Group sync skipped/partial: {e}")

    await _broadcast_team_event(group_data, name, {
        "type": "new_team",
        "team": group_data,
    })
    return group_data


@router.post("/conversations/direct", response_model=Dict[str, Any])
async def ensure_direct_conversation(
    payload: DirectConversationCreate,
    current_user=Depends(get_current_user),
):
    """Ensure a direct 1:1 conversation exists in mobile Firestore so new website chats sync immediately to the app."""
    my_ids = get_user_identifiers(current_user)
    target_ref = (payload.target_id or "").strip()
    if not target_ref:
        raise HTTPException(status_code=400, detail="target_id is required.")

    my_uid = resolve_auth_uid(my_ids["primary_id"]) or my_ids["primary_id"]
    target_uid = resolve_auth_uid(target_ref) or target_ref
    target_info = get_user_display_info(target_uid)
    target_name = target_info.get("name") or target_ref
    target_emp_id = target_info.get("employee_id") or ""

    my_canonical = resolve_canonical_user_id(my_ids["primary_id"])
    target_canonical = resolve_canonical_user_id(target_uid or target_ref)
    if target_canonical and target_canonical != "admin":
        pair_canon = sorted([my_canonical, target_canonical]) if my_canonical != target_canonical else [my_canonical, target_canonical]
        fallback_cid = f"direct_{pair_canon[0]}_{pair_canon[1]}"
    else:
        fallback_cid = make_direct_conversation_id(my_canonical, target_canonical)

    mobile_cid = None
    try:
        mobile_cid = ensure_direct_conversation_in_mobile_app(my_uid, target_uid)
    except Exception as e:
        logger.debug(f"[ChatSync] ensure_direct_conversation_in_mobile_app partial: {e}")

    conv_id = mobile_cid or fallback_cid
    now_iso = datetime.now(timezone.utc).isoformat()
    pmap = get_presence_map()
    is_on, last_s, _, _ = _resolve_presence_tuple([target_uid, target_emp_id, target_ref], pmap)

    # If previously deleted for current user, restore it now that user is initiating/opening conversation
    try:
        uid_key, _, write_ids = _resolve_user_conv_targets(
            my_ids, my_canonical, conv_id, "direct", target_emp_id or target_uid or target_ref
        )
        restore_updates = {"deletedForMe": False, "deleted_for_me": False, "updatedAt": datetime.now(timezone.utc)}
        _persist_user_inbox_pref(uid_key, write_ids, restore_updates)
        if my_uid and my_uid != uid_key:
            _persist_user_inbox_pref(my_uid, write_ids, restore_updates)
        _invalidate_user_state_cache(uid_key)
        if my_uid:
            _invalidate_user_state_cache(my_uid)
    except Exception as e:
        logger.debug(f"[ChatSync] Failed to reset deletedForMe in ensure_direct_conversation: {e}")

    return {
        "conversation_id": conv_id,
        "chat_type": "direct",
        "target_id": target_emp_id or target_uid or target_ref,
        "target_auth_uid": target_uid,
        "title": target_name,
        "subtitle": target_info.get("department") or target_info.get("role") or "Member",
        "avatar_initials": "".join([w[0].upper() for w in target_name.split()[:2]]) or "U",
        "last_message": "",
        "last_sender": "",
        "last_message_at": now_iso,
        "unread_count": 0,
        "is_online": is_on,
        "last_seen": last_s,
        "members": [],
    }


@router.patch("/conversations/{group_id}", response_model=Dict[str, Any])
async def update_group_channel(
    group_id: str,
    payload: GroupUpdate,
    current_user=Depends(get_current_user),
):
    """Update group name or description across Website and Android App."""
    my_ids = get_user_identifiers(current_user)
    clean_gid = group_id[5:] if group_id.startswith("team_") else group_id
    team = firestore_service.get_document("teams", clean_gid) or firestore_service.get_document("teams", group_id)
    team_doc_id = str((team or {}).get("id") or clean_gid)
    mob_conv = None
    if not team:
        mob_conv = rest_get_document(f"chat_conversations/{group_id}") or rest_get_document(f"conversations/{group_id}")
        if not mob_conv:
            raise HTTPException(status_code=404, detail="Group not found.")

    source = team or mob_conv
    conv_id = str(source.get("conversation_id") or (group_id if mob_conv else f"team_{team_doc_id}")).strip()
    old_name = str(source.get("teamName") or source.get("name") or source.get("groupName") or "Group").strip()
    my_keys = set(get_all_user_keys(my_ids))
    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or ""
    if not _user_can_access_team_doc(
        source,
        my_keys,
        my_ids["name"].strip().lower(),
        my_ids["employee_id"].strip().lower(),
        my_ids["email"].strip().lower(),
        my_auth_uid,
        False,
    ):
        raise HTTPException(status_code=403, detail="Access denied: You are not a member of this group.")

    updates: Dict[str, Any] = {}
    new_name = payload.name.strip() if isinstance(payload.name, str) and payload.name.strip() else None
    new_desc = payload.description.strip() if isinstance(payload.description, str) else None
    if new_name is None and new_desc is None:
        raise HTTPException(status_code=400, detail="Nothing to update.")

    now_iso = datetime.now(timezone.utc).isoformat()
    updates["updated_at"] = now_iso
    if new_name is not None:
        updates["teamName"] = new_name
        updates["name"] = new_name
    if new_desc is not None:
        updates["description"] = new_desc

    if team:
        firestore_service.update_document("teams", team_doc_id, updates)
        invalidate_chat_cache("teams")

    try:
        sync_group_metadata_to_mobile_app(
            conversation_id=conv_id,
            team_id=team_doc_id if team else source.get("teamId") or source.get("team_id"),
            name=new_name,
            description=new_desc,
        )
    except Exception:
        pass

    sys_msg = None
    if new_name and new_name != old_name:
        sys_msg = {
            "conversation_id": conv_id,
            "participant_ids": [team_doc_id],
            "chat_type": "team",
            "target_id": team_doc_id,
            "team_id": team_doc_id,
            "team_name": new_name,
            "sender_id": "SYSTEM",
            "sender_name": "System",
            "sender_role": "system",
            "sender_avatar": "⚙️",
            "receiver_id": team_doc_id,
            "receiver_name": new_name,
            "content": f"{my_ids['name']} renamed the group to '{new_name}'.",
            "attachments": [],
            "reply_to": None,
            "reactions": {},
            "is_pinned": False,
            "read_by": [my_ids["primary_id"]],
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        s_id = firestore_service.create_document("chat_messages", sys_msg)
        sys_msg["id"] = s_id
        invalidate_chat_cache("chat_messages")
        try:
            sync_message_to_mobile_app(
                msg_id=str(s_id),
                conversation_id=conv_id,
                chat_type="team",
                sender_identifier=my_ids["primary_id"],
                content=sys_msg["content"],
                target_id=team_doc_id,
                team_name=new_name,
                member_identifiers=source.get("memberIds") or source.get("members") or [],
                include_sender_in_members=False,
            )
        except Exception:
            pass
        await _broadcast_team_event(source, new_name or old_name, {"type": "new_message", "conversation_id": conv_id, "message": sys_msg})

    updated_team = firestore_service.get_document("teams", team_doc_id) if team else dict(source)
    if updated_team:
        updated_team["id"] = team_doc_id if team else conv_id
        updated_team["conversation_id"] = conv_id
        updated_team["name"] = new_name or old_name
        updated_team["teamName"] = new_name or old_name
        if new_desc is not None:
            updated_team["description"] = new_desc
    await _broadcast_team_event(updated_team or source, new_name or old_name, {"type": "team_updated", "team": updated_team, "conversation_id": conv_id})

    return {"success": True, "team": updated_team, "conversation_id": conv_id}


@router.post("/conversations/{group_id}/members", response_model=Dict[str, Any])
async def add_group_member(
    group_id: str,
    payload: MemberAction,
    current_user=Depends(get_current_user),
):
    """Add an employee member to a team group channel."""
    my_ids = get_user_identifiers(current_user)
    clean_gid = group_id[5:] if group_id.startswith("team_") else group_id
    team = firestore_service.get_document("teams", clean_gid) or firestore_service.get_document("teams", group_id)
    team_doc_id = str((team or {}).get("id") or clean_gid)
    mob_conv = None
    if not team:
        mob_conv = rest_get_document(f"chat_conversations/{group_id}") or rest_get_document(f"conversations/{group_id}")
        if not mob_conv:
            raise HTTPException(status_code=404, detail="Group not found.")

    source = team or mob_conv
    conv_id = str(source.get("conversation_id") or (group_id if mob_conv else f"team_{team_doc_id}")).strip()
    team_name = source.get("name") or source.get("groupName") or source.get("teamName") or "Group"
    my_keys = set(get_all_user_keys(my_ids))
    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or ""
    if not _user_can_access_team_doc(
        source,
        my_keys,
        my_ids["name"].strip().lower(),
        my_ids["employee_id"].strip().lower(),
        my_ids["email"].strip().lower(),
        my_auth_uid,
        False,
    ):
        raise HTTPException(status_code=403, detail="Access denied: You are not a member of this group.")
    members = list(source.get("members") or []) if isinstance(source.get("members"), list) else []
    member_ids = list(source.get("memberIds") or []) if isinstance(source.get("memberIds"), list) else []
    if not members and member_ids:
        members = [get_user_display_info(u)["name"] for u in member_ids]

    target_user = payload.user_id.strip()
    u_info = get_user_display_info(target_user)
    target_display = u_info.get("name") or target_user
    target_uid = resolve_auth_uid(target_user)

    changed = False
    if target_display not in members and target_user not in members:
        members.append(target_display)
        changed = True
    if target_uid and len(target_uid) >= 20 and "@" not in target_uid and target_uid not in member_ids:
        member_ids.append(target_uid)
        changed = True

    if changed:
        if team:
            firestore_service.update_document("teams", team_doc_id, {
                "members": members,
                "memberNames": members,
                "memberIds": member_ids,
            })

        now_iso = datetime.now(timezone.utc).isoformat()
        sys_msg = {
            "conversation_id": conv_id,
            "participant_ids": [str(team_doc_id)],
            "chat_type": "team",
            "target_id": team_doc_id,
            "team_id": team_doc_id,
            "team_name": team_name,
            "sender_id": "SYSTEM",
            "sender_name": "System",
            "sender_role": "system",
            "sender_avatar": "⚙️",
            "receiver_id": team_doc_id,
            "receiver_name": team_name,
            "content": f"{target_display} was added to the group by {my_ids['name']}.",
            "attachments": [],
            "reply_to": None,
            "reactions": {},
            "is_pinned": False,
            "read_by": [my_ids["primary_id"]],
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        s_id = firestore_service.create_document("chat_messages", sys_msg)
        sys_msg["id"] = s_id
        invalidate_chat_cache("teams", "chat_messages")
        try:
            if team:
                team["members"] = members
                team["memberNames"] = members
                team["memberIds"] = member_ids
                sync_team_to_mobile_app(str(team_doc_id), team, include_creator_in_members=False)
            sync_message_to_mobile_app(
                msg_id=str(s_id),
                conversation_id=conv_id,
                chat_type="team",
                sender_identifier=my_ids["primary_id"],
                content=sys_msg["content"],
                target_id=team_doc_id,
                team_name=team_name,
                member_identifiers=member_ids,
                include_sender_in_members=False,
            )
        except Exception:
            pass
        team_snapshot = dict(source)
        team_snapshot["members"] = members
        team_snapshot["memberIds"] = member_ids
        await _broadcast_team_event(team_snapshot, team_name, {"type": "new_message", "conversation_id": conv_id, "message": sys_msg})
        await _broadcast_team_event(team_snapshot, team_name, {
            "type": "team_updated",
            "conversation_id": conv_id,
            "team": {
                "id": team_doc_id if team else conv_id,
                "conversation_id": conv_id,
                "members": members,
                "memberNames": members,
                "memberIds": member_ids,
                "member_count": max(len(members), len(member_ids)),
            },
        })

    return {"success": True, "members": members, "member_ids": member_ids}


@router.delete("/conversations/{group_id}/members/{user_id}", response_model=Dict[str, Any])
async def remove_group_member(
    group_id: str,
    user_id: str,
    current_user=Depends(get_current_user),
):
    """Remove a member from a group, or leave the group."""
    my_ids = get_user_identifiers(current_user)
    clean_gid = group_id[5:] if group_id.startswith("team_") else group_id
    team = firestore_service.get_document("teams", clean_gid) or firestore_service.get_document("teams", group_id)
    team_doc_id = str((team or {}).get("id") or clean_gid)
    mob_conv = None
    if not team:
        mob_conv = rest_get_document(f"chat_conversations/{group_id}") or rest_get_document(f"conversations/{group_id}")
        if not mob_conv:
            raise HTTPException(status_code=404, detail="Group not found.")

    source = team or mob_conv
    conv_id = str(source.get("conversation_id") or (group_id if mob_conv else f"team_{team_doc_id}")).strip()
    team_name = source.get("name") or source.get("groupName") or source.get("teamName") or "Group"
    my_keys = set(get_all_user_keys(my_ids))
    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or ""
    if not _user_can_access_team_doc(
        source,
        my_keys,
        my_ids["name"].strip().lower(),
        my_ids["employee_id"].strip().lower(),
        my_ids["email"].strip().lower(),
        my_auth_uid,
        False,
    ):
        raise HTTPException(status_code=403, detail="Access denied: You are not a member of this group.")

    target_user = user_id.strip()
    u_info = get_user_display_info(target_user)
    target_uid = (resolve_auth_uid(target_user) or "").lower()
    target_keys = {k.lower() for k in (target_user, u_info.get("name"), u_info.get("employee_id"), target_uid) if k}

    is_self = user_matches_target(my_ids, target_user)
    my_keys = set(get_all_user_keys(my_ids))
    my_uid = (resolve_auth_uid(my_ids["primary_id"]) or "").lower()
    is_group_manager = _can_user_delete_group(source, team_name, my_ids, my_keys, my_uid)

    if not is_self and not is_group_manager:
        raise HTTPException(status_code=403, detail="Permission denied to remove member.")

    members = list(source.get("members") or []) if isinstance(source.get("members"), list) else []
    member_ids = list(source.get("memberIds") or []) if isinstance(source.get("memberIds"), list) else []
    if not members and member_ids:
        members = [get_user_display_info(u)["name"] for u in member_ids]

    new_members = [m for m in members if str(m).strip().lower() not in target_keys]
    new_member_ids = [uid for uid in member_ids if str(uid).strip().lower() not in target_keys]
    if team:
        firestore_service.update_document("teams", team_doc_id, {
            "members": new_members,
            "memberNames": new_members,
            "memberIds": new_member_ids,
        })

    now_iso = datetime.now(timezone.utc).isoformat()
    display_name = u_info.get("name") or target_user
    action_str = f"{display_name} left the group." if is_self else f"{display_name} was removed by {my_ids['name']}."
    sys_msg = {
        "conversation_id": conv_id,
        "participant_ids": [str(team_doc_id)],
        "chat_type": "team",
        "target_id": team_doc_id,
        "team_id": team_doc_id,
        "team_name": team_name,
        "sender_id": "SYSTEM",
        "sender_name": "System",
        "sender_role": "system",
        "sender_avatar": "⚙️",
        "receiver_id": team_doc_id,
        "receiver_name": team_name,
        "content": action_str,
        "attachments": [],
        "reply_to": None,
        "reactions": {},
        "is_pinned": False,
        "read_by": [my_ids["primary_id"]],
        "created_at": now_iso,
        "updated_at": now_iso,
    }
    s_id = firestore_service.create_document("chat_messages", sys_msg)
    sys_msg["id"] = s_id
    invalidate_chat_cache("teams", "chat_messages")
    try:
        if team:
            team["members"] = new_members
            team["memberNames"] = new_members
            team["memberIds"] = new_member_ids
            sync_team_to_mobile_app(str(team_doc_id), team, include_creator_in_members=False)
        else:
            member_name_map = {uid: get_user_display_info(uid)["name"] for uid in new_member_ids}
            for col in ("chat_conversations", "conversations"):
                if rest_get_document(f"{col}/{conv_id}"):
                    rest_patch_document(
                        f"{col}/{conv_id}",
                        {"memberIds": new_member_ids, "memberNames": member_name_map},
                        merge_fields=["memberIds", "memberNames"],
                    )
        sync_message_to_mobile_app(
            msg_id=str(s_id),
            conversation_id=conv_id,
            chat_type="team",
            sender_identifier=my_ids["primary_id"],
            content=sys_msg["content"],
            target_id=team_doc_id,
            team_name=team_name,
            member_identifiers=new_member_ids,
            include_sender_in_members=False,
        )
    except Exception:
        pass
    await _broadcast_team_event(source, team_name, {"type": "new_message", "conversation_id": conv_id, "message": sys_msg})
    await _broadcast_team_event(source, team_name, {
        "type": "team_updated",
        "conversation_id": conv_id,
        "team": {
            "id": team_doc_id if team else conv_id,
            "conversation_id": conv_id,
            "members": new_members,
            "memberNames": new_members,
            "memberIds": new_member_ids,
            "member_count": max(len(new_members), len(new_member_ids)),
        },
    })

    return {"success": True, "members": new_members, "member_ids": new_member_ids}


def _resolve_group_for_mutation(group_id: str) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]], str, str, str]:
    """Locate a team/group document across Website `teams` and Mobile `chat_conversations`/`conversations`."""
    raw_gid = str(group_id or "").strip()
    clean_gid = raw_gid[5:] if raw_gid.startswith("team_") else raw_gid
    team = firestore_service.get_document("teams", clean_gid) or firestore_service.get_document("teams", raw_gid)
    if not team:
        target_cid = raw_gid if raw_gid.startswith("team_") else f"team_{clean_gid}"
        for t in get_cached_collection("teams"):
            t_cid = str(t.get("conversation_id") or "").strip()
            t_tid = str(t.get("id") or t.get("team_id") or "").strip()
            if raw_gid in (t_cid, t_tid) or clean_gid in (t_cid, t_tid) or target_cid == t_cid:
                team = t
                break

    team_doc_id = str((team or {}).get("id") or (team or {}).get("_firestore_id") or clean_gid).strip()
    mob_conv = (
        rest_get_document(f"chat_conversations/{raw_gid}")
        or rest_get_document(f"chat_conversations/team_{clean_gid}")
        or rest_get_document(f"conversations/{raw_gid}")
        or rest_get_document(f"conversations/team_{clean_gid}")
    )
    if not team and not mob_conv:
        raise HTTPException(status_code=404, detail="Group not found.")

    source = team or mob_conv
    conv_id = str(
        source.get("conversation_id")
        or source.get("conversationId")
        or (mob_conv.get("id") if mob_conv else "")
        or (f"team_{team_doc_id}" if team else raw_gid)
    ).strip()
    team_name = str(
        source.get("name") or source.get("groupName") or source.get("teamName") or source.get("title") or "Group"
    ).strip()
    return team, mob_conv, team_doc_id, conv_id, team_name


@router.delete("/conversations/{group_id}", response_model=Dict[str, Any])
@router.delete("/teams/{group_id}", response_model=Dict[str, Any])
async def delete_group_channel(
    group_id: str,
    current_user=Depends(get_current_user),
):
    """Permanently delete a team/group chat across Website, Backend Cache, Mobile App, and Cloud Storage."""
    my_ids = get_user_identifiers(current_user)
    my_keys = set(get_all_user_keys(my_ids))
    my_auth_uid = resolve_auth_uid(my_ids["primary_id"]) or resolve_auth_uid(my_ids["email"]) or my_ids.get("uid") or ""

    team, mob_conv, team_doc_id, conv_id, team_name = _resolve_group_for_mutation(group_id)
    if _is_protected_general_group(team_name):
        raise HTTPException(status_code=403, detail="The company-wide general channel cannot be deleted.")

    merged_source: Dict[str, Any] = {}
    if mob_conv:
        merged_source.update(mob_conv)
    if team:
        merged_source.update(team)

    if not _can_user_delete_group(merged_source, team_name, my_ids, my_keys, my_auth_uid):
        raise HTTPException(
            status_code=403,
            detail="Only the group creator or group admin can delete this group.",
        )

    cleanup_summary = delete_team_and_sync_mobile(
        team_doc_id,
        conv_id,
        deleted_by=my_auth_uid or my_ids["primary_id"],
    )

    try:
        firestore_service.create_document("audit_logs", {
            "actor_id": my_ids["primary_id"],
            "actor_email": my_ids.get("email", ""),
            "action": "DELETE_GROUP_CHAT",
            "target_type": "teams",
            "target_id": team_doc_id,
            "conversation_id": conv_id,
            "group_name": team_name,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass

    await _broadcast_team_event(merged_source, team_name, {
        "type": "team_deleted",
        "team_id": team_doc_id,
        "conversation_id": conv_id,
        "deleted_by": my_ids["name"],
    })

    return {
        "success": True,
        "team_id": team_doc_id,
        "conversation_id": conv_id,
        "cleanup": cleanup_summary,
        "message": f"Group '{team_name}' deleted across website and mobile app.",
    }


# ==============================================================================
# WebSocket Endpoint
# ==============================================================================
@router.websocket("/ws")
async def chat_websocket_endpoint(
    websocket: WebSocket,
    token: Optional[str] = Query(None),
):
    """
    Real-time WebSocket connection for instant chat delivery, typing indicators,
    and online presence notifications.
    """
    # 1. Authenticate token
    user_data = None
    if token:
        payload = decode_access_token(token)
        if payload:
            user_data = {
                "id": payload.get("sub"),
                "role": payload.get("role", "employee"),
                "email": payload.get("email"),
                "employee_id": payload.get("employeeId") or payload.get("employee_id"),
            }
        else:
            fb = verify_firebase_token(token)
            if fb:
                user_data = {
                    "id": fb.get("uid"),
                    "role": fb.get("role") or ("admin" if fb.get("admin") else "employee"),
                    "email": fb.get("email"),
                }

    if not user_data:
        # Fallback for dev mode
        user_data = {"id": "ADM-001", "role": "admin", "email": "admin@arshith.com"}

    class TempUser:
        pass
    tu = TempUser()
    for k, v in user_data.items():
        setattr(tu, k, v)

    user_ids = get_user_identifiers(tu)
    auth_uid = resolve_auth_uid(user_ids["primary_id"]) or resolve_auth_uid(user_ids["email"])
    if auth_uid:
        info = get_user_display_info(auth_uid)
        if not user_ids["employee_id"] and info.get("employee_id"):
            user_ids["employee_id"] = info["employee_id"]
            user_ids["primary_id"] = info["employee_id"]
        if not user_ids["email"] and info.get("email"):
            user_ids["email"] = info["email"].lower()
    user_keys = get_all_user_keys(user_ids)
    if auth_uid and auth_uid.lower() not in user_keys:
        user_keys.append(auth_uid.lower())

    def _presence_event(online: bool, last_seen: str = "") -> Dict[str, Any]:
        return {
            "type": "presence",
            "user_id": user_ids["primary_id"],
            "employee_id": user_ids["employee_id"] or user_ids["primary_id"],
            "uid": auth_uid or "",
            "email": user_ids["email"] or "",
            "status": "online" if online else "offline",
            "is_online": online,
            "last_seen": "" if online else last_seen,
        }

    async def _handle_ws_disconnect():
        manager.disconnect(websocket, user_keys)
        still_online = any(manager.is_user_online(k) for k in user_keys)
        if not still_online:
            now_iso = datetime.now(timezone.utc).isoformat()
            manager.record_last_seen(user_keys, now_iso)
            invalidate_chat_cache("chat_presence")
            await manager.broadcast_all(_presence_event(False, now_iso))
            await asyncio.to_thread(update_user_presence, auth_uid or user_ids["primary_id"], False)

    await manager.connect(websocket, user_keys)
    invalidate_chat_cache("chat_presence")
    asyncio.create_task(asyncio.to_thread(update_user_presence, auth_uid or user_ids["primary_id"], True))
    last_ping_sync = time.monotonic()

    # Broadcast presence
    await manager.broadcast_all(_presence_event(True))

    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
                action = data.get("action")

                if action == "typing":
                    # Broadcast typing status to recipients
                    target_id = str(data.get("target_id", "")).strip().lower()
                    chat_type = data.get("chat_type", "direct")
                    is_typing = bool(data.get("is_typing", True))
                    event = {
                        "type": "typing",
                        "sender_id": user_ids["primary_id"],
                        "sender_name": user_ids["name"],
                        "chat_type": chat_type,
                        "target_id": target_id,
                        "is_typing": is_typing,
                    }
                    if chat_type == "direct":
                        await manager.broadcast_to_keys([target_id], event)
                    else:
                        target_team = next(
                            (
                                t for t in get_cached_collection("teams")
                                if str(t.get("id") or "").strip().lower() == target_id
                                or str(t.get("conversation_id") or "").strip().lower() == target_id
                                or f"team_{str(t.get('id') or '').strip().lower()}" == target_id
                            ),
                            None,
                        )
                        if target_team:
                            t_title = str(target_team.get("name") or target_team.get("teamName") or "")
                            await _broadcast_team_event(target_team, t_title, event)
                        elif "general" in target_id:
                            await manager.broadcast_all(event)

                elif action == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
                    now_mono = time.monotonic()
                    if now_mono - last_ping_sync >= 20.0:
                        last_ping_sync = now_mono
                        asyncio.create_task(asyncio.to_thread(update_user_presence, auth_uid or user_ids["primary_id"], True))

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        await _handle_ws_disconnect()
    except Exception as e:
        logger.debug(f"Chat websocket closed with error: {e}")
        await _handle_ws_disconnect()
