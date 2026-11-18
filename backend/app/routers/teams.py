from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.services.firestore_service import firestore_service
from app.dependencies.auth import get_current_user, get_current_admin

router = APIRouter(prefix="/teams", tags=["Teams"])


class TeamCreate(BaseModel):
    teamName: str
    department: Optional[str] = "Operations"
    description: Optional[str] = ""
    leader: Optional[str] = None
    members: Optional[List[str]] = []
    memberIds: Optional[List[str]] = []
    sync_to_chat: Optional[bool] = None
    source: Optional[str] = None


def format_team(doc: dict) -> dict:
    members = doc.get("members", [])
    if not isinstance(members, list):
        members = []
    member_ids = doc.get("memberIds", [])
    if not isinstance(member_ids, list):
        member_ids = []
    leader = doc.get("leader") or (members[0] if members else "Unassigned")
    doc_id = doc.get("id")
    sync_to_chat = doc.get("sync_to_chat") is not False and str(doc.get("team_scope") or "").lower() != "project_hr"
    return {
        "id": doc_id,
        "conversation_id": (doc.get("conversation_id") or (f"team_{doc_id}" if doc_id else "")) if sync_to_chat else "",
        "name": doc.get("name", doc.get("teamName", "")),
        "teamName": doc.get("name", doc.get("teamName", "")),
        "department": doc.get("department", "Operations"),
        "description": doc.get("description", ""),
        "leader": leader,
        "members": members,
        "memberIds": member_ids,
        "memberCount": max(len(members), len(member_ids)),
        "sync_to_chat": sync_to_chat,
        "team_scope": doc.get("team_scope") or ("project_hr" if not sync_to_chat else "chat"),
    }


format_team_response = format_team


@router.get("", response_model=List[dict])
def list_teams(
    current_user=Depends(get_current_user),
):
    """List operational teams and member lists from Firestore."""
    try:
        from app.services.chat_sync_service import ensure_bidirectional_teams_synced
        ensure_bidirectional_teams_synced(max_age_seconds=20)
    except Exception:
        pass
    docs = [t for t in firestore_service.list_documents("teams") if t.get("active") is not False]
    docs.sort(key=lambda t: str(t.get("name", "")).lower())
    return [format_team(t) for t in docs]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=dict)
