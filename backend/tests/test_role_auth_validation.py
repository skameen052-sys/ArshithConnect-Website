import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.db.session import SessionLocal
from app.models.user import User
from app.models.employee import Employee
from app.core.security import get_password_hash, create_access_token

client = TestClient(app)

ADMIN_EMAIL = "admin@arshith.com"
ADMIN_PASSWORD = "AdminPassword@123"
EMPLOYEE_EMAIL = "employee@arshith.com"
EMPLOYEE_PASSWORD = "Employee@123"


def test_valid_employee_credentials_on_employee_login():
    """1. Valid Employee credentials on Employee Login should succeed with role 'employee'."""
    res = client.post(
        "/api/auth/login",
        json={"email": EMPLOYEE_EMAIL, "password": EMPLOYEE_PASSWORD},
    )
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "employee"
    assert data["user"]["email"] == EMPLOYEE_EMAIL
    assert data["user"]["role"] == "employee"


def test_valid_admin_credentials_on_admin_login():
    """2. Valid Admin credentials on Admin Login should succeed with role 'admin'."""
    res = client.post(
        "/api/auth/admin-login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "admin"
    assert data["user"]["email"] == ADMIN_EMAIL
    assert data["user"]["role"] == "admin"


def test_admin_credentials_on_employee_login_rejected():
    """3. Admin credentials on Employee Login must be rejected with the exact required message."""
    res = client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    )
    assert res.status_code == 403
    data = res.json()
    assert data["detail"] == (
        "Admin credentials cannot be used to log in through Employee Login. Please use the Admin Login page."
    )
    assert "access_token" not in data


def test_employee_credentials_on_admin_login_rejected():
    """4. Employee credentials on Admin Login must be rejected with the exact required message."""
    res = client.post(
        "/api/auth/admin-login",
        json={"email": EMPLOYEE_EMAIL, "password": EMPLOYEE_PASSWORD},
    )
    assert res.status_code == 403
    data = res.json()
    assert data["detail"] == (
        "Employee credentials cannot be used to log in through Admin Login. Please use the Employee Login page."
    )
    assert "access_token" not in data


def test_incorrect_credentials_rejected():
    """5. Incorrect credentials must be rejected with HTTP 401."""
    # Incorrect employee credentials
    res_emp = client.post(
        "/api/auth/login",
        json={"email": EMPLOYEE_EMAIL, "password": "WrongPassword@999"},
    )
    assert res_emp.status_code == 401
    assert "Invalid employee email or password" in res_emp.json()["detail"]

    # Incorrect admin credentials
    res_adm = client.post(
        "/api/auth/admin-login",
        json={"email": ADMIN_EMAIL, "password": "WrongPassword@999"},
    )
    assert res_adm.status_code == 401
    assert "Invalid administrator credentials" in res_adm.json()["detail"]

    # Admin email with wrong password on employee login must return 401 without leaking admin status
    res_admin_wrong_pass = client.post(
        "/api/auth/login",
        json={"email": ADMIN_EMAIL, "password": "WrongPassword@999"},
    )
    assert res_admin_wrong_pass.status_code == 401
    assert "Invalid employee email or password" in res_admin_wrong_pass.json()["detail"]

    # Non-existent email
    res_non_existent = client.post(
        "/api/auth/login",
        json={"email": "nonexistent@arshith.com", "password": "AnyPassword@123"},
    )
    assert res_non_existent.status_code in (400, 401, 404)


