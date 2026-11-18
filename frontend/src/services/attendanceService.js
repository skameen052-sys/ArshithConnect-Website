import api from './api';
import { db } from '../firebase/firebaseConfig';
import { collection, collectionGroup, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';

/**
 * AttendanceService - Check-in, Check-out, and Attendance Logs
 * Connected to FastAPI backend with Cloud Firestore direct client fallback.
 */
export const attendanceService = {
  /**
   * Direct Firestore client fallback when backend API is offline or unreachable
   */
  async getRecordsFromFirestoreDirectly(params = {}) {
    if (!db) return [];
    try {
      // 1. Fetch employees map
      const empMap = {};
      try {
        const empSnap = await getDocs(collection(db, 'employees'));
        empSnap.forEach((d) => {
          const data = d.data();
          const uid = d.id;
          const code = data.employeeId || data.employee_id || uid;
          empMap[uid] = data;
          if (code) empMap[code] = data;
          if (data.email) empMap[String(data.email).toLowerCase().trim()] = data;
        });
      } catch (e) {
        console.warn('[AttendanceService] Could not pre-fetch employees map from Firestore:', e);
      }

      // 2. Fetch top-level attendance collection
      const rawRecordsMap = new Map();
      try {
        const attSnap = await getDocs(collection(db, 'attendance'));
        attSnap.forEach((d) => {
          const data = d.data();
          const eid = data.employee_id || data.employeeId || data.employee_uid || data.employeeUid || d.id;
          const dt = String(data.date || '').slice(0, 10);
          const key = `${eid}_${dt}`;
          rawRecordsMap.set(key, { id: d.id, ...data });
        });
      } catch (e) {
        console.warn('[AttendanceService] Could not fetch top-level attendance:', e);
      }

      // 3. Fetch collectionGroup('records') where mobile check-ins and late reasons are stored
      try {
        const cgSnap = await getDocs(collectionGroup(db, 'records'));
        cgSnap.forEach((d) => {
          const cData = d.data();
          const parentDoc = d.ref.parent.parent;
          const parentUid = parentDoc ? parentDoc.id : '';
          const eid = cData.employeeId || cData.employee_id || cData.uid || parentUid;
          const emp = empMap[eid] || empMap[parentUid] || {};
          const realEmpId = emp.employeeId || emp.employee_id || eid;
          const dt = String(cData.date || d.id || '').slice(0, 10);
          const key = `${realEmpId}_${dt}`;

          const existing = rawRecordsMap.get(key) || rawRecordsMap.get(`${eid}_${dt}`) || {};
          const lateReasonStr = cData.lateReason || cData.late_reason || cData.reason || existing.lateReason || existing.late_reason || null;
          const isLateFlag = Boolean(
            cData.lateLogin ||
            cData.is_late ||
            cData.isLate ||
            (cData.status || '').toLowerCase() === 'late' ||
            existing.isLate ||
            existing.is_late ||
            lateReasonStr
          );

          rawRecordsMap.set(key, {
            id: d.id,
            employeeUid: parentUid,
            ...existing,
            ...cData,
            lateReason: lateReasonStr,
            isLate: isLateFlag,
          });
        });
      } catch (e) {
        console.warn('[AttendanceService] Could not fetch collectionGroup records:', e);
      }

      const rawRecords = Array.from(rawRecordsMap.values());

      // 4. Format and enrich records
      const formatted = rawRecords.map((r) => {
        const empId = r.employee_id || r.employeeId || r.employee_uid || r.employeeUid || '';
        const emp = empMap[empId] || empMap[r.id] || {};
        const empName =
          r.employeeName ||
          r.employee_name ||
          r.name ||
          emp.name ||
          emp.fullName ||
          emp.full_name ||
          'Employee';
        const empDept = r.department || emp.department || 'Operations';
        const checkInTime = r.check_in_time || r.checkIn || (typeof r.check_in_timestamp === 'string' ? r.check_in_timestamp.slice(11, 16) : '--');
        const checkOutTime = r.check_out_time || r.checkOut || (typeof r.check_out_timestamp === 'string' ? r.check_out_timestamp.slice(11, 16) : '--');
        const lateReasonVal = r.lateReason || r.late_reason || r.reason || null;
        const isLateVal = Boolean(
          r.is_late ||
          r.isLate ||
          r.lateLogin ||
          (r.status || '').toLowerCase() === 'late' ||
          (lateReasonVal && String(lateReasonVal).trim())
        );

        return {
          id: r.id,
          employeeId: emp.employeeId || emp.employee_id || empId,
          employeeName: empName,
          department: empDept,
          date: String(r.date || '').slice(0, 10),
          workMode: r.work_mode || r.workMode || 'WFO',
          status: isLateVal ? 'Late' : (r.status || 'Present'),
          checkIn: checkInTime || '--',
          checkOut: checkOutTime || '--',
          duration: r.duration || '--',
          isLate: isLateVal,
          lateReason: lateReasonVal,
          lateReasonStatus: r.lateReasonStatus || r.late_reason_status || (lateReasonVal ? 'SUBMITTED' : (isLateVal ? 'PENDING' : 'NOT_REQUIRED')),
          lateReasonSubmittedAt: r.late_reason_submitted_at || r.lateReasonSubmittedAt || null,
          checkInLatitude: r.check_in_latitude ?? r.checkInLatitude ?? null,
          checkInLongitude: r.check_in_longitude ?? r.checkInLongitude ?? null,
          checkInLocationAccuracy: r.check_in_location_accuracy ?? r.checkInLocationAccuracy ?? null,
          hasCheckInPhoto: Boolean(r.check_in_photo_url || r.photoUrl || r.checkInPhotoUrl || r.hasCheckInPhoto),
          checkInPhotoUrl: r.check_in_photo_url || r.photoUrl || r.checkInPhotoUrl || null,
        };
      });

      // 4. Apply filters
      const effectiveStart = (params.start_date || params.from_date || (params.date ? params.date : '') || '').trim();
      const effectiveEnd = (params.end_date || params.to_date || (params.date ? params.date : '') || '').trim();
      const search = (params.search || '').trim().toLowerCase();
      const statusFilter = (params.status || 'ALL').toUpperCase();
      const modeFilter = (params.workMode || 'ALL').toUpperCase();

      const filtered = formatted.filter((rec) => {
        if (effectiveStart && rec.date && rec.date < effectiveStart) return false;
        if (effectiveEnd && rec.date && rec.date > effectiveEnd) return false;
        if (search) {
          const matchName = (rec.employeeName || '').toLowerCase().includes(search);
          const matchId = (rec.employeeId || '').toLowerCase().includes(search);
          const matchDept = (rec.department || '').toLowerCase().includes(search);
          if (!matchName && !matchId && !matchDept) return false;
        }
        if (statusFilter !== 'ALL' && statusFilter !== 'ALL STATUSES') {
          if (statusFilter === 'LATE') {
            if (!rec.isLate && (rec.status || '').toUpperCase() !== 'LATE') return false;
          } else if ((rec.status || '').toUpperCase() !== statusFilter) {
            return false;
          }
        }
        if (modeFilter !== 'ALL' && modeFilter !== 'ALL WORK MODES') {
          if ((rec.workMode || '').toUpperCase() !== modeFilter) return false;
        }
        return true;
      });

      filtered.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return filtered;
    } catch (err) {
      console.error('[AttendanceService] Direct Firestore fallback error:', err);
      return [];
    }
  },

  /**
   * Get attendance records with optional filters (Search, workMode, status, date, start_date, end_date)
   */
  async getRecords(params = {}) {
    try {
      const response = await api.get('/api/attendance/records', { params });
      return response.data;
    } catch (error) {
      // If backend is not available or static hosting without backend, use Firestore client fallback
      if (!error.response || error.response?.status >= 500) {
        return await this.getRecordsFromFirestoreDirectly(params);
      }
      throw new Error(error.response?.data?.detail || error.response?.data?.message || 'Could not fetch attendance records');
    }
  },

  /**
   * Get personal attendance records for the logged-in employee
   */
  async getMyRecords(params = {}) {
    try {
      const response = await api.get('/api/attendance/me', { params });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.detail || error.response?.data?.message || 'Could not fetch personal attendance records');
    }
  },

  /**
   * Get today's punch-in and clock status for current employee
   */
  async getTodayStatus() {
    try {
      const response = await api.get('/api/attendance/today-status');
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.detail || error.response?.data?.message || 'Could not fetch today attendance status');
    }
  },

  /**
   * Calculate distance between two coordinates in meters using Haversine formula (frontend mirror)
   */
  calculateHaversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // meters
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  /**
   * Get authoritative office coordinates and geofence parameters from backend
   */
  async getOfficeLocation() {
    try {
      const response = await api.get('/api/attendance/office-location');
      return response.data;
    } catch (error) {
      console.warn('Could not fetch office location configuration from backend', error);
      // Fallback matching default configuration
      return {
        latitude: 12.9104417,
        longitude: 77.6442435,
        radiusMeters: 250,
        maxAccuracyMeters: 100,
        timezone: 'Asia/Kolkata',
      };
    }
  },

  /**
   * Pre-validate GPS coordinates and work mode on backend
   */
  async validateLocation({ latitude, longitude, accuracy, workMode }) {
    try {
      const response = await api.post('/api/attendance/validate-location', {
        latitude,
        longitude,
        accuracy,
        workMode,
      });
      return response.data;
    } catch (error) {
      const errData = error.response?.data;
      const code = errData?.code || (errData?.detail && typeof errData.detail === 'object' ? errData.detail.code : null);
      const message =
        (errData?.detail && typeof errData.detail === 'object' ? errData.detail.message : null) ||
        errData?.message ||
        errData?.detail ||
        error.message ||
        'Location verification failed';
      const customErr = new Error(message);
      customErr.code = code;
      customErr.status = error.response?.status;
      customErr.data = errData;
      throw customErr;
    }
  },

  /**
   * Check in employee with photo and GPS location coordinates
   */
  async checkIn(payload = {}) {
    try {
      let data;
      if (payload instanceof FormData) {
        data = payload;
      } else {
        const formData = new FormData();
        const photo = payload.photo || payload.file || payload.photoBlob || payload.capturedBlob;
        if (photo) {
          if (photo instanceof Blob || photo instanceof File) {
            formData.append('photo', photo, 'check_in_selfie.jpg');
          } else {
            formData.append('photo', photo);
          }
        }
        if (payload.latitude !== undefined && payload.latitude !== null) {
          formData.append('latitude', payload.latitude);
        }
        if (payload.longitude !== undefined && payload.longitude !== null) {
          formData.append('longitude', payload.longitude);
        }
        if (payload.accuracy !== undefined && payload.accuracy !== null) {
          formData.append('accuracy', payload.accuracy);
        }
        if (payload.workMode) formData.append('workMode', payload.workMode);
        if (payload.timestamp) formData.append('timestamp', payload.timestamp);
        if (payload.employeeId) formData.append('employeeId', payload.employeeId);
        data = formData;
      }
      const response = await api.post('/api/attendance/check-in', data);
      return response.data;
    } catch (error) {
      const errData = error.response?.data;
      const code = errData?.code || (errData?.detail && typeof errData.detail === 'object' ? errData.detail.code : null);
      const message =
        (errData?.detail && typeof errData.detail === 'object' ? errData.detail.message : null) ||
        errData?.message ||
        errData?.detail ||
        error.message ||
        'Check-in failed';
      const customErr = new Error(message);
      customErr.code = code;
      customErr.data = errData;
      throw customErr;
    }
  },

  /**
   * Submit mandatory late check-in reason
   */
  async submitLateReason({ attendanceId, reason, date } = {}) {
    try {
      const response = await api.post('/api/attendance/late-reason', {
        attendanceId,
        reason: (reason || '').trim(),
        date,
      });
      return response.data;
    } catch (error) {
      const msg = error.response?.data?.detail || error.response?.data?.message || error.message || 'Failed to submit late check-in reason.';
      throw new Error(msg);
    }
  },

  /**
   * Check out employee and lock daily attendance
   */
  async checkOut({ employeeId } = {}) {
    try {
      const payload = {};
      if (employeeId) {
        payload.employeeId = employeeId;
      }
      const response = await api.post('/api/attendance/check-out', payload);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.detail || error.response?.data?.message || 'Check-out failed');
    }
  },

  /**
   * Get attendance photo binary blob securely using authenticated API client
   */
  async getPhotoBlob(attendanceId, photoType = 'check-in') {
    try {
      const response = await api.get(`/api/attendance/${attendanceId}/photo/${photoType}`, {
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.detail || 'Could not load attendance photo');
    }
  },

  /**
   * Edit attendance record (Admin only)
   */
  async updateRecord(recordId, data) {
    try {
      const response = await api.patch(`/api/attendance/${recordId}`, data);
      return response.data;
    } catch (error) {
      throw new Error(error.response?.data?.detail || error.response?.data?.message || 'Failed to update attendance record');
    }
  },

  /**
   * Get monthly attendance reports with employee-wise breakdown, working days, and late reasons
   */
  async getMonthlyReport(params = {}) {
    try {
      const response = await api.get('/api/reports/monthly', { params });
      return response.data;
    } catch (error) {
      if (!error.response || error.response?.status >= 500) {
        // Fallback: calculate using client Firestore records
        return await this.getMonthlyReportFromFirestoreDirectly(params);
      }
      throw new Error(error.response?.data?.detail || error.response?.data?.message || 'Could not fetch monthly attendance report');
    }
  },

  /**
   * Client-side direct Firestore calculation fallback for monthly attendance reports
   */
  async getMonthlyReportFromFirestoreDirectly(params = {}) {
    try {
      const monthStr = params.month || new Date().toISOString().slice(0, 7);
      const [year, month] = monthStr.includes('-')
        ? monthStr.split('-').map(Number)
        : [new Date().getFullYear(), new Date().getMonth() + 1];

      const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
      const recs = await this.getRecordsFromFirestoreDirectly({
        start_date: `${monthPrefix}-01`,
        end_date: `${monthPrefix}-31`,
      });

      const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

      // Working days calculation
      const today = new Date();
      const isCurrentMonth = today.getFullYear() === year && (today.getMonth() + 1) === month;
      const daysInMonth = new Date(year, month, 0).getDate();
      const cutoffDay = isCurrentMonth ? today.getDate() : daysInMonth;

      let workingDays = 0;
      for (let d = 1; d <= cutoffDay; d++) {
        const dayOfWeek = new Date(year, month - 1, d).getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          workingDays++;
        }
      }

      // Group by employee
      const empMap = {};
      recs.forEach((r) => {
        const key = r.employeeId || r.employeeName || 'Unknown';
        if (!empMap[key]) {
          empMap[key] = {
            employeeId: r.employeeId || key,
            employeeName: r.employeeName || key,
            email: r.email || `${key.toLowerCase()}@arshithgroup.com`,
            department: r.department || 'Operations',
            presentDates: new Set(),
            wfoDays: 0,
            wfhDays: 0,
            lateDays: 0,
            lateReasons: [],
            dailyRecords: [],
          };
        }
        const emp = empMap[key];
        const isWfo = (r.workMode || '').toUpperCase() === 'WFO';
        if (isWfo) emp.wfoDays++;
        else emp.wfhDays++;

        if (r.isLate) {
          emp.lateDays++;
          if (r.lateReason) {
            emp.lateReasons.push({ date: r.date, reason: r.lateReason });
          }
        }
        emp.presentDates.add(r.date);
        emp.dailyRecords.push(r);
      });

      const employees = Object.values(empMap).map((emp) => {
        const presentDays = emp.presentDates.size;
        const approvedLeaveDays = 0;
        const eligibleDays = Math.max(0, workingDays - approvedLeaveDays);
        const attendancePercentage = eligibleDays > 0 ? Math.round((presentDays * 1000) / eligibleDays) / 10 : 0;
        const absentDays = Math.max(0, eligibleDays - presentDays);

        return {
          employeeId: emp.employeeId,
          employeeName: emp.employeeName,
          email: emp.email,
          department: emp.department,
          presentDays,
          workingDays,
          approvedLeaveDays,
          absentDays,
          attendancePercentage,
          wfoDays: emp.wfoDays,
          wfhDays: emp.wfhDays,
          lateDays: emp.lateDays,
          lateReasons: emp.lateReasons,
          dailyRecords: emp.dailyRecords,
        };
      });

      employees.sort((a, b) => b.attendancePercentage - a.attendancePercentage);

      const totalWfo = employees.reduce((acc, e) => acc + e.wfoDays, 0);
      const totalWfh = employees.reduce((acc, e) => acc + e.wfhDays, 0);
      const totalLate = employees.reduce((acc, e) => acc + e.lateDays, 0);
      const totalPresent = employees.reduce((acc, e) => acc + e.presentDays, 0);
      const totalAbsent = employees.reduce((acc, e) => acc + e.absentDays, 0);

      return {
        month: monthPrefix,
        monthName,
        totalWorkingDays: workingDays,
        summary: {
          totalRecords: recs.length,
          wfo: totalWfo,
          wfh: totalWfh,
          late: totalLate,
          present: totalPresent,
          absent: totalAbsent,
        },
        analytics: {
          wfo: totalWfo,
          wfh: totalWfh,
          late: totalLate,
          present: totalPresent,
          absent: totalAbsent,
          tiers: {
            excellent: employees.filter((e) => e.attendancePercentage >= 90).length,
            good: employees.filter((e) => e.attendancePercentage >= 75 && e.attendancePercentage < 90).length,
            low: employees.filter((e) => e.attendancePercentage < 75).length,
          },
        },
        employees,
      };
    } catch (err) {
      console.error('[AttendanceService] Direct monthly report fallback error:', err);
      return null;
    }
  },

  /**
   * Get attendance summary counts with optional single date or date-range parameters
   */
  async getSummary(params = {}) {
    try {
      const response = await api.get('/api/attendance/summary', { params });
      return response.data;
    } catch (error) {
      if (!error.response || error.response?.status >= 500) {
        const recs = await this.getRecords(params);
        const total = recs.length;
        const wfo = recs.filter((r) => (r.workMode || '').toUpperCase() === 'WFO').length;
        const wfh = recs.filter((r) => (r.workMode || '').toUpperCase() === 'WFH').length;
        const late = recs.filter((r) => r.isLate || (r.status || '').toUpperCase() === 'LATE').length;
        const present = recs.filter((r) => ['PRESENT', 'LATE', 'COMPLETED'].includes((r.status || '').toUpperCase())).length;
        const absent = recs.filter((r) => (r.status || '').toUpperCase() === 'ABSENT').length;
        return {
          totalAttendance: total,
          wfo,
          wfh,
          late,
          present,
          absent,
          totalPresent: present,
        };
      }
      throw new Error(error.response?.data?.detail || error.response?.data?.message || 'Could not fetch attendance summary');
    }
  },
};

export default attendanceService;
