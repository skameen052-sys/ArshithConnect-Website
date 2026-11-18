import os
import uuid
import io
import logging
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo
from typing import Optional, Tuple, Any, Dict
try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    Image = None
    HAS_PIL = False

import math
from fastapi import HTTPException, status, UploadFile

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

ALLOWED_MIME_TYPES = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}

# Magic bytes detection
MAGIC_BYTES = [
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"RIFF", "image/webp", ".webp"),  # WEBP starts with RIFF and has WEBP at offset 8
]


def get_attendance_storage_dir() -> str:
    """Get the absolute path to the private attendance photo storage directory."""
    if settings.ATTENDANCE_PHOTO_DIR and os.path.isabs(settings.ATTENDANCE_PHOTO_DIR):
        base_dir = settings.ATTENDANCE_PHOTO_DIR
    elif settings.ATTENDANCE_PHOTO_DIR:
        base_dir = os.path.normpath(
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), settings.ATTENDANCE_PHOTO_DIR)
        )
    else:
        # Default: backend/storage/attendance_photos
        base_dir = os.path.normpath(
            os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "storage", "attendance_photos")
        )

    os.makedirs(base_dir, exist_ok=True)
    return base_dir


def get_attendance_timezone() -> ZoneInfo:
    """Retrieve ZoneInfo for configured attendance timezone, defaulting to Asia/Kolkata."""
    try:
        return ZoneInfo(settings.ATTENDANCE_TIMEZONE)
    except Exception:
        return ZoneInfo("Asia/Kolkata")


def get_attendance_now() -> datetime:
    """Get authoritative current datetime in the configured attendance timezone."""
    return datetime.now(get_attendance_timezone())


def get_attendance_today() -> date:
    """Get authoritative current date in the configured attendance timezone."""
    return get_attendance_now().date()


def format_duration_str(seconds: int) -> str:
    """Format duration in 'HH hrs MM mins' to match reference screenshot."""
    if seconds < 0:
        seconds = 0
    hrs = seconds // 3600
    mins = (seconds % 3600) // 60
    return f"{hrs:02d} hrs {mins:02d} mins"


