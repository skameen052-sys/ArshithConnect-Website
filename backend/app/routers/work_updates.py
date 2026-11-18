from datetime import datetime, date, timezone
from typing import List, Optional, Dict, Any
from zoneinfo import ZoneInfo
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.firebase import get_firestore_client, is_firebase_live
from app.db.session import get_db, SessionLocal
from app.dependencies.auth import get_current_user, get_current_admin
from app.services.chat_sync_service import resolve_auth_uid, _is_looks_like_uid
from app.services.firestore_service import firestore_service
from app.schemas.work_update import (
    WorkScheduleBase,
    WorkScheduleCreate,
    WorkScheduleUpdate,
    WorkScheduleResponse,
    WorkUpdateSubmission,
    WorkUpdateLegacyCreate,
)

logger = logging.getLogger("uvicorn.error")
router = APIRouter(prefix="/work-updates", tags=["Work Updates"])
schedules_router = APIRouter(prefix="/work-schedules", tags=["Work Schedules"])

IST = ZoneInfo("Asia/Kolkata")

# Canonical default schedules matching mobile screenshot 4
DEFAULT_SCHEDULES = [
    {
        "schedule_id": "SCH-01",
        "name": "Morning Work Update",
        "section": 1,
        "work_start": "09:30",
        "work_end": "11:00",
        "work_start_display": "9:30 AM",
        "work_end_display": "11:00 AM",
        "work_schedule_str": "9:30 AM - 11:00 AM",
        "window_start": "10:30",
        "window_end": "11:00",
        "window_start_display": "10:30 AM",
        "window_end_display": "11:00 AM",
        "submission_window_str": "10:30 AM - 11:00 AM",
        "recurrence": "Daily",
        "applicable_to": "All",
        "is_active": True,
    },
    {
        "schedule_id": "SCH-02",
        "name": "Midday Work Update",
        "section": 2,
        "work_start": "11:15",
        "work_end": "13:00",
        "work_start_display": "11:15 AM",
        "work_end_display": "1:00 PM",
        "work_schedule_str": "11:15 AM - 1:00 PM",
        "window_start": "12:30",
        "window_end": "13:00",
        "window_start_display": "12:30 PM",
        "window_end_display": "1:00 PM",
        "submission_window_str": "12:30 PM - 1:00 PM",
        "recurrence": "Daily",
        "applicable_to": "All",
        "is_active": True,
    },
    {
        "schedule_id": "SCH-03",
        "name": "Afternoon Work Update",
        "section": 3,
        "work_start": "14:00",
        "work_end": "16:00",
        "work_start_display": "2:00 PM",
        "work_end_display": "4:00 PM",
        "work_schedule_str": "2:00 PM - 4:00 PM",
        "window_start": "15:30",
        "window_end": "16:00",
        "window_start_display": "3:30 PM",
        "window_end_display": "4:00 PM",
        "submission_window_str": "3:30 PM - 4:00 PM",
        "recurrence": "Daily",
        "applicable_to": "All",
        "is_active": True,
    },
    {
        "schedule_id": "SCH-04",
        "name": "Evening Work Update",
        "section": 4,
        "work_start": "16:15",
        "work_end": "18:00",
        "work_start_display": "4:15 PM",
        "work_end_display": "6:00 PM",
        "work_schedule_str": "4:15 PM - 6:00 PM",
        "window_start": "18:00",
        "window_end": "18:30",
        "window_start_display": "6:00 PM",
        "window_end_display": "6:30 PM",
        "submission_window_str": "6:00 PM - 6:30 PM",
        "recurrence": "Daily",
        "applicable_to": "All",
        "is_active": True,
    },
]


def time_to_minutes(t_str: str) -> int:
    """Parse time string like '10:30', '10:30 AM', '1:00 PM' into minutes since midnight."""
    if not t_str:
        return 0
    t_str = t_str.strip().upper()
    try:
        if "AM" in t_str or "PM" in t_str:
            dt = datetime.strptime(t_str, "%I:%M %p")
            return dt.hour * 60 + dt.minute
        parts = t_str.split(":")
        return int(parts[0]) * 60 + int(parts[1])
    except Exception:
        return 0