async def create_team(
    data: TeamCreate,
    admin_user=Depends(get_current_admin),
):
    """Create team and enroll staff members (Admin or Project HR)."""
    clean_name = data.teamName.strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Team name is required.")

    actor_role = str(getattr(admin_user, "role", "") or "").strip().lower()
    is_project_hr_team = (
        data.sync_to_chat is False
        or str(data.source or "").strip().lower() == "project_hr"
        or (actor_role in ("hr_projects", "project_hr") and data.sync_to_chat is not True)
    )
    should_sync_chat = not is_project_hr_team

    # Check duplicate only within the same team scope (do not let Teams Chat groups block Project HR Team Management)
    existing = [
        t for t in firestore_service.list_documents("teams", [("name", "==", clean_name)])
        if t.get("active") is not False and (
            (not should_sync_chat and (t.get("sync_to_chat") is False or str(t.get("team_scope") or "").lower() == "project_hr"))
            or (should_sync_chat and t.get("sync_to_chat") is not False and str(t.get("team_scope") or "").lower() != "project_hr")
        )
    ]
    if existing:
        raise HTTPException(status_code=409, detail=f"Team '{clean_name}' already exists.")

    from app.services.chat_sync_service import (
        get_user_display_info,
        invalidate_chat_cache,
        resolve_auth_uid,
        sync_message_to_mobile_app,
        sync_team_to_mobile_app,
    )
    from app.routers.chat import get_user_identifiers, manager

    admin_ids = get_user_identifiers(admin_user)
    creator_uid = (
        resolve_auth_uid(admin_ids["primary_id"])
        or resolve_auth_uid(admin_ids["email"])
        or admin_ids["uid"]
        or admin_ids["primary_id"]
    )

    resolved_members = []
    resolved_uids = []
    raw_inputs = list(data.memberIds) if data.memberIds else list(data.members or [])
    if data.leader and data.leader.strip() and data.leader.strip() not in raw_inputs:
        raw_inputs.append(data.leader.strip())

    for m in raw_inputs:
        m_clean = str(m or "").strip()
        if not m_clean:
            continue
        info = get_user_display_info(m_clean)
        uid = resolve_auth_uid(m_clean)
        display_name = info.get("name") or m_clean
        if display_name not in resolved_members:
            resolved_members.append(display_name)
        if uid and len(uid) >= 20 and "@" not in uid and uid not in resolved_uids:
            resolved_uids.append(uid)

    # Also keep explicit display names passed in data.members when memberIds lacked a Firebase UID
    for m_name in (data.members or []):
        clean_m = str(m_name or "").strip()
        if clean_m and clean_m not in resolved_members:
            resolved_members.append(clean_m)

    leader_uid = resolve_auth_uid(data.leader) if data.leader else None
    if leader_uid and len(leader_uid) >= 20 and "@" not in leader_uid and leader_uid in resolved_uids:
        group_admins = [leader_uid]
    elif resolved_uids:
        group_admins = [resolved_uids[0]]
    else:
        group_admins = []

    now_iso = datetime.now(timezone.utc).isoformat()
    team_data = {
        "name": clean_name,
        "teamName": clean_name,
        "team_name": clean_name,
        "department": data.department or "Operations",
        "description": data.description.strip() if data.description else "",
        "leader": data.leader or (resolved_members[0] if resolved_members else None),
        "createdBy": creator_uid,
        "created_by": admin_ids["primary_id"],
        "groupAdmins": group_admins,
        "members": resolved_members,
        "memberNames": resolved_members,
        "memberIds": resolved_uids,
        "active": True,
        "sync_to_chat": should_sync_chat,
        "team_scope": "chat" if should_sync_chat else "project_hr",
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    doc_id = firestore_service.create_document("teams", team_data)
    team_data["id"] = doc_id
    team_data["team_id"] = doc_id

    if should_sync_chat:
        conv_id = f"team_{doc_id}"
        team_data["conversation_id"] = conv_id

        sys_msg = {
            "conversation_id": conv_id,
            "participant_ids": [str(doc_id)],
            "chat_type": "team",
            "target_id": str(doc_id),
            "team_id": str(doc_id),
            "team_name": clean_name,
            "sender_id": "SYSTEM",
            "sender_name": "System",
            "sender_role": "system",
            "sender_avatar": "⚙️",
            "receiver_id": str(doc_id),
            "receiver_name": clean_name,
            "content": f"Team '{clean_name}' was created by {admin_ids['name']}.",
            "attachments": [],
            "reply_to": None,
            "reactions": {},
            "is_pinned": False,
            "read_by": [admin_ids["primary_id"]],
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        s_id = firestore_service.create_document("chat_messages", sys_msg)
        sys_msg["id"] = s_id
        invalidate_chat_cache("teams", "chat_messages")

        try:
            sync_team_to_mobile_app(str(doc_id), team_data, include_creator_in_members=False)
            if resolved_uids:
                sync_message_to_mobile_app(
                    msg_id=str(s_id),
                    conversation_id=conv_id,
                    chat_type="team",
                    sender_identifier=creator_uid or resolved_uids[0],
                    content=sys_msg["content"],
                    target_id=str(doc_id),
                    team_name=clean_name,
                    member_identifiers=resolved_uids,
                    include_sender_in_members=False,
                )
        except Exception:
            pass

        formatted = format_team(team_data)
        await manager.broadcast_all({"type": "new_team", "team": formatted})
    else:
        invalidate_chat_cache("teams")
        formatted = format_team(team_data)

    # Record audit log
    firestore_service.create_document("audit_logs", {
        "actor_id": admin_user.id,
        "actor_email": admin_user.email,
        "action": "CREATE_TEAM",
        "target_type": "teams",
        "target_id": doc_id,
        "timestamp": now_iso,
    })

    return formatted


@router.delete("/{team_id}", status_code=status.HTTP_200_OK)
async def delete_team(
    team_id: str,
    admin_user=Depends(get_current_admin),
):
    """Disband team (Admin only)."""
    team = firestore_service.get_document("teams", str(team_id))
    if not team:
        # Check integer match
        teams = firestore_service.list_documents("teams")
        for t in teams:
            if str(t.get("id")) == str(team_id):
                team = t
                break

    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    conv_id = str(team.get("conversation_id") or f"team_{team['id']}").strip()
    deleted_team_id = str(team["id"])
    try:
        from app.services.chat_sync_service import delete_team_and_sync_mobile
        delete_team_and_sync_mobile(
            deleted_team_id,
            conv_id,
            deleted_by=str(getattr(admin_user, "email", None) or getattr(admin_user, "id", "")),
        )
    except Exception:
        firestore_service.delete_document("teams", deleted_team_id)

    try:
        from app.routers.chat import manager
        await manager.broadcast_all({
            "type": "team_deleted",
            "team_id": deleted_team_id,
            "conversation_id": conv_id,
        })
    except Exception:
        pass

    # Record audit log
    firestore_service.create_document("audit_logs", {
        "actor_id": admin_user.id,
        "actor_email": admin_user.email,
        "action": "DELETE_TEAM",
        "target_type": "teams",
        "target_id": deleted_team_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })

    return {"success": True, "message": "Team deleted successfully"}