def test_inactive_employee_account_rejected():
    """6. Inactive employee account must be rejected with HTTP 403."""
    inactive_email = "inactive_emp_test@arshith.com"
    from app.core.config import settings
    from app.services.firestore_service import FirestoreService

    if settings.DATABASE_BACKEND == "firebase":
        user_doc = {
            "id": "inactive_emp_test",
            "email": inactive_email,
            "hashed_password": get_password_hash("TestPassword@123"),
            "role": "employee",
            "is_active": False,
            "approval_status": "APPROVED",
        }
        FirestoreService.save("users", "inactive_emp_test", user_doc)
        emp_doc = {
            "id": "AFI-INACTIVE",
            "employee_id": "AFI-INACTIVE",
            "user_id": "inactive_emp_test",
            "full_name": "Inactive Employee",
            "email": inactive_email,
            "status": "Inactive",
        }
        FirestoreService.save("employees", "AFI-INACTIVE", emp_doc)
        try:
            res = client.post(
                "/api/auth/login",
                json={"email": inactive_email, "password": "TestPassword@123"},
            )
            assert res.status_code == 403
            assert "inactive" in res.json()["detail"].lower()
        finally:
            FirestoreService.delete("users", "inactive_emp_test")
            FirestoreService.delete("employees", "AFI-INACTIVE")
    else:
        with SessionLocal() as db:
            db.query(Employee).filter(Employee.email == inactive_email).delete()
            db.query(User).filter(User.email == inactive_email).delete()
            db.commit()

            user = User(
                email=inactive_email,
                hashed_password=get_password_hash("TestPassword@123"),
                role="employee",
                is_active=False,
                approval_status="APPROVED",
            )
            db.add(user)
            db.flush()
            emp = Employee(
                employee_id="AFI-INACTIVE",
                user_id=user.id,
                full_name="Inactive Employee",
                email=inactive_email,
                status="Inactive",
            )
            db.add(emp)
            db.commit()

        try:
            res = client.post(
                "/api/auth/login",
                json={"email": inactive_email, "password": "TestPassword@123"},
            )
            assert res.status_code == 403
            assert "inactive" in res.json()["detail"].lower()
        finally:
            with SessionLocal() as db:
                db.query(Employee).filter(Employee.email == inactive_email).delete()
                db.query(User).filter(User.email == inactive_email).delete()
                db.commit()


def test_inactive_admin_account_rejected():
    """7. Inactive or unauthorized admin account must be rejected with HTTP 403."""
    inactive_admin_email = "inactive_adm_test@arshith.com"
    from app.core.config import settings
    from app.services.firestore_service import FirestoreService

    if settings.DATABASE_BACKEND == "firebase":
        admin_user_doc = {
            "id": "inactive_adm_test",
            "email": inactive_admin_email,
            "hashed_password": get_password_hash("TestPassword@123"),
            "role": "admin",
            "is_active": False,
            "approval_status": "APPROVED",
        }
        FirestoreService.save("users", "inactive_adm_test", admin_user_doc)
        try:
            res = client.post(
                "/api/auth/admin-login",
                json={"email": inactive_admin_email, "password": "TestPassword@123"},
            )
            assert res.status_code == 403
            assert "inactive" in res.json()["detail"].lower()
        finally:
            FirestoreService.delete("users", "inactive_adm_test")
    else:
        with SessionLocal() as db:
            db.query(User).filter(User.email == inactive_admin_email).delete()
            db.commit()

            user = User(
                email=inactive_admin_email,
                hashed_password=get_password_hash("TestPassword@123"),
                role="admin",
                is_active=False,
                approval_status="APPROVED",
            )
            db.add(user)
            db.commit()

        try:
            res = client.post(
                "/api/auth/admin-login",
                json={"email": inactive_admin_email, "password": "TestPassword@123"},
            )
            assert res.status_code == 403
            assert "inactive" in res.json()["detail"].lower()
        finally:
            with SessionLocal() as db:
                db.query(User).filter(User.email == inactive_admin_email).delete()
                db.commit()


def test_employee_token_on_admin_only_api():
    """8. Employee token used on Admin-only API must return HTTP 403 Forbidden."""
    emp_token = client.post(
        "/api/auth/login",
        json={"email": EMPLOYEE_EMAIL, "password": EMPLOYEE_PASSWORD},
    ).json()["access_token"]

    headers = {"Authorization": f"Bearer {emp_token}"}

    # Test Admin dashboard
    res_dash = client.get("/api/admin/dashboard", headers=headers)
    assert res_dash.status_code == 403

    # Test Admin employee registrations
    res_reg = client.get("/api/admin/employee-registrations", headers=headers)
    assert res_reg.status_code == 403

    # Test Admin employee creation
    res_create = client.post(
        "/api/employees",
        headers=headers,
        json={"employeeId": "AFI-TEST-FAIL", "name": "Fail", "email": "fail@arshith.com"},
    )
    assert res_create.status_code == 403


