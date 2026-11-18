import pytest
import io
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

ADMIN_EMAIL = "admin@arshith.com"
ADMIN_PASSWORD = "AdminPassword@123"
EMPLOYEE_EMAIL = "employee@arshith.com"
EMPLOYEE_PASSWORD = "Employee@123"


@pytest.fixture(scope="module")
def admin_token():
    res = client.post(
        "/api/auth/admin-login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    if res.status_code != 200:
        res = client.post(
            "/api/auth/admin-login",
            json={"email": ADMIN_EMAIL, "password": "Admin@123"},
        )
    assert res.status_code == 200
    return res.json()["access_token"]


@pytest.fixture(scope="module")
def employee_token():
    res = client.post(
        "/api/auth/login",
        json={"email": EMPLOYEE_EMAIL, "password": EMPLOYEE_PASSWORD},
    )
    assert res.status_code == 200
    return res.json()["access_token"]


def test_get_contacts(admin_token, employee_token):
    """Test contacts retrieval for both admin and employee."""
    # Admin gets contacts
    res_admin = client.get("/api/chat/contacts", headers={"Authorization": f"Bearer {admin_token}"})
    assert res_admin.status_code == 200
    contacts_admin = res_admin.json()
    assert isinstance(contacts_admin, list)

    # Employee gets contacts
    res_emp = client.get("/api/chat/contacts", headers={"Authorization": f"Bearer {employee_token}"})
    assert res_emp.status_code == 200
    contacts_emp = res_emp.json()
    assert isinstance(contacts_emp, list)
    # Admin should be in contacts for employee
    assert any(c["role"] == "admin" or c["id"] == "ADM-001" for c in contacts_emp)


def test_get_teams_and_channels(admin_token, employee_token):
    """Test team channels retrieval."""
    res = client.get("/api/chat/teams", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    teams = res.json()
    assert isinstance(teams, list)


def test_direct_messaging_workflow(admin_token, employee_token):
    """Test complete direct messaging workflow: send, edit, reaction, pin, delete."""
    # 1. Admin sends message to employee
    send_res = client.post(
        "/api/chat/messages",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "chat_type": "direct",
            "target_id": "AFI-001",
            "content": "Hello employee! Please review the sprint goals.",
            "attachments": [],
        },
    )
    assert send_res.status_code == 201
    msg_data = send_res.json()
    msg_id = msg_data["id"]
    assert msg_data["content"] == "Hello employee! Please review the sprint goals."

    # 2. Admin edits their own message
    edit_res = client.patch(
        f"/api/chat/messages/{msg_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"content": "Hello employee! Please review the sprint goals ASAP."},
    )
    assert edit_res.status_code == 200
    assert edit_res.json()["message"]["content"] == "Hello employee! Please review the sprint goals ASAP."
    assert edit_res.json()["message"]["is_edited"] is True

    # 3. Employee toggles reaction
    react_res = client.post(
        f"/api/chat/messages/{msg_id}/reactions",
        headers={"Authorization": f"Bearer {employee_token}"},
        json={"emoji": "👍"},
    )
    assert react_res.status_code == 200
    assert "👍" in react_res.json()["reactions"]

    # 4. Toggle pin
    pin_res = client.post(
        f"/api/chat/messages/{msg_id}/pin",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert pin_res.status_code == 200
    assert pin_res.json()["is_pinned"] is True

    # 5. Retrieve message history
    history_res = client.get(
        "/api/chat/messages",
        headers={"Authorization": f"Bearer {employee_token}"},
        params={"chat_type": "direct", "target_id": "ADM-001"},
    )
    assert history_res.status_code == 200
    history = history_res.json()
    assert any(m["id"] == msg_id for m in history)

    # 6. Delete message
    del_res = client.delete(
        f"/api/chat/messages/{msg_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert del_res.status_code == 200


def test_group_channel_workflow(admin_token, employee_token):
    """Test group creation, adding members, and member leaving/removal."""
    # 1. Admin creates a custom team group
    group_res = client.post(
        "/api/chat/conversations/group",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "name": "Frontend Guild",
            "description": "Collaboration on web architecture",
            "member_ids": ["AFI-001"],
        },
    )
    assert group_res.status_code == 200
    group_data = group_res.json()
    group_id = str(group_data["id"])
    assert group_data["name"] == "Frontend Guild"
    assert "AFI-001" in group_data["members"]

    # 2. Add an additional member
    add_res = client.post(
        f"/api/chat/conversations/{group_id}/members",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"user_id": "AFI-002"},
    )
    assert add_res.status_code == 200
    assert "AFI-002" in add_res.json()["members"]

    # 3. Post a message to group
    post_res = client.post(
        "/api/chat/messages",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "chat_type": "team",
            "target_id": group_id,
            "content": "Welcome all to Frontend Guild!",
        },
    )
    assert post_res.status_code == 201

    # 4. Remove a member
    rem_res = client.delete(
        f"/api/chat/conversations/{group_id}/members/AFI-002",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert rem_res.status_code == 200
    assert "AFI-002" not in rem_res.json()["members"]


def test_file_attachment_upload(admin_token):
    """Test attachment upload with validation and size check."""
    # 1. Allowed text file upload
    file_content = b"Sample work specification document content."
    file_obj = io.BytesIO(file_content)

    upload_res = client.post(
        "/api/chat/attachments/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("project_spec.txt", file_obj, "text/plain")},
    )
    assert upload_res.status_code == 200
    file_info = upload_res.json()
    assert file_info["filename"] == "project_spec.txt"
    assert file_info["url"].startswith("/static/chat_uploads/")
    assert file_info["is_image"] is False

    # 2. Reject disallowed executable file
    exe_file = io.BytesIO(b"binary content")
    bad_upload = client.post(
        "/api/chat/attachments/upload",
        headers={"Authorization": f"Bearer {admin_token}"},
        files={"file": ("script.exe", exe_file, "application/x-msdownload")},
    )
    assert bad_upload.status_code == 400


def test_unread_count_endpoint(admin_token, employee_token):
    """Test unread count check for navbar badges."""
    res = client.get("/api/chat/unread-count", headers={"Authorization": f"Bearer {employee_token}"})
    assert res.status_code == 200
    assert "total_unread" in res.json()
    assert isinstance(res.json()["total_unread"], int)


def test_admin_cannot_view_employee_to_employee_direct_chats(admin_token, monkeypatch):
    """Admin must only see their own DMs and group channels, never private employee-to-employee DMs."""
    from app.routers import chat as chat_router

    captured_calls = []

    def _fake_fetch_mobile_convs(user_auth_uid, is_admin=False):
        captured_calls.append((user_auth_uid, is_admin))
        # Simulate mobile conversations list containing both an employee-employee DM and an admin-employee DM
        all_rows = [
            {
                "conversation_id": "direct_uid9001_uid9002",
                "type": "direct",
                "member_ids": ["uid9001", "uid9002"],
                "last_message": "Private employee chat",
                "last_message_at": "2026-11-12T04:30:00Z",
                "unread_counts": {},
            },
            {
                "conversation_id": "direct_ezvZfsphCqUpkgvu18ldvi7XW9D2_uid9001",
                "type": "direct",
                "member_ids": ["ezvZfsphCqUpkgvu18ldvi7XW9D2", "uid9001"],
                "last_message": "Message with Admin",
                "last_message_at": "2026-11-12T04:31:00Z",
                "unread_counts": {},
            },
        ]
        if is_admin:
            return all_rows
        return [r for r in all_rows if user_auth_uid and user_auth_uid in r["member_ids"]]

    monkeypatch.setattr(chat_router, "fetch_live_mobile_conversations", _fake_fetch_mobile_convs)

    # 1. Admin's conversation list must only include direct chats where Admin is a participant
    conv_res = client.get("/api/chat/conversations", headers={"Authorization": f"Bearer {admin_token}"})
    assert conv_res.status_code == 200
    assert any(not is_adm for (_, is_adm) in captured_calls)
    direct_convs = [c for c in conv_res.json() if c.get("type") == "direct"]
    direct_cids = {c.get("conversation_id") for c in direct_convs}
    direct_msgs = {c.get("last_message") for c in direct_convs}
    assert "Private employee chat" not in direct_msgs
    assert not any("uid9002" in str(cid) for cid in direct_cids)

    # 2. Admin fetching messages of an employee-to-employee DM directly must be forbidden (403)
    msg_res = client.get(
        "/api/chat/messages",
        params={"chat_type": "direct", "conversation_id": "dm_AFI-9001_AFI-9002"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert msg_res.status_code == 403


def test_admin_cannot_view_private_groups_without_membership(admin_token, monkeypatch):
    """Admin must not see, read, post to, or delete private employee groups unless explicitly added."""
    from app.routers import chat as chat_router

    fake_teams = [
        {
            "id": "GENERAL_COMPANY",
            "name": "General & Company-Wide",
            "conversation_id": "team_GENERAL_COMPANY",
            "members": ["Employee One"],
            "memberIds": ["uid9001"],
            "active": True,
        },
        {
            "id": "GRP_PRIVATE_99",
            "name": "Secret Dev Squad",
            "conversation_id": "team_GRP_PRIVATE_99",
            "created_by": "AFI-9001",
            "createdBy": "uid9001",
            "leader": "Employee One",
            "members": ["Employee One", "Employee Two"],
            "memberIds": ["uid9001", "uid9002"],
            "active": True,
            "is_custom_group": True,
        },
        {
            "id": "GRP_WITH_ADMIN_100",
            "name": "Ops With Admin",
            "conversation_id": "team_GRP_WITH_ADMIN_100",
            "created_by": "AFI-9001",
            "createdBy": "uid9001",
            "leader": "Employee One",
            "members": ["Employee One", "Administrator"],
            "memberIds": ["uid9001", "ezvZfsphCqUpkgvu18ldvi7XW9D2"],
            "active": True,
            "is_custom_group": True,
        },
    ]

    orig_get_cached = chat_router.get_cached_collection

    def _fake_get_cached(col_name):
        if col_name == "teams":
            return list(fake_teams)
        if col_name == "chat_messages":
            return []
        if col_name == "chat_deleted_groups":
            return []
        return orig_get_cached(col_name)

    monkeypatch.setattr(chat_router, "get_cached_collection", _fake_get_cached)
    monkeypatch.setattr(chat_router, "warm_chat_collections_parallel", lambda *a, **k: None)
    monkeypatch.setattr(chat_router, "fetch_live_mobile_conversations", lambda uid, is_admin=False: [
        {
            "conversation_id": "team_MOB_PRIV_88",
            "team_id": "MOB_PRIV_88",
            "type": "team",
            "title": "Mobile Only Private",
            "member_ids": ["uid9001", "uid9002"],
            "created_by": "uid9001",
            "last_message": "Secret mobile group msg",
            "last_message_at": "2026-11-12T04:40:00Z",
            "unread_counts": {},
        }
    ] if is_admin else [])
    monkeypatch.setattr(
        chat_router.firestore_service,
        "get_document",
        lambda col, did: next((t for t in fake_teams if str(t["id"]) == str(did) or str(t.get("conversation_id")) == str(did)), None) if col == "teams" else None,
    )

    # 1. /api/chat/teams hides groups where Admin was not added, keeps General & joined groups
    teams_res = client.get("/api/chat/teams", headers={"Authorization": f"Bearer {admin_token}"})
    assert teams_res.status_code == 200
    team_ids = {t["id"] for t in teams_res.json()}
    assert "GENERAL_COMPANY" in team_ids
    assert "GRP_WITH_ADMIN_100" in team_ids
    assert "GRP_PRIVATE_99" not in team_ids
    assert "team_MOB_PRIV_88" not in team_ids

    # 2. /api/chat/conversations hides groups where Admin was not added
    conv_res = client.get("/api/chat/conversations", headers={"Authorization": f"Bearer {admin_token}"})
    assert conv_res.status_code == 200
    conv_cids = {c["conversation_id"] for c in conv_res.json()}
    assert "team_GRP_WITH_ADMIN_100" in conv_cids
    assert "team_GRP_PRIVATE_99" not in conv_cids
    assert "team_MOB_PRIV_88" not in conv_cids

    # 3. Reading messages, posting messages, or deleting an unjoined private group returns 403 for Admin
    get_msg_res = client.get(
        "/api/chat/messages",
        params={"chat_type": "team", "target_id": "GRP_PRIVATE_99"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert get_msg_res.status_code == 403

    post_msg_res = client.post(
        "/api/chat/messages",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"chat_type": "team", "target_id": "GRP_PRIVATE_99", "content": "Snooping"},
    )
    assert post_msg_res.status_code == 403

    del_grp_res = client.delete(
        "/api/chat/teams/GRP_PRIVATE_99",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert del_grp_res.status_code == 403