def format_minutes_to_display(minutes: int) -> str:
    """Format minutes since midnight to '10:30 AM'."""
    h = (minutes // 60) % 24
    m = minutes % 60
    am_pm = "AM" if h < 12 else "PM"
    h12 = h % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{m:02d} {am_pm}"


def get_current_ist() -> tuple[datetime, int, str]:
    """Get current datetime in Asia/Kolkata, minutes since midnight, and date string."""
    now_ist = datetime.now(IST)
    curr_min = now_ist.hour * 60 + now_ist.minute
    today_str = now_ist.strftime("%Y-%m-%d")
    return now_ist, curr_min, today_str


def get_all_schedules_from_db() -> List[dict]:
    """Retrieve schedules from Firestore, or fallback to default."""
    schedules = firestore_service.list_documents("work_schedules")
    if not schedules:
        return [dict(s) for s in DEFAULT_SCHEDULES]
    
    # Sort by section
    schedules.sort(key=lambda s: int(s.get("section", 99)))
    return schedules


def _run_pg_sync(db: Optional[Session], action_label: str, fn) -> None:
    """Execute optional PostgreSQL sync only when SQLAlchemy session is active."""
    if db is None:
        return
    try:
        fn(db)
        db.commit()
    except Exception as pg_err:
        logger.warning(f"PostgreSQL {action_label} skipped: {pg_err}")
        try:
            db.rollback()
        except Exception:
            pass


def _collect_employee_keys(emp_doc: dict) -> List[str]:
    """Collect all distinct lowercase identifiers for an employee record."""
    keys = []
    for k in (emp_doc.get("uid"), emp_doc.get("id"), emp_doc.get("employee_id"), emp_doc.get("employeeId"), emp_doc.get("email")):
        if k:
            val = str(k).strip().lower()
            if val and val not in keys:
                keys.append(val)
    return keys


def resolve_employee_info(current_user) -> dict:
    """
    Resolve authoritative employee details for current authenticated session.
    Prioritizes Firebase Auth UID so Web and Android App read/write the exact same
    `workUpdates/{uid}/dailyUpdates` path.
    """
    raw_uid = str(getattr(current_user, "uid", "") or "").strip()
    raw_id = str(getattr(current_user, "id", "") or "").strip()
    email = str(getattr(current_user, "email", "") or "").strip().lower()
    name = getattr(current_user, "full_name", None) or getattr(current_user, "name", None) or ""
    emp_id = str(getattr(current_user, "employee_id", None) or getattr(current_user, "employeeId", None) or "").strip()

    auth_uid = ""
    for candidate in (raw_uid, email, raw_id, emp_id):
        if candidate:
            resolved = resolve_auth_uid(candidate)
            if resolved and _is_looks_like_uid(resolved):
                auth_uid = resolved
                break

    # Check Firestore employees if missing auth_uid, name, or emp_id
    if email and (not auth_uid or not name or not emp_id):
        matches = firestore_service.list_documents("employees", [("email", "==", email)])
        if matches:
            e = matches[0]
            doc_uid = str(e.get("uid") or e.get("id") or "").strip()
            if not auth_uid and doc_uid:
                auth_uid = doc_uid
            name = name or e.get("full_name") or e.get("name") or e.get("employeeName") or ""
            emp_id = emp_id or str(e.get("employee_id") or e.get("employeeId") or "").strip()

    uid = auth_uid or raw_uid or raw_id
    if not name:
        name = email.split("@")[0].capitalize() if email else "Employee"

    candidate_uids = []
    for candidate in (uid, raw_uid, raw_id, emp_id):
        if candidate and candidate not in candidate_uids:
            candidate_uids.append(candidate)

    return {
        "uid": uid,
        "email": email,
        "name": name,
        "employee_id": emp_id or uid,
        "candidate_uids": candidate_uids,
    }


def calculate_availability(schedule: dict, current_minutes: int, has_submitted: bool) -> dict:
    """
    Calculate schedule status, badge variant and button lock state matching mobile reference screenshot:
    A. Submitted: badge 'Submitted' (green), button 'View ›'
    B. Open: badge 'Open Now' (emerald), button 'Submit' (unlocked)
    C. Upcoming: badge 'Opens {time}' (amber), button '🔒 Submit'
    D. Closed: badge 'Window closed' (gray), button '🔒 Submit'
    """
    w_start = time_to_minutes(schedule.get("window_start", ""))
    w_end = time_to_minutes(schedule.get("window_end", ""))
    w_disp = schedule.get("submission_window_str") or f"{schedule.get('window_start_display')} - {schedule.get('window_end_display')}"
    w_start_disp = schedule.get("window_start_display") or format_minutes_to_display(w_start)

    if has_submitted:
        return {
            "status": "submitted",
            "badge_text": "Submitted",
            "badge_variant": "submitted",
            "status_text": "Work update submitted for today",
            "button_text": "View ›",
            "is_open": False,
            "can_submit": False,
            "is_locked": False,
        }

    if not schedule.get("is_active", True):
        return {
            "status": "inactive",
            "badge_text": "Inactive",
            "badge_variant": "closed",
            "status_text": "Schedule is currently inactive",
            "button_text": "Submit",
            "is_open": False,
            "can_submit": False,
            "is_locked": True,
        }

    if current_minutes < w_start:
        return {
            "status": "upcoming",
            "badge_text": f"Opens {w_start_disp}",
            "badge_variant": "upcoming",
            "status_text": f"Available from {w_disp}",
            "button_text": "Submit",
            "is_open": False,
            "can_submit": False,
            "is_locked": True,
        }
    elif w_start <= current_minutes <= w_end:
        return {
            "status": "open",
            "badge_text": "Open Now",
            "badge_variant": "open",
            "status_text": f"Update is available now • {w_disp}",
            "button_text": "Submit",
            "is_open": True,
            "can_submit": True,
            "is_locked": False,
        }
    else:
        return {
            "status": "closed",
            "badge_text": "Window closed",
            "badge_variant": "closed",
            "status_text": "Update window closed",
            "button_text": "Submit",
            "is_open": False,
            "can_submit": False,
            "is_locked": True,
        }


# =====================================================================
# EMPLOYEE: TODAY'S SCHEDULES & AVAILABILITY
# =====================================================================

def _normalize_submission_details(data: dict, sec: Optional[int] = None) -> dict:
    """Normalize Firestore dailyUpdate fields across Android App and Website schemas."""
    if not data:
        return {}
    s_num = data.get("section") if data.get("section") is not None else sec
    try:
        s_int = int(s_num) if s_num is not None else None
    except Exception:
        s_int = sec

    sub_at = data.get("submittedAt")
    sub_at_iso = sub_at.isoformat() if hasattr(sub_at, "isoformat") else (str(sub_at) if sub_at else "")
    sub_time = data.get("submittedTime") or ""
    work_sched = data.get("workSchedule") or data.get("schedule") or "-"
    sub_win = data.get("submissionWindow") or data.get("updateWindow") or "-"
    sched_name = data.get("scheduleName") or data.get("sectionTitle") or (f"Work Update 0{s_int}" if s_int else "-")
    update_txt = data.get("update") or data.get("tasks_completed") or data.get("tasksCompleted") or ""

    return {
        **data,
        "section": s_int,
        "workSchedule": work_sched,
        "schedule": data.get("schedule") or work_sched,
        "submissionWindow": sub_win,
        "updateWindow": data.get("updateWindow") or sub_win,
        "scheduleName": sched_name,
        "sectionTitle": data.get("sectionTitle") or sched_name,
        "update": update_txt,
        "submittedAt": sub_at_iso,
        "submittedTime": sub_time,
        "formattedSubmitted": _format_submitted_display(sub_at, sub_time),
    }


@router.get("/today-schedules")
def get_today_schedules_for_employee(current_user=Depends(get_current_user)):
    """
    Return today's work schedules configured by admin along with the employee's
    submission status and real-time availability window (Asia/Kolkata).
    """
    emp = resolve_employee_info(current_user)
    uid = emp["uid"]
    email = emp["email"]
    candidate_uids = emp.get("candidate_uids") or ([uid] if uid else [])
    now_ist, curr_min, today_str = get_current_ist()

    # Read existing submissions for this employee today from Firestore
    # Path: workUpdates/{uid}/dailyUpdates/{date}_section_{section}
    submissions_by_section: Dict[int, dict] = {}
    client = get_firestore_client()
    if client:
        for cand_uid in candidate_uids:
            try:
                sub_refs = (
                    client.collection("workUpdates")
                    .document(cand_uid)
                    .collection("dailyUpdates")
                    .where("date", "==", today_str)
                    .stream()
                )
                for doc in sub_refs:
                    d = doc.to_dict() or {}
                    sec = d.get("section")
                    if sec is not None:
                        sec_int = int(sec)
                        if sec_int not in submissions_by_section:
                            submissions_by_section[sec_int] = _normalize_submission_details(d, sec_int)
            except Exception as e:
                logger.warning(f"Error fetching employee dailyUpdates ({cand_uid}) from Firestore: {e}")

        # Merge any submission stored under another UID sharing the same email
        if email:
            try:
                for doc in client.collection_group("dailyUpdates").stream():
                    d = doc.to_dict() or {}
                    if d.get("date") != today_str:
                        continue
                    doc_email = str(d.get("employeeEmail", "")).strip().lower()
                    doc_emp_id = str(d.get("employeeId", "")).strip()
                    if doc_email == email or doc_emp_id in candidate_uids:
                        sec = d.get("section")
                        if sec is not None:
                            sec_int = int(sec)
                            if sec_int not in submissions_by_section:
                                submissions_by_section[sec_int] = _normalize_submission_details(d, sec_int)
            except Exception as e:
                logger.warning(f"Error checking dailyUpdates by email: {e}")

    # Also check firestore_service local store fallback when Firebase client is unavailable
    if not client or not submissions_by_section:
        try:
            local_updates = firestore_service.collection_group("dailyUpdates")
            for d in local_updates:
                if d.get("date") == today_str:
                    emp_match = (
                        (d.get("employeeId") in candidate_uids)
                        or (email and str(d.get("employeeEmail", "")).strip().lower() == email)
                    )
                    if emp_match:
                        sec = d.get("section")
                        if sec is not None:
                            sec_int = int(sec)
                            if sec_int not in submissions_by_section:
                                submissions_by_section[sec_int] = _normalize_submission_details(d, sec_int)
        except Exception:
            pass

    # Also check local SQLite/PostgreSQL fallback only when DB backend is not firebase
    if not submissions_by_section and settings.DATABASE_BACKEND != "firebase":
        try:
            pg_db = SessionLocal()
            res = pg_db.execute(
                text("SELECT section, tasks_completed, submitted_time, submitted_at FROM work_updates WHERE employee_email = :email AND date = :dt"),
                {"email": email, "dt": today_str}
            ).fetchall()
            for r in res:
                if r[0] is not None:
                    sec_int = int(r[0])
                    submissions_by_section[sec_int] = _normalize_submission_details(
                        {
                            "section": sec_int,
                            "update": r[1],
                            "submittedTime": r[2],
                            "submittedAt": r[3],
                        },
                        sec_int,
                    )
            pg_db.close()
        except Exception:
            pass

    # Section standard title mapping
    section_title_map = {
        1: "Morning Work Update",
        2: "Midday Work Update",
        3: "Afternoon Work Update",
        4: "Evening Work Update",
    }

    schedules = get_all_schedules_from_db()
    result = []
    for sch in schedules:
        sec = int(sch.get("section", 1))
        submission = submissions_by_section.get(sec)
        has_sub = submission is not None

        avail = calculate_availability(sch, curr_min, has_sub)
        std_name = section_title_map.get(sec, sch.get("name") or f"Work Update 0{sec}")

        item = {
            "id": sch.get("schedule_id") or str(sch.get("id", "")),
            "schedule_id": sch.get("schedule_id", f"SCH-0{sec}"),
            "name": std_name,
            "section": sec,
            "section_label": f"UPDATE 0{sec}",
            "work_start": sch.get("work_start", "09:30"),
            "work_end": sch.get("work_end", "11:00"),
            "work_start_display": sch.get("work_start_display", "9:30 AM"),
            "work_end_display": sch.get("work_end_display", "11:00 AM"),
            "work_schedule_str": sch.get("work_schedule_str", "9:30 AM - 11:00 AM"),
            "window_start": sch.get("window_start", "10:30"),
            "window_end": sch.get("window_end", "11:00"),
            "window_start_display": sch.get("window_start_display", "10:30 AM"),
            "window_end_display": sch.get("window_end_display", "11:00 AM"),
            "submission_window_str": sch.get("submission_window_str", "10:30 AM - 11:00 AM"),
            "recurrence": sch.get("recurrence", "Daily"),
            "applicable_to": sch.get("applicable_to", "All"),
            "is_active": sch.get("is_active", True),
            # Status matching Mobile Screenshot
            "status": avail["status"],
            "badge_text": avail["badge_text"],
            "badge_variant": avail["badge_variant"],
            "status_text": avail["status_text"],
            "button_text": avail["button_text"],
            "is_locked": avail["is_locked"],
            "is_open": avail["is_open"],
            "has_submitted": has_sub,
            "submission_details": submission,
        }
        result.append(item)

    # Next window banner text
    next_window_text = ""
    open_sch = next((s for s in result if s["status"] == "open"), None)
    if open_sch:
        next_window_text = f"Submission window is open until {open_sch['window_end_display']}"
    else:
        upcoming_sch = next((s for s in result if s["status"] == "upcoming"), None)
        if upcoming_sch:
            next_window_text = f"Next window opens at {upcoming_sch['window_start_display']}"
        elif all(s["has_submitted"] for s in result):
            next_window_text = "All 4 updates submitted for today"
        else:
            next_window_text = "All submission windows for today are closed"

    return {
        "date": today_str,
        "currentTime": now_ist.strftime("%I:%M %p"),
        "employee": emp,
        "nextWindowText": next_window_text,
        "totalUpdatesToday": len(result),
        "submittedCount": sum(1 for s in result if s["has_submitted"]),
        "schedules": result,
    }


# =====================================================================
# EMPLOYEE: SUBMIT WORK UPDATE
# =====================================================================

@router.post("", status_code=status.HTTP_201_CREATED)
def submit_work_update(
    data: WorkUpdateSubmission,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Submit daily work update during the permitted window.
    Saves to Firestore (workUpdates/{uid}/dailyUpdates/{date}_section_{section})
    and dual-writes to PostgreSQL.
    """
    emp = resolve_employee_info(current_user)
    uid = emp["uid"]
    email = emp["email"]
    name = emp["name"]
    emp_id = emp["employee_id"]
    candidate_uids = emp.get("candidate_uids") or ([uid] if uid else [])

    if not uid:
        raise HTTPException(status_code=400, detail="Unable to resolve authenticated employee account.")

    text_content = (data.updateText or "").strip()
    if not text_content:
        raise HTTPException(status_code=400, detail="Work update text is required.")

    now_ist, curr_min, today_str = get_current_ist()
    sec = int(data.section)
    document_id = f"{today_str}_section_{sec}"

    # 1. Fetch configured schedule for this section
    schedules = get_all_schedules_from_db()
    matching_sch = next((s for s in schedules if int(s.get("section", 0)) == sec), None)
    if not matching_sch:
        raise HTTPException(status_code=404, detail=f"No work schedule configured for Section {sec}.")

    if not matching_sch.get("is_active", True):
        raise HTTPException(status_code=400, detail="This work schedule is currently inactive.")

    # 2. Server-side time window validation in Asia/Kolkata
    w_start = time_to_minutes(matching_sch.get("window_start", ""))
    w_end = time_to_minutes(matching_sch.get("window_end", ""))
    w_disp = matching_sch.get("submission_window_str") or "the configured window"

    if curr_min < w_start:
        raise HTTPException(
            status_code=400,
            detail=f"Submission window has not opened yet. Available from {w_disp}."
        )
    if curr_min > w_end:
        raise HTTPException(
            status_code=400,
            detail=f"Update window closed at {matching_sch.get('window_end_display', '')}. Late submissions are not permitted."
        )

    # 3. Check duplicate submission across all candidate UIDs / App+Web paths
    client = get_firestore_client()
    doc_path = f"workUpdates/{uid}/dailyUpdates/{document_id}"
    if client:
        for cand_uid in candidate_uids:
            try:
                existing = client.document(f"workUpdates/{cand_uid}/dailyUpdates/{document_id}").get()
                if existing.exists:
                    raise HTTPException(
                        status_code=400,
                        detail="Work update has already been submitted for this schedule today."
                    )
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"Error checking existing update in Firestore ({cand_uid}): {e}")

        if email:
            try:
                for d in client.collection_group("dailyUpdates").stream():
                    item = d.to_dict() or {}
                    if (
                        item.get("date") == today_str
                        and str(item.get("section")) == str(sec)
                        and str(item.get("employeeEmail", "")).strip().lower() == email
                    ):
                        raise HTTPException(
                            status_code=400,
                            detail="Work update has already been submitted for this schedule today."
                        )
            except HTTPException:
                raise
            except Exception as e:
                logger.warning(f"Error checking email duplicate in dailyUpdates: {e}")

    now_time_str = now_ist.strftime("%I:%M %p")
    now_utc = datetime.now(timezone.utc)

    work_sched_str = matching_sch.get("work_schedule_str") or data.workSchedule or "-"
    sub_win_str = matching_sch.get("submission_window_str") or data.submissionWindow or "-"
    sched_name = matching_sch.get("name") or data.scheduleName or f"Work Update 0{sec}"

    # 4. Save to Firestore with full Android App + Website field parity
    firestore_data = {
        "employeeId": uid,
        "employeeCode": emp_id,
        "employeeEmail": email,
        "employeeName": name,
        "date": today_str,
        "section": sec,
        "sectionTitle": sched_name,
        "scheduleName": sched_name,
        "schedule": work_sched_str,
        "workSchedule": work_sched_str,
        "updateWindow": sub_win_str,
        "submissionWindow": sub_win_str,
        "update": text_content,
        "submittedAt": now_utc,
        "submittedTime": now_time_str,
        "source": "website",
    }

    if client:
        try:
            client.collection("workUpdates").document(uid).set(
                {
                    "employeeId": uid,
                    "employeeCode": emp_id,
                    "employeeEmail": email,
                    "employeeName": name,
                    "updatedAt": now_utc,
                },
                merge=True,
            )
            client.document(doc_path).set(firestore_data)
        except Exception as e:
            logger.error(f"Failed to write work update to Firestore at {doc_path}: {e}")
            raise HTTPException(status_code=500, detail=f"Database write failed: {str(e)}")
    else:
        local_doc = {
            **firestore_data,
            "id": document_id,
            "documentId": document_id,
            "submittedAt": now_utc.isoformat(),
            "_doc_path": doc_path,
        }
        firestore_service.create_document(f"workUpdates/{uid}/dailyUpdates", local_doc)

    # 5. Optional dual-write to PostgreSQL (only when SQLAlchemy session is active)
    def _write_pg_update(pg_db: Session):
        from app.models.work_update import WorkUpdate as PgWorkUpdate
        pg_update = PgWorkUpdate(
            update_code=f"UPD-{today_str.replace('-', '')}-{sec}-{uid[:6] if uid else '000'}",
            employee_id=emp_id,
            employee_name=name,
            employee_email=email,
            date=date.fromisoformat(today_str),
            time=now_time_str,
            section=sec,
            work_schedule=work_sched_str,
            submission_window=sub_win_str,
            schedule_name=sched_name,
            tag="Operations",
            tasks_completed=text_content,
            submitted_time=now_time_str,
            submitted_at=now_utc,
            firestore_path=doc_path,
        )
        pg_db.add(pg_update)

    _run_pg_sync(db, "work update sync", _write_pg_update)

    return {
        "success": True,
        "message": "Work update submitted successfully.",
        "data": {
            "id": document_id,
            "documentId": document_id,
            "employeeId": uid,
            "employeeName": name,
            "employeeEmail": email,
            "date": today_str,
            "section": sec,
            "sectionTitle": sched_name,
            "scheduleName": sched_name,
            "schedule": work_sched_str,
            "workSchedule": work_sched_str,
            "updateWindow": sub_win_str,
            "submissionWindow": sub_win_str,
            "update": text_content,
            "submittedTime": now_time_str,
        }
    }


def _format_day_name(d_str: str) -> str:
    try:
        dt = datetime.strptime(d_str, "%Y-%m-%d")
        return f"{dt.strftime('%A')}, {dt.day} {dt.strftime('%B %Y')}"
    except Exception:
        return d_str


def _format_submitted_display(sub_at, fallback_time="") -> str:
    if not sub_at:
        return fallback_time or "-"
    try:
        if isinstance(sub_at, str):
            dt = datetime.fromisoformat(sub_at.replace("Z", "+00:00"))
        elif isinstance(sub_at, datetime):
            dt = sub_at
        else:
            return fallback_time or str(sub_at)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        dt_ist = dt.astimezone(IST)
        return dt_ist.strftime("%d %b %Y, %I:%M %p")
    except Exception:
        return fallback_time or str(sub_at)


def _get_all_daily_updates_internal(date_filter: Optional[str] = None) -> List[Dict[str, Any]]:
    client = get_firestore_client()
    raw_docs = []

    # 1. Try live Firebase if client is active
    if client:
        try:
            for d in client.collection_group("dailyUpdates").stream():
                raw_docs.append((d.id, d.reference.path, d.to_dict()))
        except Exception as e:
            logger.warning(f"Error querying dailyUpdates collectionGroup: {e}")

    # 2. Local fallback from firestore_service when Firebase client is unavailable
    if not client and not raw_docs:
        for d in firestore_service.collection_group("dailyUpdates"):
            doc_id = d.get("id") or d.get("documentId") or ""
            path = d.get("firestorePath") or d.get("_doc_path") or f"workUpdates/{d.get('employeeId')}/dailyUpdates/{doc_id}"
            raw_docs.append((doc_id, path, d))

    # 3. Fallback to PostgreSQL only when backend is not firebase
    if not raw_docs and settings.DATABASE_BACKEND != "firebase":
        try:
            pg_db = SessionLocal()
            rows = pg_db.execute(text("SELECT id, update_code, employee_id, employee_name, employee_email, date, section, work_schedule, submission_window, schedule_name, tasks_completed, submitted_time, submitted_at, firestore_path FROM work_updates ORDER BY submitted_at DESC NULLS LAST, id DESC")).fetchall()
            for r in rows:
                raw_docs.append((
                    str(r[0]),
                    r[13] or f"workUpdates/{r[2]}/dailyUpdates/{r[1]}",
                    {
                        "id": str(r[0]),
                        "documentId": r[1] or str(r[0]),
                        "employeeId": r[2],
                        "employeeName": r[3],
                        "employeeEmail": r[4],
                        "date": str(r[5]),
                        "section": r[6],
                        "workSchedule": r[7] or "-",
                        "submissionWindow": r[8] or "-",
                        "scheduleName": r[9] or (f"Work Update 0{r[6]}" if r[6] else "-"),
                        "update": r[10],
                        "submittedTime": r[11],
                        "submittedAt": r[12].isoformat() if r[12] else None,
                    }
                ))
            pg_db.close()
        except Exception as e:
            logger.warning(f"Error querying PostgreSQL work_updates fallback: {e}")

    # Build employee lookup cache
    emp_cache = {}
    try:
        all_emps = firestore_service.list_documents("employees")
        for e in all_emps:
            uid = e.get("uid") or e.get("id") or ""
            email = str(e.get("email") or "").strip().lower()
            name = e.get("name") or e.get("full_name") or ""
            for k in _collect_employee_keys(e):
                emp_cache[k] = (name, email, uid or e.get("id") or "")
    except Exception:
        pass

    parsed = []
    seen_paths = set()
    for doc_id, path, data in raw_docs:
        if path and path in seen_paths:
            continue
        if path:
            seen_paths.add(path)

        d_date = data.get("date") or ""
        if date_filter and d_date != date_filter:
            continue

        emp_uid = str(data.get("employeeId") or "").strip()
        emp_email = str(data.get("employeeEmail") or "").strip().lower()

        cached = emp_cache.get(emp_uid.lower()) or emp_cache.get(emp_email)
        if cached:
            emp_name = cached[0] or data.get("employeeName")
            emp_email = emp_email or cached[1]
            canonical_uid = cached[2] or emp_uid
        else:
            emp_name = data.get("employeeName") or (emp_email.split("@")[0].capitalize() if emp_email else "Employee")
            canonical_uid = emp_uid

        norm = _normalize_submission_details(data)
        parsed.append({
            "id": doc_id,
            "documentId": doc_id,
            "firestorePath": path,
            "employeeId": emp_uid or canonical_uid,
            "canonicalUid": canonical_uid,
            "employeeName": emp_name,
            "employeeEmail": emp_email,
            "date": d_date,
            "section": norm["section"],
            "workSchedule": norm["workSchedule"],
            "submissionWindow": norm["submissionWindow"],
            "scheduleName": norm["scheduleName"],
            "update": norm["update"],
            "submittedAt": norm["submittedAt"],
            "submittedTime": norm["submittedTime"],
            "formattedSubmitted": norm["formattedSubmitted"],
        })
    return parsed


# =====================================================================
# TIER 1: EMPLOYEE SUMMARIES (Screenshot 1)
# =====================================================================

@router.get("/employees-summary")
def get_work_updates_employees_summary(current_user=Depends(get_current_user)):
    """
    Tier 1 (Mobile Screenshot 1):
    Returns employee summaries with:
    - name, email, uid
    - totalSubmittedUpdates
    - latestUpdate (YYYY-MM-DD)
    - workDaysCount
    Sorted with employees who have updates first, ordered by latest date descending.
    """
    all_updates = _get_all_daily_updates_internal()
    all_emps = firestore_service.list_documents("employees")

    updates_by_key: Dict[str, List[dict]] = {}
    for u in all_updates:
        for k in (u.get("employeeId"), u.get("canonicalUid"), u.get("employeeEmail")):
            if k:
                updates_by_key.setdefault(str(k).strip().lower(), []).append(u)

    seen_keys = set()
    summary = []

    for emp in all_emps:
        uid = emp.get("uid") or emp.get("id")
        email = (emp.get("email") or "").strip().lower()
        name = emp.get("name") or emp.get("full_name") or "Employee"

        key = email or uid
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)

        emp_updates = []
        seen_doc_keys = set()
        for k in _collect_employee_keys(emp):
            for u in updates_by_key.get(k, []):
                ukey = u.get("firestorePath") or f"{u.get('date')}_{u.get('section')}"
                if ukey not in seen_doc_keys:
                    seen_doc_keys.add(ukey)
                    emp_updates.append(u)

        dates = sorted(list(set(u.get("date") for u in emp_updates if u.get("date"))), reverse=True)

        summary.append({
            "uid": uid,
            "employeeId": uid,
            "name": name,
            "employeeName": name,
            "email": email,
            "employeeEmail": email,
            "totalSubmittedUpdates": len(emp_updates),
            "latestUpdate": dates[0] if dates else None,
            "workDaysCount": len(dates),
        })

    # Sort: employees with updates first (latest date desc, then count desc)
    summary.sort(
        key=lambda s: (
            1 if s["totalSubmittedUpdates"] > 0 else 0,
            s["latestUpdate"] or "",
            s["totalSubmittedUpdates"]
        ),
        reverse=True
    )
    return summary


def _resolve_employee_history_target(employee_id: str, current_user, all_updates: List[dict]):
    """Resolve all identifiers & metadata for a target employee across App and Website."""
    target_raw = (employee_id or "").strip()
    if target_raw.lower() == "me":
        self_info = resolve_employee_info(current_user)
        target_raw = self_info["uid"] or self_info["email"] or target_raw

    e_clean = target_raw.lower()
    emp_keys = {e_clean}
    resolved_uid = resolve_auth_uid(target_raw)
    if resolved_uid:
        emp_keys.add(resolved_uid.strip().lower())

    emp_name = "Employee"
    emp_email = target_raw if "@" in target_raw else ""
    emp_uid = resolved_uid or target_raw

    emps = firestore_service.list_documents("employees")
    for e in emps:
        keys = set(_collect_employee_keys(e))
        if emp_keys & keys:
            emp_keys.update(keys)
            emp_name = e.get("name") or e.get("full_name") or emp_name
            emp_email = (e.get("email") or emp_email).strip().lower()
            emp_uid = e.get("uid") or e.get("id") or emp_uid
            break

    emp_updates = []
    seen_doc_keys = set()
    for u in all_updates:
        u_keys = {
            str(u.get("employeeId") or "").strip().lower(),
            str(u.get("canonicalUid") or "").strip().lower(),
            str(u.get("employeeEmail") or "").strip().lower(),
        } - {""}
        if emp_keys & u_keys:
            ukey = u.get("firestorePath") or f"{u.get('date')}_{u.get('section')}"
            if ukey not in seen_doc_keys:
                seen_doc_keys.add(ukey)
                emp_updates.append(u)

    if emp_updates and emp_name == "Employee":
        emp_name = emp_updates[0].get("employeeName") or emp_name
        emp_email = emp_updates[0].get("employeeEmail") or emp_email
        emp_uid = emp_updates[0].get("canonicalUid") or emp_updates[0].get("employeeId") or emp_uid

    return emp_uid, emp_name, emp_email, emp_updates


# =====================================================================
# TIER 2: EMPLOYEE WORK HISTORY DATES (Screenshot 2)
# =====================================================================

@router.get("/employee/{employee_id}/history")
def get_employee_work_history(employee_id: str, current_user=Depends(get_current_user)):
    """
    Tier 2 (Mobile Screenshot 2):
    Returns daily work history for a given employee with:
    - employee info (name, email, uid)
    - totalWorkDays
    - workDays list with formatted date, section count, raw date
    """
    all_updates = _get_all_daily_updates_internal()
    emp_uid, emp_name, emp_email, emp_updates = _resolve_employee_history_target(
        employee_id, current_user, all_updates
    )

    dates = sorted(list(set(u.get("date") for u in emp_updates if u.get("date"))), reverse=True)
    work_days = []
    for d in dates:
        day_updates = [u for u in emp_updates if u.get("date") == d]
        work_days.append({
            "date": d,
            "formattedDate": _format_day_name(d),
            "sectionCount": len(day_updates),
            "sectionsSubmitted": len(day_updates),
        })

    return {
        "employee": {
            "uid": emp_uid,
            "name": emp_name,
            "email": emp_email,
        },
        "totalWorkDays": len(work_days),
        "workDays": work_days,
    }


# =====================================================================
# TIER 3: EMPLOYEE DAY SECTIONS (Screenshot 3)
# =====================================================================

@router.get("/employee/{employee_id}/date/{date_str}")
def get_employee_day_work_updates(employee_id: str, date_str: str, current_user=Depends(get_current_user)):
    """
    Tier 3 (Mobile Screenshot 3):
    Returns the specific day's work updates for an employee:
    - employee info
    - date and formattedDate (e.g. Wednesday, 28 October 2026)
    - sectionCount
    - sections list (Section 1, 2, 3, 4) with schedule, window, update text, formattedSubmitted
    """
    all_updates = _get_all_daily_updates_internal(date_filter=date_str)
    emp_uid, emp_name, emp_email, emp_updates = _resolve_employee_history_target(
        employee_id, current_user, all_updates
    )

    emp_updates.sort(key=lambda u: u.get("section") or 0)

    return {
        "employee": {
            "uid": emp_uid,
            "name": emp_name,
            "email": emp_email,
        },
        "date": date_str,
        "formattedDate": _format_day_name(date_str),
        "sectionCount": len(emp_updates),
        "sections": emp_updates,
    }


# =====================================================================
# ADMIN: LIST WORK UPDATES (Screenshots 1 & 2)
# =====================================================================

@router.get("")
def list_work_updates(
    date: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    section: Optional[str] = Query(None),
    schedule_id: Optional[str] = Query(None),
    current_user=Depends(get_current_user),
):
    """
    Retrieve all employee work updates with real employee names, section, schedule,
    submission window, update content, and submitted timestamp.
    """
    user_role = str(getattr(current_user, "role", "employee")).strip().lower()
    updates = _get_all_daily_updates_internal(date_filter=date)

    if user_role not in ["admin", "team_leader", "project_hr"]:
        emp_info = resolve_employee_info(current_user)
        curr_email = emp_info["email"]
        allowed_uids = {c.lower() for c in emp_info.get("candidate_uids", []) if c}
        updates = [
            u for u in updates
            if (curr_email and (u.get("employeeEmail") or "").strip().lower() == curr_email)
            or (str(u.get("employeeId") or "").strip().lower() in allowed_uids)
            or (str(u.get("canonicalUid") or "").strip().lower() in allowed_uids)
        ]

    filtered = updates
    if search:
        s_low = search.strip().lower()
        filtered = [
            u for u in filtered
            if s_low in u["employeeName"].lower() or s_low in (u["employeeEmail"] or "").lower() or s_low in u["update"].lower()
        ]
    if section and section.upper() != "ALL":
        try:
            s_num = int(section)
            filtered = [u for u in filtered if u.get("section") == s_num]
        except Exception:
            pass

    filtered.sort(key=lambda u: (str(u.get("date", "")), str(u.get("submittedAt", ""))), reverse=True)
    return filtered


# =====================================================================
# ADMIN: DELETE SINGLE WORK UPDATE (Screenshots 1 & 2)
# =====================================================================

@router.delete("/{doc_id}")
def delete_work_update(
    doc_id: str,
    path: Optional[str] = Query(None),
    current_admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Delete an individual employee work update from Firestore and PostgreSQL.
    Requires Admin authentication.
    """
    client = get_firestore_client()
    deleted = False

    # 1. If explicit Firestore path is supplied, delete directly
    if client and path and path.startswith("workUpdates/"):
        try:
            client.document(path).delete()
            deleted = True
        except Exception as e:
            logger.warning(f"Failed to delete Firestore document at path {path}: {e}")

    # 2. Search collectionGroup if path was not provided or failed
    if client and not deleted:
        try:
            for doc in client.collection_group("dailyUpdates").stream():
                if doc.id == doc_id:
                    doc.reference.delete()
                    deleted = True
                    break
        except Exception as e:
            logger.warning(f"Error searching doc {doc_id} to delete in collectionGroup: {e}")

    # 3. Optional delete from PostgreSQL
    _run_pg_sync(
        db,
        "work update delete",
        lambda pg_db: pg_db.execute(
            text("DELETE FROM work_updates WHERE update_code = :doc_id OR firestore_path = :path OR id::text = :doc_id"),
            {"doc_id": doc_id, "path": path or ""},
        ),
    )

    return {"success": True, "message": "Work update deleted successfully."}


# =====================================================================
# ADMIN: DELETE ALL UPDATES (BULK)
# =====================================================================

@router.delete("")
def delete_all_work_updates(
    date: Optional[str] = Query(None),
    all_dates: bool = Query(False, alias="all"),
    current_admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Permanently delete work updates in bulk.
    If 'date' is provided, deletes all updates for that date.
    If 'all=true' is provided, deletes all updates across all dates.
    Requires Admin privileges.
    """
    if not date and not all_dates:
        raise HTTPException(
            status_code=400,
            detail="Specify ?date=YYYY-MM-DD or ?all=true to confirm bulk deletion scope."
        )

    client = get_firestore_client()
    deleted_count = 0

    if client:
        try:
            all_docs = list(client.collection_group("dailyUpdates").stream())
            docs = [d for d in all_docs if (not date or all_dates or d.to_dict().get("date") == date)]
            # Batch delete in chunks of 400 (Firestore limit is 500)
            for i in range(0, len(docs), 400):
                batch = client.batch()
                chunk = docs[i:i+400]
                for d in chunk:
                    batch.delete(d.reference)
                batch.commit()
                deleted_count += len(chunk)
        except Exception as e:
            logger.error(f"Error during bulk deletion in Firestore: {e}")
            raise HTTPException(status_code=500, detail=f"Failed bulk deletion: {str(e)}")

    # Optional delete from PostgreSQL
    _run_pg_sync(
        db,
        "bulk work_updates delete",
        lambda pg_db: (
            pg_db.execute(text("DELETE FROM work_updates WHERE date = :dt"), {"dt": date})
            if (date and not all_dates)
            else pg_db.execute(text("DELETE FROM work_updates"))
        ),
    )

    scope_str = f"for date {date}" if (date and not all_dates) else "across all dates"
    return {
        "success": True,
        "deletedCount": deleted_count,
        "message": f"Successfully deleted {deleted_count} work updates {scope_str}.",
    }


# =====================================================================
# WORK SCHEDULE MANAGEMENT ENDPOINTS
# =====================================================================

@schedules_router.get("", response_model=List[dict])
def list_work_schedules(current_user=Depends(get_current_user)):
    """Retrieve all work update schedules configured by admin."""
    return get_all_schedules_from_db()


@schedules_router.post("", status_code=status.HTTP_201_CREATED)
def create_work_schedule(
    data: WorkScheduleCreate,
    current_admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Admin: create a new work update schedule."""
    schedules = get_all_schedules_from_db()
    existing_sections = [int(s.get("section", 0)) for s in schedules]
    if data.section in existing_sections:
        raise HTTPException(status_code=400, detail=f"A schedule for Section {data.section} already exists.")

    sch_id = f"SCH-{data.section:02d}"
    now_iso = datetime.now(timezone.utc).isoformat()

    w_start_min = time_to_minutes(data.work_start)
    w_end_min = time_to_minutes(data.work_end)
    sub_start_min = time_to_minutes(data.window_start)
    sub_end_min = time_to_minutes(data.window_end)

    if w_start_min >= w_end_min:
        raise HTTPException(status_code=400, detail="Work start time must be before work end time.")
    if sub_start_min >= sub_end_min:
        raise HTTPException(status_code=400, detail="Submission window start must be before window end.")

    w_start_disp = format_minutes_to_display(w_start_min)
    w_end_disp = format_minutes_to_display(w_end_min)
    sub_start_disp = format_minutes_to_display(sub_start_min)
    sub_end_disp = format_minutes_to_display(sub_end_min)

    doc_data = {
        "schedule_id": sch_id,
        "name": data.name.strip(),
        "section": data.section,
        "work_start": data.work_start,
        "work_end": data.work_end,
        "work_start_display": w_start_disp,
        "work_end_display": w_end_disp,
        "work_schedule_str": f"{w_start_disp} - {w_end_disp}",
        "window_start": data.window_start,
        "window_end": data.window_end,
        "window_start_display": sub_start_disp,
        "window_end_display": sub_end_disp,
        "submission_window_str": f"{sub_start_disp} - {sub_end_disp}",
        "recurrence": data.recurrence or "Daily",
        "applicable_to": data.applicable_to or "All",
        "is_active": data.is_active if data.is_active is not None else True,
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    doc_data["id"] = sch_id
    firestore_service.create_document("work_schedules", doc_data)

    # Optional sync to PostgreSQL
    def _write_pg_sch(pg_db: Session):
        from app.models.work_schedule import WorkSchedule as PgWorkSchedule
        pg_db.add(
            PgWorkSchedule(
                schedule_id=sch_id,
                name=doc_data["name"],
                section=doc_data["section"],
                work_start=doc_data["work_start"],
                work_end=doc_data["work_end"],
                work_start_display=doc_data["work_start_display"],
                work_end_display=doc_data["work_end_display"],
                work_schedule_str=doc_data["work_schedule_str"],
                window_start=doc_data["window_start"],
                window_end=doc_data["window_end"],
                window_start_display=doc_data["window_start_display"],
                window_end_display=doc_data["window_end_display"],
                submission_window_str=doc_data["submission_window_str"],
                recurrence=doc_data["recurrence"],
                applicable_to=doc_data["applicable_to"],
                is_active=doc_data["is_active"],
            )
        )

    _run_pg_sync(db, "schedule create", _write_pg_sch)

    return doc_data


@schedules_router.put("/{schedule_id}")
def update_work_schedule(
    schedule_id: str,
    data: WorkScheduleUpdate,
    current_admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Admin: update an existing work update schedule."""
    existing = firestore_service.get_document("work_schedules", schedule_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Schedule not found.")

    update_dict = {k: v for k, v in data.model_dump().items() if v is not None}
    now_iso = datetime.now(timezone.utc).isoformat()
    update_dict["updated_at"] = now_iso

    # Recompute display strings if times change
    w_start = update_dict.get("work_start", existing.get("work_start"))
    w_end = update_dict.get("work_end", existing.get("work_end"))
    if w_start and w_end:
        w_start_disp = format_minutes_to_display(time_to_minutes(w_start))
        w_end_disp = format_minutes_to_display(time_to_minutes(w_end))
        update_dict["work_start_display"] = w_start_disp
        update_dict["work_end_display"] = w_end_disp
        update_dict["work_schedule_str"] = f"{w_start_disp} - {w_end_disp}"

    sub_start = update_dict.get("window_start", existing.get("window_start"))
    sub_end = update_dict.get("window_end", existing.get("window_end"))
    if sub_start and sub_end:
        sub_start_disp = format_minutes_to_display(time_to_minutes(sub_start))
        sub_end_disp = format_minutes_to_display(time_to_minutes(sub_end))
        update_dict["window_start_display"] = sub_start_disp
        update_dict["window_end_display"] = sub_end_disp
        update_dict["submission_window_str"] = f"{sub_start_disp} - {sub_end_disp}"

    firestore_service.update_document("work_schedules", schedule_id, update_dict)

    # Optional sync to PostgreSQL
    def _update_pg_sch(pg_db: Session):
        from app.models.work_schedule import WorkSchedule as PgWorkSchedule
        pg_sch = pg_db.query(PgWorkSchedule).filter(PgWorkSchedule.schedule_id == schedule_id).first()
        if pg_sch:
            for k, v in update_dict.items():
                if hasattr(pg_sch, k):
                    setattr(pg_sch, k, v)

    _run_pg_sync(db, "schedule update", _update_pg_sch)

    existing.update(update_dict)
    return existing


@schedules_router.delete("/{schedule_id}")
def delete_work_schedule(
    schedule_id: str,
    current_admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Admin: delete a work schedule."""
    firestore_service.delete_document("work_schedules", schedule_id)

    def _delete_pg_sch(pg_db: Session):
        from app.models.work_schedule import WorkSchedule as PgWorkSchedule
        pg_db.query(PgWorkSchedule).filter(PgWorkSchedule.schedule_id == schedule_id).delete()

    _run_pg_sync(db, "schedule delete", _delete_pg_sch)

    return {"success": True, "message": "Work schedule deleted successfully."}