def test_admin_token_on_employee_specific_api():
    """9. Admin token used on an employee-specific API must be rejected if route requires employee identity."""
    admin_token = client.post(
        "/api/auth/admin-login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
    ).json()["access_token"]

    headers = {"Authorization": f"Bearer {admin_token}"}

    # Test Employee personal dashboard
    res_dash = client.get("/api/dashboard/employee", headers=headers)
    assert res_dash.status_code == 403

    # Test Employee personal attendance history
    res_att_me = client.get("/api/attendance/me", headers=headers)
    assert res_att_me.status_code == 403

    # Test Employee today attendance status
    res_att_status = client.get("/api/attendance/today-status", headers=headers)
    assert res_att_status.status_code == 403

    # Test Employee apply leave endpoint
    res_leave = client.post(
        "/api/leaves",
        headers=headers,
        json={
            "leaveType": "Sick Leave",
            "startDate": "2026-11-10",
            "endDate": "2026-11-11",
            "reason": "Medical appointment",
        },
    )
    assert res_leave.status_code == 403


def test_missing_or_invalid_jwt_token():
    """10. Missing or invalid JWT token must return HTTP 401 Unauthorized."""
    # Missing token
    res_missing = client.get("/api/auth/me")
    assert res_missing.status_code == 401

    # Malformed token
    res_malformed = client.get(
        "/api/auth/me",
        headers={"Authorization": "Bearer not_a_real_jwt_token_at_all"},
    )
    assert res_malformed.status_code == 401

    # Fake signed token with wrong key
    from jwt import encode
    fake_token = encode({"sub": "1", "role": "admin"}, "wrong_key_1234567890", algorithm="HS256")
    res_fake = client.get(
        "/api/auth/me",
        headers={"Authorization": f"Bearer {fake_token}"},
    )
    assert res_fake.status_code == 401


def test_modified_frontend_role_or_payload_no_privilege_escalation():
    """11. Request payload role tampering or forged claims must not escalate privilege."""
    # Attempt to pass role: "admin" in Employee Login payload
    tampered_login = client.post(
        "/api/auth/login",
        json={
            "email": EMPLOYEE_EMAIL,
            "password": EMPLOYEE_PASSWORD,
            "role": "admin",
        },
    )
    assert tampered_login.status_code == 200
    token_data = tampered_login.json()
    # The issued token and role claim MUST still be employee
    assert token_data["role"] == "employee"
    assert token_data["user"]["role"] == "employee"

    # Attempt to forge token claims (sub is employee, but role is set to admin)
    from app.core.config import settings
    from app.services.firestore_service import FirestoreService
    if settings.DATABASE_BACKEND == "firebase":
        users = FirestoreService.query("users", {"email": EMPLOYEE_EMAIL})
        emp_user_id = users[0]["id"] if users else "AFI-001"
    else:
        with SessionLocal() as db:
            emp_user = db.query(User).filter(User.email == EMPLOYEE_EMAIL).first()
            assert emp_user is not None
            emp_user_id = str(emp_user.id)

    forged_admin_token = create_access_token(
        subject=str(emp_user_id),
        role="admin",  # Forged claim in token
    )

    # When accessing protected admin route, backend checks DB record, detects mismatch or employee role
    tampered_admin_req = client.get(
        "/api/admin/dashboard",
        headers={"Authorization": f"Bearer {forged_admin_token}"},
    )
    assert tampered_admin_req.status_code in (401, 403)


def test_expired_hs256_token_skips_firebase_kid_warning(caplog):
    """Expired local HS256 JWTs must return 401 without triggering Firebase 'kid' warnings."""
    import base64
    import json
    from datetime import timedelta
    from app.core.security import create_access_token, is_firebase_id_token_format

    expired_token = create_access_token(
        subject="AFI-9073",
        role="employee",
        expires_delta=timedelta(seconds=-10),
    )

    # Local HS256 JWTs do not have a "kid" header claim and must not look like Firebase ID tokens
    assert is_firebase_id_token_format(expired_token) is False

    fake_firebase_header = base64.urlsafe_b64encode(
        json.dumps({"alg": "RS256", "kid": "abc123", "typ": "JWT"}).encode("utf-8")
    ).rstrip(b"=").decode("ascii")
    assert is_firebase_id_token_format(f"{fake_firebase_header}.e30.c2ln") is True

    with caplog.at_level("WARNING"):
        res = client.get(
            "/api/chat/unread-count",
            headers={"Authorization": f"Bearer {expired_token}"},
        )

    assert res.status_code == 401
    assert "expired" in res.json().get("detail", "").lower()
    assert 'Firebase ID token has no "kid" claim.' not in caplog.text

    refresh_res = client.post(
        "/api/auth/refresh",
        json={"firebase_token": expired_token},
    )
    assert refresh_res.status_code == 401


