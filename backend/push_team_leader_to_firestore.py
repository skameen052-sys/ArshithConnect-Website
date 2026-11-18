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

def to_firestore_value(v):
    if v is None:
        return {"nullValue": None}
    elif isinstance(v, bool):
        return {"booleanValue": v}
    elif isinstance(v, int):
        return {"integerValue": str(v)}
    elif isinstance(v, float):
        return {"doubleValue": v}
    elif isinstance(v, str):
        return {"stringValue": v}
    elif isinstance(v, list):
        return {"arrayValue": {"values": [to_firestore_value(x) for x in v]}}
    elif isinstance(v, dict):
        return {"mapValue": {"fields": {k: to_firestore_value(val) for k, val in v.items()}}}
    else:
        return {"stringValue": str(v)}

def to_firestore_document(doc_dict):
    fields = {}
    for k, v in doc_dict.items():
        if k.startswith("_"):
            continue
        fields[k] = to_firestore_value(v)
    return {"fields": fields}

def save_document(token, collection_name, doc_id, doc_data):
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/{collection_name}/{doc_id}"
    body = json.dumps(to_firestore_document(doc_data)).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="PATCH")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return True, resp.status
    except Exception as e:
        return False, str(e)

def main():
    print("1. Authenticating with Firebase Admin...")
    try:
        token = get_admin_token()
        print("   Authentication successful!")
    except Exception as e:
        print(f"   Failed to authenticate: {e}")
        return

    if not os.path.exists(LOCAL_DB_FILE):
        print(f"Error: {LOCAL_DB_FILE} not found!")
        return

    with open(LOCAL_DB_FILE, "r", encoding="utf-8") as f:
        db = json.load(f)

    target_tables = [
        "team_leaders",
        "projects",
        "project_tasks",
        "tasks",
        "employee_daily_updates",
        "team_leader_reviews",
        "team_leader_performance",
        "workAssignments",
        "employee_notifications",
        "project_milestones",
        "project_allocations",
        "project_reports",
        "project_audit_logs",
        "teams",
        "chat_conversations",
        "users",
    ]

    print("\n2. Pushing tables and documents to Cloud Firestore...")
    for table in target_tables:
        docs = db.get(table, [])
        print(f"\n--- Collection '{table}' ({len(docs)} documents) ---")
        success_cnt = 0
        fail_cnt = 0
        for d in docs:
            doc_id = str(d.get("id") or d.get("milestone_id") or d.get("allocation_id") or d.get("report_id") or d.get("log_id") or d.get("task_id") or d.get("project_id") or d.get("schedule_id"))
            ok, msg = save_document(token, table, doc_id, d)
            if ok:
                success_cnt += 1
                print(f"  [SUCCESS] {table}/{doc_id}")
            else:
                fail_cnt += 1
                print(f"  [FAILED]  {table}/{doc_id}: {msg}")
        print(f"Collection '{table}' Summary: {success_cnt} created/updated, {fail_cnt} failed.")

if __name__ == "__main__":
    main()

