import urllib.request
import json
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
LOCAL_DB_FILE = os.path.join(BACKEND_DIR, "firestore_local_db.json")
API_KEY = "AIzaSyCdc8YjhNXXS0dSdYs1iKgJvL44G_6MAM8"
PROJECT_ID = "arshith-connect-attendance"

def get_admin_token():
    url = f"https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={API_KEY}"
    payload = json.dumps({
        "email": "admin@arshith.com",
        "password": "Admin@123",
        "returnSecureToken": True,
    }).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return data["idToken"]

def parse_firestore_fields(fields):
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
            res[k] = [
                x.get("stringValue") or x.get("integerValue") or x.get("booleanValue") or x
                for x in v["arrayValue"].get("values", [])
            ]
        else:
            res[k] = str(v)
    return res

def fetch_collection(token, collection_name, page_size=100):
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection_name}?pageSize={page_size}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            docs = []
            for doc in data.get("documents", []):
                doc_id = doc.get("name", "").split("/")[-1]
                parsed = parse_firestore_fields(doc.get("fields", {}))
                parsed["id"] = doc_id
                docs.append(parsed)
            return docs
    except Exception as e:
        print(f"Error fetching collection {collection_name}: {e}")
        return []

def fetch_subcollection(token, path):
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            docs = []
            for doc in data.get("documents", []):
                doc_id = doc.get("name", "").split("/")[-1]
                parsed = parse_firestore_fields(doc.get("fields", {}))
                parsed["id"] = doc_id
                docs.append(parsed)
            return docs
    except Exception as e:
        return []

