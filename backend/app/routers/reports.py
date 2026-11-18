import calendar
from datetime import datetime, date, timedelta, timezone
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.services.firestore_service import FirestoreService
from app.dependencies.auth import get_current_user

router = APIRouter(prefix="/reports", tags=["Reports"])


def _parse_target_month(raw_month: Optional[str]):
    """Parse month input into (year: int, month: int, month_name: str)."""
    ist = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(ist).date()

    if not raw_month or not str(raw_month).strip():
        return now_ist.year, now_ist.month, now_ist.strftime("%B %Y")

    cleaned = str(raw_month).strip()

    # Formats: "YYYY-MM", "YYYY-M", "MM-YYYY", "November 2026", "Nov 2026"
    for fmt in ["%Y-%m", "%m-%Y", "%B %Y", "%b %Y", "%Y/%m"]:
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.year, dt.month, dt.strftime("%B %Y")
        except ValueError:
            pass

    # Try split
    parts = cleaned.replace("/", "-").replace(" ", "-").split("-")
    if len(parts) == 2:
        try:
            if len(parts[0]) == 4:
                return int(parts[0]), int(parts[1]), datetime(int(parts[0]), int(parts[1]), 1).strftime("%B %Y")
            elif len(parts[1]) == 4:
                return int(parts[1]), int(parts[0]), datetime(int(parts[1]), int(parts[0]), 1).strftime("%B %Y")
        except Exception:
            pass

    return now_ist.year, now_ist.month, now_ist.strftime("%B %Y")