def parse_time_display(val: Any) -> str:
    """Parse Timestamp, datetime, or time string to standard human-readable 12-hour format in configured timezone (IST)."""
    if not val:
        return "--"
    tz = get_attendance_timezone()
    if isinstance(val, datetime):
        if val.tzinfo is None:
            val = val.replace(tzinfo=timezone.utc)
        return val.astimezone(tz).strftime("%I:%M %p")
    if hasattr(val, "strftime"):
        return val.strftime("%I:%M %p")
    s = str(val).strip()
    if not s or s == "None" or s == "--":
        return "--"
    if "T" in s or s.endswith("Z"):
        try:
            iso_s = s.replace("Z", "+00:00")
            dt = datetime.fromisoformat(iso_s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(tz).strftime("%I:%M %p")
        except Exception:
            return s
    return s


def calculate_haversine_distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate great-circle distance between two GPS coordinates in meters
    using the Haversine formula.
    """
    R = 6371000.0  # Earth's mean radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def verify_wfo_geofence(latitude: float, longitude: float, accuracy: float) -> dict:
    """
    Independently validate GPS coordinates against authoritative office coordinates and accuracy threshold.
    Returns structured validation report dict.
    """
    # 1. Bounds checking
    if not (-90.0 <= latitude <= 90.0) or not (-180.0 <= longitude <= 180.0):
        return {
            "valid": False,
            "code": "INVALID_COORDINATES",
            "message": "GPS coordinates out of valid geographical range (latitude [-90, 90], longitude [-180, 180]).",
            "distanceMeters": None,
            "allowedRadiusMeters": settings.OFFICE_GEOFENCE_RADIUS_METERS,
            "accuracy": accuracy,
            "maxAllowedAccuracy": settings.MAX_GPS_ACCURACY_METERS,
        }

    # 2. Check GPS accuracy threshold
    if accuracy < 0:
        return {
            "valid": False,
            "code": "INVALID_ACCURACY",
            "message": "GPS location accuracy must be a positive number in meters.",
            "distanceMeters": None,
            "allowedRadiusMeters": settings.OFFICE_GEOFENCE_RADIUS_METERS,
            "accuracy": accuracy,
            "maxAllowedAccuracy": settings.MAX_GPS_ACCURACY_METERS,
        }

    if accuracy > settings.MAX_GPS_ACCURACY_METERS:
        return {
            "valid": False,
            "code": "INACCURATE_GPS",
            "message": (
                f"Your GPS accuracy is too low (±{round(accuracy)}m). Accurate location within "
                f"{int(settings.MAX_GPS_ACCURACY_METERS)}m is required. Please check your device location settings or move near a window and try again."
            ),
            "distanceMeters": None,
            "allowedRadiusMeters": settings.OFFICE_GEOFENCE_RADIUS_METERS,
            "accuracy": accuracy,
            "maxAllowedAccuracy": settings.MAX_GPS_ACCURACY_METERS,
        }

    # 3. Calculate distance to authoritative coordinates (12.9104417, 77.6442435)
    dist = calculate_haversine_distance_meters(
        latitude,
        longitude,
        settings.COMPANY_OFFICE_LATITUDE,
        settings.COMPANY_OFFICE_LONGITUDE,
    )

    radius_int = int(settings.OFFICE_GEOFENCE_RADIUS_METERS)
    if dist > settings.OFFICE_GEOFENCE_RADIUS_METERS:
        return {
            "valid": False,
            "code": "OUTSIDE_OFFICE_GEOFENCE",
            "message": "You are outside the permitted attendance area.",
            "distanceMeters": round(dist, 1),
            "allowedRadiusMeters": settings.OFFICE_GEOFENCE_RADIUS_METERS,
            "accuracy": accuracy,
            "maxAllowedAccuracy": settings.MAX_GPS_ACCURACY_METERS,
        }

    return {
        "valid": True,
        "code": None,
        "message": f"Successfully verified presence within {radius_int} metres of configured coordinates.",
        "distanceMeters": round(dist, 1),
        "allowedRadiusMeters": settings.OFFICE_GEOFENCE_RADIUS_METERS,
        "accuracy": accuracy,
        "maxAllowedAccuracy": settings.MAX_GPS_ACCURACY_METERS,
    }


def get_employee_authorized_work_mode(employee) -> str:
    """
    Determine the employee's authorized work mode ('WFO' or 'WFH') from their verified profile settings.
    Rejects with clear message instead of guessing or defaulting if missing or unauthorized.
    """
    if not employee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Employee profile not found.",
        )

    # Check direct work_mode attribute if present
    explicit_mode = (
        (employee.get("work_mode") or employee.get("workMode"))
        if isinstance(employee, dict)
        else getattr(employee, "work_mode", getattr(employee, "workMode", None))
    )
    if explicit_mode and str(explicit_mode).strip().upper() in ["WFO", "WFH"]:
        return str(explicit_mode).strip().upper()

    # Derive from employee location setting
    loc = (
        employee.get("location")
        if isinstance(employee, dict)
        else getattr(employee, "location", None)
    )
    if not loc or not str(loc).strip():
        return "WFO"

    loc_str = str(loc).strip().upper()
    if any(k in loc_str for k in ["WFH", "REMOTE", "HOME", "WORK FROM HOME"]):
        return "WFH"

    if any(k in loc_str for k in ["HQ", "OFFICE", "WFO", "ONSITE"]):
        return "WFO"

    return "WFO"


def detect_image_type(file_bytes: bytes) -> Optional[Tuple[str, str]]:
    """Detect image type from magic bytes. Returns (mime_type, file_extension) or None."""
    if len(file_bytes) < 12:
        return None

    if file_bytes.startswith(b"\xff\xd8\xff"):
        return ("image/jpeg", ".jpg")
    if file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("image/png", ".png")
    if file_bytes.startswith(b"RIFF") and file_bytes[8:12] == b"WEBP":
        return ("image/webp", ".webp")

    return None


async def validate_and_save_attendance_photo(
    file: object,
    photo_type: str = "check_in",
    attendance_date: Optional[date] = None,
) -> Tuple[str, bytes, str]:
    """
    Validate uploaded image (size, magic bytes, PIL verification) and save to private storage.
    Supports UploadFile, raw bytes, or Base64 data URL string.
    Returns (storage_key, image_bytes, mime_type) for dual storage in file system and PostgreSQL BYTEA.
    """
    if attendance_date is None:
        attendance_date = get_attendance_today()

    date_str = attendance_date.isoformat()

    # Read content from UploadFile, bytes, or Base64 string
    if hasattr(file, "read"):
        content = await file.read()
    elif isinstance(file, (bytes, bytearray)):
        content = bytes(file)
    elif isinstance(file, str):
        import base64
        cleaned_str = file.strip()
        if "," in cleaned_str:
            cleaned_str = cleaned_str.split(",", 1)[1]
        try:
            content = base64.b64decode(cleaned_str)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Corrupted or invalid Base64 image encoding.",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported photograph payload format.",
        )

    file_size = len(content)

    # 1. Size validation (Max 5 MB)
    if file_size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded photo is empty.",
        )
    if file_size > settings.MAX_PHOTO_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Photo size exceeds maximum allowed limit of {settings.MAX_PHOTO_SIZE_BYTES // (1024 * 1024)}MB.",
        )

    # 2. Magic bytes inspection
    detected = detect_image_type(content)
    if not detected:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Unsupported image format. Only JPEG, PNG, and WebP are accepted.",
        )

    mime_type, ext = detected

    # 3. PIL image structure verification (if Pillow is installed)
    if HAS_PIL and Image is not None:
        try:
            image = Image.open(io.BytesIO(content))
            image.verify()  # Verifies header and integrity without loading entire bitmap into memory
        except Exception as e:
            logger.warning(f"Image verification failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Corrupted or invalid image data.",
            )

    # 4. Save to private directory organized by date
    storage_base = get_attendance_storage_dir()
    date_dir = os.path.join(storage_base, date_str)
    os.makedirs(date_dir, exist_ok=True)

    unique_filename = f"{uuid.uuid4().hex}_{photo_type}{ext}"
    absolute_dest = os.path.join(date_dir, unique_filename)

    try:
        with open(absolute_dest, "wb") as f:
            f.write(content)
    except Exception as e:
        logger.error(f"Failed to write attendance photo: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to store attendance photo securely.",
        )

    # Return relative storage key, raw binary bytes for direct PostgreSQL BYTEA storage, and mime_type
    storage_key = f"{date_str}/{unique_filename}"
    return storage_key, content, mime_type


def resolve_photo_path(storage_key: str) -> Tuple[str, str]:
    """
    Safely resolve storage key to absolute file path and verify it exists within storage directory.
    Returns (absolute_file_path, mime_type).
    """
    if not storage_key:
        raise HTTPException(status_code=404, detail="Photo not found.")

    storage_base = os.path.realpath(get_attendance_storage_dir())
    target_path = os.path.realpath(os.path.join(storage_base, storage_key.replace("/", os.sep)))

    # Prevent directory traversal attacks
    if not target_path.startswith(storage_base):
        logger.warning(f"Directory traversal attempt detected with key: {storage_key}")
        raise HTTPException(status_code=400, detail="Invalid storage path.")

    if not os.path.exists(target_path) or not os.path.isfile(target_path):
        raise HTTPException(status_code=404, detail="Attendance photo file not found.")

    ext = os.path.splitext(target_path)[1].lower()
    mime_map = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
    }
    mime_type = mime_map.get(ext, "image/jpeg")

    return target_path, mime_type


def cleanup_photo_file(storage_key: Optional[str]) -> None:
    """Delete a newly saved photo file if database transaction fails."""
    if not storage_key:
        return
    try:
        storage_base = os.path.realpath(get_attendance_storage_dir())
        target_path = os.path.realpath(os.path.join(storage_base, storage_key.replace("/", os.sep)))
        if target_path.startswith(storage_base) and os.path.exists(target_path):
            os.remove(target_path)
            logger.info(f"Cleaned up orphaned attendance photo: {storage_key}")
    except Exception as e:
        logger.warning(f"Failed to cleanup photo {storage_key}: {e}")


def upload_to_firebase_storage(
    photo_bytes: bytes,
    mime_type: str,
    employee_id: str,
    attendance_record_id: Any,
    photo_type: str = "check-in",
    employee_uid: Optional[str] = None,
    attendance_date: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Upload real attendance photograph bytes to Cloud Storage for Firebase.
    Uploads exactly once to the single canonical storage path:
       attendancePhotos/{target_id}/{date_str}.jpg
    Returns (canonical_storage_path, photo_url).
    """
    from datetime import timedelta
    from app.core.firebase import get_storage_bucket, is_firebase_live

    ext = ".jpg" if ("jpeg" in mime_type or "jpg" in mime_type) else (".png" if "png" in mime_type else ".webp")
    target_id = employee_uid or employee_id
    date_str = str(attendance_date or "")
    if not date_str and "_" in str(attendance_record_id):
        date_str = str(attendance_record_id).split("_", 1)[1]

    # Canonical storage path matching reference screenshot & Android mobile app:
    # attendancePhotos/{userId}/{date}.jpg
    if date_str:
        canonical_path = f"attendancePhotos/{target_id}/{date_str}{ext}"
    else:
        canonical_path = f"attendancePhotos/{target_id}/{attendance_record_id}{ext}"

    if is_firebase_live():
        bucket = get_storage_bucket()
        if not bucket:
            raise RuntimeError("Cloud Storage bucket is not available or not initialized.")

        try:
            # Upload exactly once to canonical storage path
            blob = bucket.blob(canonical_path)
            blob.upload_from_string(photo_bytes, content_type=mime_type)

            # Generate signed URL for authenticated display or direct media link
            try:
                photo_url = blob.generate_signed_url(expiration=timedelta(days=7), method="GET")
            except Exception:
                photo_url = f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/{canonical_path.replace('/', '%2F')}?alt=media"

            logger.info(f"Successfully uploaded photograph ({len(photo_bytes)} bytes) to Cloud Storage: {canonical_path}")
            return canonical_path, photo_url
        except Exception as e:
            logger.error(f"Failed to upload photo to Cloud Storage bucket: {e}")
            raise RuntimeError(f"Cloud Storage photograph upload failed: {e}")

    # Fallback / local developer persistence
    storage_base = get_attendance_storage_dir()
    rec_dir = os.path.join(storage_base, str(employee_id), str(attendance_record_id))
    os.makedirs(rec_dir, exist_ok=True)
    local_filename = f"{photo_type}{ext}"
    dest = os.path.join(rec_dir, local_filename)
    with open(dest, "wb") as f:
        f.write(photo_bytes)

    local_url = f"/api/attendance/{attendance_record_id}/photo/{photo_type}"
    return canonical_path, local_url


def get_daily_attendance_metrics(target_date: Optional[str] = None) -> Dict[str, Any]:
    """
    Compute authoritative live daily attendance breakdown:
    - totalPresent: total unique employees present
    - wfo: total WFO employees
    - wfh: total WFH employees
    - late: total late logins
    - records: deduplicated daily attendance records formatted for dashboard
    Queries live Cloud Firestore subcollections (attendance/{uid}/records/{date}),
    collection_group records, and top-level attendance.
    """
    if not target_date:
        target_date = get_attendance_today().isoformat()

    target_date_iso = str(target_date).strip()

    from app.services.firestore_service import FirestoreService

    all_emps = FirestoreService.list_all("employees")
    emp_map = {}
    for e in all_emps:
        uid = e.get("uid") or e.get("id")
        code = e.get("employeeId") or e.get("employee_id") or uid
        if uid:
            emp_map[str(uid)] = e
        if code:
            emp_map[str(code)] = e
        if e.get("email"):
            emp_map[str(e["email"]).lower().strip()] = e

    merged_by_emp = {}

    # 1. Query collection group records for target date
    cg_records = FirestoreService.collection_group("records", [("date", "==", target_date_iso)])
    for cr in cg_records:
        eid = str(cr.get("employeeId") or cr.get("employee_id") or cr.get("uid") or "")
        emp = emp_map.get(eid) or emp_map.get(str(cr.get("email", "")).lower().strip()) or {}
        code = emp.get("employeeId") or emp.get("employee_id") or eid
        if code:
            merged_by_emp[str(code)] = dict(cr)
            if eid:
                merged_by_emp[str(eid)] = dict(cr)

    # 2. Query top-level attendance records for target date
    top_records = FirestoreService.query("attendance", {"date": target_date_iso})
    for tr in top_records:
        eid = str(tr.get("employee_id") or tr.get("employeeId") or tr.get("employee_uid") or "")
        emp = emp_map.get(eid) or emp_map.get(str(tr.get("email", "")).lower().strip()) or {}
        code = emp.get("employeeId") or emp.get("employee_id") or eid
        if code:
            if str(code) in merged_by_emp:
                merged_by_emp[str(code)].update(tr)
            else:
                merged_by_emp[str(code)] = dict(tr)

    # 3. Fetch real-time live attendance punches from Cloud Firestore for all active employees
    try:
        from concurrent.futures import ThreadPoolExecutor
        from app.services.firestore_rest import fetch_live_subdocument

        def _fetch_emp(emp):
            u = emp.get("uid") or emp.get("id")
            if not u:
                return None
            rec = fetch_live_subdocument("attendance", str(u), "records", target_date_iso)
            return (str(u), rec, emp)

        with ThreadPoolExecutor(max_workers=10) as ex:
            fetched_items = list(ex.map(_fetch_emp, all_emps))

        for item in fetched_items:
            if not item:
                continue
            u_id, live_rec, emp_obj = item
            if live_rec and (live_rec.get("checkIn") or live_rec.get("status") or live_rec.get("date") == target_date_iso):
                code = emp_obj.get("employeeId") or emp_obj.get("employee_id") or u_id
                emp_name = emp_obj.get("name") or emp_obj.get("fullName") or "Employee"
                emp_dept = emp_obj.get("department") or "Operations"
                cin_val = live_rec.get("checkIn") or live_rec.get("check_in_time")
                cout_val = live_rec.get("checkOut") or live_rec.get("check_out_time")
                w_mode = str(live_rec.get("workMode") or live_rec.get("work_mode") or "WFO").upper()
                st = str(live_rec.get("status") or ("Completed" if cout_val and cout_val != "--" else "Present"))
                late_reason_val = (
                    live_rec.get("lateReason")
                    or live_rec.get("late_reason")
                    or live_rec.get("lateLoginReason")
                    or live_rec.get("late_login_reason")
                    or live_rec.get("reason")
                    or live_rec.get("lateReasonText")
                )
                is_lt = bool(live_rec.get("lateLogin") or live_rec.get("is_late") or bool(late_reason_val))
                late_status_val = "SUBMITTED" if late_reason_val else ("PENDING" if is_lt else "NOT_REQUIRED")

                norm = {
                    "id": f"{code}_{target_date_iso}",
                    "employee_id": code,
                    "employeeId": code,
                    "employee_uid": u_id,
                    "employeeName": emp_name,
                    "name": emp_name,
                    "department": emp_dept,
                    "date": target_date_iso,
                    "check_in_time": parse_time_display(cin_val),
                    "check_out_time": parse_time_display(cout_val) if cout_val else None,
                    "check_in_timestamp": cin_val,
                    "check_out_timestamp": cout_val,
                    "work_mode": w_mode,
                    "workMode": w_mode,
                    "status": st,
                    "is_late": is_lt,
                    "lateLogin": is_lt,
                    "lateReason": late_reason_val,
                    "late_reason": late_reason_val,
                    "lateReasonStatus": late_status_val,
                    "late_reason_status": late_status_val,
                    "lateReasonSubmittedAt": live_rec.get("lateReasonSubmittedAt") or live_rec.get("late_reason_submitted_at") or (cin_val if late_reason_val else None),
                    "check_in_photo_url": live_rec.get("checkInPhotoUrl"),
                    "duration": live_rec.get("duration") or "--",
                    "sync_channel": live_rec.get("sync_channel") or "web_portal_synced",
                    "sync_source": live_rec.get("sync_source") or "web_portal",
                }
                merged_by_emp[str(code)] = norm
                merged_by_emp[str(u_id)] = norm

                # Cache in local attendance collection
                try:
                    FirestoreService.save("attendance", f"{code}_{target_date_iso}", norm)
                except Exception:
                    pass
    except Exception as live_err:
        logger.debug(f"Live daily attendance metrics fetch: {live_err}")

    # Deduplicate strictly by employee code
    unique_records = {}
    for k, r in merged_by_emp.items():
        emp = emp_map.get(k) or emp_map.get(str(r.get("email", "")).lower().strip()) or {}
        code = emp.get("employeeId") or emp.get("employee_id") or r.get("employee_id") or r.get("employeeId") or k
        if str(code) not in unique_records:
            name = emp.get("name") or emp.get("fullName") or r.get("employeeName") or r.get("name") or "Employee"
            dept = emp.get("department") or r.get("department") or "Operations"
            r_copy = dict(r)
            r_copy["employee_id"] = str(code)
            r_copy["employeeId"] = str(code)
            r_copy["employeeName"] = name
            r_copy["department"] = dept
            unique_records[str(code)] = r_copy

    daily_list = list(unique_records.values())

    total_present = 0
    wfo_count = 0
    wfh_count = 0
    late_count = 0

    for r in daily_list:
        st = str(r.get("status", "")).strip().capitalize()
        cin = r.get("check_in_time") or r.get("checkIn") or r.get("check_in_timestamp")
        is_present = (st in ["Present", "Late", "Completed"]) or bool(cin and str(cin) != "--")
        if is_present:
            total_present += 1
            w_mode = str(r.get("work_mode") or r.get("workMode") or "WFO").strip().upper()
            if w_mode == "WFH":
                wfh_count += 1
            else:
                wfo_count += 1

            is_lt = bool(r.get("is_late") or r.get("lateLogin") or st == "Late")
            if is_lt:
                late_count += 1

    return {
        "date": target_date_iso,
        "totalPresent": total_present,
        "wfo": wfo_count,
        "wfh": wfh_count,
        "late": late_count,
        "records": daily_list,
    }