def main():
    print("1. Authenticating with Firebase Admin...")
    token = get_admin_token()
    print("   Authenticated successfully.")

    print("2. Fetching Collections from Cloud Firestore...")
    employees = fetch_collection(token, "employees")
    print(f"   Fetched {len(employees)} employees.")
    
    users = fetch_collection(token, "users")
    print(f"   Fetched {len(users)} users.")

    admins = fetch_collection(token, "admins")
    print(f"   Fetched {len(admins)} admins.")

    teams = fetch_collection(token, "teams")
    print(f"   Fetched {len(teams)} teams.")

    settings_docs = fetch_collection(token, "settings")
    print(f"   Fetched {len(settings_docs)} settings.")

    meetings = fetch_collection(token, "meetings")
    print(f"   Fetched {len(meetings)} meetings.")

    # 3. Fetch attendance records for all employees
    all_attendance_records = []
    print("3. Fetching attendance records for each employee...")
    for emp in employees:
        uid = emp.get("uid") or emp.get("id")
        emp_code = emp.get("employeeId") or emp.get("employee_id") or uid
        emp_name = emp.get("name") or emp.get("fullName") or "Employee"
        emp_dept = emp.get("department") or "Operations"
        emp_email = (emp.get("email") or "").lower()

        if uid:
            records = fetch_subcollection(token, f"attendance/{uid}/records")
            for r in records:
                doc_date = r.get("date") or r.get("id")
                r["user_id"] = uid
                r["firebase_uid"] = uid
                r["employeeId"] = uid
                r["employee_uid"] = uid
                r["employee_id"] = emp_code
                r["employeeCode"] = emp_code
                r["employeeName"] = emp_name
                r["name"] = emp_name
                r["department"] = emp_dept
                r["email"] = emp_email
                r["date"] = doc_date
                r["_doc_path"] = f"attendance/{uid}/records/{doc_date}"
                if not r.get("sync_channel"):
                    r["sync_channel"] = "web_portal_synced"
                all_attendance_records.append(r)
    print(f"   Fetched {len(all_attendance_records)} attendance records across all employees.")

    # 4. Fetch workUpdates for all employees
    all_work_updates = []
    print("4. Fetching workUpdates records for each employee...")
    for emp in employees:
        uid = emp.get("uid") or emp.get("id")
        emp_name = emp.get("name") or emp.get("full_name") or "Employee"
        emp_email = (emp.get("email") or "").lower()
        if uid:
            records = fetch_subcollection(token, f"workUpdates/{uid}/dailyUpdates")
            for r in records:
                doc_name = r.get("id") or r.get("name", "").split("/")[-1]
                sec = r.get("section")
                sec_str = f"Work Update 0{sec}" if sec else "-"
                r["id"] = doc_name
                r["documentId"] = doc_name
                r["firestorePath"] = f"workUpdates/{uid}/dailyUpdates/{doc_name}"
                r["_doc_path"] = f"workUpdates/{uid}/dailyUpdates/{doc_name}"
                if not r.get("employeeId"):
                    r["employeeId"] = uid
                if not r.get("employeeEmail"):
                    r["employeeEmail"] = emp_email
                if not r.get("employeeName"):
                    r["employeeName"] = emp_name
                if not r.get("workSchedule"):
                    r["workSchedule"] = r.get("schedule") or "-"
                if not r.get("submissionWindow"):
                    r["submissionWindow"] = r.get("updateWindow") or "-"
                if not r.get("scheduleName"):
                    r["scheduleName"] = r.get("sectionTitle") or sec_str
                all_work_updates.append(r)
    print(f"   Fetched {len(all_work_updates)} work updates across all employees.")

    # 5. Normalize employees & users
    users_by_email = {u.get("email", "").lower(): u for u in users if u.get("email")}

    for emp in employees:
        email = (emp.get("email") or "").lower()
        u = users_by_email.get(email)
        if u:
            if not emp.get("hashed_password") and u.get("hashed_password"):
                emp["hashed_password"] = u["hashed_password"]
            if not emp.get("user_id"):
                emp["user_id"] = u.get("id")
        if not emp.get("full_name") and emp.get("name"):
            emp["full_name"] = emp["name"]
        if not emp.get("employee_id") and emp.get("employeeId"):
            emp["employee_id"] = emp["employeeId"]
        if not emp.get("employeeId") and emp.get("employee_id"):
            emp["employeeId"] = emp["employee_id"]
        if not emp.get("profile_photo") and emp.get("photoUrl"):
            emp["profile_photo"] = emp["photoUrl"]
        if not emp.get("profilePhoto") and emp.get("photoUrl"):
            emp["profilePhoto"] = emp["photoUrl"]
        if not emp.get("approval_status"):
            emp["approval_status"] = (emp.get("status") or "APPROVED").upper()
        if not emp.get("status"):
            emp["status"] = "Active" if emp.get("approval_status") == "APPROVED" else emp.get("approval_status")

    # Load existing local db to preserve additional mock keys if any
    local_db = {}
    if os.path.exists(LOCAL_DB_FILE):
        try:
            with open(LOCAL_DB_FILE, "r", encoding="utf-8") as f:
                local_db = json.load(f)
        except Exception:
            pass

    local_db["employees"] = employees
    local_db["users"] = users
    local_db["admins"] = admins
    local_db["teams"] = teams
    local_db["settings"] = settings_docs
    local_db["meetings"] = meetings
    local_db["attendance"] = all_attendance_records
    local_db["attendances"] = all_attendance_records
    local_db["cg_records"] = all_attendance_records
    local_db["work_updates"] = all_work_updates
    local_db["cg_dailyUpdates"] = all_work_updates
    local_db["workUpdates"] = all_work_updates

    # Save to LOCAL_DB_FILE and backup
    backup_file = os.path.join(BACKEND_DIR, "firestore_local_db.backup.json")
    with open(backup_file, "w", encoding="utf-8") as f:
        json.dump(local_db, f, indent=2)
    with open(LOCAL_DB_FILE, "w", encoding="utf-8") as f:
        json.dump(local_db, f, indent=2)
    print(f"5. Updated {LOCAL_DB_FILE} and backup with real live database data!")

if __name__ == "__main__":
    main()