def test_team_leader_login_alias_and_get_current_user_resolution(monkeypatch):
    """Approved Team Leaders can log in across domain aliases and call protected /api/teamlead routes."""
    from app.core.security import get_password_hash
    from app.services.firestore_service import FirestoreService, firestore_service

    store = {
        "team_leaders": [
            {
                "id": "7856",
                "team_leader_id": "7856",
                "full_name": "rajesh",
                "name": "rajesh",
                "email": "rajesh@leadarshith.com",
                "hashed_password": get_password_hash("TeamLead@123"),
                "role": "team_leader",
                "approval_status": "APPROVED",
                "is_active": True,
                "department": "Operations",
            },
            {
                "id": "8521",
                "team_leader_id": "8521",
                "full_name": "dinesh",
                "name": "dinesh",
                "email": "dinesh@leadarshith.com",
                "hashed_password": get_password_hash("TeamLead@123"),
                "role": "team_leader",
                "approval_status": "PENDING",
                "is_active": False,
            },
        ],
        "users": [],
        "admins": [],
        "employees": [],
        "projects": [
            {
                "id": "PRJ-412119",
                "name": "facial solutions",
                "team_leader": "rajesh",
                "team_leader_id": "7856",
                "team_leader_email": "rajesh@leadarshith.com",
                "team_leader_approval_status": "APPROVED",
            }
        ],
        "project_tasks": [],
    }

    def _list_all(entity):
        col = FirestoreService.get_collection_name(entity)
        return [dict(d) for d in store.get(col, [])]

    def _query(entity, filters):
        res = []
        for item in _list_all(entity):
            ok = True
            for k, v in filters.items():
                if v is None:
                    continue
                iv = item.get(k)
                if isinstance(iv, str) and isinstance(v, str):
                    if iv.lower().strip() != v.lower().strip():
                        ok = False
                        break
                elif iv != v:
                    ok = False
                    break
            if ok:
                res.append(item)
        return res

    def _get_by_id(entity, doc_id):
        col = FirestoreService.get_collection_name(entity)
        for item in store.get(col, []):
            if str(item.get("id")) == str(doc_id) or str(item.get("email", "")).lower() == str(doc_id).lower():
                return dict(item)
        return None

    def _save(entity, doc_id, data):
        col = FirestoreService.get_collection_name(entity)
        bucket = store.setdefault(col, [])
        for i, item in enumerate(bucket):
            if str(item.get("id")) == str(doc_id):
                bucket[i] = {**item, **data}
                return bucket[i]
        bucket.append(dict(data))
        return data

    monkeypatch.setattr(FirestoreService, "list_all", classmethod(lambda cls, e: _list_all(e)))
    monkeypatch.setattr(FirestoreService, "query", classmethod(lambda cls, e, f: _query(e, f)))
    monkeypatch.setattr(FirestoreService, "get_by_id", classmethod(lambda cls, e, d: _get_by_id(e, d)))
    monkeypatch.setattr(FirestoreService, "save", classmethod(lambda cls, e, d, data: _save(e, d, data)))
    monkeypatch.setattr(firestore_service, "list_documents", lambda c, filters=None: _query(c, {f[0]: f[2] for f in filters if len(f) == 3 and f[1] == "=="}) if filters else _list_all(c))
    monkeypatch.setattr(firestore_service, "get_document", lambda c, d: _get_by_id(c, d))

    # 1. Approved leader can log in using @teamlead.com domain alias
    login_res = client.post(
        "/api/teamlead/login",
        json={"email": "rajesh@teamlead.com", "password": "TeamLead@123"},
    )
    assert login_res.status_code == 200
    body = login_res.json()
    assert body["role"] == "team_leader"
    assert body["user"]["email"] == "rajesh@leadarshith.com"
    assert body["user"]["team_leader_id"] == "7856"
    token = body["access_token"]

    # 2. Protected Team Leader route resolves identity even if only in team_leaders collection
    store["users"] = []
    proj_res = client.get(
        "/api/teamlead/projects",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert proj_res.status_code == 200
    assert any(p["id"] == "PRJ-412119" for p in proj_res.json())

    # 3. Pending leader is gated with 403
    pending_res = client.post(
        "/api/teamlead/login",
        json={"email": "dinesh@leadarshith.com", "password": "TeamLead@123"},
    )
    assert pending_res.status_code == 403

    # 4. Nonexistent email returns 401
    missing_res = client.post(
        "/api/teamlead/login",
        json={"email": "unknown_leader@teamlead.com", "password": "TeamLead@123"},
    )
    assert missing_res.status_code == 401


