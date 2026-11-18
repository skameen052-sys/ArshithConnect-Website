from datetime import datetime, timezone
import logging
from app.services.firestore_service import firestore_service
from app.core.security import get_password_hash

logger = logging.getLogger("uvicorn.error")


def init_firestore_seed():
    """Ensure default admin and office timings exist in Firestore."""
    now_iso = datetime.now(timezone.utc).isoformat()

    # 1. Ensure Default Admin User exists
    admin_email = "admin@arshith.com"
    existing_users = firestore_service.list_documents("users", [("email", "==", admin_email)])
    if not existing_users:
        logger.info(f"Seeding default administrator ({admin_email}) in Firestore...")
        user_id = firestore_service.create_document("users", {
            "email": admin_email,
            "hashed_password": get_password_hash("AdminPassword@123"),
            "role": "admin",
            "is_active": True,
            "approval_status": "APPROVED",
            "created_at": now_iso,
            "updated_at": now_iso,
        })

        # Check corresponding employee
        existing_emp = firestore_service.list_documents("employees", [("employee_id", "==", "ADM-001")])
        if not existing_emp:
            firestore_service.create_document("employees", {
                "employee_id": "ADM-001",
                "user_id": user_id,
                "full_name": "Administrator",
                "email": admin_email,
                "phone": "--",
                "department": "Operations",
                "designation": "Administrator",
                "status": "Active",
                "shift": "General (09:30 AM - 06:30 PM)",
                "location": "HQ Office",
                "created_at": now_iso,
                "updated_at": now_iso,
            })

    # 1B. Ensure Default HR User exists
    hr_email = "hr@arshith.com"
    existing_hr = firestore_service.list_documents("users", [("email", "==", hr_email)])
    if not existing_hr:
        logger.info(f"Seeding default HR Manager ({hr_email}) in Firestore...")
        hr_uid = firestore_service.create_document("users", {
            "email": hr_email,
            "hashed_password": get_password_hash("HrPassword@123"),
            "role": "hr",
            "is_active": True,
            "approval_status": "APPROVED",
            "name": "HR Manager",
            "employee_id": "HR-001",
            "employeeId": "HR-001",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        existing_hr_emp = firestore_service.list_documents("employees", [("employee_id", "==", "HR-001")])
        if not existing_hr_emp:
            firestore_service.create_document("employees", {
                "employee_id": "HR-001",
                "employeeId": "HR-001",
                "user_id": hr_uid,
                "full_name": "HR Manager",
                "name": "HR Manager",
                "email": hr_email,
                "phone": "+91 98765 00001",
                "department": "Human Resources",
                "designation": "HR Manager",
                "status": "Active",
                "shift": "General (09:30 AM - 06:30 PM)",
                "location": "HQ Office",
                "created_at": now_iso,
                "updated_at": now_iso,
            })

    # 1C. Ensure Default Project HR User exists (Role: hr_projects)
    proj_hr_email = "project.hr@arshith.com"
    existing_proj_hr = firestore_service.list_documents("users", [("email", "==", proj_hr_email)])
    if not existing_proj_hr:
        logger.info(f"Seeding default Project HR Lead ({proj_hr_email}) in Firestore...")
        proj_hr_uid = firestore_service.create_document("users", {
            "email": proj_hr_email,
            "hashed_password": get_password_hash("ProjectHr@123"),
            "role": "hr_projects",
            "is_active": True,
            "approval_status": "APPROVED",
            "name": "Project HR Lead",
            "employee_id": "HR-PRJ-001",
            "employeeId": "HR-PRJ-001",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        existing_proj_emp = firestore_service.list_documents("employees", [("employee_id", "==", "HR-PRJ-001")])
        if not existing_proj_emp:
            firestore_service.create_document("employees", {
                "employee_id": "HR-PRJ-001",
                "employeeId": "HR-PRJ-001",
                "user_id": proj_hr_uid,
                "full_name": "Project HR Lead",
                "name": "Project HR Lead",
                "email": proj_hr_email,
                "phone": "+91 98765 00002",
                "department": "Project Operations",
                "designation": "Project Operations HR Lead",
                "status": "Active",
                "shift": "General (09:30 AM - 06:30 PM)",
                "location": "HQ Office",
                "created_at": now_iso,
                "updated_at": now_iso,
            })

    # 2. Ensure Regular Office Timing exists
    timings = firestore_service.list_documents("office_timings", [("timing_type", "==", "REGULAR")])
    if not timings:
        logger.info("Seeding default regular office timing in Firestore...")
        firestore_service.create_document("office_timings", {
            "timing_type": "REGULAR",
            "start_time": "09:30",
            "end_time": "18:30",
            "grace_minutes": 2,
            "created_at": now_iso,
            "updated_at": now_iso,
        })

    # 3. Canonical PDF Employee (EMP-1001) seeding disabled (sample data removed)
    # 4. Canonical performance appraisal for EMP-1001 disabled (sample data removed)
    # 5. Canonical performance goals for EMP-1001 disabled (sample data removed)

    # 6. Seed Default Teams (General & Company-Wide default group removed)
    existing_teams = firestore_service.list_documents("teams")
    if not existing_teams:
        logger.info("Seeding default enterprise teams for collaborative chat...")
        all_emps = firestore_service.list_documents("employees")
        emp_names = [e.get("full_name") or e.get("name") for e in all_emps if e.get("full_name") or e.get("name")]
        sample_members = emp_names[:8] if emp_names else ["Administrator"]

        team_ops_id = firestore_service.create_document("teams", {
            "name": "Operations Core",
            "teamName": "Operations Core",
            "department": "Operations",
            "description": "Field operations, daily shifts, attendance, and dispatch coordination.",
            "leader": "Farook",
            "members": sample_members,
            "created_at": now_iso,
            "updated_at": now_iso,
        })

        team_eng_id = firestore_service.create_document("teams", {
            "name": "Engineering & Tech",
            "teamName": "Engineering & Tech",
            "department": "Engineering",
            "description": "Technical architecture, system workflows, and sprint updates.",
            "leader": "Arshith Developer",
            "members": ["Arshith Developer", "Farook"],
            "created_at": now_iso,
            "updated_at": now_iso,
        })

    # 1B. Ensure Default HR User exists
    hr_email = "hr@arshith.com"
    existing_hr = firestore_service.list_documents("users", [("email", "==", hr_email)])
    if not existing_hr:
        logger.info(f"Seeding default HR Manager ({hr_email}) in Firestore...")
        hr_uid = firestore_service.create_document("users", {
            "email": hr_email,
            "hashed_password": get_password_hash("HrPassword@123"),
            "role": "hr",
            "is_active": True,
            "approval_status": "APPROVED",
            "name": "HR Manager",
            "employee_id": "HR-001",
            "employeeId": "HR-001",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        existing_hr_emp = firestore_service.list_documents("employees", [("employee_id", "==", "HR-001")])
        if not existing_hr_emp:
            firestore_service.create_document("employees", {
                "employee_id": "HR-001",
                "employeeId": "HR-001",
                "user_id": hr_uid,
                "full_name": "HR Manager",
                "name": "HR Manager",
                "email": hr_email,
                "phone": "+91 98765 00001",
                "department": "Human Resources",
                "designation": "HR Manager",
                "status": "Active",
                "shift": "General (09:30 AM - 06:30 PM)",
                "location": "HQ Office",
                "created_at": now_iso,
                "updated_at": now_iso,
            })

    # 1C. Ensure Default Project HR User exists (Role: hr_projects)
    proj_hr_email = "project.hr@arshith.com"
    existing_proj_hr = firestore_service.list_documents("users", [("email", "==", proj_hr_email)])
    if not existing_proj_hr:
        logger.info(f"Seeding default Project HR Lead ({proj_hr_email}) in Firestore...")
        proj_hr_uid = firestore_service.create_document("users", {
            "email": proj_hr_email,
            "hashed_password": get_password_hash("ProjectHr@123"),
            "role": "hr_projects",
            "is_active": True,
            "approval_status": "APPROVED",
            "name": "Project HR Lead",
            "employee_id": "HR-PRJ-001",
            "employeeId": "HR-PRJ-001",
            "created_at": now_iso,
            "updated_at": now_iso,
        })
        existing_proj_emp = firestore_service.list_documents("employees", [("employee_id", "==", "HR-PRJ-001")])
        if not existing_proj_emp:
            firestore_service.create_document("employees", {
                "employee_id": "HR-PRJ-001",
                "employeeId": "HR-PRJ-001",
                "user_id": proj_hr_uid,
                "full_name": "Project HR Lead",
                "name": "Project HR Lead",
                "email": proj_hr_email,
                "phone": "+91 98765 00002",
                "department": "Project Operations",
                "designation": "Project Operations HR Lead",
                "status": "Active",
                "shift": "General (09:30 AM - 06:30 PM)",
                "location": "HQ Office",
                "created_at": now_iso,
                "updated_at": now_iso,
            })

    # 6. Ensure Default Daily Work Update Schedules exist in Firestore
    existing_schedules = firestore_service.list_documents("work_schedules")
    if not existing_schedules:
        logger.info("Seeding default daily work update schedules in Firestore...")
        default_schedules = [
            {
                "schedule_id": "SCH-01",
                "name": "Work Update 01",
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
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            {
                "schedule_id": "SCH-02",
                "name": "Work Update 02",
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
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            {
                "schedule_id": "SCH-03",
                "name": "Work Update 03",
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
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            {
                "schedule_id": "SCH-04",
                "name": "Work Update 04",
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
                "created_at": now_iso,
                "updated_at": now_iso,
            },
        ]
        for sch in default_schedules:
            sch["id"] = sch["schedule_id"]
            firestore_service.create_document("work_schedules", sch)

    # 10. Employee loans & salary advances (sample data removed)
    # 11. Canonical payslips & payslip requests (sample data removed)

    # 12. Ensure Default Team Leaders exist
    existing_tls = firestore_service.list_documents("team_leaders")
    if not existing_tls:
        logger.info("Seeding default team leaders in Firestore...")
        hashed_tl_pw = get_password_hash("TeamLead@123")
        default_tls = [
            {
                "id": "7856",
                "team_leader_id": "7856",
                "full_name": "rajesh",
                "name": "rajesh",
                "email": "rajesh@leadarshith.com",
                "department": "Operations",
                "specialization": "Technical Lead",
                "experience_years": "3+ Years",
                "hashed_password": hashed_tl_pw,
                "role": "team_leader",
                "approval_status": "APPROVED",
                "is_active": True,
                "registered_at": now_iso,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
            {
                "id": "5230",
                "team_leader_id": "5230",
                "full_name": "phani",
                "name": "phani",
                "email": "phani@leadarshtih.com",
                "department": "Engineering",
                "specialization": "Technical Lead",
                "experience_years": "3+ Years",
                "hashed_password": hashed_tl_pw,
                "role": "team_leader",
                "approval_status": "APPROVED",
                "is_active": True,
                "registered_at": now_iso,
                "created_at": now_iso,
                "updated_at": now_iso,
            },
        ]
        for tl in default_tls:
            firestore_service.create_document("team_leaders", tl)
            existing_user = firestore_service.list_documents("users", [("email", "==", tl["email"])])
            if not existing_user:
                firestore_service.create_document("users", {
                    "id": tl["id"],
                    "uid": tl["id"],
                    "email": tl["email"],
                    "hashed_password": tl["hashed_password"],
                    "role": "team_leader",
                    "name": tl["name"],
                    "team_leader_id": tl["team_leader_id"],
                    "approval_status": "APPROVED",
                    "is_active": True,
                    "created_at": now_iso,
                    "updated_at": now_iso,
                })

    # 13. Ensure Default Projects exist
    default_projs = [
        {
            "id": "PRJ-412119",
            "project_id": "PRJ-412119",
            "name": "facial solutions",
            "title": "facial solutions",
            "description": "work",
            "scope": "work",
            "department": "Operations",
            "status": "In Progress",
            "progress": 15,
            "deadline": "2026-11-10",
            "team_leader": "rajesh",
            "team_leader_id": "7856",
            "team_leader_email": "rajesh@leadarshith.com",
            "assigned_employees": ["Shaik Ameen"],
            "staff_count": 1,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "PRJ-372729",
            "project_id": "PRJ-372729",
            "name": "updi",
            "title": "updi",
            "description": "scope",
            "scope": "scope",
            "department": "Operations",
            "status": "In Progress",
            "progress": 0,
            "deadline": "2026-11-11",
            "team_leader": "rajesh",
            "team_leader_id": "7856",
            "team_leader_email": "rajesh@leadarshith.com",
            "assigned_employees": ["Shaik Ameen"],
            "staff_count": 1,
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    ]
    for p in default_projs:
        existing = firestore_service.list_documents("projects", [("project_id", "==", p["project_id"])])
        if not existing:
            firestore_service.create_document("projects", p)

    # 14. Ensure Default Project Tasks exist
    default_tasks = [
        {
            "id": "TSK-495837",
            "task_id": "TSK-495837",
            "title": "complete work",
            "description": "test cases",
            "project_id": "PRJ-412119",
            "project_name": "facial solutions",
            "assigned_to": "Shaik Ameen",
            "assigned_to_id": "AFI-9073",
            "assigned_to_email": "ameen@arshithgroup.com",
            "lead": "rajesh",
            "team_leader": "rajesh",
            "team_leader_id": "7856",
            "team_leader_email": "rajesh@leadarshith.com",
            "status": "SUBMITTED",
            "review_status": "PENDING",
            "progress": 85,
            "priority": "High Priority",
            "due_date": "2026-11-10",
            "deadline": "2026-11-10",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
        {
            "id": "TSK-495838",
            "task_id": "TSK-495838",
            "title": "complete work",
            "description": "test cases",
            "project_id": "PRJ-372729",
            "project_name": "updi",
            "assigned_to": "Shaik Ameen",
            "assigned_to_id": "AFI-9073",
            "assigned_to_email": "ameen@arshithgroup.com",
            "lead": "rajesh",
            "team_leader": "rajesh",
            "team_leader_id": "7856",
            "team_leader_email": "rajesh@leadarshith.com",
            "status": "IN_PROGRESS",
            "progress": 15,
            "priority": "Medium Priority",
            "due_date": "2026-11-12",
            "deadline": "2026-11-12",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    ]
    for t in default_tasks:
        existing = firestore_service.list_documents("project_tasks", [("task_id", "==", t["task_id"])])
        if not existing:
            firestore_service.create_document("project_tasks", t)
            firestore_service.create_document("tasks", t)
            firestore_service.create_document("assignments", t)