@router.get("/monthly")
@router.get("/attendance-monthly")
def get_monthly_report(
    month: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Authoritative Monthly Attendance Report matching mobile application logic.
    Computes employee-wise Present, Working, Approved Leave, Attendance %, WFO, WFH, Late counts,
    and actual submitted Late Reasons.
    """
    dept_str = department if isinstance(department, str) else None
    search_str = search if isinstance(search, str) else None
    month_str = month if isinstance(month, str) else None

    year, mon, month_display = _parse_target_month(month_str)
    ist = timezone(timedelta(hours=5, minutes=30))
    today_ist = datetime.now(ist).date()

    num_days = calendar.monthrange(year, mon)[1]
    first_day = date(year, mon, 1)
    last_day = date(year, mon, num_days)

    if year == today_ist.year and mon == today_ist.month:
        cutoff_date = min(last_day, today_ist)
        is_current_month = True
    elif date(year, mon, 1) > today_ist:
        cutoff_date = first_day
        is_current_month = False
    else:
        cutoff_date = last_day
        is_current_month = False

    # 1. Holidays for the month
    holiday_dates = set()
    try:
        holidays = FirestoreService.list_all("holidays")
        month_prefix = f"{year:04d}-{mon:02d}"
        for h in holidays:
            h_date = h.get("date") or h.get("id") or ""
            if str(h_date).startswith(month_prefix):
                holiday_dates.add(str(h_date).strip()[:10])
    except Exception:
        pass

    # 2. Total Working Days (Monday - Friday excluding holidays up to cutoff)
    total_working_days = 0
    cur_d = first_day
    while cur_d <= cutoff_date:
        if cur_d.weekday() < 5 and cur_d.isoformat() not in holiday_dates:
            total_working_days += 1
        cur_d += timedelta(days=1)

    # 3. Approved Leaves
    approved_leave_map = {}
    try:
        cg_requests = FirestoreService.collection_group("requests")
        top_leaves = FirestoreService.list_all("leaves")
        all_leaves = list(cg_requests) + list(top_leaves)

        for l in all_leaves:
            if str(l.get("status", "")).lower() != "approved":
                continue
            e_id = l.get("employeeId") or l.get("employee_id") or ""
            e_mail = str(l.get("email", "")).lower().strip()
            keys_to_tag = [str(e_id).strip()] if e_id else []
            if e_mail:
                keys_to_tag.append(e_mail)

            raw_from = str(l.get("fromDate") or l.get("from_date") or l.get("startDate") or l.get("start_date") or "").strip()
            raw_to = str(l.get("toDate") or l.get("to_date") or l.get("endDate") or l.get("end_date") or "").strip()
            if not raw_from or not raw_to:
                continue

            try:
                d_from = date.fromisoformat(raw_from[:10])
                d_to = date.fromisoformat(raw_to[:10])
            except Exception:
                continue

            c_from = max(d_from, first_day)
            c_to = min(d_to, cutoff_date)
            if c_from > c_to:
                continue

            cur_l = c_from
            while cur_l <= c_to:
                if cur_l.weekday() < 5 and cur_l.isoformat() not in holiday_dates:
                    d_iso = cur_l.isoformat()
                    for k in keys_to_tag:
                        if k not in approved_leave_map:
                            approved_leave_map[k] = set()
                        approved_leave_map[k].add(d_iso)
                cur_l += timedelta(days=1)
    except Exception:
        pass

    # 4. Employees directory map
    all_employees = FirestoreService.list_all("employees")
    emp_map = {}
    for e in all_employees:
        for k in ("employeeId", "employee_id", "id", "uid", "_firestore_id"):
            val = e.get(k)
            if val:
                emp_map[str(val).strip()] = e
        if e.get("email"):
            emp_map[str(e["email"]).lower().strip()] = e

    # 5. Fetch Attendance Records for the Month
    start_str = first_day.isoformat()
    end_str = last_day.isoformat()

    month_records = []

    try:
        cg_records = FirestoreService.collection_group("records")
        for r in cg_records:
            d_str = str(r.get("date", "")).strip()[:10]
            if start_str <= d_str <= end_str:
                month_records.append(r)
    except Exception:
        pass

    # Fall back to top-level attendance only if collection group has no records
    if not month_records:
        try:
            top_records = FirestoreService.list_all("attendance")
            for r in top_records:
                d_str = str(r.get("date", "")).strip()[:10]
                if start_str <= d_str <= end_str:
                    month_records.append(r)
        except Exception:
            pass

    # 6. Aggregate by Employee
    emp_reports = {}
    total_wfo = 0
    total_wfh = 0
    total_late = 0

    for r in month_records:
        d_str = str(r.get("date", "")).strip()[:10]
        eid = r.get("employeeId") or r.get("employee_id") or r.get("uid") or ""
        email = str(r.get("email", "")).lower().strip()
        emp_obj = emp_map.get(str(eid)) or emp_map.get(email) or {}

        real_id = emp_obj.get("employeeId") or emp_obj.get("employee_id") or eid or email
        real_name = (
            emp_obj.get("name")
            or emp_obj.get("fullName")
            or emp_obj.get("full_name")
            or r.get("employeeName")
            or r.get("name")
            or "Employee"
        )
        real_email = emp_obj.get("email") or email or f"{real_id.lower()}@arshithgroup.com"
        real_dept = emp_obj.get("department") or r.get("department") or "Operations"

        target_key = real_id or real_email

        if target_key not in emp_reports:
            emp_reports[target_key] = {
                "employeeId": real_id,
                "employeeName": real_name,
                "email": real_email,
                "department": real_dept,
                "presentDates": set(),
                "wfoDays": 0,
                "wfhDays": 0,
                "lateDays": 0,
                "lateReasons": [],
                "dailyRecords": [],
            }

        rep = emp_reports[target_key]
        work_mode = str(r.get("workMode") or r.get("work_mode") or "WFO").upper()
        if work_mode == "WFO":
            rep["wfoDays"] += 1
            total_wfo += 1
        elif work_mode == "WFH":
            rep["wfhDays"] += 1
            total_wfh += 1

        is_late = bool(
            r.get("lateLogin")
            or r.get("is_late")
            or str(r.get("status", "")).lower() == "late"
            or (r.get("lateReason") and str(r.get("lateReason")).strip())
        )
        late_reason = r.get("lateReason") or r.get("late_reason") or r.get("reason")

        if is_late:
            rep["lateDays"] += 1
            total_late += 1
            if late_reason and str(late_reason).strip():
                rep["lateReasons"].append({
                    "date": d_str,
                    "reason": str(late_reason).strip(),
                })

        try:
            d_obj = date.fromisoformat(d_str)
            if d_obj <= cutoff_date and d_obj.weekday() < 5 and d_str not in holiday_dates:
                rep["presentDates"].add(d_str)
        except Exception:
            pass

        rep["dailyRecords"].append({
            "date": d_str,
            "workMode": work_mode,
            "checkIn": r.get("checkIn") or r.get("check_in_time") or "--",
            "checkOut": r.get("checkOut") or r.get("check_out_time") or "--",
            "duration": r.get("duration") or "--",
            "status": "Late" if is_late else (r.get("status") or "Present"),
            "lateReason": str(late_reason).strip() if late_reason else None,
            "isLate": is_late,
        })

    # Ensure all registered employees appear even with 0 attendance
    for e_key, e_obj in emp_map.items():
        e_id = e_obj.get("employeeId") or e_obj.get("employee_id") or e_obj.get("id") or ""
        e_email = str(e_obj.get("email", "")).lower().strip()
        e_name = e_obj.get("name") or e_obj.get("fullName") or e_obj.get("full_name") or "Employee"
        e_dept = e_obj.get("department") or "Operations"

        target_k = e_id or e_email
        if target_k and target_k not in emp_reports and (e_id not in emp_reports and e_email not in emp_reports):
            emp_reports[target_k] = {
                "employeeId": e_id or "AFI-0000",
                "employeeName": e_name,
                "email": e_email,
                "department": e_dept,
                "presentDates": set(),
                "wfoDays": 0,
                "wfhDays": 0,
                "lateDays": 0,
                "lateReasons": [],
                "dailyRecords": [],
            }

    # Final calculations for each employee
    result_employees = []
    total_present_days_all = 0
    total_absent_days_all = 0

    dept_stats = {}

    for rep in emp_reports.values():
        leaves = approved_leave_map.get(rep["employeeId"]) or approved_leave_map.get(rep["email"]) or set()
        approved_leave_count = len(leaves)

        valid_present = len([d for d in rep["presentDates"] if d not in leaves])
        eligible_days = max(0, total_working_days - approved_leave_count)

        if eligible_days > 0:
            pct = round((valid_present * 100.0) / eligible_days, 1)
        else:
            pct = 0.0

        absent_count = max(0, eligible_days - valid_present)
        total_present_days_all += valid_present
        total_absent_days_all += absent_count

        rep["lateReasons"].sort(key=lambda x: x["date"])
        rep["dailyRecords"].sort(key=lambda x: x["date"], reverse=True)

        emp_item = {
            "employeeId": rep["employeeId"],
            "employeeName": rep["employeeName"],
            "email": rep["email"],
            "department": rep["department"],
            "presentDays": valid_present,
            "workingDays": total_working_days,
            "approvedLeaveDays": approved_leave_count,
            "absentDays": absent_count,
            "attendancePercentage": pct,
            "wfoDays": rep["wfoDays"],
            "wfhDays": rep["wfhDays"],
            "lateDays": rep["lateDays"],
            "lateReasons": rep["lateReasons"],
            "dailyRecords": rep["dailyRecords"],
        }
        result_employees.append(emp_item)

        dept = rep["department"]
        if dept not in dept_stats:
            dept_stats[dept] = {
                "department": dept,
                "employeeCount": 0,
                "totalPercentage": 0.0,
                "wfo": 0,
                "wfh": 0,
                "late": 0,
                "present": 0,
            }
        dept_stats[dept]["employeeCount"] += 1
        dept_stats[dept]["totalPercentage"] += pct
        dept_stats[dept]["wfo"] += rep["wfoDays"]
        dept_stats[dept]["wfh"] += rep["wfhDays"]
        dept_stats[dept]["late"] += rep["lateDays"]
        dept_stats[dept]["present"] += valid_present

    # Sort employees by Attendance % descending by default
    result_employees.sort(key=lambda x: x["attendancePercentage"], reverse=True)

    # Filter by department or search if requested at API level
    filtered_employees = result_employees
    if dept_str and dept_str.upper() not in ["ALL", "ALL DEPARTMENTS"]:
        filtered_employees = [e for e in filtered_employees if e["department"].lower() == dept_str.lower()]

    if search_str:
        s = search_str.strip().lower()
        filtered_employees = [
            e for e in filtered_employees
            if s in e["employeeName"].lower() or s in e["employeeId"].lower() or s in e["email"].lower()
        ]

    # Department summaries
    dept_summaries = []
    for d_name, d_val in sorted(dept_stats.items(), key=lambda x: x[0]):
        avg_p = round(d_val["totalPercentage"] / max(1, d_val["employeeCount"]), 1)
        dept_summaries.append({
            "department": d_name,
            "employeeCount": d_val["employeeCount"],
            "presentAvg": f"{avg_p}%",
            "averagePercentage": avg_p,
            "wfoCount": d_val["wfo"],
            "wfhCount": d_val["wfh"],
            "lateCount": d_val["late"],
            "presentCount": d_val["present"],
        })

    # Performance tier distribution
    tier_excellent = sum(1 for e in result_employees if e["attendancePercentage"] >= 90.0)
    tier_good = sum(1 for e in result_employees if 75.0 <= e["attendancePercentage"] < 90.0)
    tier_low = sum(1 for e in result_employees if e["attendancePercentage"] < 75.0)

    overall_avg_rate = round(
        sum(e["attendancePercentage"] for e in result_employees) / max(1, len(result_employees)),
        1
    ) if result_employees else 0.0

    return {
        "month": f"{year:04d}-{mon:02d}",
        "monthName": month_display,
        "selectedMonth": month_display,
        "totalWorkingDays": total_working_days,
        "averageAttendanceRate": f"{overall_avg_rate}%",
        "onTimeRate": f"{round(max(0, 100.0 - (total_late * 100.0 / max(1, len(month_records)))), 1)}%",
        "summary": {
            "totalRecords": len(month_records),
            "wfo": total_wfo,
            "wfh": total_wfh,
            "late": total_late,
            "present": total_present_days_all,
            "absent": total_absent_days_all,
            "totalAttendance": len(month_records),
        },
        "analytics": {
            "wfo": total_wfo,
            "wfh": total_wfh,
            "late": total_late,
            "present": total_present_days_all,
            "absent": total_absent_days_all,
            "tiers": {
                "excellent": tier_excellent,
                "good": tier_good,
                "low": tier_low,
            },
        },
        "departmentSummaries": dept_summaries,
        "employees": filtered_employees,
        "totalEmployees": len(result_employees),
    }
